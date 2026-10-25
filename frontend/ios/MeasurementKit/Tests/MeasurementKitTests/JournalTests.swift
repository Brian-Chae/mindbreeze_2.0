import XCTest
@testable import MeasurementKit

final class JournalTests: XCTestCase {
    var dir: URL!
    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("mk-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

    func payload(_ i: Int) -> Data { Data("payload-\(i)-".utf8) + Data(repeating: UInt8(i & 0xff), count: 20 + i) }

    func testAppendAndReopenKeepsAllRecordsInOrder() throws {
        let url = dir.appendingPathComponent("raw.journal")
        let j = try AppendOnlyJournal(url: url)
        for i in 1...5 { XCTAssertEqual(try j.append(payload(i)), UInt64(i)) }
        j.close()
        let again = try AppendOnlyJournal(url: url)
        XCTAssertEqual(again.lastSequence, 5)
        XCTAssertEqual(try again.append(payload(6)), 6)
        let scan = AppendOnlyJournal.scan(url: url)
        XCTAssertEqual(scan.records.map { $0.sequence }, [1, 2, 3, 4, 5, 6])
        XCTAssertEqual(scan.records[2].payload, payload(3))
        XCTAssertEqual(scan.discardedBytes, 0)
    }

    /// 쓰기 도중 어느 바이트 위치에서 죽어도(찢긴 꼬리) 앞선 완결 레코드는 모두 살아야 하고 이어쓰기가 가능해야 한다.
    func testTornTailAtEveryByteOffsetRecoversCompletePrefix() throws {
        let url = dir.appendingPathComponent("raw.journal")
        let j = try AppendOnlyJournal(url: url)
        var ends: [Int] = []
        for i in 1...4 { _ = try j.append(payload(i)); ends.append(Int(try FileManager.default.attributesOfItem(atPath: url.path)[.size] as! UInt64)) }
        j.close()
        let full = try Data(contentsOf: url)
        for cut in 0..<full.count {
            let torn = dir.appendingPathComponent("torn-\(cut).journal")
            try full.prefix(cut).write(to: torn)
            let expected = ends.filter { $0 <= cut }.count
            let r = try AppendOnlyJournal(url: torn)
            XCTAssertEqual(r.lastSequence, UInt64(expected), "cut=\(cut)")
            XCTAssertEqual(try r.append(Data("next".utf8)), UInt64(expected + 1), "cut=\(cut)")
            r.close()
            let s = AppendOnlyJournal.scan(url: torn)
            XCTAssertEqual(s.records.count, expected + 1, "cut=\(cut)")
            XCTAssertEqual(s.records.last?.payload, Data("next".utf8))
        }
    }

    func testCorruptionInMiddleIsQuarantinedNotSilentlyDeleted() throws {
        let url = dir.appendingPathComponent("raw.journal")
        let j = try AppendOnlyJournal(url: url)
        for i in 1...3 { _ = try j.append(payload(i)) }
        j.close()
        var bytes = try Data(contentsOf: url)
        let firstLen = AppendOnlyJournal.headerSize + payload(1).count
        bytes[firstLen + AppendOnlyJournal.headerSize + 2] ^= 0xFF   // 2번째 레코드 payload 변조
        try bytes.write(to: url)
        let r = try AppendOnlyJournal(url: url)
        XCTAssertEqual(r.lastSequence, 1)
        XCTAssertGreaterThan(r.quarantinedBytes, 0)
        let side = try FileManager.default.contentsOfDirectory(atPath: dir.path).filter { $0.contains(".corrupt-") }
        XCTAssertEqual(side.count, 1, "폐기 바이트는 sidecar 로 보존")
        let kept = try Data(contentsOf: dir.appendingPathComponent(side[0]))
        XCTAssertEqual(kept.count, Int(r.quarantinedBytes))
    }

    func testFsyncIsCalledPerAppend() throws {
        let url = dir.appendingPathComponent("raw.journal")
        var syncs = 0
        let j = try AppendOnlyJournal(url: url, syncHook: { syncs += 1 })
        _ = try j.append(payload(1)); _ = try j.append(payload(2))
        XCTAssertEqual(syncs, 2)
    }

    func testCRC32KnownVector() { XCTAssertEqual(CRC32.checksum(Data("123456789".utf8)), 0xCBF43926) }
}
