import Foundation
import os

public enum LiveState: String, Equatable { case idle, connecting, resyncing, ready, degraded, terminal, revoked, authBlocked }
public enum Visibility: String { case foreground, background, locked }
public enum TokenRefreshError: Error { case transient, invalid }

/// live:clock_probe 왕복 결과. RTT 는 native 단조시계(scheduler) 기준.
public struct ClockProbeResult: Equatable {
    public let probeId: String
    public let clientMonotonicUs: UInt64
    public let serverReceiveMs: UInt64, serverSendMs: UInt64
    public let rttSeconds: TimeInterval
}
public enum ClockProbeError: Error, Equatable { case notReady, rejected(String), transport }

/// native v2 live 세션: hello → join → snapshot → sync_complete → applied(READY) 상태머신, command(같은 command_id 재시도),
/// metric 배치 전송·ACK, 5초 presence, heartbeat 감시, 토큰 갱신(single-flight), 권한회수/종료 처리.
/// 전부 native 타이머(Scheduler)로 동작한다 — 웹뷰/JS 타이머 의존 없음. 호출은 직렬 큐 전제.
public final class LiveSession {
    public static let protocolVersion = 2, schemaVersion = 1
    public static let heartbeatDegradedAfter: TimeInterval = 10
    public static let presenceInterval: TimeInterval = 5
    public static let intentValiditySeconds: TimeInterval = 30
    static let commandBackoff: [TimeInterval] = [0.5, 1, 2, 4]

    private let client: SocketIOClient
    private let scheduler: Scheduler
    private let sessionId: String, instanceId: String, appBuild: String, coreVersion: String
    private let refreshToken: (@escaping (Result<String, Error>) -> Void) -> Void

    /// 실기기 진단용(Console.app 에서 subsystem 으로 필터). 토큰·측정값은 싣지 않는다(seq·code·개수만).
    private static let log = Logger(subsystem: "com.looxidlabs.mindbreeze2", category: "measurement")
    public private(set) var state: LiveState = .idle {
        didSet { if state != oldValue { Self.log.info("live 상태 \(oldValue.rawValue, privacy: .public) -> \(self.state.rawValue, privacy: .public)"); onState?(state) } }
    }
    public var onState: ((LiveState) -> Void)?
    public var onCommandAck: (([String: Any]) -> Void)?
    public var onEvent: (([String: Any]) -> Void)?
    public var onSnapshot: (([String: Any]) -> Void)?
    public var onMetricAck: (([String: Any]) -> Void)?
    /// live:device 가 재시도 불가 오류(stream_not_active 등)로 끝났을 때. 호출자는 보고를 중단한다.
    public var onDeviceRejected: ((String) -> Void)?

    // 계약: 서버 time
    public private(set) var lastHeartbeatServerMs: UInt64?
    public private(set) var nativeHeartbeatCount: UInt64 = 0
    public private(set) var lastAckSequence: UInt64 = 0
    /// 서버가 알려 준 최신 epoch(join ack·snapshot·heartbeat·command ack 중 최댓값). expected_epoch 자동 채움에 쓴다.
    public private(set) var epoch: UInt64 = 0

    private var outbox: MetricOutbox?
    private var inflight: Set<UInt64> = []
    private var connectionGeneration: UInt64 = 0
    private var expectedSnapshotId: String?
    private var earlySyncSnapshotId: String?
    private var lastSnapshotId: String?
    private var cursors: [String: UInt64] = [:]      // "audience|domain" → seq
    private var eventBuffer: [[String: Any]] = []
    private var visibility: Visibility = .foreground
    private var owner: (stream: String, generation: UInt64)?
    private var presenceTimer: Cancellable?, heartbeatTimer: Cancellable?
    private var refreshing = false
    private var refreshRetry = 0
    /// autoEpoch: 호출자가 expected_epoch 를 주지 않은 native 명령 — 보낼 때마다 서버 epoch 로 채운다.
    /// (서버 body hash 에 expected_epoch 가 들어가지 않으므로 같은 command_id 로 값이 바뀌어도 idempotency_conflict 가 아니다.)
    private struct Pending { var command: [String: Any]; var attempt: Int; var firstSentAt: TimeInterval; var inFlight: Bool; var timer: Cancellable?; var autoEpoch: Bool }
    private var commands: [String: Pending] = [:]
    private var commandOrder: [String] = []
    private var isolateMetrics = false          // 배치 전체 검증 실패 → 창 하나씩 보내 원인 창만 격리
    private var metricHalted = false            // forbidden 등 연결 단위 오류 — 다음 READY 까지 보내지 않는다
    private var metricRetryTimer: Cancellable?
    private var pendingDevice: [String: Any]?
    private var deviceInFlight = false
    private var deviceRetryTimer: Cancellable?

