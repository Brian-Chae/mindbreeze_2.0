import XCTest
@testable import MeasurementKit

/// SDD-315 — 수업 중 증분 변환(RawArchiver)이 종료 후 일괄 변환과 바이트 동일한지, 복구 재생이 멱등인지 검증한다. Rust 코어 없이 돈다.
final class RawArchiverTests: XCTestCase {
    private let sid = "00000001-0000-4000-8000-000000000001"
    private let stream = "00000014-0000-4000-8000-000000000014"
    var root: URL!
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("ra-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: root) }

    // MARK: 합성 입력

    struct Pkt { let sensor: BandSensor; let bytes: Data; let arrivalUs: UInt64 }

    /// 100ms 마다 EEG 25행 · PPG 5행 · ACC 3행. `rewindAt` 번째 EEG 패킷에서 장치 tick 이 되감긴다(세그먼트 롤오버).
    static func synth(seconds: Int, rewindAt: Int? = nil) -> [Pkt] {
        func pkt(_ s: BandSensor, rows: Int, tick: UInt32) -> Data {
            let sb = s == .eeg ? 7 : 6
            var d = Data(count: 4 + rows * sb)
            for i in 0..<d.count { d[i] = UInt8((i * 7 + Int(tick)) % 251) }
            for i in 0..<4 { d[i] = UInt8((tick >> (8 * UInt32(i))) & 0xFF) }
            return d
        }
        var out: [Pkt] = []
        for i in 0..<(seconds * 10) {
            let us = UInt64(i) * 100_000
            var eegTick = UInt32(100_000 + Double(i) * 3276.8)
            if let r = rewindAt, i >= r { eegTick = UInt32(500 + Double(i - r) * 3276.8) }
            out.append(Pkt(sensor: .eeg, bytes: pkt(.eeg, rows: 25, tick: eegTick), arrivalUs: us))
            let t = UInt32(100_000 + Double(i) * 3276.8)
            out.append(Pkt(sensor: .ppg, bytes: pkt(.ppg, rows: 5, tick: t), arrivalUs: us + 1_000))
            out.append(Pkt(sensor: .acc, bytes: pkt(.acc, rows: 3, tick: t), arrivalUs: us + 2_000))
        }
        return out
    }

    /// MeasurementEngine.encodeRaw 와 같은 레코드 형식(sensor u8 | arrival u64 | wall u64 | anchor u64 | bytes).
    static func record(_ p: Pkt) -> Data {
        var d = Data([p.sensor.rawValue])
        for v in [p.arrivalUs, 1_760_000_000_000, 0] as [UInt64] { var x = v.littleEndian; withUnsafeBytes(of: &x) { d.append(contentsOf: $0) } }
        d.append(p.bytes); return d
    }

    func session(_ name: String) throws -> (dir: URL, journal: AppendOnlyJournal, queue: ArchiveQueue) {
        let dir = root.appendingPathComponent(name)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: dir.appendingPathComponent("archive"), withIntermediateDirectories: true)
        let j = try AppendOnlyJournal(url: dir.appendingPathComponent("raw.journal"), sync: .none)
        let q = try ArchiveQueue(dir: dir.appendingPathComponent("archive"))
        return (dir, j, q)
    }
    func archiver(_ dir: URL, _ q: ArchiveQueue) -> RawArchiver {
        RawArchiver(dir: dir, sessionId: sid, streamId: stream, queue: q, reconnectCount: { 0 })
    }
    /// alias → (sha256, 파일 바이트 sha)
    func snapshot(_ dir: URL, _ q: ArchiveQueue) -> [String: String] {
        var m: [String: String] = [:]
        for i in q.all() where i.kind == .raw {
            let f = dir.appendingPathComponent("archive").appendingPathComponent(i.file)
            m[i.alias] = i.sha256 + "|" + (Hashing.sha256Hex(file: f) ?? "nil") + "|\(i.sizeBytes)"
        }
        return m
    }
    func header(_ i: ArchiveItem) -> [String: Any] { i.meta?["header"] as! [String: Any] }

    /// 일괄(기준): journal 을 다 쓴 뒤 final 한 번.
    func batch(_ pk: [Pkt]) throws -> [String: String] {
        let s = try session("batch-\(UUID().uuidString)")
        for p in pk { _ = try s.journal.append(Self.record(p)) }
        archiver(s.dir, s.queue).catchUp(final: true)
        return snapshot(s.dir, s.queue)
    }

    // MARK: b1~b4 일괄 동일

    func testIncrementalEqualsBatchBytesForAllSensors() throws {
        let pk = Self.synth(seconds: 95)
        let base = try batch(pk)
        XCTAssertGreaterThan(base.count, 20)
        for step in [1, 37, 300, 701, 2000] {       // 경계: 패킷 1개 · 임의 · 청크 경계(10초=300패킷) 근처
            let s = try session("inc-\(step)"); let a = archiver(s.dir, s.queue)
            for (i, p) in pk.enumerated() { _ = try s.journal.append(Self.record(p)); if (i + 1) % step == 0 { a.catchUp(final: false) } }
            a.catchUp(final: true)
            XCTAssertEqual(snapshot(s.dir, s.queue), base, "step=\(step)")
        }
        for sig in ["eeg", "ppg", "acc"] {
            let s = try session("sig-\(sig)"); let a = archiver(s.dir, s.queue)
            for p in pk { _ = try s.journal.append(Self.record(p)) }
            a.catchUp(final: true)
            XCTAssertTrue(s.queue.all().contains { (header($0)["signal_type"] as? String) == sig }, sig)
        }
    }

