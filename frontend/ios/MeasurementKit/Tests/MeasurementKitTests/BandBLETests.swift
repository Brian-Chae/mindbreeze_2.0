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
    func testReconnectFastWindowRetriesEvery2to3SecondsAtLeast40Times() {
        var b = ReconnectBackoff(random: { 0.5 }); b.startWindow(now: 0)
        var t: TimeInterval = 0; var n = 0
        while b.isFast(now: t) { n += 1; t += b.next(now: t) }
        XCTAssertGreaterThanOrEqual(n, 40); XCTAssertEqual(n, 48)
        var lo = ReconnectBackoff(random: { 0 }), hi = ReconnectBackoff(random: { 1 })
        XCTAssertEqual(lo.next(now: 0), 2.0, accuracy: 0.001)
        XCTAssertEqual(hi.next(now: 0), 3.0, accuracy: 0.001)
        XCTAssertEqual(ReconnectBackoff.attemptTimeout, 10)
    }
    func testReconnectSlowBackoffAfter120sThenScanFallbackAndReset() {
        var b = ReconnectBackoff(random: { 0.5 }); b.startWindow(now: 0)
        XCTAssertEqual((0..<7).map { _ in b.next(now: 120) }, [1, 2, 4, 8, 15, 30, 30])
        b.noteFailure(); XCTAssertFalse(b.shouldScan(now: 120)); b.noteFailure()
        XCTAssertFalse(b.shouldScan(now: 60), "빠른 창 동안은 스캔 전환 없음"); XCTAssertTrue(b.shouldScan(now: 120))
        b.startWindow(now: 200); XCTAssertFalse(b.shouldScan(now: 200), "깨웠어요 — 창 재시작")
        b.reset(); XCTAssertFalse(b.windowOpen); XCTAssertEqual(b.directFailures, 0)
    }

    func testPeripheralPickPrefersKnownThenConnectedThenScan() {
        let a = UUID(), b = UUID()
        XCTAssertEqual(PeripheralPick.choose(expected: a, known: a, connected: []), a)
        XCTAssertEqual(PeripheralPick.choose(expected: a, known: nil, connected: [b, a]), a)
        XCTAssertNil(PeripheralPick.choose(expected: a, known: nil, connected: [b]), "다른 기기는 집지 않고 스캔")
        XCTAssertEqual(PeripheralPick.choose(expected: nil, known: nil, connected: [b]), b, "ID 없어도 이미 연결된 밴드를 잡는다")
        XCTAssertNil(PeripheralPick.choose(expected: nil, known: nil, connected: []))
    }

    func testScanRecheckFiresEveryFiveSecondsUntilCancelled() {
        let sch = ManualScheduler(); let r = ScanRecheck(scheduler: sch)
        var ticks = 0
        func arm() { r.start { ticks += 1; arm() } }
        arm()
        sch.advance(4.9); XCTAssertEqual(ticks, 0)
        sch.advance(0.2); XCTAssertEqual(ticks, 1)
        sch.advance(5); XCTAssertEqual(ticks, 2)
        r.cancel()
        XCTAssertFalse(r.isArmed); XCTAssertEqual(sch.pendingCount, 0)
        sch.advance(60); XCTAssertEqual(ticks, 2, "취소 뒤 늦은 콜백 없음")
        r.cancel() // 멱등
    }

    func testScanRecheckStartReplacesPreviousTimer() {
        let sch = ManualScheduler(); let r = ScanRecheck(scheduler: sch)
        var a = 0, b = 0
        r.start { a += 1 }; r.start { b += 1 }
        XCTAssertEqual(sch.pendingCount, 1)
        sch.advance(6); XCTAssertEqual(a, 0); XCTAssertEqual(b, 1)
    }
}
