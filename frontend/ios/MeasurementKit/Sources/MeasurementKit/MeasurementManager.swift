import Foundation

public enum ManagerState: String { case idle = "IDLE", arming = "ARMING", capturing = "CAPTURING", reconnecting = "RECONNECTING", sealing = "SEALING", draining = "DRAINING", closed = "CLOSED", blocked = "BLOCKED" }
public enum ManagerError: Error, Equatable { case nativeDisabled, jsOwnsBand, alreadyActive, notActive, invalidArgument(String) }

public protocol BandControlling: AnyObject {
    var delegate: BandLinkDelegate? { get set }
    func connect(expectedPeripheral: UUID?)
    func disconnect()
}
extension BandLink: BandControlling {}

public protocol LiveControlling: AnyObject {
    var state: LiveState { get }
    var lastAckSequence: UInt64 { get }
    var nativeHeartbeatCount: UInt64 { get }
    var onState: ((LiveState) -> Void)? { get set }
    var onEvent: (([String: Any]) -> Void)? { get set }
    var onCommandAck: (([String: Any]) -> Void)? { get set }
    func start()
    func stop()
    func dispatch(command: [String: Any])
    func setOwner(streamId: String, generation: UInt64)
    func clearOwner()
    func setVisibility(_ v: Visibility)
    func attach(outbox: MetricOutbox)
    func pump()
}
extension LiveSession: LiveControlling {}

/// 앱 프로세스 수명 동안 살아 있는 측정 매니저(UI unmount 는 stop 이 아니다).
/// BLE → engine(raw journal→코어→feature journal→outbox) → LiveSession(native Socket.IO) 와 archive 큐를 소유한다.
/// 앱 시작 시 WebView 보다 먼저 `recoverOnLaunch()` 로 복구한다. 기능 플래그 off 이면 아무 BLE 도 만지지 않는다.
public final class MeasurementManager: BandLinkDelegate {
    public static let nativeRuntimeVersion = "native-1.0.0", coreVersion = "core-1.0.0"
    public static let diskLimit = 536_870_912

    private let root: URL
    private let band: BandControlling
    private let ownership: BandOwnership
    private let makeLive: (String) -> LiveControlling
    private let makeEngine: (URL, StreamContext) throws -> MeasurementEngine
    private let participantHint: (String) -> String
    private let profile: (device: String, algorithm: String, model: String)
    private let nowMs: () -> UInt64
    private let lock = NSRecursiveLock()

    public private(set) var state: ManagerState = .idle
    public private(set) var blockedReason: String?
    public var onBridgeEvent: (([String: Any]) -> Void)?

    private var generation: UInt64 = 0
    private var eventSeq: UInt64 = 0
    private var managerId = ""
    private var requestId: String?
    private var sessionId: String?
    private var credentialHandle: String?
    private var configHash: String?
    private var live: LiveControlling?
    private var engine: MeasurementEngine?
    private var archive: ArchiveQueue?
    private var streamId: String?
    private var ownerGeneration: UInt64?
    private var participantId: String?
    private var peripheralId: UUID?
    private var bandState = "unknown"
    private var wasReconnecting = false
    private var needsRecoveryMark = false
    private var lastEnvelope: [String: Any]?
    private var bleGaps: [(id: String, start: UInt64, end: UInt64?)] = []
    private var openBleGapStart: UInt64?
    private var anchor: (wallMs: UInt64, monoUs: UInt64)?
    private var captureStartCommandId: String?
    private var streamWaiters: [(Result<(String, UInt64), ManagerError>) -> Void] = []
    private var batteryPct: Int?