    func testIncrementalAcrossSegmentRolloverEqualsBatch() throws {
        let pk = Self.synth(seconds: 60, rewindAt: 200)
        let base = try batch(pk)
        for step in [50, 199, 200, 201, 450] {
            let s = try session("roll-\(step)"); let a = archiver(s.dir, s.queue)
            for (i, p) in pk.enumerated() { _ = try s.journal.append(Self.record(p)); if (i + 1) % step == 0 { a.catchUp(final: false) } }
            a.catchUp(final: true)
            XCTAssertEqual(snapshot(s.dir, s.queue), base, "step=\(step)")
        }
        let s = try session("roll-check"); for p in pk { _ = try s.journal.append(Self.record(p)) }
        archiver(s.dir, s.queue).catchUp(final: true)
        let segs = Set(s.queue.all().filter { ($0.meta?["header"] as? [String: Any])?["signal_type"] as? String == "eeg" }.map { header($0)["segment_id"] as! String })
        XCTAssertEqual(segs.count, 2, "되감김 → EEG segment 2개")
    }

    // MARK: a (수업 중 생성) / d (서버 규칙)

    func testChunksAppearBeforeFinalAndFinalAddsOnlyRemainder() throws {
        let pk = Self.synth(seconds: 35)
        let s = try session("live"); let a = archiver(s.dir, s.queue)
        for p in pk.prefix(pk.count * 2 / 3) { _ = try s.journal.append(Self.record(p)) }
        a.catchUp(final: false)
        let mid = s.queue.all().filter { $0.kind == .raw }.count
        XCTAssertGreaterThan(mid, 0, "수업 중에 이미 큐에 raw 가 있어야 한다")
        XCTAssertEqual(s.queue.dueItems(now: 0).filter { $0.kind == .raw }.count, mid, "업로더 pump 대상")
        for p in pk.suffix(from: pk.count * 2 / 3) { _ = try s.journal.append(Self.record(p)) }
        a.catchUp(final: true)
        let total = s.queue.all().filter { $0.kind == .raw }.count
        XCTAssertGreaterThan(total, mid)
        XCTAssertEqual(total, try batch(pk).count)
    }

    func testShortInputProducesNothingUntilFinalFlush() throws {
        let s = try session("short"); let a = archiver(s.dir, s.queue)
        for p in Self.synth(seconds: 4) { _ = try s.journal.append(Self.record(p)) }
        a.catchUp(final: false)
        XCTAssertEqual(s.queue.all().count, 0, "10초 미만은 수업 중 청크 없음")
        a.catchUp(final: true)
        XCTAssertGreaterThanOrEqual(s.queue.all().count, 3, "봉인 flush 로 센서별 부분 청크")
    }

    func testServerRawV2RulesHold() throws {
        let pk = Self.synth(seconds: 90, rewindAt: 400)
        let s = try session("rules"); let a = archiver(s.dir, s.queue)
        for (i, p) in pk.enumerated() { _ = try s.journal.append(Self.record(p)); if i % 101 == 0 { a.catchUp(final: false) } }
        a.catchUp(final: true)
        let raws = s.queue.all().filter { $0.kind == .raw }
        var bySeg: [String: [[String: Any]]] = [:]
        for i in raws {
            let h = header(i)
            bySeg["\(h["stream_id"] as! String)|\(h["segment_id"] as! String)", default: []].append(h)
            XCTAssertLessThanOrEqual(i.sizeBytes, 1_048_576)
            XCTAssertNotNil(i.alias.range(of: "^[A-Z][A-Za-z0-9_-]{0,63}$", options: .regularExpression))
            XCTAssertEqual(i.meta?["checksum"] as? String, i.sha256)
        }
        for (k, hs) in bySeg {
            let sorted = hs.sorted { ($0["chunk_index"] as! Int) < ($1["chunk_index"] as! Int) }
            XCTAssertEqual(sorted.map { $0["chunk_index"] as! Int }, Array(0..<sorted.count), "chunk_index 연속 \(k)")
            var expect = 0
            for h in sorted {
                XCTAssertEqual(h["first_sample_index"] as? Int, expect, "sample_index 연속·비겹침 \(k)")
                expect = h["end_sample_index_exclusive"] as! Int
                XCTAssertEqual(expect - (h["first_sample_index"] as! Int), h["sample_count"] as? Int)
            }
        }
        // 센서별 총 샘플 = 입력 총 행 수 (누락 0)
        func total(_ sig: String) -> Int { raws.filter { header($0)["signal_type"] as? String == sig }.reduce(0) { $0 + (header($1)["sample_count"] as! Int) } }
        XCTAssertEqual(total("eeg"), 900 * 25); XCTAssertEqual(total("ppg"), 900 * 5); XCTAssertEqual(total("acc"), 900 * 3)
    }