    public init(client: SocketIOClient, scheduler: Scheduler, sessionId: String, instanceId: String, appBuild: String, coreVersion: String,
                refreshToken: @escaping (@escaping (Result<String, Error>) -> Void) -> Void) {
        self.client = client; self.scheduler = scheduler; self.sessionId = sessionId; self.instanceId = instanceId
        self.appBuild = appBuild; self.coreVersion = coreVersion; self.refreshToken = refreshToken
        wire()
    }

    public func attach(outbox: MetricOutbox) { self.outbox = outbox }
    /// 진단용: 연결된 live outbox 의 현재 카운트(pending/acked/rejected).
    public var outboxCounts: MetricOutbox.Counts? { outbox?.counts() }
    public func setOwner(streamId: String, generation: UInt64) { owner = (streamId, generation) }
    public func clearOwner() { owner = nil }
    public func setVisibility(_ v: Visibility) { visibility = v }

    public func start() { state = .connecting; client.connect() }
    public func stop() { stopTimers(); client.close(); if state != .revoked && state != .terminal { state = .idle } }

    // MARK: wiring

    private func wire() {
        client.onConnect = { [weak self] in self?.handleConnected() }
        client.onDisconnect = { [weak self] _ in self?.handleDisconnected() }
        client.onConnectError = { [weak self] m in self?.handleConnectError(m) }
        client.on("live:snapshot") { [weak self] args, _ in self?.handleSnapshot(args) }
        client.on("live:sync_complete") { [weak self] args, _ in self?.handleSyncComplete(args) }
        client.on("live:event") { [weak self] args, _ in self?.handleEvent(args) }
        client.on("live:heartbeat") { [weak self] args, _ in self?.handleHeartbeat(args) }
        client.on("live:access_revoked") { [weak self] _, _ in self?.handleRevoked() }
        client.on("live:terminal") { [weak self] _, _ in self?.handleTerminal() }
        client.on("live:resync_required") { [weak self] args, _ in self?.sendResync(reason: ((args.first as? [String: Any])?["reason"] as? String) ?? "server_requested") }
        client.on("live:degraded") { [weak self] _, _ in if self?.state == .ready { self?.state = .degraded } }
        client.on("live:auth_expired") { [weak self] _, _ in self?.refreshAndReauth() }
        client.on("live:metric_ack") { [weak self] args, _ in if let o = args.first as? [String: Any] { self?.applyMetricAck(o) } }
        client.on("live:ack") { [weak self] args, _ in if let o = args.first as? [String: Any] { self?.handleCommandAck(o) } }
    }

    private var terminalLike: Bool { state == .revoked || state == .terminal || state == .authBlocked }

    private func base() -> [String: Any] { ["protocol_version": Self.protocolVersion, "schema_version": Self.schemaVersion] }

    // MARK: 연결

    private func handleConnected() {
        if state == .revoked || state == .authBlocked { client.close(); return }
        if state == .terminal { return }
        connectionGeneration += 1
        state = .resyncing
        inflight.removeAll()
        expectedSnapshotId = nil; earlySyncSnapshotId = nil; eventBuffer.removeAll()
        var hello = base()
        hello["supported_protocol_versions"] = [Self.protocolVersion]; hello["app_build"] = appBuild
        hello["client_instance_id"] = instanceId; hello["capabilities"] = ["native_background"]; hello["core_version"] = coreVersion
        client.emit("live:hello", hello, ackTimeout: 2) { [weak self] r in
            guard let self = self else { return }
            switch r {
            case .success(let v):
                let o = v as? [String: Any]
                if (o?["ok"] as? Bool) == false {
                    Self.log.error("live:hello 거절 code=\((o?["code"] as? String) ?? "-", privacy: .public)")
                    if (o?["code"] as? String) == "token_expired" { self.refreshAndReconnect() }
                    else if (o?["retryable"] as? Bool) == true { self.client.reconnectNow() }
                    else { self.state = .degraded }
                    return
                }
                self.sendJoin()
            case .failure: self.client.reconnectNow()
            }
        }
    }