    public init(root: URL, band: BandControlling, ownership: BandOwnership,
                makeLive: @escaping (String) -> LiveControlling,
                makeEngine: @escaping (URL, StreamContext) throws -> MeasurementEngine,
                participantId: @escaping (String) -> String,
                profile: (device: String, algorithm: String, model: String) = ("linkband2-v1", "web-ts-1", "b0-cohort-2"),
                nowMs: @escaping () -> UInt64 = { MonotonicClock.wallMs() }) {
        self.root = root; self.band = band; self.ownership = ownership; self.makeLive = makeLive; self.makeEngine = makeEngine
        self.participantHint = participantId; self.profile = profile; self.nowMs = nowMs
        band.delegate = self
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    // MARK: 시작·정지 (브리지 API)

    @discardableResult
    public func startMeasurement(sessionId: String, credentialHandle: String, configHash: String, requestId: String) throws -> [String: Any] {
        lock.lock(); defer { lock.unlock() }
        if let cur = self.requestId, cur == requestId, state != .idle, state != .closed {
            return startResult(replay: true)                       // 같은 requestId 는 새 수집을 시작하지 않는다
        }
        guard Self.isUUID(sessionId), Self.isUUID(requestId) else { throw ManagerError.invalidArgument("uuid") }
        if state != .idle && state != .closed { throw ManagerError.alreadyActive }
        switch ownership.tryAcquireNative() {
        case .rejected(.nativeDisabled): throw ManagerError.nativeDisabled
        case .rejected(.jsOwnsBand): throw ManagerError.jsOwnsBand
        case .acquired: break
        }
        generation += 1; managerId = UUID().uuidString.lowercased()
        self.requestId = requestId; self.sessionId = sessionId; self.credentialHandle = credentialHandle; self.configHash = configHash
        streamId = nil; ownerGeneration = nil; engine = nil; lastEnvelope = nil; blockedReason = nil
        bleGaps = []; openBleGapStart = nil; anchor = nil; needsRecoveryMark = false
        archive = try? ArchiveQueue(dir: sessionDir(sessionId).appendingPathComponent("archive"))
        state = .arming
        let l = makeLive(sessionId); live = l; wire(l)
        l.start()
        persistActive()
        let cid = UUID().uuidString.lowercased(); captureStartCommandId = cid
        l.dispatch(command: ["command_id": cid, "kind": "capture.start", "expected_epoch": "0", "client_generation": String(generation),
                             "payload": ["device_profile": profile.device, "algorithm_version": profile.algorithm, "model_version": profile.model]])
        band.connect(expectedPeripheral: peripheralId)
        emitMeasurementUpdated()
        return startResult(replay: false)
    }

    private func startResult(replay: Bool) -> [String: Any] {
        var r: [String: Any] = ["managerId": managerId, "managerGeneration": String(generation), "state": state.rawValue, "idempotentReplay": replay]
        r["ownerGeneration"] = ownerGeneration.map(String.init) ?? NSNull(); r["streamId"] = streamId ?? NSNull()
        return r
    }

    /// 서버가 capture.start 로 stream 을 발급(device 이벤트)하면 호출된다. 이미 있으면 즉시.
    public func awaitStream(_ done: @escaping (Result<(String, UInt64), ManagerError>) -> Void) {
        lock.lock(); defer { lock.unlock() }
        if let s = streamId, let g = ownerGeneration { done(.success((s, g))); return }
        if state == .blocked || state == .idle || state == .closed { done(.failure(.notActive)); return }
        streamWaiters.append(done)
    }

    @discardableResult
    public func stopMeasurement(reason: String, requestId: String) throws -> [String: Any] {
        lock.lock(); defer { lock.unlock() }
        guard state != .idle, state != .closed else { throw ManagerError.notActive }
        guard Self.isReason(reason), Self.isUUID(requestId) else { throw ManagerError.invalidArgument("reason") }
        band.disconnect()
        var started = false
        if let e = engine, let s = streamId, !e.isSealed {
            if let fin = try? e.seal() {
                started = true
                enqueueArchive(of: fin)
                live?.dispatch(command: ["command_id": UUID().uuidString.lowercased(), "kind": "capture.close", "expected_epoch": "0", "client_generation": String(generation),
                                         "payload": ["stream_id": s, "reason": reason,
                                                     "final_sequences": ["eeg": fin.eeg, "ppg": fin.ppg, "acc": fin.acc, "metric": fin.metric]]])
            }
        }
        state = started ? .sealing : .closed
        if !started { finishClosed() }
        persistActive()
        emitMeasurementUpdated()
        return ["seal_started": started, "state": state.rawValue, "note": "seal_started_is_not_archive_complete"]
    }

    /// 봉인 이후 raw/feature journal 을 불변 payload 로 보관하고 업로드 큐에 넣는다(T09 의 capture_stream_id/monotonic_range 포함).
    private func enqueueArchive(of fin: CoreFinal) {
        guard let sid = sessionId, let stream = streamId, let q = archive else { return }
        let dir = sessionDir(sid)
        let out = dir.appendingPathComponent("archive")
        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        for (kind, name) in [(ArchiveKind.raw, "raw.journal"), (ArchiveKind.feature, "feature.journal")] {
            let src = dir.appendingPathComponent(name)
            guard let data = try? Data(contentsOf: src), !data.isEmpty else { continue }
            let alias = "\(stream)-\(kind.rawValue)-0001"
            let file = alias + ".bin"
            let dst = out.appendingPathComponent(file)
            if !FileManager.default.fileExists(atPath: dst.path) { try? data.write(to: dst, options: .atomic) }
            let item = ArchiveItem(alias: alias, kind: kind, file: file, sha256: Hashing.sha256Hex(data), sizeBytes: data.count, captureStreamId: stream, monotonicRange: nil)
            try? q.enqueue(item)
        }
    }

    public var archiveQueue: ArchiveQueue? { lock.lock(); defer { lock.unlock() }; return archive }
    public func archiveFileURL(_ item: ArchiveItem) -> URL {
        lock.lock(); defer { lock.unlock() }
        return sessionDir(sessionId ?? "").appendingPathComponent("archive").appendingPathComponent(item.file)
    }

    public func dispatchLiveCommand(_ command: [String: Any]) throws -> [String: Any] {
        lock.lock(); defer { lock.unlock() }
        guard let id = command["command_id"] as? String, Self.isUUID(id), command["kind"] is String else { throw ManagerError.invalidArgument("command") }
        guard let l = live, state != .idle, state != .closed else { throw ManagerError.notActive }
        l.dispatch(command: command)
        return ["command_id": id, "accepted_for_send": true, "queued_at_native_ms": nowMs()]
    }

    public func setVisibility(_ v: Visibility) { lock.lock(); live?.setVisibility(v); lock.unlock() }

    // MARK: 복구 (앱 시작, WebView 보다 먼저)

    /// 이전 프로세스가 수집 중이었다면(active.json) journal/outbox/코어 checkpoint 로 복원하고 BLE·live 를 다시 붙인다.
    /// 사용자가 force quit 한 뒤 재실행을 OS 가 보장하지 않으므로, 복구 성공을 약속하지 않고 사이 구간은 bounded gap 으로 남긴다.
    @discardableResult
    public func recoverOnLaunch() -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard state == .idle, ownership.nativeEnabled, let a = loadActive(),
              let sid = a["sessionId"] as? String, let st = a["state"] as? String, st != "CLOSED", st != "SEALING",
              let stream = a["streamId"] as? String, let gen = (a["ownerGeneration"] as? String).flatMap({ UInt64($0) }),
              let pid = a["participantId"] as? String else { return false }
        guard case .acquired = ownership.tryAcquireNative() else { return false }
        generation = (a["managerGeneration"] as? UInt64) ?? 1; managerId = (a["managerId"] as? String) ?? UUID().uuidString.lowercased()
        requestId = a["requestId"] as? String; sessionId = sid; credentialHandle = a["credentialHandle"] as? String; configHash = a["configHash"] as? String
        peripheralId = (a["peripheralId"] as? String).flatMap(UUID.init(uuidString:))
        guard let cred = credentialHandle else { ownership.releaseNative(); return false }
        _ = cred
        participantId = pid; streamId = stream; ownerGeneration = gen
        archive = try? ArchiveQueue(dir: sessionDir(sid).appendingPathComponent("archive"))
        guard adoptEngine(sessionId: sid, participant: pid, stream: stream, generation: gen) else { ownership.releaseNative(); state = .blocked; blockedReason = "storage_full"; return false }
        needsRecoveryMark = true
        state = .reconnecting
        let l = makeLive(sid); live = l; wire(l); l.attach(outbox: engine!.outbox); l.setOwner(streamId: stream, generation: gen)
        l.start()
        band.connect(expectedPeripheral: peripheralId)
        return true
    }

