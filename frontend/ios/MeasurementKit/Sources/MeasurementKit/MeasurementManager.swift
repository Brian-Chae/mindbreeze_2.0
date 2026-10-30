import Foundation
import os

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
    var onDeviceRejected: ((String) -> Void)? { get set }
    func reportDevice(_ report: [String: Any])
    func clockProbe(clientMonotonicUs: UInt64, _ done: @escaping (Result<ClockProbeResult, ClockProbeError>) -> Void)
}
extension LiveSession: LiveControlling {}

/// 계약 u64 는 JSON 십진 문자열이다. 정수(JSON number)는 받지 않는다(서버가 문자열로 통일 — 정수 가정 제거).
enum U64 {
    static func parse(_ v: Any?) -> UInt64? {
        guard let s = v as? String, !s.isEmpty, s.count <= 20, s.allSatisfy({ $0.isASCII && $0.isNumber }) else { return nil }
        return UInt64(s)
    }
}

/// 앱 프로세스 수명 동안 살아 있는 측정 매니저(UI unmount 는 stop 이 아니다).
/// BLE → engine(raw journal→코어→feature journal→outbox) → LiveSession(native Socket.IO) 와 archive 큐를 소유한다.
/// 앱 시작 시 WebView 보다 먼저 `recoverOnLaunch()` 로 복구한다. 기능 플래그 off 이면 아무 BLE 도 만지지 않는다.
public final class MeasurementManager: BandLinkDelegate {
    /// 실기기 진단용(Console.app 에서 subsystem 으로 필터). 토큰·값은 싣지 않는다.
    private static let log = Logger(subsystem: "com.looxidlabs.mindbreeze2", category: "measurement")

    public static let nativeRuntimeVersion = "native-1.0.0", coreVersion = "core-1.0.0"
    public static let diskLimit = 536_870_912
    /// 서버 capture lease 는 30초(CAPTURE_LEASE_SECONDS). lease 가 유효해야 live 투영되므로 10초마다 갱신한다.
    public static let renewInterval: TimeInterval = 10
    /// 서버 anchor 재확정 주기. READY 진입(재연결)마다 즉시 한 번 더 한다.
    public static let clockResyncInterval: TimeInterval = 300
    /// anchor 전 오차 = 계약 최댓값(알 수 없음). 서버는 anchor 가 없으면 어차피 time_uncertain 으로 판정한다.
    public static let unknownClockUncertaintyMs: Double = 300_000

    private let root: URL
    private let band: BandControlling
    private let ownership: BandOwnership
    private let makeLive: (String) -> LiveControlling
    private let makeEngine: (URL, StreamContext, ModelPin?) throws -> MeasurementEngine
    private let scheduler: Scheduler
    private let monoUs: () -> UInt64
    private let profile: (device: String, algorithm: String, model: String)
    /// 세션 단위 활성 표준 모델 pin(없으면 코호트 profile.model). capture.start·snapshot·envelope 가 같은 값을 쓴다.
    private var pin: ModelPin?
    private var modelVersion: String { pin?.modelVersion ?? profile.model }
    private let nowMs: () -> UInt64
    private let lock = NSRecursiveLock()

    public private(set) var state: ManagerState = .idle
    public private(set) var blockedReason: String?
    public var onBridgeEvent: (([String: Any]) -> Void)?
    /// 봉인(사용자 정지·회차 종료·terminal) 직후 — 호스트가 archive 업로드를 시작한다. (sessionId, credentialHandle)
    public var onSealed: ((String, String?) -> Void)?

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
    private var captureStartCommand: [String: Any]?
    private var streamWaiters: [(Result<(String, UInt64), ManagerError>) -> Void] = []
    private var batteryPct: Int?
    // T07b: capture lease 갱신·서버 시계 anchor·live:device
    private var leaseExpiresAtMs: UInt64?
    private var renewCommandId: String?
    private var renewTimer: Cancellable?, clockTimer: Cancellable?
    private var probing = false
    private var reanchorPending: (commandId: String, probe: ClockProbeResult)?
    private var clockAnchorId = UUID().uuidString.lowercased()
    private var clockUncertaintyMs = MeasurementManager.unknownClockUncertaintyMs
    private var deviceSeq: UInt64 = 0
    private var deviceReportingStopped = false
    private var lastContact: [String: String]?
    private var lastSqi: Any = NSNull()