    private func handleDisconnected() {
        Self.log.error("live 소켓 끊김 inflight=\(self.inflight.count)")
        stopTimers()
        inflight.removeAll()
        for id in commands.keys { commands[id]?.inFlight = false; commands[id]?.timer?.cancel(); commands[id]?.timer = nil }
        if !terminalLike { state = .connecting }
    }

    private func handleConnectError(_ message: String) {
        Self.log.error("live 연결 오류 \(message, privacy: .public)")
        if message == "token_expired" || message == "auth_expired" { refreshAndReconnect() }
        else if message == "access_revoked" { handleRevoked() }
    }

    private func sendJoin() {
        var join = base()
        join["session_id"] = sessionId; join["request_id"] = UUID().uuidString.lowercased()
        join["generation"] = String(connectionGeneration); join["last_cursors"] = cursorList(); join["entry_credential"] = NSNull()
        expectedSnapshotId = nil
        client.emit("live:join", join, ackTimeout: 5, ack: joinAck)
    }

    private func sendResync(reason: String) {
        guard !terminalLike, client.isConnected else { return }
        state = .resyncing
        expectedSnapshotId = nil; earlySyncSnapshotId = nil; eventBuffer.removeAll(); inflight.removeAll()
        var r = base()
        r["session_id"] = sessionId; r["reason"] = reason; r["request_id"] = UUID().uuidString.lowercased(); r["last_cursors"] = cursorList()
        client.emit("live:resync", r, ackTimeout: 5, ack: joinAck)
    }

    private lazy var joinAck: (Result<Any?, AckError>) -> Void = { [weak self] r in
        guard let self = self else { return }
        guard case .success(let v) = r, let o = v as? [String: Any], (o["ok"] as? Bool) != false else {
            if case .success(let v) = r, let o = v as? [String: Any] {
                Self.log.error("live:join/resync 거절 code=\((o["code"] as? String) ?? "-", privacy: .public)")
                switch o["code"] as? String {
                case "access_revoked": self.handleRevoked()
                case "token_expired": self.refreshAndReconnect()
                case "protocol_v1_session", "upgrade_required": self.state = .degraded   // v2 아님 — 현행(JS) 경로가 담당
                default: self.scheduleRejoin()
                }
            } else { self.scheduleRejoin() }
            return
        }
        self.noteEpoch(o["epoch"])
        self.expectedSnapshotId = o["snapshot_id"] as? String
        if let early = self.earlySyncSnapshotId, early == self.expectedSnapshotId { self.earlySyncSnapshotId = nil; self.applySync(early) }
    }

    private func scheduleRejoin() {
        scheduler.schedule(after: 1) { [weak self] in if let s = self, s.client.isConnected, !s.terminalLike { s.sendJoin() } }
    }

    // MARK: snapshot / sync

    private func handleSnapshot(_ args: [Any]) {
        guard let o = args.first as? [String: Any] else { return }
        lastSnapshotId = o["snapshot_id"] as? String
        noteEpoch(o["epoch"])
        cursors.removeAll()
        for c in (o["through"] as? [[String: Any]]) ?? [] { setCursor(c) }
        onSnapshot?(o)
    }

    private func handleSyncComplete(_ args: [Any]) {
        guard let o = args.first as? [String: Any], let sid = o["snapshot_id"] as? String else { return }
        guard let expected = expectedSnapshotId else { earlySyncSnapshotId = sid; return }   // join ack 보다 먼저 도착
        guard sid == expected else { return }                                              // 이전 요청의 snapshot 폐기
        applySync(sid)
    }

    private func applySync(_ snapshotId: String) {
        var a = base()
        a["session_id"] = sessionId; a["cursors"] = cursorList(); a["snapshot_id"] = snapshotId
        client.emit("live:applied", a, ackTimeout: 3) { [weak self] r in
            guard let self = self else { return }
            guard case .success(let v) = r, let o = v as? [String: Any], (o["ok"] as? Bool) != false else { return }
            if (o["state"] as? String) == "READY" { self.becomeReady() }
        }
    }

    private func becomeReady() {
        guard !terminalLike, state != .ready else { return }
        state = .ready
        let buffered = eventBuffer; eventBuffer.removeAll()
        for e in buffered { handleEvent([e]) }
        armHeartbeat(); startPresence()
        metricHalted = false
        flushCommands()
        pump()
        sendDevice()
    }

