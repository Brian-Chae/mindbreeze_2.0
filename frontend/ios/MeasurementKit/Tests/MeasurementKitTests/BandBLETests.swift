import XCTest
import CoreBluetooth
@testable import MeasurementKit

final class BandBLETests: XCTestCase {
    func testUUIDsMatchWebAndSDDSources() {
        XCTAssertEqual(BandUUIDs.eegService.uuidString.lowercased(), "df7b5d95-3afe-00a1-084c-b50895ef4f95")
        XCTAssertEqual(BandUUIDs.eegChar.uuidString.lowercased(), "00ab4d15-66b4-0d8a-824f-8d6f8966c6e5")
        XCTAssertEqual(BandUUIDs.ppgChar.uuidString.lowercased(), "6c739642-23ba-818b-2045-bfe8970263f6")
        XCTAssertEqual(BandUUIDs.accChar.uuidString.lowercased(), "d3d46a35-4394-e9aa-5a43-e7921120aaed")
        XCTAssertEqual(BandUUIDs.sensor(for: BandUUIDs.ppgChar), .ppg)
        XCTAssertNil(BandUUIDs.sensor(for: CBUUID(string: "2A19")))
    }
    func testMonotonicClockIsNonDecreasing() {
        let a = MonotonicClock.nowUs(); let b = MonotonicClock.nowUs()
        XCTAssertGreaterThanOrEqual(b, a); XCTAssertGreaterThan(a, 0)
    }
    func testRestorationPlanReattachesKnownPeripheralAndResubscribes() {
        let known = UUID()
        let plan = RestorationPlan.make(restored: [RestoredPeripheral(id: known, connected: true, discoveredCharacteristics: [BandUUIDs.eegChar], notifying: [BandUUIDs.eegChar])],
                                         expectedPeripheral: known)
        XCTAssertEqual(plan.action, .adopt(known))
        XCTAssertEqual(Set(plan.needNotify), [BandUUIDs.ppgChar, BandUUIDs.accChar], "이미 notify 중인 EEG 는 건드리지 않고 나머지만 재구독")
    }
    func testRestorationPlanIgnoresForeignPeripheralAndDisconnectedReconnects() {
        let known = UUID()
        XCTAssertEqual(RestorationPlan.make(restored: [RestoredPeripheral(id: UUID(), connected: true, discoveredCharacteristics: [], notifying: [])], expectedPeripheral: known).action, .none)
        let p = RestorationPlan.make(restored: [RestoredPeripheral(id: known, connected: false, discoveredCharacteristics: [], notifying: [])], expectedPeripheral: known)
        XCTAssertEqual(p.action, .reconnect(known))
    }
    func testReconnectBackoffIsBoundedAndResets() {
        var b = ReconnectBackoff()
        XCTAssertEqual((0..<8).map { _ in b.next() }, [1, 2, 4, 8, 15, 15, 15, 15])
        b.reset(); XCTAssertEqual(b.next(), 1)
    }
}
