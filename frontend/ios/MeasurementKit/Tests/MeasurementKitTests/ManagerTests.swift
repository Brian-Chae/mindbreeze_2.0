import XCTest
@testable import MeasurementKit

final class FakeBand: BandControlling {
    var connects = 0, disconnects = 0
    var lastExpected: UUID?
    weak var delegate: BandLinkDelegate?
    func connect(expectedPeripheral: UUID?) { connects += 1; lastExpected = expectedPeripheral }
    func disconnect() { disconnects += 1 }
}
final class FakeLive: LiveControlling {
    var started = 0, stopped = 0
    var dispatched: [[String: Any]] = []
    var owner: (String, UInt64)?
    var vis: Visibility = .foreground
    var onState: ((LiveState) -> Void)?; var onEvent: (([String: Any]) -> Void)?; var onCommandAck: (([String: Any]) -> Void)?
    var state: LiveState = .idle
    var lastAckSequence: UInt64 = 0; var nativeHeartbeatCount: UInt64 = 0
    func start() { started += 1 }; func stop() { stopped += 1 }
    func dispatch(command: [String: Any]) { dispatched.append(command) }
    func setOwner(streamId: String, generation: UInt64) { owner = (streamId, generation) }
    func clearOwner() { owner = nil }
    func setVisibility(_ v: Visibility) { vis = v }
    var outbox: MetricOutbox?
    func attach(outbox: MetricOutbox) { self.outbox = outbox }
    func pump() {}
    var onDeviceRejected: ((String) -> Void)?
    var devices: [[String: Any]] = []
    func reportDevice(_ report: [String: Any]) { devices.append(report) }
    var probes: [(us: UInt64, done: (Result<ClockProbeResult, ClockProbeError>) -> Void)] = []
    func clockProbe(clientMonotonicUs: UInt64, _ done: @escaping (Result<ClockProbeResult, ClockProbeError>) -> Void) { probes.append((clientMonotonicUs, done)) }

    static let stream = "00000014-0000-4000-8000-000000000014", pid = "00000004-0000-4000-8000-000000000004"
    func command(_ kind: String) -> [String: Any]? { dispatched.last { ($0["kind"] as? String) == kind } }
    /// 서버 capture.start ACK(T05b: result 에 stream_id·participant_id·generation·owner_generation·lease, u64 는 문자열).
    func ackCaptureStart(stream: String = FakeLive.stream, generation: String = "3", participant: String = FakeLive.pid, status: String = "applied") {
        let id = command("capture.start")!["command_id"] as! String
        onCommandAck?(["command_id": id, "status": status, "epoch": "1", "cursors": [], "entity_version": "1", "committed": true,
                       "result": ["stream_id": stream, "participant_id": participant, "generation": generation, "owner_generation": generation,
                                  "lease": ["expires_at_ms": 1_760_000_030_000, "offline_bound_until_ms": 1_760_000_600_000], "clock_uncertain": true]])
    }
    func ack(_ kind: String, status: String = "applied", code: String? = nil, result: [String: Any]? = nil) {
        var a: [String: Any] = ["command_id": command(kind)!["command_id"] as! String, "status": status, "epoch": "1", "cursors": [], "committed": status != "retryable"]
        if let c = code { a["code"] = c }
        if let r = result { a["result"] = r }
        onCommandAck?(a)
    }
}

final class ManagerTests: XCTestCase {
    var dir: URL!, band: FakeBand!, live: FakeLive!, own: BandOwnership!, m: MeasurementManager!
    var events: [[String: Any]] = []
    let sid = "00000001-0000-4000-8000-000000000001", req = "0000001e-0000-4000-8000-00000000001e"
    let handle = "cred_handle_AbCdEfGh0123", cfgHash = String(repeating: "a", count: 64)

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("mgr-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        band = FakeBand(); live = FakeLive()
        own = BandOwnership(defaults: UserDefaults(suiteName: "m-\(UUID().uuidString)")!)
        m = MeasurementManager(root: dir, band: band, ownership: own, makeLive: { [unowned self] _ in self.live },
                               makeEngine: { [unowned self] d, ctx, _ in try MeasurementEngine(dir: d, configJSON: CoreBridgeTests.cfg, context: ctx, journalSync: .none) },
                               scheduler: ManualScheduler())
        m.onBridgeEvent = { [unowned self] in events.append($0) }
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }
    func start(_ r: String? = nil) throws -> [String: Any] { try m.startMeasurement(sessionId: sid, credentialHandle: handle, configHash: cfgHash, requestId: r ?? req) }