    public init(root: URL, band: BandControlling, ownership: BandOwnership,
                makeLive: @escaping (String) -> LiveControlling,
                makeEngine: @escaping (URL, StreamContext, ModelPin?) throws -> MeasurementEngine,
                scheduler: Scheduler = DispatchScheduler(queue: DispatchQueue(label: "com.looxidlabs.mindbreeze2.measurement.manager")),
                profile: (device: String, algorithm: String, model: String) = ("linkband2-v1", "web-ts-1", "b0-cohort-2"),
                nowMs: @escaping () -> UInt64 = { MonotonicClock.wallMs() },
                monoUs: @escaping () -> UInt64 = { MonotonicClock.nowUs() }) {
        self.root = root; self.band = band; self.ownership = ownership; self.makeLive = makeLive; self.makeEngine = makeEngine
        self.scheduler = scheduler; self.profile = profile; self.nowMs = nowMs; self.monoUs = monoUs
        band.delegate = self
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    // MARK: 시작·정지 (브리지 API)

    @discardableResult
    public func startMeasurement(sessionId: String, credentialHandle: String, configHash: String, requestId: String, peripheralId: String? = nil,
                                  modelParams: String? = nil, modelVersion: String? = nil) throws -> [String: Any] {
        lock.lock(); defer { lock.unlock() }
        if let cur = self.requestId, cur == requestId, state != .idle, state != .closed {
            return startResult(replay: true)                       // 같은 requestId 는 새 수집을 시작하지 않는다
        }
        guard Self.isUUID(sessionId), Self.isUUID(requestId) else { throw ManagerError.invalidArgument("uuid") }
        if state != .idle && state != .closed {
            // 다른 회차의 수집이 남아 있으면(앱 재시작 복구 등) 새 시작을 영구히 막지 않도록 그 회차를 봉인하고 넘긴다. 같은 회차는 기존대로 거절.
            guard let old = self.sessionId, old != sessionId else { throw ManagerError.alreadyActive }
            Self.log.error("다른 회차 수집이 남아 있어 봉인 후 교체 old=\(old, privacy: .public) state=\(self.state.rawValue, privacy: .public)")
            if state == .arming || state == .capturing || state == .reconnecting { seal(reason: "superseded", closeStream: true) }
            live?.stop(); live = nil
            ownership.releaseNative()
            state = .closed
            persistActive()
        }
        switch ownership.tryAcquireNative() {
        case .rejected(.nativeDisabled): throw ManagerError.nativeDisabled
        case .rejected(.jsOwnsBand): throw ManagerError.jsOwnsBand
        case .acquired: break
        }
        generation += 1; managerId = UUID().uuidString.lowercased()
        self.requestId = requestId; self.sessionId = sessionId; self.credentialHandle = credentialHandle; self.configHash = configHash
        // 웹뷰 BLE 로 선택된 밴드(UUID 문자열)를 이어받는다. 없거나 UUID 가 아니면 현행 스캔.
        self.peripheralId = peripheralId.flatMap(UUID.init(uuidString:))
        streamId = nil; ownerGeneration = nil; participantId = nil; engine = nil; lastEnvelope = nil; blockedReason = nil
        bleGaps = []; openBleGapStart = nil; anchor = nil; needsRecoveryMark = false
        resetStreamRuntime()
        // 활성 표준 모델 1회 pin: 세션 디렉터리의 pin 파일이 있으면 그것을 쓰고(도중 교체 금지), 없을 때만 새로 기록한다.
        pin = ModelPin.loadOrCreate(file: sessionDir(sessionId).appendingPathComponent("model-pin.json"), rawParams: modelParams, version: modelVersion)
        archive = openArchive(sessionId)
        state = .arming
        let l = makeLive(sessionId); live = l; wire(l)
        l.start()
        persistActive()
        // expected_epoch 는 넣지 않는다 — LiveSession 이 보낼 때 서버 epoch 로 채운다("0" 고정이면 매번 epoch_mismatch).
        let cmd: [String: Any] = ["command_id": UUID().uuidString.lowercased(), "kind": "capture.start", "client_generation": String(generation),
                                  "payload": ["device_profile": profile.device, "algorithm_version": profile.algorithm, "model_version": self.modelVersion]]
        captureStartCommand = cmd
        Self.log.info("capture.start 송신 session=\(sessionId, privacy: .public) gen=\(self.generation) cmd=\((cmd["command_id"] as? String) ?? "", privacy: .public)")
        l.dispatch(command: cmd)
        band.connect(expectedPeripheral: self.peripheralId)
        emitMeasurementUpdated()
        return startResult(replay: false)
    }

    private func startResult(replay: Bool) -> [String: Any] {
        var r: [String: Any] = ["managerId": managerId, "managerGeneration": String(generation), "state": state.rawValue, "idempotentReplay": replay]
        r["ownerGeneration"] = ownerGeneration.map(String.init) ?? NSNull(); r["streamId"] = streamId ?? NSNull()
        return r
    }

    /// 화면의 '다시 연결' — 수집 중일 때만 밴드 링크를 끊었다 다시 붙인다(백오프 초기화). JS BLE 를 거치지 않는다.
    @discardableResult
    public func reconnectBand() throws -> [String: Any] {
        lock.lock(); defer { lock.unlock() }
        guard state == .arming || state == .capturing || state == .reconnecting else { throw ManagerError.notActive }
        Self.log.info("밴드 재연결 요청 band_state=\(self.bandState, privacy: .public) state=\(self.state.rawValue, privacy: .public)")
        band.disconnect()
        band.connect(expectedPeripheral: peripheralId)
        return ["accepted": true, "band_state": bandState, "state": state.rawValue]
    }

    /// 서버가 capture.start ACK(result)로 stream 을 발급하면 호출된다. 이미 있으면 즉시.
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
        let started = seal(reason: reason, closeStream: true)
        return ["seal_started": started, "state": state.rawValue, "note": "seal_started_is_not_archive_complete"]
    }

