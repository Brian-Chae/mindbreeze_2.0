import XCTest
@testable import MeasurementKit

/// SDD-315 — 수업 중(봉인 전) 원시 청크가 큐에 생기고, 봉인은 남은 구간만 더하며, 앱 재시작(복구) 후에도 일괄과 같은 결과인지 매니저 수준에서 증명한다.
final class ManagerArchiveDuringClassTests: XCTestCase {
    var dir: URL!
    let sid = "00000001-0000-4000-8000-000000000001"
    let stopReq = "0000001f-0000-4000-8000-00000000001f"

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("mad-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

    func owner() -> BandOwnership { let o = BandOwnership(defaults: UserDefaults(suiteName: "mad-\(UUID().uuidString)")!); o.nativeEnabled = true; return o }
    func make(_ sch: ManualScheduler, _ l: FakeLive, _ own: BandOwnership) -> MeasurementManager {
        MeasurementManager(root: dir, band: FakeBand(), ownership: own, makeLive: { _ in l },
                           makeEngine: { d, ctx, _ in try MeasurementEngine(dir: d, configJSON: CoreBridgeTests.cfg, context: ctx, journalSync: .none) },
                           scheduler: sch, nowMs: { 1_760_000_000_000 })
    }
    func startCapturing(_ m: MeasurementManager, _ l: FakeLive) throws {
        _ = try m.startMeasurement(sessionId: sid, credentialHandle: "cred_handle_AbCdEfGh0123", configHash: String(repeating: "a", count: 64), requestId: "0000001e-0000-4000-8000-00000000001e")
        l.ackCaptureStart()
        l.onEvent?(["protocol_version": 2, "schema_version": 1, "event_id": UUID().uuidString.lowercased(), "session_id": sid, "epoch": "1",
                    "audience": "member:00000004-0000-4000-8000-000000000004", "domain": "device", "seq": "1", "entity_id": "00000004-0000-4000-8000-000000000004",
                    "entity_version": "1", "kind": "device.changed", "observed_at_ms": NSNull(), "received_at_server_ms": 1_760_000_000_000,
                    "payload": ["participant_id": "00000004-0000-4000-8000-000000000004", "stream_id": FakeLive.stream, "generation": "3", "status": "active",
                                "clock_uncertain": true, "cutoff_code": NSNull()]])
    }
    func feed(_ m: MeasurementManager, _ r: Range<Int>) {
        for i in r { let p = EngineTests.packets[i]; m.bandLink(didReceive: p.sensor, data: p.bytes, monotonicUs: p.arrivalUs) }
    }
    func rawItems(_ q: ArchiveQueue) -> [ArchiveItem] { q.all().filter { $0.kind == .raw } }
    func snap(_ q: ArchiveQueue) -> [String: String] { Dictionary(uniqueKeysWithValues: rawItems(q).map { ($0.alias, "\($0.sha256)|\($0.sizeBytes)") }) }

    /// 같은 journal 을 새 폴더에서 한 번에 변환한 기준(종료 후 일괄 방식).
    func batchBaseline() throws -> [String: String] {
        let d = dir.appendingPathComponent("baseline")
        try FileManager.default.createDirectory(at: d.appendingPathComponent("archive"), withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: dir.appendingPathComponent("sessions/\(sid)/raw.journal"), to: d.appendingPathComponent("raw.journal"))
        let q = try ArchiveQueue(dir: d.appendingPathComponent("archive"))
        RawArchiver(dir: d, sessionId: sid, streamId: FakeLive.stream, queue: q, reconnectCount: { 0 }).catchUp(final: true)
        return snap(q)
    }

    // a1·a2
    func testRawItemsAppearInQueueDuringClassAndAreDue() throws {
        let sch = ManualScheduler(); let l = FakeLive(); let m = make(sch, l, owner()); try startCapturing(m, l)
        feed(m, 0..<2400)                                // 약 80초분
        XCTAssertEqual(rawItems(m.archiveQueue!).count, 0, "tick 전에는 아직 없음")
        sch.advance(MeasurementManager.rawArchiveInterval + 1)
        let live = rawItems(m.archiveQueue!)
        XCTAssertGreaterThan(live.count, 0, "수업 중(봉인 전) 큐에 raw 항목")
        XCTAssertNotEqual(m.state, .sealing); XCTAssertTrue(m.state == .capturing)
        XCTAssertEqual(m.archiveQueue!.dueItems(now: 0).filter { $0.kind == .raw }.count, live.count, "업로더 pump 대상")
        for i in live { XCTAssertEqual(Hashing.sha256Hex(file: m.archiveFileURL(i)), i.sha256) }
    }

    // a3·b1·e2·e3
    func testStopAddsOnlyRemainderAndEqualsBatchAndTimerStops() throws {
        let sch = ManualScheduler(); let l = FakeLive(); let m = make(sch, l, owner()); try startCapturing(m, l)
        feed(m, 0..<2400); sch.advance(31)
        let during = snap(m.archiveQueue!)
        feed(m, 2400..<4400)
        _ = try m.stopMeasurement(reason: "user_stop", requestId: stopReq)
        let after = snap(m.archiveQueue!)
        for (k, v) in during { XCTAssertEqual(after[k], v, "수업 중 만든 청크는 봉인 후에도 그대로: \(k)") }
        XCTAssertGreaterThan(after.count, during.count, "봉인은 남은 구간을 더한다")
        XCTAssertEqual(after, try batchBaseline(), "증분+봉인 = 종료 후 일괄 (alias·sha256·크기 동일)")
        // e2: close intent 의 expected_artifacts 가 최종 큐 전체
        let p = CloseIntentStore(file: dir.appendingPathComponent("sessions/\(sid)/close-intent.json")).pending()
        XCTAssertEqual(Set((p?.intent["expected_artifacts"] as? [[String: Any]] ?? []).compactMap { $0["alias"] as? String }), Set(m.archiveQueue!.all().map { $0.alias }))
        // e3: 봉인 후에는 tick 이 큐를 건드리지 않는다
        let n = m.archiveQueue!.all().count
        sch.advance(120)
        XCTAssertEqual(m.archiveQueue!.all().count, n)
    }

    func testShortSessionProducesRawOnlyAtSeal() throws {
        let sch = ManualScheduler(); let l = FakeLive(); let m = make(sch, l, owner()); try startCapturing(m, l)
        feed(m, 0..<60)                                   // 약 2초
        sch.advance(31)
        XCTAssertEqual(rawItems(m.archiveQueue!).count, 0)
        _ = try m.stopMeasurement(reason: "user_stop", requestId: stopReq)
        XCTAssertGreaterThanOrEqual(rawItems(m.archiveQueue!).count, 3)
    }

    // c1·c2: 강제 종료 후 복구
    func testForceQuitRecoveryHasNoDuplicatesOrLossAndEqualsBatch() throws {
        let sch1 = ManualScheduler(); let l1 = FakeLive(); let own1 = owner(); let m1 = make(sch1, l1, own1); try startCapturing(m1, l1)
        feed(m1, 0..<2400); sch1.advance(31)
        let before = snap(m1.archiveQueue!); XCTAssertFalse(before.isEmpty)
        // 프로세스 종료 모사: m1 폐기 → 새 매니저가 recoverOnLaunch
        let sch2 = ManualScheduler(); let l2 = FakeLive(); let own2 = owner(); let m2 = make(sch2, l2, own2)
        XCTAssertTrue(m2.recoverOnLaunch())
        XCTAssertEqual(snap(m2.archiveQueue!), before, "복구 직후 큐가 그대로")
        m2.bandLink(didChange: .subscribed, reason: nil)
        feed(m2, 2400..<3600); sch2.advance(31)
        let mid = snap(m2.archiveQueue!)
        for (k, v) in before { XCTAssertEqual(mid[k], v, "복구 재생이 기존 청크를 바꾸지 않음: \(k)") }   // 커서 0 재생 = 같은 sha → 멱등
        feed(m2, 3600..<4500)
        _ = try m2.stopMeasurement(reason: "user_stop", requestId: stopReq)
        let final = snap(m2.archiveQueue!)
        XCTAssertEqual(final, try batchBaseline(), "복구 후 최종 = 같은 journal 일괄 변환 (중복·누락 없음)")
        // 센서별 샘플 합계 = journal 에 기록된 행 수
        var total: [String: Int] = [:]
        for i in rawItems(m2.archiveQueue!) { let h = i.meta!["header"] as! [String: Any]; total[h["signal_type"] as! String, default: 0] += h["sample_count"] as! Int }
        var rows: [String: Int] = [:]
        for p in MeasurementEngine.rawPackets(in: dir.appendingPathComponent("sessions/\(sid)")) {
            let sb = p.sensor == .eeg ? 7 : 6
            let n = (p.bytes.count >= 4 + sb && (p.bytes.count - 4) % sb == 0) ? (p.bytes.count - 4) / sb : 0
            rows[p.sensor == .eeg ? "eeg" : p.sensor == .ppg ? "ppg" : "acc", default: 0] += n
        }
        XCTAssertEqual(total, rows)
    }
}