    func testFeatureFlagOffRejectsStartAndTouchesNoBle() {
        XCTAssertThrowsError(try start()) { XCTAssertEqual($0 as? ManagerError, .nativeDisabled) }
        XCTAssertEqual(band.connects, 0); XCTAssertEqual(live.started, 0)
        XCTAssertEqual(m.state, .idle)
    }
    func testStartIsIdempotentPerRequestIdAndSecondRequestRejectedWhileActive() throws {
        own.nativeEnabled = true
        let r1 = try start()
        XCTAssertEqual(r1["state"] as? String, "ARMING"); XCTAssertEqual(r1["idempotentReplay"] as? Bool, false)
        let r2 = try start()
        XCTAssertEqual(r2["idempotentReplay"] as? Bool, true); XCTAssertEqual(r2["managerId"] as? String, r1["managerId"] as? String)
        XCTAssertEqual(band.connects, 1, "같은 requestId 는 새 수집을 시작하지 않는다")
        XCTAssertThrowsError(try start("0000001f-0000-4000-8000-00000000001f")) { XCTAssertEqual($0 as? ManagerError, .alreadyActive) }
    }
    /// 재연결 버튼: 수집 중이면 밴드 링크를 끊었다 다시 붙인다(백오프 초기화). 수집 중이 아니면 거절.
    func testReconnectBandRestartsLinkOnlyWhileCollecting() throws {
        own.nativeEnabled = true
        XCTAssertThrowsError(try m.reconnectBand()) { XCTAssertEqual($0 as? ManagerError, .notActive) }
        _ = try start()
        let before = (band.connects, band.disconnects)
        let r = try m.reconnectBand()
        XCTAssertEqual(r["accepted"] as? Bool, true)
        XCTAssertEqual(band.disconnects, before.1 + 1); XCTAssertEqual(band.connects, before.0 + 1)
    }
    /// A7: 활성 모델 pin — capture.start·snapshot 의 model 이 pin 버전, 모델 없으면 코호트.
    func testModelPinFlowsToCaptureStartAndSnapshot() throws {
        own.nativeEnabled = true
        let model = #"{"focusIndex":{"m":-1.2,"s":0.5,"direction":1}}"#
        _ = try m.startMeasurement(sessionId: sid, credentialHandle: handle, configHash: cfgHash, requestId: req, modelParams: model, modelVersion: "v7")
        let payload = live.dispatched.first?["payload"] as? [String: Any]
        XCTAssertEqual(payload?["model_version"] as? String, "sigmoid-v7")
        XCTAssertEqual((m.snapshot()["versions"] as? [String: Any])?["model"] as? String, "sigmoid-v7")
        XCTAssertTrue(FileManager.default.fileExists(atPath: dir.appendingPathComponent("sessions/\(sid)/model-pin.json").path))
    }
    /// C1: iOS 스냅샷은 계약 필드를 최상위에 둔다(Android 의 `bridge` 중첩 결함 없음). 이벤트 payload 도 같은 형태.
    func testSnapshotIsContractShapedWithoutBridgeNesting() throws {
        own.nativeEnabled = true; _ = try start()
        let snap = m.snapshot()
        XCTAssertNil(snap["bridge"]); XCTAssertEqual(snap["bridge_version"] as? Int, 1); XCTAssertNotNil(snap["seq"] as? String)
        let upd = events.last { $0["event"] as? String == "measurementUpdated" }
        XCTAssertNil((upd?["payload"] as? [String: Any])?["bridge"]); XCTAssertNotNil((upd?["payload"] as? [String: Any])?["seq"] as? String)
    }
    func testNoModelKeepsCohortVersion() throws {
        own.nativeEnabled = true; _ = try start()
        XCTAssertEqual((live.dispatched.first?["payload"] as? [String: Any])?["model_version"] as? String, "b0-cohort-2")
        XCTAssertEqual((m.snapshot()["versions"] as? [String: Any])?["model"] as? String, "b0-cohort-2")
    }
    func testJSOwningBandBlocksNativeStart() throws {
        own.nativeEnabled = true; own.setJSOwning(true)
        XCTAssertThrowsError(try start()) { XCTAssertEqual($0 as? ManagerError, .jsOwnsBand) }
        XCTAssertEqual(band.connects, 0)
    }
    func testCaptureStartAckResultPromotesToCapturing() throws {
        own.nativeEnabled = true; _ = try start()
        let cmd = live.dispatched.first
        XCTAssertEqual(cmd?["kind"] as? String, "capture.start")
        XCTAssertEqual((cmd?["payload"] as? [String: Any])?["device_profile"] as? String, "linkband2-v1")
        m.liveStateChanged(.ready)
        live.ackCaptureStart()
        XCTAssertEqual(live.owner?.0, "00000014-0000-4000-8000-000000000014"); XCTAssertEqual(live.owner?.1, 3)
        XCTAssertEqual(m.state, .capturing)
        let snap = m.snapshot()
        XCTAssertEqual(snap["streamId"] as? String, "00000014-0000-4000-8000-000000000014"); XCTAssertEqual(snap["ownerGeneration"] as? String, "3")
    }
    func testNewerOwnerGenerationFencesAndBlocks() throws {
        own.nativeEnabled = true; _ = try start()
        live.ackCaptureStart()
        live.onEvent?(["domain": "device", "kind": "device.changed", "payload": ["stream_id": "00000099-0000-4000-8000-000000000099", "generation": "4", "status": "active"]])
        XCTAssertEqual(m.state, .blocked); XCTAssertEqual(m.blockedReason, "owner_fenced")
        XCTAssertEqual(band.disconnects, 1)
    }
    func testBridgeEventsHaveMonotonicSeqAndGeneration() throws {
        own.nativeEnabled = true; _ = try start()
        m.emitMeasurementUpdated(); m.emitMeasurementUpdated()
        let seqs = events.compactMap { ($0["seq"] as? String).flatMap { UInt64($0) } }
        XCTAssertEqual(seqs, seqs.sorted()); XCTAssertEqual(Set(seqs).count, seqs.count)
        XCTAssertTrue(events.allSatisfy { ($0["managerGeneration"] as? String) == "1" && ($0["bridge_version"] as? Int) == 1 })
    }
    func testSnapshotShapeHasContractRequiredKeysAndNativeCounters() throws {
        own.nativeEnabled = true; _ = try start()
        let s = m.snapshot()
        for k in ["bridge_version", "managerGeneration", "seq", "sessionId", "state", "blocked_reason", "streamId", "ownerGeneration", "versions", "metrics", "collection", "live", "archive", "gaps"] { XCTAssertNotNil(s[k], k) }
        let c = (s["collection"] as? [String: Any])?["counters"] as? [String: Any]
        XCTAssertEqual(c?["js_heartbeat_independent"] as? Bool, true)
        XCTAssertEqual(((s["archive"] as? [String: Any])?["queue"] as? [String: Any])?["disk_limit_bytes"] as? Int, 536870912)
        XCTAssertTrue(s["metrics"] is NSNull, "측정 전 metrics 는 null (0 으로 채우지 않음)")
    }
    func testStopStartsSealWithoutClaimingArchiveComplete() throws {
        own.nativeEnabled = true; _ = try start()
        live.ackCaptureStart()
        let r = try m.stopMeasurement(reason: "user_stop", requestId: "0000001f-0000-4000-8000-00000000001f")
        XCTAssertEqual(r["seal_started"] as? Bool, true); XCTAssertEqual(r["state"] as? String, "SEALING")
        XCTAssertEqual(r["note"] as? String, "seal_started_is_not_archive_complete")
        XCTAssertEqual(band.disconnects, 1)
        let close = live.dispatched.last
        XCTAssertEqual(close?["kind"] as? String, "capture.close")
        let fs = (close?["payload"] as? [String: Any])?["final_sequences"] as? [String: Any]
        XCTAssertNotNil(fs?["metric"])
        own.setJSOwning(true) // sealing 중에도 native 가 소유 중이면 거절
        XCTAssertTrue(own.isNativeOwning)
    }
    func testAuthExpiredLiveBlocksButKeepsCollecting() throws {
        own.nativeEnabled = true; _ = try start()
        live.ackCaptureStart()
        m.liveStateChanged(.authBlocked)
        XCTAssertEqual(m.state, .capturing, "수집은 계속, live 만 막힘")
        XCTAssertEqual(m.snapshot()["blocked_reason"] as? String, "auth_expired")
    }
    func testRevokedLiveStopsCaptureWithCleanBlock() throws {
        own.nativeEnabled = true; _ = try start()
        m.liveStateChanged(.revoked)
        XCTAssertEqual(m.state, .blocked); XCTAssertEqual(m.blockedReason, "consent_missing")
        XCTAssertEqual(band.disconnects, 1)
    }
    func testBleLossMovesToReconnectingAndBackToCapturing() throws {
        own.nativeEnabled = true; _ = try start()
        live.ackCaptureStart()
        m.bandLink(didChange: .reconnecting, reason: "ble_disconnect")
        XCTAssertEqual(m.state, .reconnecting)
        m.bandLink(didChange: .subscribed, reason: nil)
        XCTAssertEqual(m.state, .capturing)
    }
}