    // MARK: event / heartbeat

    private func cursorKey(_ audience: String, _ domain: String) -> String { "\(audience)|\(domain)" }
    private func setCursor(_ c: [String: Any]) {
        guard let a = c["audience"] as? String, let d = c["domain"] as? String, let s = (c["seq"] as? String).flatMap({ UInt64($0) }) else { return }
        cursors[cursorKey(a, d)] = s
    }
    private func cursorList() -> [[String: String]] {
        cursors.keys.sorted().map { k -> [String: String] in
            let p = k.split(separator: "|", maxSplits: 1).map(String.init)
            return ["audience": p[0], "domain": p.count > 1 ? p[1] : "", "seq": String(cursors[k] ?? 0)]
        }
    }

    private func handleEvent(_ args: [Any]) {
        guard let e = args.first as? [String: Any] else { return }
        if state == .resyncing {
            if eventBuffer.count >= 1000 { sendResync(reason: "buffer_overflow") } else { eventBuffer.append(e) }
            return
        }
        guard let a = e["audience"] as? String, let d = e["domain"] as? String, let seq = (e["seq"] as? String).flatMap({ UInt64($0) }) else { return }
        let key = cursorKey(a, d)
        if let last = cursors[key] {
            if seq <= last { return }                       // 중복·이전 seq 폐기
            if seq != last + 1 { sendResync(reason: "seq_gap"); return }
        }
        cursors[key] = seq
        onEvent?(e)
    }

    private func handleHeartbeat(_ args: [Any]) {
        nativeHeartbeatCount += 1
        if let o = args.first as? [String: Any] {
            lastHeartbeatServerMs = (o["server_time_ms"] as? NSNumber)?.uint64Value
            noteEpoch(o["epoch"])
            for c in (o["through"] as? [[String: Any]]) ?? [] {
                guard let a = c["audience"] as? String, let d = c["domain"] as? String, let s = (c["seq"] as? String).flatMap({ UInt64($0) }) else { continue }
                if s > (cursors[cursorKey(a, d)] ?? s) { sendResync(reason: "heartbeat_gap"); return }   // 마지막 이벤트 유실 감지
            }
        }
        if state == .degraded { state = .ready; flushCommands(); pump(); sendDevice() }
        if state == .ready { armHeartbeat() }
    }

    private func armHeartbeat() {
        heartbeatTimer?.cancel()
        heartbeatTimer = scheduler.schedule(after: Self.heartbeatDegradedAfter) { [weak self] in
            guard let self = self, self.state == .ready else { return }
            self.state = .degraded
        }
    }

    // MARK: presence

    private func startPresence() {
        presenceTimer?.cancel()
        presenceTimer = scheduler.schedule(after: Self.presenceInterval) { [weak self] in
            guard let self = self, self.client.isConnected, self.state == .ready || self.state == .degraded else { return }
            self.sendPresence(); self.startPresence()
        }
    }
    private func sendPresence() {
        var p = base()
        p["session_id"] = sessionId; p["instance_id"] = instanceId; p["lease_generation"] = String(connectionGeneration); p["visibility"] = visibility.rawValue
        if let o = owner { p["stream_id"] = o.stream; p["owner_generation"] = String(o.generation) }
        client.emit("live:presence", p, ackTimeout: 2, ack: nil)
    }

    private func stopTimers() { presenceTimer?.cancel(); presenceTimer = nil; heartbeatTimer?.cancel(); heartbeatTimer = nil }

    // MARK: 권한·종료

    private func handleRevoked() { stopTimers(); state = .revoked; client.close() }
    /// 업무 종료: presence/heartbeat 는 멈추지만 cutoff 이전 창 drain 을 위해 metric 전송과 capture.close 는 허용한다.
    private func handleTerminal() { stopTimers(); state = .terminal; pump() }

    // MARK: 토큰

