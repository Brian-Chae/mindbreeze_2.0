import XCTest
@testable import MeasurementKit

/// SDD-252 — iOS 원시 청크/feature 메타가 서버 필수 필드를 채우고 크기·섹션 규칙을 지키는지 검증한다.
final class RawChunkerTests: XCTestCase {
    private let sid = "00000001-0000-4000-8000-000000000001"
    private func packet(_ s: BandSensor, rows: Int, tick: UInt32) -> Data {
        let sb = s == .eeg ? 7 : 6
        var d = Data(count: 4 + rows * sb)
        for i in 0..<d.count { d[i] = UInt8(i % 251) }
        for i in 0..<4 { d[i] = UInt8((tick >> (8 * UInt32(i))) & 0xFF) }
        return d
    }
    private func u32le(_ d: Data, _ o: Int) -> Int { Int(d[o]) | Int(d[o + 1]) << 8 | Int(d[o + 2]) << 16 | Int(d[o + 3]) << 24 }

    func testEegTenSecondsSealsOneValidChunk() throws {
        var out: [RawChunk] = []
        let c = RawChunker(sensor: .eeg, session: sid, originUs: 0) { out.append($0) }
        for i in 0..<100 { c.onPacket(packet(.eeg, rows: 25, tick: UInt32(1000 + i * 3277)), arrivalUs: Int64(i) * 100_000) }
        XCTAssertEqual(out.count, 1)
        let h = out[0].meta["header"] as! [String: Any]
        XCTAssertEqual(h["sample_count"] as? Int, 2500); XCTAssertEqual(h["packet_count"] as? Int, 100)
        XCTAssertEqual((h["parser_profile"] as! [String: Any])["platform"] as? String, "native-candidate")
        let sec = h["sections"] as! [[String: Any]]
        XCTAssertEqual(sec.count, 3); XCTAssertEqual(sec[0]["length"] as? Int, 2500 * 17)
        XCTAssertEqual(sec[0]["length"] as? Int, sec[1]["offset"] as? Int)
        let p = out[0].payload
        XCTAssertEqual(String(data: p.prefix(8), encoding: .utf8), "MBRAW002")
        let hl = u32le(p, 8)
        XCTAssertEqual(p.count, 12 + hl + sec.reduce(0) { $0 + ($1["length"] as! Int) })
        XCTAssertEqual(out[0].meta["size_bytes"] as? Int, p.count); XCTAssertEqual(out[0].meta["checksum"] as? String, Hashing.sha256Hex(p))
        XCTAssertLessThanOrEqual(p.count, 1_048_576)
        XCTAssertNotNil(out[0].alias.range(of: "^[A-Z][A-Za-z0-9_-]{0,63}$", options: .regularExpression))
    }

    func testPpgAccUseTheirStridesAndRates() {
        for (sensor, stride, rate) in [(BandSensor.ppg, 8, 50), (BandSensor.acc, 18, 30)] {
            var out: [RawChunk] = []
            let c = RawChunker(sensor: sensor, session: sid, originUs: 0) { out.append($0) }
            var t = 100
            for i in 0..<(rate * 10 / 5) { c.onPacket(packet(sensor, rows: 5, tick: UInt32(t)), arrivalUs: Int64(i) * 100_000); t += 5 * 32768 / rate }
            XCTAssertEqual(out.count, 1, "\(sensor)")
            let h = out[0].meta["header"] as! [String: Any]
            XCTAssertEqual(h["sample_count"] as? Int, rate * 10)
            XCTAssertEqual(((h["sections"] as! [[String: Any]])[0])["length"] as? Int, rate * 10 * stride)
        }
    }

    func testTickRewindStartsNewSegment() {
        var out: [RawChunk] = []
        let c = RawChunker(sensor: .eeg, session: sid, originUs: 0) { out.append($0) }
        c.onPacket(packet(.eeg, rows: 25, tick: 100000), arrivalUs: 0); c.onPacket(packet(.eeg, rows: 25, tick: 103277), arrivalUs: 100_000)
        c.onPacket(packet(.eeg, rows: 25, tick: 500), arrivalUs: 200_000)
        XCTAssertEqual(out.count, 1); c.flush(); XCTAssertEqual(out.count, 2)
        XCTAssertNotEqual((out[0].meta["header"] as! [String: Any])["segment_id"] as? String, (out[1].meta["header"] as! [String: Any])["segment_id"] as? String)
    }

    func testIrregularPpgTicksDoNotSplitSegments() {
        var out: [RawChunk] = []
        let c = RawChunker(sensor: .ppg, session: sid, originUs: 0) { out.append($0) }
        var t = 1000
        for i in 0..<100 { c.onPacket(packet(.ppg, rows: 5, tick: UInt32(t)), arrivalUs: Int64(i) * 100_000); t += 3277 + (i % 2 == 0 ? 900 : -900) }
        c.flush()
        XCTAssertEqual(Set(out.map { (($0.meta["header"] as! [String: Any])["segment_id"] as! String) }).count, 1)
    }