final class ManagerRecoveryAndContractTests: XCTestCase {
    var dir: URL!
    let sid = "00000001-0000-4000-8000-000000000001"
    func make(_ band: FakeBand, _ live: FakeLive, _ own: BandOwnership) -> MeasurementManager {
        let m = MeasurementManager(root: dir, band: band, ownership: own, makeLive: { _ in live },
                                   makeEngine: { d, ctx, _ in try MeasurementEngine(dir: d, configJSON: CoreBridgeTests.cfg, context: ctx, journalSync: .none) },
                                   scheduler: ManualScheduler(), nowMs: { 1_760_000_000_000 })
        return m
    }
    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("mrc-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

    /// 서버 live:event(T04 _wire_event)와 같은 전체 LiveEvent 형태. DeviceEntity 합집합(T05b): participant_id 필수, generation 은 문자열.
    func deviceEvent(stream: String, generation: String, status: String = "active", cutoff: String? = nil) -> [String: Any] {
        ["protocol_version": 2, "schema_version": 1, "event_id": UUID().uuidString.lowercased(), "session_id": sid, "epoch": "1",
         "audience": "member:00000004-0000-4000-8000-000000000004", "domain": "device", "seq": "1", "entity_id": "00000004-0000-4000-8000-000000000004",
         "entity_version": "1", "kind": "device.changed", "observed_at_ms": NSNull(), "received_at_server_ms": 1_760_000_000_000,
         "payload": ["participant_id": "00000004-0000-4000-8000-000000000004", "stream_id": stream, "generation": generation, "status": status,
                     "clock_uncertain": true, "cutoff_code": cutoff.map { $0 as Any } ?? NSNull()]]
    }
    func startCapturing(_ m: MeasurementManager, _ live: FakeLive) throws {
        _ = try m.startMeasurement(sessionId: sid, credentialHandle: "cred_handle_AbCdEfGh0123", configHash: String(repeating: "a", count: 64), requestId: "0000001e-0000-4000-8000-00000000001e")
        live.ackCaptureStart()
        live.onEvent?(deviceEvent(stream: "00000014-0000-4000-8000-000000000014", generation: "3"))
    }

    func testRecoverOnLaunchRestoresEngineAndReconnectsBandWithoutNewCaptureStart() throws {
        let own1 = BandOwnership(defaults: UserDefaults(suiteName: "r-\(UUID().uuidString)")!); own1.nativeEnabled = true
        let b1 = FakeBand(), l1 = FakeLive(); let m1 = make(b1, l1, own1)
        try startCapturing(m1, l1)
        for i in 0..<300 { let p = EngineTests.packets[i]; m1.bandLink(didReceive: p.sensor, data: p.bytes, monotonicUs: p.arrivalUs) }
        let committed = m1.snapshot()["collection"] as! [String: Any]
        XCTAssertEqual(committed["last_committed_sample_sequence"] as? String, "300")
        // 프로세스 종료 모사: m1 폐기, 새 인스턴스(앱 재시작)
        let suite = "r-\(UUID().uuidString)"
        let own2 = BandOwnership(defaults: UserDefaults(suiteName: suite)!); own2.nativeEnabled = true
        let b2 = FakeBand(), l2 = FakeLive(); let m2 = make(b2, l2, own2)
        XCTAssertTrue(m2.recoverOnLaunch())
        XCTAssertEqual(m2.state, .reconnecting)
        XCTAssertEqual(b2.connects, 1); XCTAssertEqual(l2.started, 1)
        XCTAssertEqual(l2.owner?.0, "00000014-0000-4000-8000-000000000014"); XCTAssertEqual(l2.owner?.1, 3)
        XCTAssertFalse(l2.dispatched.contains { ($0["kind"] as? String) == "capture.start" }, "복구는 새 stream 을 만들지 않고 기존 owner generation 으로 이어간다")
        let s = m2.snapshot()
        XCTAssertEqual((s["collection"] as! [String: Any])["last_committed_sample_sequence"] as? String, "300")
        // 첫 패킷이 오면 app_killed bounded gap 이 기록되고 CAPTURING 복귀
        m2.bandLink(didChange: .subscribed, reason: nil)
        let p = EngineTests.packets[400]; m2.bandLink(didReceive: p.sensor, data: p.bytes, monotonicUs: p.arrivalUs)
        let kinds = (m2.snapshot()["gaps"] as! [[String: Any]]).map { $0["kind"] as? String }
        XCTAssertTrue(kinds.contains("app_killed"))
        XCTAssertEqual(m2.state, .capturing)
    }
    func testRecoverNotAttemptedWhenFlagOffOrNothingActiveOrAlreadyClosed() throws {
        let off = BandOwnership(defaults: UserDefaults(suiteName: "r-\(UUID().uuidString)")!)
        let m = make(FakeBand(), FakeLive(), off)
        XCTAssertFalse(m.recoverOnLaunch(), "플래그 off: 아무것도 하지 않는다")
        let on = BandOwnership(defaults: UserDefaults(suiteName: "r-\(UUID().uuidString)")!); on.nativeEnabled = true
        let b = FakeBand(); XCTAssertFalse(make(b, FakeLive(), on).recoverOnLaunch()); XCTAssertEqual(b.connects, 0)
    }
    func testStopThenRelaunchDoesNotResurrect() throws {
        let own = BandOwnership(defaults: UserDefaults(suiteName: "r-\(UUID().uuidString)")!); own.nativeEnabled = true
        let l = FakeLive(); let m = make(FakeBand(), l, own); try startCapturing(m, l)
        _ = try m.stopMeasurement(reason: "user_stop", requestId: "0000001f-0000-4000-8000-00000000001f")
        let own2 = BandOwnership(defaults: UserDefaults(suiteName: "r-\(UUID().uuidString)")!); own2.nativeEnabled = true
        let b2 = FakeBand(); XCTAssertFalse(make(b2, FakeLive(), own2).recoverOnLaunch()); XCTAssertEqual(b2.connects, 0)
    }
    func testSealQueuesRawAndFeatureForArchiveWithStreamId() throws {
        let own = BandOwnership(defaults: UserDefaults(suiteName: "r-\(UUID().uuidString)")!); own.nativeEnabled = true
        let l = FakeLive(); let m = make(FakeBand(), l, own); try startCapturing(m, l)
        for i in 0..<400 { let p = EngineTests.packets[i]; m.bandLink(didReceive: p.sensor, data: p.bytes, monotonicUs: p.arrivalUs) }
        _ = try m.stopMeasurement(reason: "user_stop", requestId: "0000001f-0000-4000-8000-00000000001f")
        let q = m.archiveQueue!
        XCTAssertEqual(q.counts.pending, 2)
        let item = q.dueItems(now: 0)[0]
        XCTAssertEqual(item.captureStreamId, "00000014-0000-4000-8000-000000000014")
        XCTAssertEqual(Hashing.sha256Hex(file: m.archiveFileURL(item)), item.sha256)
        XCTAssertEqual(m.state, .sealing)
    }

    /// Swift 가 만든 snapshot/event JSON 을 contracts/measurement-bridge 의 ajv 검증기로 확인한다(MK_CONTRACT_OUT 지정 시 파일로 내보냄).
    func testEmitContractSamplesForNodeValidation() throws {
        let own = BandOwnership(defaults: UserDefaults(suiteName: "r-\(UUID().uuidString)")!); own.nativeEnabled = true
        let l = FakeLive(); let m = make(FakeBand(), l, own)
        var evs: [[String: Any]] = []; m.onBridgeEvent = { evs.append($0) }
        try startCapturing(m, l)
        for i in 0..<1500 { let p = EngineTests.packets[i]; m.bandLink(didReceive: p.sensor, data: p.bytes, monotonicUs: p.arrivalUs) }
        m.bandLink(didChange: .reconnecting, reason: "ble_disconnect")
        m.emitArchiveStatus(stage: "put", code: "http_503")
        let out: [String: Any] = ["snapshot": m.snapshot(), "events": evs,
                                  "start": ["managerId": "00000003-0000-4000-8000-000000000003", "streamId": "00000014-0000-4000-8000-000000000014", "ownerGeneration": "3", "managerGeneration": "1", "state": "ARMING", "idempotentReplay": false],
                                  "capabilities": NativeCapabilities.make(osVersion: "17.5", bluetooth: "granted", notifications: "granted"),
                                  // 웹→native 인계 요청(토큰 포함 허용)과 결과(핸들만)를 플러그인과 같은 함수로 만든다
                                  "registerCredential": ["request": ["accountId": "acct-0001", "accessToken": "opaque-access", "refreshToken": "opaque-refresh", "apiBase": "https://api.example.test"],
                                                         "result": NativeBridgeAPI.registerCredentialResult(handle: "cred_handle_AbCdEfGh0123")]]
        let data = try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])
        if let path = ProcessInfo.processInfo.environment["MK_CONTRACT_OUT"] { try data.write(to: URL(fileURLWithPath: path)) }
        XCTAssertFalse(evs.isEmpty)
    }
}