    private func refreshAndReconnect() { refresh { [weak self] ok in if ok { self?.client.reconnectNow() } } }
    private func refreshAndReauth() {
        refresh { [weak self] ok in
            guard let self = self, ok else { return }
            self.client.emit("live:reauth", ["token": self.currentToken], ackTimeout: 3) { r in
                if case .success(let v) = r, let o = v as? [String: Any], (o["ok"] as? Bool) == false { self.state = .authBlocked }
            }
        }
    }
    private var currentToken = ""
    /// single-flight. invalid 이면 live 중단(authBlocked), transient 이면 backoff 후 재시도.
    private func refresh(_ done: @escaping (Bool) -> Void) {
        guard !refreshing else { return }
        refreshing = true
        refreshToken { [weak self] result in
            guard let self = self else { return }
            self.refreshing = false
            switch result {
            case .success(let tk): self.currentToken = tk; self.refreshRetry = 0; done(true)
            case .failure(let e):
                if (e as? TokenRefreshError) == .transient {
                    let wait = min(30, pow(2, Double(self.refreshRetry))); self.refreshRetry += 1
                    self.scheduler.schedule(after: wait) { [weak self] in self?.refresh(done) }
                } else { self.stopTimers(); self.state = .authBlocked }
            }
        }
    }

    // MARK: metric

    public func pump() {
        guard state == .ready || state == .terminal, client.isConnected, !metricHalted, metricRetryTimer == nil,
              let box = outbox, inflight.isEmpty else { return }
        let windows = box.nextBatch(max: isolateMetrics ? 1 : 60, excluding: inflight)
        guard !windows.isEmpty else { return }
        let seqs = Set(windows.compactMap { ($0["sequence"] as? String).flatMap { UInt64($0) } })
        inflight = seqs
        var payload = base(); payload["windows"] = windows
        Self.log.info("live:metric 송신 windows=\(windows.count) seq=\(seqs.min() ?? 0)...\(seqs.max() ?? 0)")
        client.emit("live:metric", payload, ackTimeout: 2) { [weak self] r in
            guard let self = self else { return }
            self.inflight.subtract(seqs)
            guard case .success(let v) = r, let o = v as? [String: Any] else {
                if case .failure(let e) = r { Self.log.error("live:metric 응답 실패 \(String(describing: e), privacy: .public) — 1초 뒤 재시도") }
                self.scheduleMetricRetry(after: 1); return
            }
            if o["acks"] is [[String: Any]] {
                if self.isolateMetrics && seqs.count == 1 { self.isolateMetrics = false }
                self.applyMetricAck(o); return
            }
            self.handleMetricError(o, seqs: seqs, box: box)
        }
    }

    /// 배치 단위 오류({ok:false,code}). 재시도 가능(not_ready·*_ingest_unavailable·db_unavailable)은 pending 유지 후 재시도,
    /// 연결 단위 오류는 다음 READY 까지 중단, 그 밖의 검증 실패는 창 하나씩 분리해 원인 창만 격리한다.
    private func handleMetricError(_ o: [String: Any], seqs: Set<UInt64>, box: MetricOutbox) {
        let code = (o["code"] as? String) ?? "rejected"
        Self.log.error("live:metric 배치 거절 code=\(code, privacy: .public) field=\((o["field"] as? String) ?? "-", privacy: .public) retryable=\(((o["retryable"] as? Bool) == true) ? "y" : "n", privacy: .public) windows=\(seqs.count)")
        if (o["retryable"] as? Bool) == true {
            scheduleMetricRetry(after: TimeInterval((o["retry_after_ms"] as? NSNumber)?.doubleValue ?? 1000) / 1000)
        } else if Self.connectionLevelMetricErrors.contains(code) {
            metricHalted = true
        } else if seqs.count == 1 {
            box.markRejected(Array(seqs), code: code)
            pump()
        } else {
            isolateMetrics = true
            scheduleMetricRetry(after: 0)
        }
    }
    static let connectionLevelMetricErrors: Set<String> = ["forbidden", "unsupported_protocol", "unsupported_schema", "access_revoked"]

    private func scheduleMetricRetry(after t: TimeInterval) {
        metricRetryTimer?.cancel()
        metricRetryTimer = scheduler.schedule(after: t) { [weak self] in self?.metricRetryTimer = nil; self?.pump() }
    }