    // MARK: wiring

    private func wire(_ l: LiveControlling) {
        l.onState = { [weak self] s in self?.liveStateChanged(s) }
        l.onEvent = { [weak self] e in self?.handleLiveEvent(e) }
        l.onCommandAck = { [weak self] a in self?.emit(event: "commandAck", payload: a) }
    }

    public func liveStateChanged(_ s: LiveState) {
        lock.lock(); defer { lock.unlock() }
        switch s {
        case .authBlocked: blockedReason = "auth_expired"                 // 수집은 계속, live 만 막힘
        case .revoked:
            blockedReason = "consent_missing"; state = .blocked; band.disconnect(); live?.clearOwner(); persistActive()
        case .ready:
            if blockedReason == "auth_expired" { blockedReason = nil }
            live?.pump()
        default: break
        }
        emit(event: "liveStateUpdated", payload: nil, liveState: s)
        emitMeasurementUpdated()
    }

    public func handleLiveEvent(_ e: [String: Any]) {
        lock.lock(); defer { lock.unlock() }
        if (e["domain"] as? String) == "device", let p = e["payload"] as? [String: Any], let sid = p["stream_id"] as? String {
            let gen = (p["generation"] as? NSNumber)?.uint64Value ?? (p["generation"] as? String).flatMap { UInt64($0) } ?? 0
            let status = p["status"] as? String
            if let own = streamId {
                if sid == own, status != "active", status != nil { fence(); return }                 // 내 stream 이 superseded/closed
                if sid != own, gen > (ownerGeneration ?? 0), status == "active" { fence(); return }  // 더 새 owner 세대
            } else if status == "active" {
                let entity = (e["entity_id"] as? String)
                let aud = e["audience"] as? String
                if let aud = aud, !aud.hasPrefix("member:") && aud != "host" { return }
                adopt(stream: sid, generation: gen, participant: entity ?? participantHint(sessionId ?? ""))
            }
        }
        emit(event: "liveStateUpdated", payload: e)
    }