    /// 수집 중단 + 코어 마감 + (closeStream 이면) archive 큐 적재·capture.close. 사용자 정지와 서버 종료(terminal/ended)가 같은 경로를 쓴다.
    /// 반환: 봉인을 새로 시작했는지. archive 완료가 아니다(서버 verify ACK 만 완료).
    @discardableResult
    private func seal(reason: String, closeStream: Bool) -> Bool {
        stopStreamTimers()
        band.disconnect()
        var started = false
        if let e = engine, let s = streamId, !e.isSealed {
            if let fin = try? e.seal() {
                started = true
                enqueueArchive(of: fin)
                // 종료 기록(close intent)을 서버 응답 이전에 디스크에 먼저 남긴다 — 앱이 죽어도 다음 실행/업로드 완료 깨움에서 이어 보낸다.
                if closeStream, let sid = sessionId, let q = archive {
                    Self.closeIntentStore(root: root, sessionId: sid).record(queue: q, sessionId: sid, participantId: participantId, reason: reason, nowUs: Int64(nowMs()) * 1000)
                }
                if closeStream {
                    live?.dispatch(command: ["command_id": UUID().uuidString.lowercased(), "kind": "capture.close", "client_generation": String(generation),
                                             "payload": ["stream_id": s, "reason": reason,
                                                         "final_sequences": ["eeg": fin.eeg, "ppg": fin.ppg, "acc": fin.acc, "metric": fin.metric]]])
                }
            }
        }
        state = started ? .sealing : .closed
        if !started { finishClosed() }
        persistActive()
        emitMeasurementUpdated()
        if started, let sid = sessionId { onSealed?(sid, credentialHandle) }
        return started
    }

    /// 서버가 회차를 끝냈다(live:terminal 또는 내 stream 이 ended) → 자동 봉인·drain. 이미 봉인/정지 상태면 아무것도 안 한다.
    private func autoSeal(reason: String) {
        guard state == .arming || state == .capturing || state == .reconnecting else { return }
        seal(reason: reason, closeStream: true)
    }