    private func applyMetricAck(_ o: [String: Any]) {
        guard let acks = o["acks"] as? [[String: Any]], let box = outbox else { return }   // ok:false(not_ready 등)는 pending 유지
        var ok: [UInt64] = [], bad: [(UInt64, String?)] = []
        for a in acks {
            guard let s = (a["sequence"] as? String).flatMap({ UInt64($0) }) else { continue }
            let durable = (a["durable"] as? Bool) == true
            switch a["status"] as? String {
            case "accepted", "duplicate": if durable { ok.append(s) }
            case "rejected": bad.append((s, a["code"] as? String))
            default: break          // retryable: pending 유지(다음 pump 에서 재전송)
            }
        }
        if !bad.isEmpty { Self.log.error("live:metric 창 거절 \(bad.count)건 codes=\(bad.map { $0.1 ?? "-" }.prefix(5).joined(separator: ","), privacy: .public) first_seq=\(bad.first?.0 ?? 0)") }
        Self.log.info("live:metric ACK durable=\(ok.count) rejected=\(bad.count) total=\(acks.count)")
        box.markAcked(ok)
        for (s, c) in bad { box.markRejected([s], code: c) }
        if let m = ok.max() { lastAckSequence = max(lastAckSequence, m) }
        onMetricAck?(o)
        pump()
    }

    // MARK: command

    /// 같은 command_id 로만 재시도한다. 새 ID 를 만들지 않는다(업무 부작용은 서버 ledger 가 한 번만 적용).
    public func dispatch(command: [String: Any]) {
        guard let id = command["command_id"] as? String else { return }
        var c = command
        let autoEpoch = c["expected_epoch"] == nil
        if c["protocol_version"] == nil { c["protocol_version"] = Self.protocolVersion }
        if c["schema_version"] == nil { c["schema_version"] = Self.schemaVersion }
        if c["session_id"] == nil { c["session_id"] = sessionId }
        if commands[id] != nil { return }   // 같은 ID 중복 dispatch 는 멱등
        commands[id] = Pending(command: c, attempt: 0, firstSentAt: scheduler.nowSeconds, inFlight: false, timer: nil, autoEpoch: autoEpoch)
        commandOrder.append(id)
        sendCommand(id)
    }

    private var canSendCommands: Bool { client.isConnected && (state == .ready || state == .degraded || state == .terminal) }

    private func flushCommands() { for id in commandOrder where commands[id] != nil { sendCommand(id) } }

    private func sendCommand(_ id: String) {
        guard var p = commands[id], !p.inFlight, p.timer == nil, canSendCommands else { return }
        if scheduler.nowSeconds - p.firstSentAt > Self.intentValiditySeconds { expire(id); return }
        p.inFlight = true; p.attempt += 1
        if p.autoEpoch { p.command["expected_epoch"] = String(epoch) }
        commands[id] = p
        client.emit("live:command", p.command, ackTimeout: 2) { [weak self] r in
            guard let self = self, var cur = self.commands[id] else { return }
            cur.inFlight = false; self.commands[id] = cur
            switch r {
            case .success(let v):
                if let ack = v as? [String: Any] { self.handleCommandAck(ack) } else { self.retryCommand(id, after: nil) }
            case .failure: self.retryCommand(id, after: nil)
            }
        }
    }

    private func retryCommand(_ id: String, after: TimeInterval?) {
        guard var p = commands[id] else { return }
        let wait = after ?? Self.commandBackoff[min(max(p.attempt - 1, 0), Self.commandBackoff.count - 1)]
        p.timer?.cancel()
        p.timer = scheduler.schedule(after: wait) { [weak self] in
            guard let self = self, var cur = self.commands[id] else { return }
            cur.timer = nil; self.commands[id] = cur
            self.sendCommand(id)
        }
        commands[id] = p
    }

    private func handleCommandAck(_ ack: [String: Any]) {
        guard let id = ack["command_id"] as? String, commands[id] != nil else { return }
        noteEpoch(ack["epoch"])
        Self.log.info("live:command ACK kind=\((self.commands[id]?.command["kind"] as? String) ?? "-", privacy: .public) status=\((ack["status"] as? String) ?? "-", privacy: .public) code=\((ack["code"] as? String) ?? "-", privacy: .public)")
        if (ack["status"] as? String) == "retryable" {
            // committed:true 이면 재실행이 아니라 같은 ID 의 ledger 결과 조회 — 어느 쪽이든 새 ID 는 만들지 않는다.
            retryCommand(id, after: TimeInterval((ack["retry_after_ms"] as? NSNumber)?.doubleValue ?? 500) / 1000)
            return
        }
        commands[id]?.timer?.cancel(); commands[id] = nil; commandOrder.removeAll { $0 == id }
        if let n = (ack["entity_version"] as? String).flatMap({ UInt64($0) }) { _ = n }
        onCommandAck?(ack)
    }