    // MARK: c (복구)

    func testCrashRecoveryReplayFromZeroIsIdempotentAndComplete() throws {
        let pk = Self.synth(seconds: 80)
        let base = try batch(pk)
        let s = try session("crash"); let a1 = archiver(s.dir, s.queue)
        for p in pk.prefix(1200) { _ = try s.journal.append(Self.record(p)) }
        a1.catchUp(final: false)
        let before = snapshot(s.dir, s.queue); XCTAssertFalse(before.isEmpty)
        // 프로세스 종료: archiver·큐 메모리 소실, 디스크(journal·archive·큐 파일)만 남음
        let q2 = try ArchiveQueue(dir: s.dir.appendingPathComponent("archive"))
        XCTAssertEqual(snapshot(s.dir, q2), before, "재시작 후 큐가 그대로 복원")
        let a2 = archiver(s.dir, q2)
        XCTAssertEqual(a2.readOffset, 0)
        a2.catchUp(final: false)
        XCTAssertEqual(snapshot(s.dir, q2), before, "커서 0 재생 = 같은 청크, 중복 없음")
        for p in pk.suffix(from: 1200) { _ = try s.journal.append(Self.record(p)) }
        a2.catchUp(final: true)
        XCTAssertEqual(snapshot(s.dir, q2), base, "재생+이어받기 결과가 일괄과 동일(누락 없음)")
        // 봉인 후 한 번 더 재생해도 불변
        archiver(s.dir, q2).catchUp(final: true)
        XCTAssertEqual(snapshot(s.dir, q2), base)
    }

    func testTornJournalTailIsReadOnNextCatchUp() throws {
        let pk = Self.synth(seconds: 30)
        let base = try batch(pk)
        let s = try session("torn"); let a = archiver(s.dir, s.queue)
        for p in pk.prefix(500) { _ = try s.journal.append(Self.record(p)) }
        let url = s.dir.appendingPathComponent("raw.journal")
        let good = try Data(contentsOf: url)
        // 다음 레코드를 중간까지만 쓴 상태(쓰는 중)
        var partial = good
        _ = try s.journal.append(Self.record(pk[500]))
        let full = try Data(contentsOf: url)
        partial.append(full.suffix(from: good.count).prefix(11))
        try partial.write(to: url)
        let n = a.catchUp(final: false)
        XCTAssertEqual(n, 500, "찢긴 레코드는 건너뜀")
        XCTAssertEqual(a.readOffset, UInt64(good.count), "오프셋은 완결 레코드 끝")
        try full.write(to: url)
        let j2 = try AppendOnlyJournal(url: url, sync: .none)
        for p in pk.suffix(from: 501) { _ = try j2.append(Self.record(p)) }
        a.catchUp(final: true)
        XCTAssertEqual(snapshot(s.dir, s.queue), base)
    }

    func testNoConflictThrownOnIncrementalThenReplay() throws {
        let pk = Self.synth(seconds: 45)
        let s = try session("conflict"); let a = archiver(s.dir, s.queue)
        for (i, p) in pk.enumerated() { _ = try s.journal.append(Self.record(p)); if i % 250 == 0 { a.catchUp(final: false) } }
        a.catchUp(final: true)
        // 같은 alias 를 다른 bytes 로 넣으면 거절되므로, 재생이 동일 bytes 임을 직접 확인한다.
        for i in s.queue.all() where i.kind == .raw {
            let data = try Data(contentsOf: s.dir.appendingPathComponent("archive").appendingPathComponent(i.file))
            XCTAssertEqual(Hashing.sha256Hex(data), i.sha256)
        }
        let items = s.queue.all().count
        archiver(s.dir, s.queue).catchUp(final: true)
        XCTAssertEqual(s.queue.all().count, items)
    }

    // MARK: f1 journal 증분 읽기

    func testJournalScanFromOffsetReturnsOnlyNewRecordsAndKeepsFullScan() throws {
        let url = root.appendingPathComponent("j.journal")
        let j = try AppendOnlyJournal(url: url, sync: .none)
        for i in 1...3 { _ = try j.append(Data("p\(i)".utf8)) }
        let r1 = AppendOnlyJournal.scan(url: url, fromOffset: 0)
        XCTAssertEqual(r1.records.map { $0.sequence }, [1, 2, 3]); XCTAssertFalse(r1.corrupt)
        XCTAssertEqual(AppendOnlyJournal.scan(url: url, fromOffset: r1.nextOffset).records.count, 0)
        for i in 4...5 { _ = try j.append(Data("p\(i)".utf8)) }
        let r2 = AppendOnlyJournal.scan(url: url, fromOffset: r1.nextOffset)
        XCTAssertEqual(r2.records.map { $0.sequence }, [4, 5])
        XCTAssertEqual(AppendOnlyJournal.scan(url: url).records.map { $0.sequence }, [1, 2, 3, 4, 5], "기존 scan 불변")
        XCTAssertEqual(AppendOnlyJournal.scan(url: root.appendingPathComponent("none"), fromOffset: 7).records.count, 0)
    }
}