    func testMalformedPacketKeepsBytesWithZeroSamples() {
        var out: [RawChunk] = []
        let c = RawChunker(sensor: .eeg, session: sid, originUs: 0) { out.append($0) }
        c.onPacket(Data(repeating: 1, count: 10), arrivalUs: 0); c.flush()
        let h = out.single!.meta["header"] as! [String: Any]
        XCTAssertEqual(h["sample_count"] as? Int, 0); XCTAssertEqual(h["packet_count"] as? Int, 1)
    }

    func testIdsAreDeterministicUuids() {
        let a = RawIds.streamId(session: sid, sensor: .eeg)
        XCTAssertEqual(a, RawIds.streamId(session: sid, sensor: .eeg)); XCTAssertNotEqual(a, RawIds.streamId(session: sid, sensor: .ppg))
        XCTAssertNotNil(a.range(of: "^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", options: .regularExpression))
    }

    func testPresignBodyUsesMetaVerbatimForServerContract() {
        var item = ArchiveItem(alias: "RAW-EEG-a", kind: .raw, file: "f", sha256: "a", sizeBytes: 1, captureStreamId: "s", monotonicRange: ("1", "2"))
        item.meta = ["chunk_alias": "RAW-EEG-a", "header": ["x": 1], "checksum": "a", "size_bytes": 1]
        let b = ArchiveRequests.presignBody(item, participantId: "p")
        let ch = (b["chunks"] as! [[String: Any]])[0]
        XCTAssertNotNil(ch["header"]); XCTAssertNil(ch["monotonic_range"], "raw 본문은 서버 스키마(extra=forbid)상 monotonic_range 금지")
        XCTAssertEqual(b["capture_stream_id"] as? String, "s")
        var f = ArchiveItem(alias: "NF-1", kind: .feature, file: "f", sha256: "a", sizeBytes: 1, captureStreamId: "s", monotonicRange: ("1", "2"))
        f.meta = ["artifact_alias": "NF-1", "artifact_kind": "feature", "signal": "eeg", "segment_id": "g", "stream_id": "t"]
        let fc = ((ArchiveRequests.presignBody(f, participantId: nil)["chunks"] as! [[String: Any]])[0])
        XCTAssertEqual(fc["signal"] as? String, "eeg"); XCTAssertNotNil(fc["monotonic_range"])
    }

    // MARK: ACC 실측 rate (Android RawChunkerTest 와 같은 의미)
    /// ACC 26Hz: 패킷당 30샘플이 1.1556초(= 37866 tick @32768Hz) 간격으로 도착.
    func testAccRecordsObservedRateFromDeviceTicks() {
        var out: [RawChunk] = []
        let c = RawChunker(sensor: .acc, session: sid, originUs: 0) { out.append($0) }
        for i in 0..<12 { c.onPacket(packet(.acc, rows: 30, tick: UInt32(1000 + i * 37866)), arrivalUs: Int64(i) * 1_155_600) }
        c.flush()
        let h = out.last!.meta["header"] as! [String: Any]
        let r = h["rate"] as! [String: Any]
        XCTAssertEqual(r["numerator"] as? Int, 30); XCTAssertEqual(r["denominator"] as? Int, 1, "명목 rate 는 그대로")
        let obs = h["observed_rate"] as! [String: Any]
        let hz = Double(obs["numerator"] as! Int64) / Double(obs["denominator"] as! Int64)
        XCTAssertEqual(hz, 26.0, accuracy: 0.1)
        XCTAssertGreaterThan(h["observed_rate_window_us"] as! Int64, 1_000_000)
        XCTAssertTrue(h["observed_rate_reason"] is NSNull)
    }

    func testAccWithoutEnoughTickSpanIsNotMeasured() {
        var out: [RawChunk] = []
        let c = RawChunker(sensor: .acc, session: sid, originUs: 0) { out.append($0) }
        c.onPacket(packet(.acc, rows: 5, tick: 1000), arrivalUs: 0); c.onPacket(packet(.acc, rows: 5, tick: 1000 + 5 * 1092), arrivalUs: 100_000)
        c.flush()
        let h = out[0].meta["header"] as! [String: Any]
        XCTAssertTrue(h["observed_rate"] is NSNull); XCTAssertTrue(h["observed_rate_window_us"] is NSNull); XCTAssertEqual(h["observed_rate_reason"] as? String, "not_measured")
    }

    func testEegPpgAreNotObserved() {
        for (sensor, rate) in [(BandSensor.eeg, 250), (BandSensor.ppg, 50)] {
            var out: [RawChunk] = []
            let c = RawChunker(sensor: sensor, session: sid, originUs: 0) { out.append($0) }
            var t = 100
            for i in 0..<(rate * 3 / 5) { c.onPacket(packet(sensor, rows: 5, tick: UInt32(t)), arrivalUs: Int64(i) * 100_000); t += 5 * 32768 / rate }
            c.flush()
            let h = out[0].meta["header"] as! [String: Any]
            XCTAssertTrue(h["observed_rate"] is NSNull, "\(sensor)"); XCTAssertEqual(h["observed_rate_reason"] as? String, "not_measured")
        }
    }
}
private extension Array { var single: Element? { count == 1 ? first : nil } }
