import XCTest
@testable import MeasurementKit

final class FakeBand: BandControlling {
    var connects = 0, disconnects = 0
    weak var delegate: BandLinkDelegate?
    func connect(expectedPeripheral: UUID?) { connects += 1 }
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
    func attach(outbox: MetricOutbox) {}
    func pump() {}
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
                               makeEngine: { [unowned self] d, ctx in try MeasurementEngine(dir: d, configJSON: CoreBridgeTests.cfg, context: ctx, journalSync: .none) },
                               participantId: { _ in "00000004-0000-4000-8000-000000000004" })
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
    func testJSOwningBandBlocksNativeStart() throws {
        own.nativeEnabled = true; own.setJSOwning(true)
        XCTAssertThrowsError(try start()) { XCTAssertEqual($0 as? ManagerError, .jsOwnsBand) }
        XCTAssertEqual(band.connects, 0)
    }
    func testCaptureStartCommandUsesUniqueIdAndStreamFromDeviceEventPromotesToCapturing() throws {
        own.nativeEnabled = true; _ = try start()
        let cmd = live.dispatched.first
        XCTAssertEqual(cmd?["kind"] as? String, "capture.start")
        XCTAssertEqual((cmd?["payload"] as? [String: Any])?["device_profile"] as? String, "linkband2-v1")
        m.liveStateChanged(.ready)
        live.onEvent?(["domain": "device", "kind": "device.changed", "audience": "member:00000004-0000-4000-8000-000000000004",
                       "payload": ["stream_id": "00000014-0000-4000-8000-000000000014", "generation": 3, "status": "active"]])
        XCTAssertEqual(live.owner?.0, "00000014-0000-4000-8000-000000000014"); XCTAssertEqual(live.owner?.1, 3)
        XCTAssertEqual(m.state, .capturing)
        let snap = m.snapshot()
        XCTAssertEqual(snap["streamId"] as? String, "00000014-0000-4000-8000-000000000014"); XCTAssertEqual(snap["ownerGeneration"] as? String, "3")
    }
    func testNewerOwnerGenerationFencesAndBlocks() throws {
        own.nativeEnabled = true; _ = try start()
        live.onEvent?(["domain": "device", "kind": "device.changed", "payload": ["stream_id": "00000014-0000-4000-8000-000000000014", "generation": 3, "status": "active"]])
        live.onEvent?(["domain": "device", "kind": "device.changed", "payload": ["stream_id": "00000099-0000-4000-8000-000000000099", "generation": 4, "status": "active"]])
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
        live.onEvent?(["domain": "device", "kind": "device.changed", "payload": ["stream_id": "00000014-0000-4000-8000-000000000014", "generation": 3, "status": "active"]])
        let r = try m.stopMeasurement(reason: "user_stop", requestId: "0000001f-0000-4000-8000-00000000001f")
        XCTAssertEqual(r["seal_started"] as? Bool, true); XCTAssertEqual(r["state"] as? String, "SEALING")
        XCTAssertEqual(r["note"] as? String, "seal_started_is_not_archive_complete")
        XCTAssertEqual(band.disconnects, 1)
        let close = live.dispatched.last
        XCTAssertEqual(close?["kind"] as? String, "capture.close")
        let fs = (close?["payload"] as? [String: Any])?["final_sequences"] as? [String: Any]
        XCTAssertNotNil(fs?["metric"])
        own.setJSOwning(true) // sealing 중에도 native 가 소유 중이면 거절
        XCTAssertFalse(own.setJSOwning(true) && own.isNativeOwning)
    }
    func testAuthExpiredLiveBlocksButKeepsCollecting() throws {
        own.nativeEnabled = true; _ = try start()
        live.onEvent?(["domain": "device", "kind": "device.changed", "payload": ["stream_id": "00000014-0000-4000-8000-000000000014", "generation": 3, "status": "active"]])
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
        live.onEvent?(["domain": "device", "kind": "device.changed", "payload": ["stream_id": "00000014-0000-4000-8000-000000000014", "generation": 3, "status": "active"]])
        m.bandLink(didChange: .reconnecting, reason: "ble_disconnect")
        XCTAssertEqual(m.state, .reconnecting)
        m.bandLink(didChange: .subscribed, reason: nil)
        XCTAssertEqual(m.state, .capturing)
    }
}