    private func fence() {
        blockedReason = "owner_fenced"; state = .blocked
        band.disconnect(); live?.clearOwner()
        persistActive(); emitMeasurementUpdated()
    }

    private func adopt(stream: String, generation gen: UInt64, participant: String) {
        guard let sid = sessionId else { return }
        streamId = stream; ownerGeneration = gen; participantId = participant
        guard adoptEngine(sessionId: sid, participant: participant, stream: stream, generation: gen) else {
            blockedReason = "storage_full"; state = .blocked; band.disconnect(); return
        }
        live?.setOwner(streamId: stream, generation: gen)
        if let e = engine { live?.attach(outbox: e.outbox) }
        state = .capturing
        persistActive()
        let ws = streamWaiters; streamWaiters = []
        ws.forEach { $0(.success((stream, gen))) }
        emitMeasurementUpdated()
    }

    private func adoptEngine(sessionId sid: String, participant: String, stream: String, generation gen: UInt64) -> Bool {
        let ctx = StreamContext(sessionId: sid, participantId: participant, streamId: stream, streamGeneration: gen,
                                clockAnchorId: UUID().uuidString.lowercased(), clockUncertaintyMs: 300_000)
        let dir = sessionDir(sid)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        do { engine = try makeEngine(dir, ctx) } catch { return false }
        engine?.onFrame = { [weak self] env in self?.frameArrived(env) }
        if anchor == nil { anchor = (nowMs(), MonotonicClock.nowUs()) }
        return true
    }

    private func frameArrived(_ env: [String: Any]) {
        lock.lock(); lastEnvelope = env; lock.unlock()
        live?.pump()
        emitMeasurementUpdated()
    }

    // MARK: BandLinkDelegate

    public func bandLink(didReceive sensor: BandSensor, data: Data, monotonicUs: UInt64) {
        lock.lock(); defer { lock.unlock() }
        guard state == .capturing || state == .reconnecting, let e = engine, let a = anchor else { return }
        if needsRecoveryMark { e.markResumeAfterRecovery(firstMonotonicUs: monotonicUs); needsRecoveryMark = false }
        if let start = openBleGapStart { bleGaps.append((UUID().uuidString.lowercased(), start, e.lastCommittedRawSequence)); openBleGapStart = nil }
        do { try e.ingest(sensor: sensor, bytes: data, arrivalMonotonicUs: monotonicUs, wallMs: a.wallMs, anchorMonotonicUs: a.monoUs) }
        catch MeasurementEngine.EngineError.storageFull {
            blockedReason = "storage_full"; state = .blocked; band.disconnect(); persistActive(); emitMeasurementUpdated()
        } catch { /* 코어 오류는 raw 가 이미 journal 에 있어 재생으로 복구 가능 — 다음 패킷에서 계속 */ }
    }

    public func bandLink(didChange s: BandLinkState, reason: String?) {
        lock.lock(); defer { lock.unlock() }
        switch s {
        case .subscribed:
            bandState = "connected"
            if state == .reconnecting, streamId != nil { state = .capturing }
        case .reconnecting, .connecting, .discovering, .scanning:
            bandState = s == .reconnecting ? "reconnecting" : "connecting"
            if state == .capturing { state = .reconnecting; openBleGapStart = engine?.lastCommittedRawSequence }
            if reason == "bluetooth_off" { blockedReason = "bluetooth_off" }
        case .blocked:
            bandState = "lost"
            if reason?.contains("unauthorized") == true { blockedReason = "bluetooth_permission"; state = .blocked }
            else if reason?.contains("unsupported") == true { blockedReason = "unsupported_background"; state = .blocked }
        case .idle: bandState = "not_worn"
        }
        if s == .subscribed, blockedReason == "bluetooth_off" { blockedReason = nil }
        persistActive(); emitMeasurementUpdated()
    }
    public func bandLink(didReadBattery pct: Int) { lock.lock(); batteryPct = pct; lock.unlock() }
    public func bandLink(didSelect peripheral: UUID) { lock.lock(); peripheralId = peripheral; persistActive(); lock.unlock() }

