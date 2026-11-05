import XCTest
@testable import MeasurementKit

/// SDD-301 — CBCentralManager(BandLink) 단일성, `.unsupported` 비영구화.
final class ManagerBootstrapPolicyTests: XCTestCase {
    func testCreatesOnlyWhenEnabledAndNoManager() {
        XCTAssertTrue(ManagerBootstrapPolicy.shouldCreate(nativeEnabled: true, hasManager: false))
        XCTAssertFalse(ManagerBootstrapPolicy.shouldCreate(nativeEnabled: true, hasManager: true), "이미 있으면 BandLink 를 다시 만들지 않는다")
        XCTAssertFalse(ManagerBootstrapPolicy.shouldCreate(nativeEnabled: false, hasManager: false))
        XCTAssertFalse(ManagerBootstrapPolicy.shouldCreate(nativeEnabled: false, hasManager: true))
    }
}

final class ManagerUnsupportedTests: XCTestCase {
    var dir: URL!, band: FakeBand!, live: FakeLive!, own: BandOwnership!, m: MeasurementManager!, sched: ManualScheduler!
    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("unsup-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        band = FakeBand(); live = FakeLive(); sched = ManualScheduler()
        own = BandOwnership(defaults: UserDefaults(suiteName: "u-\(UUID().uuidString)")!)
        own.nativeEnabled = true
        m = MeasurementManager(root: dir, band: band, ownership: own, makeLive: { [unowned self] _ in self.live },
                               makeEngine: { d, ctx, _ in try MeasurementEngine(dir: d, configJSON: CoreBridgeTests.cfg, context: ctx, journalSync: .none) },
                               scheduler: sched)
        band.delegate = m
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

    func testUnsupportedWhileIdleDoesNotLatchBlocked() {
        m.bandLink(didChange: .blocked, reason: "bluetooth_unsupported")
        XCTAssertNotEqual(m.state, .blocked, "unsupported 는 일시 상태일 수 있어 영구 BLOCKED 로 굳히지 않는다")
        XCTAssertEqual(m.blockedReason, "unsupported_background")
    }

    func testStartAfterUnsupportedStillConnectsBand() throws {
        m.bandLink(didChange: .blocked, reason: "bluetooth_unsupported")
        _ = try m.startMeasurement(sessionId: UUID().uuidString.lowercased(), credentialHandle: "h", configHash: "c", requestId: UUID().uuidString.lowercased())
        XCTAssertEqual(band.connects, 1, "unsupported 가 있었어도 시작 때 band.connect 를 시도한다")
        XCTAssertEqual(m.state, .arming)
    }

    func testUnsupportedClearsWhenSubscribed() {
        m.bandLink(didChange: .blocked, reason: "bluetooth_unsupported")
        m.bandLink(didChange: .subscribed, reason: nil)
        XCTAssertNil(m.blockedReason)
    }

    func testUnauthorizedStillBlocks() {
        m.bandLink(didChange: .blocked, reason: "bluetooth_unauthorized")
        XCTAssertEqual(m.state, .blocked); XCTAssertEqual(m.blockedReason, "bluetooth_permission")
    }
}
