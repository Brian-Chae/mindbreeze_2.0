import XCTest
@testable import MeasurementKit

final class EngineTests: XCTestCase {
    var dir: URL!
    static let ctx = StreamContext(sessionId: "00000001-0000-4000-8000-000000000001", participantId: "00000004-0000-4000-8000-000000000004",
                                   streamId: "00000014-0000-4000-8000-000000000014", streamGeneration: 3, clockAnchorId: "00000015-0000-4000-8000-000000000015",
                                   clockUncertaintyMs: 12.5)
    struct Item { let sensor: BandSensor; let bytes: Data; let arrivalUs: UInt64 }
    static var packets: [Item] = {
        let root = projectRoot().appendingPathComponent("contracts/biosignal-golden/v1/synth")
        let blob = try! Data(contentsOf: root.appendingPathComponent("stream.bin"))
        let sched = try! JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("schedule.json"))) as! [[Any]]
        return sched.map { r in
            let s = r[1] as! String
            let off = (r[2] as! NSNumber).intValue, len = (r[3] as! NSNumber).intValue
            return Item(sensor: s == "eeg" ? .eeg : s == "ppg" ? .ppg : .acc, bytes: blob.subdata(in: off..<(off + len)), arrivalUs: (r[0] as! NSNumber).uint64Value)
        }
    }()
    let wall: UInt64 = 1_760_000_000_000

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("eng-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

    func makeEngine(_ d: URL, hook: CrashHook? = nil, checkpointEvery: Int = 400) throws -> MeasurementEngine {
        try MeasurementEngine(dir: d, configJSON: CoreBridgeTests.cfg, context: Self.ctx, checkpointEveryPackets: checkpointEvery, journalSync: .none, crashHook: hook)
    }
    func feed(_ e: MeasurementEngine, _ range: Range<Int>) throws {
        for i in range { let p = Self.packets[i]; try e.ingest(sensor: p.sensor, bytes: p.bytes, arrivalMonotonicUs: p.arrivalUs, wallMs: wall, anchorMonotonicUs: 0) }
    }
    func featureSig(_ d: URL) -> [String] {
        AppendOnlyJournal.scan(url: d.appendingPathComponent("feature.journal")).records.compactMap { r in
            guard let o = try? JSONSerialization.jsonObject(with: r.payload) as? [String: Any] else { return nil }
            return "\(o["sequence"] ?? "")|\(o["feature_hash"] ?? "")"
        }
    }

    func testFramesProducedAndEnvelopeIsContractShaped() throws {
        let e = try makeEngine(dir)
        try feed(e, 0..<1500)
        let sig = featureSig(dir)
        XCTAssertGreaterThan(sig.count, 5)
        let rec = AppendOnlyJournal.scan(url: dir.appendingPathComponent("feature.journal")).records[0]
        let o = try JSONSerialization.jsonObject(with: rec.payload) as! [String: Any]
        for k in ["session_id", "participant_id", "stream_id", "stream_generation", "sequence", "window_start_us", "window_end_us", "observed_at_ms", "clock_anchor_id", "clock_uncertainty_ms",
                  "device_profile_version", "algorithm_version", "model_version", "feature_hash", "contact", "sqi", "metrics"] { XCTAssertNotNil(o[k] ?? (k == "sqi" ? NSNull() : nil), k) }
        XCTAssertEqual(o["stream_generation"] as? String, "3")
        XCTAssertEqual(Set(o.keys).count, 17, "계약 MetricEnvelope 필드만, 종합점수 등 추가 필드 없음")
        XCTAssertEqual(e.pendingLiveSequences.count, sig.count, "feature 마다 live outbox 접수")
    }

    /// raw journal 이 먼저다: core 가 거절/실패해도 raw 는 남는다.
    func testRawJournaledBeforeCoreAndCountersTrack() throws {
        let e = try makeEngine(dir)
        try feed(e, 0..<50)
        XCTAssertEqual(AppendOnlyJournal.scan(url: dir.appendingPathComponent("raw.journal")).records.count, 50)
        XCTAssertEqual(e.counters.packets.values.reduce(0, +), 50)
        XCTAssertEqual(e.lastCommittedRawSequence, 50)
    }

    /// 어느 지점(raw 기록 후 / core 처리 후 / feature 기록 후 / outbox 접수 후 / checkpoint 도중)에서 죽어도
    /// 재시작·재생 후 feature 열이 무중단 실행과 완전히 같아야 한다(누락·중복·불일치 0).
    func testCrashAtEveryStageRecoversIdenticalFeatureStream() throws {
        let N = 1800
        let baseDir = dir.appendingPathComponent("base"); try FileManager.default.createDirectory(at: baseDir, withIntermediateDirectories: true)
        let base = try makeEngine(baseDir); try feed(base, 0..<N)
        let expected = featureSig(baseDir)
        XCTAssertGreaterThan(expected.count, 10)

        for stage in CrashStage.allCases {
            for crashAt in [3, 400, 401, 777, 1200] {
                let d = dir.appendingPathComponent("\(stage)-\(crashAt)"); try FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
                var count = 0
                let hook: CrashHook = { s, _ in if s == stage { count += 1; if count == crashAt { throw SimulatedCrash() } } }
                let e1 = try makeEngine(d, hook: hook)
                var fed = 0
                do { for i in 0..<N { try feed(e1, i..<i + 1); fed = i + 1 } } catch is SimulatedCrash { }
                e1.abandon()                                      // 프로세스 종료 모사(메모리 상태 폐기)
                guard fed < N else { continue }                   // 해당 단계에 crashAt 번째가 없었음
                let e2 = try makeEngine(d)                        // 재시작 → 복구
                // 크래시한 패킷이 raw 에 기록됐는지는 단계에 따라 다르다. 복구 후 raw 마지막 이후부터 이어 먹인다(BLE 재연결).
                let resume = Int(e2.lastCommittedRawSequence)
                try feed(e2, resume..<N)
                XCTAssertEqual(featureSig(d), expected, "stage=\(stage) crashAt=\(crashAt)")
                XCTAssertEqual(e2.pendingLiveSequences.count, expected.count, "stage=\(stage) crashAt=\(crashAt) outbox")
            }
        }
    }

    func testRecoveryRecordsBoundedGapWhenPacketsWereLostWhileDead() throws {
        let e1 = try makeEngine(dir); try feed(e1, 0..<500); e1.abandon()
        let e2 = try makeEngine(dir)
        XCTAssertEqual(e2.recoveredFromSequence, 500)
        e2.markResumeAfterRecovery(firstMonotonicUs: Self.packets[900].arrivalUs)
        let g = e2.gaps.last
        XCTAssertEqual(g?.kind, "process_terminated"); XCTAssertEqual(g?.bounded, true)
        XCTAssertEqual(g?.startSample, "500")
    }

    func testCorruptCheckpointFallsBackToFullReplay() throws {
        let N = 900
        let b = dir.appendingPathComponent("b"); try FileManager.default.createDirectory(at: b, withIntermediateDirectories: true)
        let base = try makeEngine(b, checkpointEvery: 200); try feed(base, 0..<N)
        let d = dir.appendingPathComponent("c"); try FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        let e1 = try makeEngine(d, checkpointEvery: 200); try feed(e1, 0..<N); e1.abandon()
        try Data("garbage".utf8).write(to: d.appendingPathComponent("core.checkpoint"))
        let e2 = try makeEngine(d, checkpointEvery: 200)
        XCTAssertEqual(featureSig(d), featureSig(b))
        XCTAssertTrue(e2.recoveryUsedFullReplay)
    }

    func testSealWritesFinalManifestAndRejectsFurtherIngest() throws {
        let e = try makeEngine(dir); try feed(e, 0..<600)
        let fin = try e.seal()
        XCTAssertEqual(fin.segments >= 1, true)
        XCTAssertThrowsError(try feed(e, 600..<601))
        let again = try e.seal()      // 멱등
        XCTAssertEqual(again.rawSha256, fin.rawSha256)
    }

    func testStorageLimitBlocksInsteadOfSilentOverwrite() throws {
        let e = try MeasurementEngine(dir: dir, configJSON: CoreBridgeTests.cfg, context: Self.ctx, diskLimitBytes: 4096, journalSync: .none)
        var blocked = false
        do { try feed(e, 0..<400) } catch MeasurementEngine.EngineError.storageFull { blocked = true }
        XCTAssertTrue(blocked)
        XCTAssertEqual(e.blockedReason, "storage_full")
        XCTAssertGreaterThan(e.lastCommittedRawSequence, 0, "마지막 committed sample 보존")
    }
}