    // MARK: 스냅샷·이벤트

    private func freshness(_ env: [String: Any]?) -> String {
        guard let obs = (env?["observed_at_ms"] as? NSNumber)?.uint64Value else { return "stale" }
        let age = Double(Int64(nowMs()) - Int64(obs)) / 1000
        return age < 3 ? "fresh" : age < 10 ? "delayed" : "stale"
    }

    private func liveSocket() -> String {
        switch live?.state ?? .idle { case .ready: return "ready"; case .degraded: return "degraded"; case .connecting, .resyncing: return "connecting"; default: return "disconnected" }
    }

    public func snapshot() -> [String: Any] {
        lock.lock(); defer { lock.unlock() }
        let c = engine?.counters
        let oc = engine?.outbox.counts()
        let ac = archive?.counts ?? ArchiveCounts()
        var metrics: Any = NSNull()
        if let env = lastEnvelope, let seq = env["sequence"] {
            metrics = ["sequence": seq, "observed_at_ms": env["observed_at_ms"] ?? NSNull(), "freshness": freshness(env), "sqi": env["sqi"] ?? NSNull(),
                       "contact": env["contact"] ?? [:], "metrics": env["metrics"] ?? [:]] as [String: Any]
        }
        var gaps: [[String: Any]] = (engine?.gaps ?? []).map { g in
            ["gap_id": UUID().uuidString.lowercased(), "kind": g.kind, "start_sample_sequence": g.startSample, "end_sample_sequence": NSNull(), "bounded": g.bounded]
        }
        gaps += bleGaps.map { ["gap_id": $0.id, "kind": "ble_disconnect", "start_sample_sequence": String($0.start), "end_sample_sequence": $0.end.map(String.init) ?? NSNull(), "bounded": true] }
        if let open = openBleGapStart { gaps.append(["gap_id": "00000000-0000-4000-8000-000000000000", "kind": "ble_disconnect", "start_sample_sequence": String(open), "end_sample_sequence": NSNull(), "bounded": false]) }
        if blockedReason == "storage_full" { gaps.append(["gap_id": UUID().uuidString.lowercased(), "kind": "storage_full", "start_sample_sequence": String(engine?.lastCommittedRawSequence ?? 0), "end_sample_sequence": NSNull(), "bounded": false]) }
        let disk = Int(engine?.diskUsedBytes ?? 0)
        return [
            "bridge_version": 1, "managerGeneration": String(generation), "seq": String(eventSeq), "sessionId": sessionId ?? "00000000-0000-4000-8000-000000000000",
            "state": state.rawValue, "blocked_reason": blockedReason ?? NSNull(), "streamId": streamId ?? NSNull(), "ownerGeneration": ownerGeneration.map(String.init) ?? NSNull(),
            "versions": ["native_runtime": Self.nativeRuntimeVersion, "core": Self.coreVersion, "algorithm": profile.algorithm, "model": profile.model, "device_profile": profile.device],
            "metrics": metrics,
            "collection": ["band_state": bandState, "last_committed_sample_sequence": String(engine?.lastCommittedRawSequence ?? 0),
                           "counters": ["packets": ["eeg": String(c?.packets["eeg"] ?? 0), "ppg": String(c?.packets["ppg"] ?? 0), "acc": String(c?.packets["acc"] ?? 0)],
                                        "samples": ["eeg": String(c?.samples["eeg"] ?? 0), "ppg": String(c?.samples["ppg"] ?? 0), "acc": String(c?.samples["acc"] ?? 0)],
                                        "native_metric_windows": String(c?.metricWindows ?? 0), "native_heartbeat": String(live?.nativeHeartbeatCount ?? 0),
                                        "js_heartbeat_independent": true]],
            "live": ["socket": liveSocket(), "last_ack_sequence": (live?.lastAckSequence).map { $0 == 0 ? NSNull() : String($0) as Any } ?? NSNull(), "snapshot_through": [Any]()],
            "archive": ["queue": ["live_pending": oc?.livePending ?? 0, "live_acked": oc?.liveAcked ?? 0, "archive_pending": ac.pending + ac.uploading, "archive_verified": ac.verified,
                                  "pending_authorization": ac.pendingAuthorization, "pending_time_review": ac.pendingTimeReview, "oldest_pending_age_ms": NSNull(),
                                  "disk_used_bytes": disk, "disk_limit_bytes": Self.diskLimit], "last_verified_at_ms": NSNull()],
            "gaps": gaps,
        ]
    }

