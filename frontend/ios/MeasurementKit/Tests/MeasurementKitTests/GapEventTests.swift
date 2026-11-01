import XCTest
@testable import MeasurementKit

/// SDD-270: 구멍 저장소·RawChunker 롤오버 관측·종료 기록 last_gap_sequence (Android GapEventStoreTest/RawGapTest 와 같은 규칙).
final class GapEventTests: XCTestCase {
    var dir: URL!
    let sid = "00000001-0000-4000-8000-000000000001"
    override func setUpWithError() throws { dir = FileManager.default.temporaryDirectory.appendingPathComponent("gap-\(UUID().uuidString)"); try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true) }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

    func store(_ n: String = "g.json") -> GapEventStore { GapEventStore(file: dir.appendingPathComponent(n), sessionId: sid, nowUs: { 5_000_000 }) }
    @discardableResult func add(_ s: GapEventStore, _ sig: String, _ start: Int64, _ end: Int64? = nil, _ reason: String = "ble_disconnect") -> [String: Any]? {
        s.append(signal: sig, streamId: "st", segmentId: "sg", startUs: start, endUs: end ?? start + 1000, reason: reason, observedOrEstimated: "observed", reconnectCount: 1)
    }
    func pkt(_ rows: Int, _ tick: UInt32) -> Data {
        var b = [UInt8](repeating: 1, count: 4 + rows * 7); for i in 0..<4 { b[i] = UInt8((tick >> (8 * UInt32(i))) & 0xFF) }; return Data(b)
    }

    func testSameGapTwiceIsOneRowAndSequenceMonotonicAcrossReopen() {
        let s = store(); XCTAssertNotNil(add(s, "eeg", 100)); XCTAssertNil(add(s, "eeg", 100)); add(s, "ppg", 200)
        let r = store(); add(r, "acc", 300)
        XCTAssertEqual(r.pending(50).map { ($0.event["sequence"] as! NSNumber).intValue }, [0, 1, 2])
        XCTAssertEqual(r.lastSequence(), 2); XCTAssertNil(store("none.json").lastSequence())
    }

    func testEventFollowsServerContractAndNeverInventsLossCounts() {
        let e = add(store(), "eeg", 100, nil)!
        XCTAssertEqual(e["event_type"] as? String, "gap"); XCTAssertEqual(e["start_us"] as? String, "100")
        XCTAssertTrue(e["expected_samples"] is NSNull && e["received_samples"] is NSNull)
        XCTAssertEqual(e["event_id"] as? String, GapEventStore.nameUUID("mb-gap|\(sid)|eeg|100"))
    }

    func testPendingStaysAfterManyAttemptsAndMarkSent() {
        let s = store(); add(s, "eeg", 1); add(s, "ppg", 2)
        for _ in 0..<30 { s.noteAttempt() }; XCTAssertEqual(s.pending(50).count, 2)
        s.mark([s.pending(1)[0].event["event_id"] as! String], status: "sent"); XCTAssertEqual(s.statuses(), ["sent", "pending"])
    }

    func testChunkerTickJumpMakesPacketGapAndRewindMakesClockReset() {
        var gaps: [RawGap] = []
        let c = RawChunker(sensor: .eeg, session: sid, originUs: 0, onGap: { gaps.append($0) }) { _ in }
        for i in 0..<10 { c.onPacket(pkt(25, UInt32(1000 + i * 3277)), arrivalUs: Int64(i) * 100_000) }
        XCTAssertTrue(gaps.isEmpty)
        c.onPacket(pkt(25, UInt32(1000 + 10 * 3277 + 2 * 32768)), arrivalUs: 3_000_000)
        XCTAssertEqual(gaps.count, 1); XCTAssertEqual(gaps[0].reason, "packet_gap"); XCTAssertEqual(gaps[0].startUs, 900_000); XCTAssertEqual(gaps[0].endUs, 3_000_000 - 24 * 4_000)
        c.onPacket(pkt(25, 50), arrivalUs: 3_100_000)
        XCTAssertEqual(gaps.count, 2); XCTAssertEqual(gaps[1].reason, "clock_reset"); XCTAssertNil(gaps[1].endUs)
    }

    func testLinkDropLogAssignsReasonNearTheGap() {
        let l = LinkDropLog(file: dir.appendingPathComponent("l.json")); l.record(us: 1_000, kind: "ble_disconnect")
        XCTAssertEqual(l.kind(startUs: 500, endUs: 1500), "ble_disconnect"); XCTAssertNil(l.kind(startUs: 90_000_000, endUs: 91_000_000))
    }
}
