import XCTest
@testable import MeasurementKit

/// SDD-293 — 밴드 보류 인계: 시작 때 재연결 0회, 이탈 시 확실한 해제.
final class BandHoldTests: XCTestCase {
    func testHoldReuseDecisionTable() {
        let a = UUID(), b = UUID()
        XCTAssertEqual(HoldReuse.decide(holding: false, holdReady: false, peripheralConnected: true, expected: a, held: a), .fresh)
        XCTAssertEqual(HoldReuse.decide(holding: true, holdReady: true, peripheralConnected: true, expected: a, held: a), .reuse)
        XCTAssertEqual(HoldReuse.decide(holding: true, holdReady: true, peripheralConnected: true, expected: nil, held: a), .reuse)
        XCTAssertEqual(HoldReuse.decide(holding: true, holdReady: false, peripheralConnected: true, expected: a, held: a), .joinPending)
        XCTAssertEqual(HoldReuse.decide(holding: true, holdReady: true, peripheralConnected: false, expected: a, held: a), .joinPending)
        XCTAssertEqual(HoldReuse.decide(holding: true, holdReady: true, peripheralConnected: true, expected: a, held: b), .fresh)
    }
}

final class ManagerHoldTests: XCTestCase {
    var dir: URL!, band: FakeBand!, live: FakeLive!, own: BandOwnership!, m: MeasurementManager!, sched: ManualScheduler!
    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("hold-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        band = FakeBand(); live = FakeLive(); sched = ManualScheduler()
        own = BandOwnership(defaults: UserDefaults(suiteName: "h-\(UUID().uuidString)")!)
        own.nativeEnabled = true
        m = MeasurementManager(root: dir, band: band, ownership: own, makeLive: { [unowned self] _ in self.live },
                               makeEngine: { d, ctx, _ in try MeasurementEngine(dir: d, configJSON: CoreBridgeTests.cfg, context: ctx, journalSync: .none) },
                               scheduler: sched)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

    func testHoldConnectsWithoutStartingCaptureOrLive() {
        var ok: Bool?
        m.holdBand(peripheralId: UUID()) { ok = $0 }
        XCTAssertEqual(band.holds, 1); XCTAssertEqual(band.connects, 0)
        XCTAssertEqual(live.started, 0, "보류 중에는 서버 스트림·소켓을 만들지 않는다")
        band.onHoldReady?()
        XCTAssertEqual(ok, true)
    }

    func testReleaseHeldBandDisconnects() {
        m.holdBand(peripheralId: UUID()) { _ in }
        band.onHoldReady?()
        XCTAssertTrue(m.releaseHeldBand())
        XCTAssertEqual(band.disconnects, 1, "대기실 이탈 시 cancelPeripheralConnection 경로")
    }

    func testHoldTimeoutDisconnectsAndReportsFalse() {
        var ok: Bool?
        m.holdBand(peripheralId: UUID()) { ok = $0 }
        sched.advance(MeasurementManager.holdTimeout + 1)
        XCTAssertEqual(ok, false); XCTAssertEqual(band.disconnects, 1)
    }

    func testReleaseWithoutHoldIsNoop() {
        XCTAssertTrue(m.releaseHeldBand()); XCTAssertEqual(band.disconnects, 0)
    }
}
