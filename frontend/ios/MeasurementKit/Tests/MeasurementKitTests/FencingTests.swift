import XCTest
@testable import MeasurementKit

final class FencingTests: XCTestCase {
    func testNativeOwnershipDefaultsOffAndRejectsStart() {
        let o = BandOwnership(defaults: UserDefaults(suiteName: "t-\(UUID().uuidString)")!)
        XCTAssertFalse(o.nativeEnabled)
        XCTAssertEqual(o.tryAcquireNative(), .rejected(.nativeDisabled))
    }
    func testJSOwnerBlocksNativeAndViceVersa() {
        let o = BandOwnership(defaults: UserDefaults(suiteName: "t-\(UUID().uuidString)")!)
        o.nativeEnabled = true
        o.setJSOwning(true)
        XCTAssertEqual(o.tryAcquireNative(), .rejected(.jsOwnsBand))
        o.setJSOwning(false)
        XCTAssertEqual(o.tryAcquireNative(), .acquired)
        XCTAssertFalse(o.setJSOwning(true), "native 소유 중이면 JS 가 밴드를 가질 수 없다")
        o.releaseNative()
        XCTAssertTrue(o.setJSOwning(true))
    }
    func testGenerationFencingDropsStaleCallbacks() {
        let f = GenerationFence()
        let g1 = f.advance()
        XCTAssertTrue(f.isCurrent(g1))
        let g2 = f.advance()
        XCTAssertFalse(f.isCurrent(g1))
        XCTAssertTrue(f.isCurrent(g2))
        XCTAssertEqual(g2, g1 + 1)
    }
    func testOwnerGenerationFencingStopsOldOwnerAfterNewerGeneration() {
        var lease = OwnerLease(streamId: "s", generation: 3)
        XCTAssertTrue(lease.mayWriteLive)
        lease.observe(serverGeneration: 4)
        XCTAssertFalse(lease.mayWriteLive, "새 generation 이 존재하면 구 owner 는 live 갱신 금지")
        XCTAssertTrue(lease.mustStop)
    }
}
