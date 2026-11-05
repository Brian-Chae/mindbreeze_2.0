import XCTest
@testable import MeasurementKit

/// SDD-300 — 저장 진행 3종(feature.counts·archive.counts·reconcile.state) 2초 주기 송출. Android SyncEmitter 계약과 동일.
final class ManagerSyncHeartbeatTests: XCTestCase {
    var dir: URL!, band: FakeBand!, live: FakeLive!, own: BandOwnership!, sch: ManualScheduler!, m: MeasurementManager!
    var events: [[String: Any]] = []
    let sid = "00000001-0000-4000-8000-000000000001", req = "0000001e-0000-4000-8000-00000000001e"
    let req2 = "0000001f-0000-4000-8000-00000000001f", sid2 = "00000002-0000-4000-8000-000000000002"
    static let names = ["feature.counts", "archive.counts", "reconcile.state"]

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("mhb-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        band = FakeBand(); live = FakeLive(); sch = ManualScheduler()
        own = BandOwnership(defaults: UserDefaults(suiteName: "mhb-\(UUID().uuidString)")!); own.nativeEnabled = true
        m = MeasurementManager(root: dir, band: band, ownership: own, makeLive: { [unowned self] _ in self.live },
                               makeEngine: { d, ctx, _ in try MeasurementEngine(dir: d, configJSON: CoreBridgeTests.cfg, context: ctx, journalSync: .none) },
                               scheduler: sch)
        m.onBridgeEvent = { [unowned self] in events.append($0) }
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

    func syncEvents() -> [[String: Any]] { events.filter { Self.names.contains($0["event"] as? String ?? "") } }
    func names() -> [String] { syncEvents().compactMap { $0["event"] as? String } }
    func start(_ s: String? = nil, _ r: String? = nil) throws { _ = try m.startMeasurement(sessionId: s ?? sid, credentialHandle: "cred_handle_AbCdEfGh0123", configHash: String(repeating: "a", count: 64), requestId: r ?? req) }
    func payload(_ name: String) -> [String: Any]? { (syncEvents().last { ($0["event"] as? String) == name })?["payload"] as? [String: Any] }

    func testImmediateSetOnStartInOrder() throws {                                    // V1
        try start()
        XCTAssertEqual(names(), Self.names)
    }
    func testEveryTwoSecondsOneSetMax() throws {                                      // V2
        try start(); events.removeAll()
        sch.advance(1); XCTAssertEqual(names().count, 0)
        sch.advance(1); XCTAssertEqual(names(), Self.names)
        sch.advance(2); XCTAssertEqual(names().count, 6)
    }
    func testNoSessionSyncSendsNumericZerosAndIdleReconcile() throws {                // V3, V7
        try start()
        let f = payload("feature.counts")!, a = payload("archive.counts")!, r = payload("reconcile.state")!
        XCTAssertEqual(f["pending"] as? Int, 0); XCTAssertEqual(f["acked"] as? Int, 0); XCTAssertEqual(f["rejected"] as? Int, 0)
        for k in ["pending", "uploading", "verified", "quarantined"] { XCTAssertEqual(a[k] as? Int, 0, k) }
        XCTAssertEqual(f["sessionId"] as? String, sid)
        XCTAssertEqual(r["feature"] as? String, "idle"); XCTAssertEqual(r["raw"] as? String, "idle"); XCTAssertEqual(r["complete"] as? Bool, false)
    }
    func testCachedSessionSyncSnapshotIsUsedByHeartbeat() throws {                    // V4
        try start()
        var s = SyncSnapshot(); s.featurePending = 5; s.featureState = "syncing"
        m.emitSyncStatus(sessionId: sid, s)
        events.removeAll(); sch.advance(2)
        XCTAssertEqual(payload("feature.counts")?["pending"] as? Int, 5)
        XCTAssertEqual(payload("reconcile.state")?["feature"] as? String, "syncing")
    }
    func testStopSendsFinalOnceThenSilent() throws {                                  // V5
        try start(); events.removeAll()
        _ = try m.stopMeasurement(reason: "user_stop", requestId: req2)
        XCTAssertEqual(names(), Self.names)
        events.removeAll(); sch.advance(10)
        XCTAssertEqual(names().count, 0)
    }
    func testRestartWithNewSessionKeepsSingleTimer() throws {                         // V6
        try start()
        _ = try m.stopMeasurement(reason: "user_stop", requestId: req2)
        try start(sid2, "00000020-0000-4000-8000-000000000020"); events.removeAll()
        sch.advance(2)
        XCTAssertEqual(names().count, 3)
        XCTAssertEqual(payload("feature.counts")?["sessionId"] as? String, sid2)
    }
}