    /// 30초 의도 유효기간 초과: 결과를 단정하지 않고 retryable(result_unknown)로 알리고 snapshot 으로 정리한다.
    private func expire(_ id: String) {
        commands[id]?.timer?.cancel(); commands[id] = nil; commandOrder.removeAll { $0 == id }
        onCommandAck?(["command_id": id, "status": "retryable", "epoch": "0", "cursors": [], "committed": false, "code": "result_unknown", "retry_after_ms": 0])
        sendResync(reason: "intent_expired")
    }

    public var pendingCommandCount: Int { commands.count }

    private func noteEpoch(_ v: Any?) {
        if let e = (v as? String).flatMap({ UInt64($0) }), e > epoch { epoch = e }
    }

    // MARK: device (live:device)

    /// 밴드 상태 보고. 최신 1건만 유지(device_seq 는 호출자가 단조 증가로 부여). 서버는 READY 연결만 받으므로 READY 에서만 보낸다.
    public func reportDevice(_ report: [String: Any]) { pendingDevice = report; sendDevice() }

    private func sendDevice() {
        guard state == .ready, client.isConnected, !deviceInFlight, deviceRetryTimer == nil, let r = pendingDevice else { return }
        var d = base(); d["session_id"] = sessionId
        for (k, v) in r { d[k] = v }
        let seq = r["device_seq"] as? String
        deviceInFlight = true
        client.emit("live:device", d, ackTimeout: 2) { [weak self] res in
            guard let self = self else { return }
            self.deviceInFlight = false
            guard case .success(let v) = res, let o = v as? [String: Any] else { self.retryDevice(after: 1); return }
            let samePending = (self.pendingDevice?["device_seq"] as? String) == seq
            if let st = o["status"] as? String, st == "accepted" || st == "duplicate" {
                if samePending { self.pendingDevice = nil }
                self.sendDevice()
            } else if (o["retryable"] as? Bool) == true {
                self.retryDevice(after: TimeInterval((o["retry_after_ms"] as? NSNumber)?.doubleValue ?? 1000) / 1000)
            } else {
                if samePending { self.pendingDevice = nil }
                Self.log.error("live:device 거절 code=\((o["code"] as? String) ?? "-", privacy: .public)")
                self.onDeviceRejected?((o["code"] as? String) ?? "rejected")
            }
        }
    }
    private func retryDevice(after t: TimeInterval) {
        deviceRetryTimer?.cancel()
        deviceRetryTimer = scheduler.schedule(after: t) { [weak self] in self?.deviceRetryTimer = nil; self?.sendDevice() }
    }

    // MARK: clock probe (live:clock_probe)

    /// 서버가 probe 수신시각을 기록한다(10초 안에 capture.reanchor 가 이 probe 를 참조해야 서버가 오차를 보증).
    public func clockProbe(clientMonotonicUs: UInt64, _ done: @escaping (Result<ClockProbeResult, ClockProbeError>) -> Void) {
        guard state == .ready, client.isConnected else { done(.failure(.notReady)); return }
        let pid = UUID().uuidString.lowercased()
        var p = base(); p["probe_id"] = pid; p["client_monotonic_us"] = String(clientMonotonicUs)
        p["server_receive_ms"] = NSNull(); p["server_send_ms"] = NSNull()      // 계약 ClockProbe: 요청은 null, 서버가 채워 응답
        let sentAt = scheduler.nowSeconds
        client.emit("live:clock_probe", p, ackTimeout: 2) { [weak self] r in
            guard let self = self else { return }
            guard case .success(let v) = r, let o = v as? [String: Any] else { done(.failure(.transport)); return }
            guard (o["ok"] as? Bool) == true, (o["probe_id"] as? String) == pid,
                  let rx = (o["server_receive_ms"] as? NSNumber)?.uint64Value, let tx = (o["server_send_ms"] as? NSNumber)?.uint64Value
            else { done(.failure(.rejected((o["code"] as? String) ?? "invalid_probe_ack"))); return }
            done(.success(ClockProbeResult(probeId: pid, clientMonotonicUs: clientMonotonicUs, serverReceiveMs: rx, serverSendMs: tx,
                                           rttSeconds: max(0, self.scheduler.nowSeconds - sentAt))))
        }
    }
}