    /// 봉인 이후 raw/feature journal 을 서버 계약(raw-v2 청크 / feature-v1 ndjson)으로 변환해 업로드 큐에 넣는다(T09 의 capture_stream_id/monotonic_range 포함).
    /// 통파일(journal 그대로)로 올리면 서버 필수 메타가 없어 항상 422 였다(SDD-252). alias 가 결정적이라 복구 재생에서도 한 번만 큐에 들어간다.
    private func enqueueArchive(of fin: CoreFinal) {
        guard let sid = sessionId, let stream = streamId, let q = archive else { return }
        let dir = sessionDir(sid)
        let out = dir.appendingPathComponent("archive")
        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        func put(_ alias: String, _ kind: ArchiveKind, _ data: Data, _ meta: [String: Any], range: (String, String)?) {
            let file = alias + ".bin"
            let dst = out.appendingPathComponent(file)
            if !FileManager.default.fileExists(atPath: dst.path) { try? data.write(to: dst, options: .atomic) }
            var item = ArchiveItem(alias: alias, kind: kind, file: file, sha256: Hashing.sha256Hex(data), sizeBytes: data.count, captureStreamId: stream, monotonicRange: range)
            item.meta = meta
            try? q.enqueue(item)
        }
        // 1) 원시 EEG/PPG/ACC 청크 — raw.journal 을 도착 순서대로 센서별 RawChunker 에 먹인다.
        let packets = MeasurementEngine.rawPackets(in: dir)
        let origin: Int64 = packets.first.map { Int64($0.wall) * 1000 + Int64(bitPattern: $0.arrival &- $0.anchor) } ?? 0
        var chunkers: [BandSensor: RawChunker] = [:]
        func chunker(_ s: BandSensor) -> RawChunker {
            if let c = chunkers[s] { return c }
            let c = RawChunker(sensor: s, session: sid, originUs: origin) { chunk in
                let h = chunk.meta["header"] as? [String: Any]
                let a = h?["anchor"] as? [String: Any]
                let from = (a?["monotonic_us"] as? String) ?? "0"
                put(chunk.alias, .raw, chunk.payload, chunk.meta, range: (from, from)) // raw 는 header 가 창을 정의 — range 는 큐 표시용
            }
            chunkers[s] = c; return c
        }
        for p in packets {
            let us = Int64(p.wall) * 1000 + Int64(bitPattern: p.arrival &- p.anchor)   // 코어 창과 같은 시간축
            chunker(p.sensor).onPacket(p.bytes, arrivalUs: us)
        }
        for c in chunkers.values { c.flush() }
        // 2) feature — feature.journal 의 프레임(envelope JSON)을 60개씩 ndjson 으로 묶는다.
        let frames: [[String: Any]] = AppendOnlyJournal.scan(url: dir.appendingPathComponent("feature.journal")).records
            .compactMap { try? JSONSerialization.jsonObject(with: $0.payload) as? [String: Any] }
        let scopeStream = RawIds.streamId(session: sid, sensor: .eeg), scopeSegment = RawIds.segmentId(session: sid, sensor: .eeg, ordinal: 0)
        var i = 0
        while i < frames.count {
            let slice = Array(frames[i..<min(i + 60, frames.count)])
            i += 60
            let seqs = slice.compactMap { ($0["sequence"] as? String).flatMap(UInt64.init) }
            guard let first = seqs.first, let last = seqs.last, let s = slice.first, let e = slice.last else { continue }
            var body = Data()
            for f in slice { if let d = try? JSONSerialization.data(withJSONObject: f, options: [.sortedKeys]) { body += d; body.append(0x0A) } }
            let alias = "NF-\(String(stream.prefix(8)))-\(first)"
            let from = (s["window_start_us"] as? String) ?? "0", to = (e["window_end_us"] as? String) ?? from
            let meta: [String: Any] = ["artifact_alias": alias, "artifact_kind": "feature", "stream_id": scopeStream, "segment_id": scopeSegment, "signal": "eeg",
                "sequence": first, "first_sequence": first, "last_sequence": last, "row_count": slice.count, "content_encoding": "identity", "schema_version": "feature-v1",
                "checksum": Hashing.sha256Hex(body), "size_bytes": body.count, "content_type": "application/x-ndjson",
                "time_range": ["from_us": from, "to_us": to], "monotonic_range": ["from_us": from, "to_us": to]]
            put(alias, .feature, body, meta, range: (from, to))
        }
    }

    /// 기기 시트 원시 파형 미리보기. 측정 중이 아니면 빈 배열.
    public func rawPreview(points: Int) -> [String: Any] {
        lock.lock(); defer { lock.unlock() }
        let p = engine?.rawPreview.preview(points: min(max(points, 2), 500))
        return p?.dictionary ?? ["eegFp1": [Double](), "eegFp2": [Double](), "ppgRed": [Double](), "ppgIr": [Double]()]
    }