    public func emitMeasurementUpdated() { emit(event: "measurementUpdated", payload: nil, snapshot: true) }
    public func emitArchiveStatus(stage: String?, code: String?) {
        lock.lock(); defer { lock.unlock() }
        guard let sid = sessionId else { return }
        let q = (snapshot()["archive"] as? [String: Any])?["queue"] ?? [:]
        emit(event: "archiveStatus", payload: ["sessionId": sid, "queue": q, "blocked_reason": blockedReason ?? NSNull(), "stage": stage ?? NSNull(), "code": code ?? NSNull()])
    }

    private func emit(event: String, payload: [String: Any]?, liveState: LiveState? = nil, snapshot snap: Bool = false) {
        lock.lock(); defer { lock.unlock() }
        guard generation > 0 else { return }
        var body: [String: Any]
        if snap { body = snapshot() }
        else if event == "liveStateUpdated" {
            guard let sid = sessionId else { return }
            // 계약: payload.event 는 LiveEvent. 상태 변화는 별도 필드 없이 snapshot 으로 전달하므로 서버 이벤트만 그대로 전달한다.
            guard let p = payload else { return }
            body = ["sessionId": sid, "event": p]
        } else { body = payload ?? [:] }
        if event == "liveStateUpdated", payload == nil { return }
        eventSeq += 1
        onBridgeEvent?(["bridge_version": 1, "event": event, "managerGeneration": String(generation), "seq": String(eventSeq),
                        "emitted_at_native_ms": nowMs(), "payload": body])
    }

    // MARK: 영속(active.json)

    private func sessionDir(_ sid: String) -> URL { root.appendingPathComponent("sessions").appendingPathComponent(sid.isEmpty ? "none" : sid) }
    private var activeURL: URL { root.appendingPathComponent("active.json") }

    private func persistActive() {
        guard let sid = sessionId else { return }
        var a: [String: Any] = ["sessionId": sid, "state": state.rawValue, "managerId": managerId, "managerGeneration": generation]
        if let v = requestId { a["requestId"] = v }
        if let v = credentialHandle { a["credentialHandle"] = v }
        if let v = configHash { a["configHash"] = v }
        if let v = streamId { a["streamId"] = v }
        if let v = ownerGeneration { a["ownerGeneration"] = String(v) }
        if let v = participantId { a["participantId"] = v }
        if let v = peripheralId { a["peripheralId"] = v.uuidString }
        if state == .closed || state == .idle { try? FileManager.default.removeItem(at: activeURL); return }
        if let d = try? JSONSerialization.data(withJSONObject: a) { try? d.write(to: activeURL, options: .atomic) }
    }
    private func loadActive() -> [String: Any]? {
        guard let d = try? Data(contentsOf: activeURL) else { return nil }
        var o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any]
        if let g = (o?["managerGeneration"] as? NSNumber)?.uint64Value { o?["managerGeneration"] = g }
        return o
    }
    private func finishClosed() { live?.stop(); ownership.releaseNative(); state = .closed; persistActive() }

    /// 봉인 후 archive 가 모두 끝나면 호출(DRAINING → CLOSED). 완료 판단은 큐 카운트 기준(서버 verify ACK 만 완료).
    public func archiveProgressed() {
        lock.lock(); defer { lock.unlock() }
        guard state == .sealing || state == .draining, let q = archive else { return }
        let c = q.counts
        state = (c.pending + c.uploading) == 0 && c.pendingAuthorization == 0 && c.pendingTimeReview == 0 ? .closed : .draining
        if state == .closed { finishClosed() } else { persistActive() }
        emitMeasurementUpdated()
    }

    // MARK: util

    static func isUUID(_ s: String) -> Bool { s.range(of: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", options: .regularExpression) != nil }
    static func isReason(_ s: String) -> Bool { s.range(of: "^[a-z][a-z0-9_]{0,63}$", options: .regularExpression) != nil }
}
