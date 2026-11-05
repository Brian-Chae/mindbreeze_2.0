import XCTest
@testable import MeasurementKit

final class BandReleasePlanTests: XCTestCase {
    let a = UUID(), b = UUID()
    func testCurrentOnly() { XCTAssertEqual(BandReleasePlan.targets(current: a, connected: []), [a]) }
    func testConnectedOnlyWhenCurrentNil() { XCTAssertEqual(BandReleasePlan.targets(current: nil, connected: [a]), [a]) }
    func testDedupKeepsOrder() { XCTAssertEqual(BandReleasePlan.targets(current: a, connected: [a, b]), [a, b]) }
    func testEmpty() { XCTAssertEqual(BandReleasePlan.targets(current: nil, connected: []), []) }
}