    /// 세션 디렉터리의 종료 기록 저장소(호스트가 앱 재시작 후에도 같은 파일로 재전송한다).
    public static func closeIntentStore(root: URL, sessionId: String) -> CloseIntentStore {
        CloseIntentStore(file: root.appendingPathComponent("sessions").appendingPathComponent(sessionId).appendingPathComponent(CloseIntentStore.fileName))
    }
    public func closeIntentStore(sessionId: String) -> CloseIntentStore { Self.closeIntentStore(root: root, sessionId: sessionId) }
    /// 해당 세션이 지금 manager 가 들고 있는 세션일 때만 그 큐(다른 세션 큐를 잘못 쓰지 않는다).
    public func archiveQueue(forSession sid: String) -> ArchiveQueue? { lock.lock(); defer { lock.unlock() }; return sessionId == sid ? archive : nil }
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
        if let why = Self.recoveryVeto(sessionDir: sessionDir(sid), nowMs: nowMs()) {
            // 이틀 지난 CAPTURING 세션·수백 MB 저널을 매 실행마다 되살리다 3GB 메모리 한도로 앱이 죽었다. 되살리지 않고 증거를 보존한 채 치운다.
            Self.log.error("세션 복구 거부 session=\(sid, privacy: .public) why=\(why, privacy: .public)")
            abandonActive(reason: why)
            return false
        }
        guard case .acquired = ownership.tryAcquireNative() else { return false }
        generation = (a["managerGeneration"] as? UInt64) ?? 1; managerId = (a["managerId"] as? String) ?? UUID().uuidString.lowercased()
        requestId = a["requestId"] as? String; sessionId = sid; credentialHandle = a["credentialHandle"] as? String; configHash = a["configHash"] as? String
        peripheralId = (a["peripheralId"] as? String).flatMap(UUID.init(uuidString:))
        resetStreamRuntime()
        pin = ModelPin.loadOrCreate(file: sessionDir(sid).appendingPathComponent("model-pin.json"), rawParams: nil, version: nil)
        deviceSeq = U64.parse(a["deviceSeq"]) ?? 0
        guard let cred = credentialHandle else { ownership.releaseNative(); return false }
        _ = cred
        participantId = pid; streamId = stream; ownerGeneration = gen
        archive = openArchive(sid)
        guard adoptEngine(sessionId: sid, participant: pid, stream: stream, generation: gen) else { ownership.releaseNative(); state = .blocked; blockedReason = "storage_full"; return false }
        needsRecoveryMark = true
        state = .reconnecting
        let l = makeLive(sid); live = l; wire(l); l.attach(outbox: engine!.outbox); l.setOwner(streamId: stream, generation: gen)
        l.start()
        band.connect(expectedPeripheral: peripheralId)
        armStreamTimers()
        return true
    }

    // MARK: wiring

    private func wire(_ l: LiveControlling) {
        l.onState = { [weak self] s in self?.liveStateChanged(s) }
        l.onEvent = { [weak self] e in self?.handleLiveEvent(e) }
        l.onCommandAck = { [weak self] a in self?.handleCommandAck(a); self?.emit(event: "commandAck", payload: a) }
        l.onDeviceRejected = { [weak self] code in self?.deviceRejected(code) }
    }

    public func liveStateChanged(_ s: LiveState) {
        lock.lock(); defer { lock.unlock() }
        switch s {
        case .authBlocked: blockedReason = "auth_expired"                 // 수집은 계속, live 만 막힘
        case .revoked:
            stopStreamTimers()
            blockedReason = "consent_missing"; state = .blocked; band.disconnect(); live?.clearOwner(); persistActive()
        case .ready:
            if blockedReason == "auth_expired" { blockedReason = nil }
            live?.pump()
            // 재연결마다 lease 를 즉시 갱신하고 서버 anchor 를 다시 잡는다(네트워크 경로가 바뀌면 오차도 바뀐다).
            renewTick(); syncClock()
        case .terminal:
            autoSeal(reason: "session_ended")
        default: break
        }
        emit(event: "liveStateUpdated", payload: nil, liveState: s)
        emitMeasurementUpdated()
    }

    /// device.changed(합집합 스키마) 소비: stream 수명(generation·status·cutoff_code)으로 owner 교체·권한 회수·종료를 판단한다.
    /// 밴드 필드는 선택(부재 = 미보고). generation 은 u64 십진 문자열만 받는다.
    public func handleLiveEvent(_ e: [String: Any]) {
        lock.lock(); defer { lock.unlock() }
        if (e["domain"] as? String) == "device", let p = e["payload"] as? [String: Any], let sid = p["stream_id"] as? String {
            let pid = p["participant_id"] as? String
            let gen = U64.parse(p["generation"])
            let status = p["status"] as? String
            if let own = streamId {
                if let pid = pid, let mine = participantId, pid != mine { emit(event: "liveStateUpdated", payload: e); return }   // 다른 참가자
                if sid == own {
                    switch status {
                    case "superseded": fence(); return
                    case "revoked": revokeCapture(cutoffCode: p["cutoff_code"] as? String); return
                    case "ended": autoSeal(reason: "session_ended"); return
                    default: break                                   // active / closed(내가 닫음)
                    }
                } else if let g = gen, g > (ownerGeneration ?? 0), status == "active" { fence(); return }   // 더 새 owner 세대
            } else if state == .arming, status == "active", let pid = pid, Self.isUUID(pid), let g = gen,
                      (e["audience"] as? String) == "member:\(pid)" {
                // 보조 경로: capture.start ACK 가 유실·만료됐을 때. 본인 member audience 의 payload.participant_id 만 신뢰한다.
                adopt(stream: sid, generation: g, participant: pid)
            }
        }
        emit(event: "liveStateUpdated", payload: e)
    }

    /// capture.* ACK 처리. capture.start 의 result(stream_id·participant_id·owner_generation·lease)를 바로 채택한다.
    public func handleCommandAck(_ a: [String: Any]) {
        lock.lock(); defer { lock.unlock() }
        guard let id = a["command_id"] as? String else { return }
        let status = a["status"] as? String, code = a["code"] as? String
        let result = a["result"] as? [String: Any]
        if let start = captureStartCommand, id == start["command_id"] as? String {
            Self.log.info("capture.start ACK status=\(status ?? "nil", privacy: .public) code=\(code ?? "nil", privacy: .public)")
        }
        if let start = captureStartCommand, id == start["command_id"] as? String {
            switch status {
            case "applied", "duplicate":
                guard streamId == nil, state == .arming, let r = result, let s = r["stream_id"] as? String, Self.isUUID(s),
                      let pid = r["participant_id"] as? String, Self.isUUID(pid), let g = U64.parse(r["owner_generation"]) ?? U64.parse(r["generation"]) else { return }
                leaseExpiresAtMs = ((r["lease"] as? [String: Any])?["expires_at_ms"] as? NSNumber)?.uint64Value
                adopt(stream: s, generation: g, participant: pid)
            case "rejected":
                guard state == .arming else { return }
                captureDenied(code: code)
            case "retryable":
                // LiveSession 의도 유효기간(30초) 만료 = 결과 미확정. 같은 command_id 로 다시 보내 ledger 결과를 받는다(새 stream 을 만들지 않는다).
                if state == .arming, streamId == nil { live?.dispatch(command: start) }
            default: break
            }
        } else if id == renewCommandId {
            renewCommandId = nil
            switch status {
            case "applied", "duplicate":
                if let ms = ((result?["lease"] as? [String: Any])?["expires_at_ms"] as? NSNumber)?.uint64Value { leaseExpiresAtMs = ms }
            case "rejected" where code == "stale_owner_generation":
                fence()
            default: break      // stream_not_active/session_ended 는 device.changed·terminal 이 처리, result_unknown 은 다음 주기에 재시도
            }
        } else if let rp = reanchorPending, id == rp.commandId {
            reanchorPending = nil
            guard status == "applied" || status == "duplicate", (result?["clock_uncertain"] as? Bool) == false else { return }
            // 서버가 probe 를 확인했다. 오차 상한 = probe 왕복시간(서버 판정 오차도 probe→reanchor 경과 기반). 고정값 대신 실측.
            clockAnchorId = rp.probe.probeId
            clockUncertaintyMs = max(1, ((rp.probe.rttSeconds * 1_000_000).rounded() / 1000).rounded(.up))   // µs 로 먼저 반올림(부동소수 오차로 1ms 과대 방지)
            engine?.updateClock(anchorId: clockAnchorId, uncertaintyMs: clockUncertaintyMs)
        }
    }

    private func captureDenied(code: String?) {
        blockedReason = code == "eeg_consent_required" ? "consent_missing" : "capture_lease_denied"
        state = .blocked
        band.disconnect()
        let ws = streamWaiters; streamWaiters = []
        ws.forEach { $0(.failure(.notActive)) }
        persistActive(); emitMeasurementUpdated()
    }

    /// 추방·동의 철회 cutoff: 수집·송신 중단, 코어는 마감하되 업로드하지 않는다(미확정 사본 격리 — 서버 인가 없이 업로드 권한을 넓히지 않는다).
    private func revokeCapture(cutoffCode: String?) {
        stopStreamTimers()
        band.disconnect()
        if let e = engine, !e.isSealed { _ = try? e.seal() }
        live?.clearOwner()
        blockedReason = cutoffCode == "consent_withdrawn" ? "consent_missing" : "capture_lease_denied"
        state = .blocked
        persistActive(); emitMeasurementUpdated()
    }

    private func fence() {
        stopStreamTimers()
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
        deviceReportingStopped = false
        persistActive()
        let ws = streamWaiters; streamWaiters = []
        ws.forEach { $0(.success((stream, gen))) }
        armStreamTimers()
        reportDevice()
        syncClock()
        emitMeasurementUpdated()
    }

    private func adoptEngine(sessionId sid: String, participant: String, stream: String, generation gen: UInt64) -> Bool {
        let ctx = StreamContext(sessionId: sid, participantId: participant, streamId: stream, streamGeneration: gen,
                                clockAnchorId: clockAnchorId, clockUncertaintyMs: clockUncertaintyMs)
        let dir = sessionDir(sid)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        do { engine = try makeEngine(dir, ctx, pin) } catch { return false }
        engine?.onFrame = { [weak self] env in self?.frameArrived(env) }
        if anchor == nil { anchor = (nowMs(), monoUs()) }
        return true
    }

    private func frameArrived(_ env: [String: Any]) {
        lock.lock(); defer { lock.unlock() }
        lastEnvelope = env
        lastSqi = env["sqi"] ?? NSNull()
        let contact = env["contact"] as? [String: String]
        if let c = contact, c != lastContact { lastContact = c; reportDevice() }     // 접촉 변화만 보고(SQI 는 1Hz 라 보고 계기로 쓰지 않는다)
        live?.pump()
        emitMeasurementUpdated()
    }

    // MARK: T07b — capture lease 갱신 · 서버 시계 anchor · live:device

    private func resetStreamRuntime() {
        stopStreamTimers()
        leaseExpiresAtMs = nil; renewCommandId = nil; probing = false; reanchorPending = nil
        clockAnchorId = UUID().uuidString.lowercased(); clockUncertaintyMs = Self.unknownClockUncertaintyMs
        deviceSeq = 0; deviceReportingStopped = false; lastContact = nil; lastSqi = NSNull()
    }

    private func armStreamTimers() {
        stopStreamTimers()
        armRenew(); armClock()
    }
    private func armRenew() {
        renewTimer = scheduler.schedule(after: Self.renewInterval) { [weak self] in
            guard let self = self else { return }
            self.lock.lock(); defer { self.lock.unlock() }
            self.renewTick(); self.armRenew()
        }
    }
    private func armClock() {
        clockTimer = scheduler.schedule(after: Self.clockResyncInterval) { [weak self] in
            guard let self = self else { return }
            self.lock.lock(); defer { self.lock.unlock() }
            self.syncClock(); self.armClock()
        }
    }
    private func stopStreamTimers() { renewTimer?.cancel(); renewTimer = nil; clockTimer?.cancel(); clockTimer = nil }

    private var collecting: Bool { state == .capturing || state == .reconnecting }

    /// capture.renew — 소켓이 붙어 있을 때(READY·DEGRADED)만, 한 번에 하나. 미연결 중에는 쌓지 않는다(재연결 READY 에서 즉시 1회).
    /// DEGRADED(heartbeat 지연)에도 명령은 보낼 수 있고, lease 가 끊기면 live 투영이 멈추므로 갱신을 거르지 않는다.
    private func renewTick() {
        guard collecting, let l = live, l.state == .ready || l.state == .degraded, renewCommandId == nil, let s = streamId, let g = ownerGeneration else { return }
        let cid = UUID().uuidString.lowercased(); renewCommandId = cid
        l.dispatch(command: ["command_id": cid, "kind": "capture.renew", "client_generation": String(generation),
                             "payload": ["stream_id": s, "owner_generation": String(g), "clock_anchor_id": clockAnchorId]])
    }

    /// 코어 창 시각과 같은 시간축(µs) — 코어는 wall_ms·1000 + (도착 단조시계 − anchor 단조시계) 로 window_*_us 를 만든다.
    /// 서버는 reanchor 의 monotonic_us 를 처리 시각(서버 시계)에 묶어 이후 창을 서버 시계로 환산한다.
    private func coreDomainUs() -> UInt64 {
        guard let a = anchor else { return monoUs() }
        let v = Int64(a.wallMs) * 1000 + (Int64(monoUs()) - Int64(a.monoUs))
        return UInt64(max(0, v))
    }

    /// live:clock_probe → 곧바로 capture.reanchor(서버는 probe 수신 10초 안의 reanchor 만 오차를 보증).
    private func syncClock() {
        guard collecting, let l = live, l.state == .ready, !probing, reanchorPending == nil, let s = streamId else { return }
        probing = true
        l.clockProbe(clientMonotonicUs: coreDomainUs()) { [weak self] r in
            guard let self = self else { return }
            self.lock.lock(); defer { self.lock.unlock() }
            self.probing = false
            guard case .success(let probe) = r, self.collecting, self.streamId == s, let l2 = self.live, l2.state == .ready else { return }
            let cid = UUID().uuidString.lowercased()
            self.reanchorPending = (cid, probe)
            l2.dispatch(command: ["command_id": cid, "kind": "capture.reanchor", "client_generation": String(self.generation),
                                  "payload": ["stream_id": s, "clock_probe_id": probe.probeId,
                                              "device_ticks": self.engine?.lastDeviceTicks ?? "0", "monotonic_us": String(self.coreDomainUs())]])
        }
    }

    /// live:device — 밴드 상태·접촉·배터리가 바뀔 때만. device_seq 는 stream 마다 단조(active.json 에 영속해 재시작 후에도 증가).
    private func reportDevice() {
        guard let s = streamId, let l = live, !deviceReportingStopped, collecting else { return }
        deviceSeq += 1
        persistActive()
        let reason: Any = (blockedReason == "bluetooth_off") ? "bluetooth_off" : NSNull()
        l.reportDevice(["stream_id": s, "device_seq": String(deviceSeq), "band_state": bandState,
                        "contact": lastContact ?? ["fp1": "unknown", "fp2": "unknown"], "sqi": lastSqi,
                        "battery_pct": batteryPct.map { min(max($0, 0), 100) as Any } ?? NSNull(), "state_reason": reason])
    }

    private func deviceRejected(_ code: String) {
        lock.lock(); defer { lock.unlock() }
        deviceReportingStopped = true            // stream_not_active(superseded 등)·stream_not_found: 이 stream 으로는 더 보고하지 않는다
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
        let before = bandState
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
        if bandState != before {
            Self.log.info("band_state \(before, privacy: .public) -> \(self.bandState, privacy: .public) reason=\(reason ?? "-", privacy: .public) manager=\(self.state.rawValue, privacy: .public)")
            reportDevice()
        }
        persistActive(); emitMeasurementUpdated()
    }
    public func bandLink(didReadBattery pct: Int) {
        lock.lock(); defer { lock.unlock() }
        let changed = batteryPct != pct
        batteryPct = pct
        if changed { reportDevice() }
    }
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
            "versions": ["native_runtime": Self.nativeRuntimeVersion, "core": Self.coreVersion, "algorithm": profile.algorithm, "model": modelVersion, "device_profile": profile.device],
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

    private func openArchive(_ sid: String) -> ArchiveQueue? {
        let d = sessionDir(sid).appendingPathComponent("archive")
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return try? ArchiveQueue(dir: d)
    }
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
        a["deviceSeq"] = String(deviceSeq)
        if state == .closed || state == .idle { try? FileManager.default.removeItem(at: activeURL); return }
        if let d = try? JSONSerialization.data(withJSONObject: a) { try? d.write(to: activeURL, options: .atomic) }
    }
    /// 복구 한도. 마지막 raw 기록이 이보다 오래됐으면(수집이 이미 끝난 세션) 또는 저널이 이보다 크면(전량 적재 시 메모리 한도 초과) 되살리지 않는다.
    public static let recoveryMaxAgeSeconds: TimeInterval = 3 * 3600
    public static let recoveryMaxJournalBytes: UInt64 = 128 * 1024 * 1024

    /// 복구 거부 사유(순수). nil 이면 복구 허용. 파일을 읽지 않고 속성(수정 시각·크기)만 본다.
    public static func recoveryVeto(sessionDir: URL, nowMs: UInt64) -> String? {
        let fm = FileManager.default
        func attrs(_ n: String) -> [FileAttributeKey: Any]? { try? fm.attributesOfItem(atPath: sessionDir.appendingPathComponent(n).path) }
        for n in ["feature.journal", "metric-outbox.journal", "raw.journal"] {
            if let sz = (attrs(n)?[.size] as? NSNumber)?.uint64Value, sz > recoveryMaxJournalBytes { return "journal_too_large" }
        }
        if let m = attrs("raw.journal")?[.modificationDate] as? Date, Double(nowMs) / 1000 - m.timeIntervalSince1970 > recoveryMaxAgeSeconds { return "stale_session" }
        return nil
    }

    /// 복구하지 않기로 한 active.json 을 지우지 않고 옆으로 치운다(사후 분석용). 세션 디렉터리는 건드리지 않는다.
    private func abandonActive(reason: String) {
        let dst = activeURL.deletingLastPathComponent().appendingPathComponent("active.abandoned-\(nowMs())-\(reason).json")
        try? FileManager.default.removeItem(at: dst)
        try? FileManager.default.moveItem(at: activeURL, to: dst)
    }

    private func loadActive() -> [String: Any]? {
        guard let d = try? Data(contentsOf: activeURL) else { return nil }
        var o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any]
        if let g = (o?["managerGeneration"] as? NSNumber)?.uint64Value { o?["managerGeneration"] = g }
        return o
    }
    private func finishClosed() { stopStreamTimers(); live?.stop(); ownership.releaseNative(); state = .closed; persistActive() }

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

public enum NativeCapabilities {
    /// 계약 Capabilities. iOS 는 audio 모드를 쓰지 않으므로 microphone 은 not_required.
    public static func make(osVersion: String, bluetooth: String, notifications: String) -> [String: Any] {
        ["bridge_version": 1, "platform": "ios", "os_version": osVersion, "native_runtime_version": MeasurementManager.nativeRuntimeVersion,
         "core_version": MeasurementManager.coreVersion, "live_protocol_versions": [2], "device_profiles": ["linkband2-v1"],
         "background": ["capture": bluetooth == "granted" ? "supported" : "needs_permission", "live_socket": "supported", "archive_upload": "supported"],
         "permissions": ["bluetooth": bluetooth, "notifications": notifications, "microphone": "not_required"]]
    }
}
