import XCTest
@testable import MeasurementKit

/// V-C5(전체 scope 이어올림)·V-C6(계정 격리)·V-A10(종료 후 대조 종단)·V-C9(복귀 재개)·V-C4(지터) 클라이언트 쪽.
final class SessionSyncTests: XCTestCase {
    var root: URL!, http: ScriptedHTTP!, sch: ManualScheduler!, files: FakeFileUploader!
    var serverFeature = Set<Int>(), serverRaw = Set<String>()
    let stream = "00000014-0000-4000-8000-000000000014"
    let base = URL(string: "https://api.example.com/api/v1")!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("ss-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        http = ScriptedHTTP(); sch = ManualScheduler(); files = FakeFileUploader()
        http.fallback = { [unowned self] req in route(req) }
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: root) }

    func route(_ req: URLRequest) -> (Int, String) {
        let p = req.url!.path
        if p.hasSuffix("/features/batch") {
            let w = ((try? JSONSerialization.jsonObject(with: req.httpBody ?? Data())) as? [String: Any])?["windows"] as? [[String: Any]] ?? []
            for x in w { if let s = (x["sequence"] as? String).flatMap(Int.init) { serverFeature.insert(s) } }
            return (200, restResults(w))
        }
        if p.hasSuffix("/features/summary") {
            let has = serverFeature.sorted()
            guard let lo = has.first, let hi = has.last else { return (200, #"{"streams":[]}"#) }
            var ranges: [String] = [], cur: Int?
            for i in lo...hi { if !serverFeature.contains(i) { if cur == nil { cur = i } } else if let c = cur { ranges.append("[\(c),\(i - 1)]"); cur = nil } }
            return (200, #"{"streams":[{"stream_id":"\#(stream)","min_index":\#(lo),"max_index":\#(hi),"missing_ranges":[\#(ranges.joined(separator: ","))],"truncated":false}]}"#)
        }
        if p.hasSuffix("/biosignal-raw/presign") {
            let b = (try? JSONSerialization.jsonObject(with: req.httpBody ?? Data())) as? [String: Any]
            let c = (b?["chunks"] as? [[String: Any]])?.first
            let alias = (c?["chunk_alias"] as? String) ?? "?"
            return (200, #"{"chunks":[{"chunk_id":"id-\#(alias)","chunk_alias":"\#(alias)","upload_url":"https://s3.example.com/\#(alias)","upload_headers":{},"upload_status":"pending"}]}"#)
        }
        if p.hasSuffix("/biosignal-raw/ack") {
            let b = (try? JSONSerialization.jsonObject(with: req.httpBody ?? Data())) as? [String: Any]
            let rid = ((b?["chunks"] as? [[String: Any]])?.first?["chunk_id"] as? String) ?? "id-?"
            serverRaw.insert(String(rid.dropFirst(3)))
            return (200, #"{"chunks":[{"chunk_id":"\#(rid)","upload_status":"uploaded","verified_at_us":"5"}]}"#)
        }
        if p.hasSuffix("/biosignal-raw/summary") {
            let a = serverRaw.sorted().map { "\"\($0)\"" }.joined(separator: ",")
            return (200, #"{"aliases_uploaded":[\#(a)],"aliases_truncated":false}"#)
        }
        if p.hasSuffix("/biosignal-events") { return (200, #"{"events":[{"status":"recorded"}]}"#) }
        return (404, "")
    }

    /// 세션 디렉터리를 만든다: scope + outbox 창 + (선택) 봉인 + raw archive 항목.
    @discardableResult
    func makeSession(_ sid: String, account: String = "acct-A", windows: Int, raws: [String] = [], sealed: Bool = true) throws -> URL {
        let d = root.appendingPathComponent("sessions").appendingPathComponent(sid)
        try FileManager.default.createDirectory(at: d.appendingPathComponent("archive"), withIntermediateDirectories: true)
        SessionScope(sessionId: sid, accountId: account, participantId: "P").save(dir: d)
        let ob = try MetricOutbox(dir: d, sync: .none)
        for i in 1...max(windows, 1) where windows > 0 { _ = try ob.enqueue(["sequence": "\(i)", "stream_id": stream, "feature_hash": "h\(i)"]) }
        let q = try ArchiveQueue(dir: d.appendingPathComponent("archive"), sync: .none)
        for a in raws {
            let data = Data(a.utf8); try data.write(to: d.appendingPathComponent("archive").appendingPathComponent("\(a).bin"))
            var it = ArchiveItem(alias: a, kind: .raw, file: "\(a).bin", sha256: Hashing.sha256Hex(data), sizeBytes: data.count, captureStreamId: stream, monotonicRange: ("1", "2"))
            it.meta = ["chunk_alias": a, "checksum": it.sha256, "size_bytes": it.sizeBytes]
            try q.enqueue(it)
        }
        if sealed { try Data("{}".utf8).write(to: d.appendingPathComponent("final.json")) }
        return d
    }

    func makeSync(_ sid: String, dir: URL) throws -> SessionSync {
        let sc = SessionScope.load(dir: dir)!
        return SessionSync(scope: sc, dir: dir, outbox: try MetricOutbox(dir: dir, sync: .none), queue: try ArchiveQueue(dir: dir.appendingPathComponent("archive"), sync: .none),
                           http: http, files: files, scheduler: sch, apiBase: base, token: { _, d in d("tok") }, nowMs: { Int(self.sch.nowSeconds * 1000) }, jitter: { _ in 0 })
    }

    /// 업로더가 만든 PUT 을 완료로 알린다(background URLSession 모사).
    func completePuts(_ s: SessionSync) {
        for t in Array(files.liveTasks) { files.liveTasks.remove(t); s.archive.uploadCompleted(taskId: t, status: 200, error: nil) }
    }
    func settle(_ s: SessionSync, rounds: Int = 12) { for _ in 0..<rounds { sch.advance(1); completePuts(s) } }

    // V-A10 종단: 봉인 후 feature 600/원시 2개가 서버에 100% 저장되고 두 마커·종료 기록까지 완료.
    func testSealedSessionDrainsToCompleteWithMarkersAndCloseIntent() throws {
        let sid = "S1"; let d = try makeSession(sid, windows: 120, raws: ["r1", "r2"])
        let cs = CloseIntentStore(file: d.appendingPathComponent(CloseIntentStore.fileName))
        let q = try ArchiveQueue(dir: d.appendingPathComponent("archive"), sync: .none)
        cs.record(queue: q, sessionId: sid, participantId: "P", reason: "user_stop", nowUs: 1)
        let s = try makeSync(sid, dir: d)
        var done = 0; s.onComplete = { done += 1 }
        s.start(); settle(s)
        XCTAssertEqual(serverFeature.count, 120); XCTAssertEqual(serverRaw, ["r1", "r2"])
        XCTAssertTrue(s.isComplete); XCTAssertEqual(done, 1)
        XCTAssertNil(cs.pending(), "종료 기록도 전송됨")
        XCTAssertTrue(FileManager.default.fileExists(atPath: d.appendingPathComponent("archive/r1.bin").path), "완료 후에도 로컬 파일 삭제 0")
    }

    // 서버가 유실한 창(ACK 는 받았지만 실제로는 없음)을 summary 대조가 찾아 다시 보낸다.
    func testServerSideLossIsRepairedByReconcile() throws {
        let sid = "S2"; let d = try makeSession(sid, windows: 100)
        let s = try makeSync(sid, dir: d)
        s.start(); settle(s)
        XCTAssertTrue(s.isComplete)
        // 완료 이후 새 앱 실행에서 마커 삭제 상황은 없지만, 대조 직전 유실을 모사: 신규 세션으로 확인
        let sid2 = "S3"; let d2 = try makeSession(sid2, windows: 100)
        let s2 = try makeSync(sid2, dir: d2)
        s2.features.onChange = nil
        s2.start()
        sch.advance(0.1)
        serverFeature.subtract(Set(30...39))     // 첫 배치 직후 서버 유실
        settle(s2, rounds: 30)
        XCTAssertEqual(serverFeature.count, 100, "대조가 유실 구간을 찾아 재전송")
        XCTAssertTrue(s2.isComplete)
    }

    // V-C5: 여러 미완료 세션(SEALING/CLOSED 포함)이 전부 발견된다. 이미 완료한 세션·수집 중 세션은 제외.
    func testPendingSessionsFoundForAllSealedStatesExcludingCompleteAndActive() throws {
        let a = try makeSession("A", windows: 5), b = try makeSession("B", windows: 5), c = try makeSession("C", windows: 0, sealed: true)
        try Data("{}".utf8).write(to: c.appendingPathComponent(FeatureReconciler.markerName))
        try Data("{}".utf8).write(to: c.appendingPathComponent(RawReconciler.markerName))
        _ = try makeSession("D", windows: 5, sealed: false)
        let ids = Set(SessionDrain.pending(root: root, excluding: ["D"]).map { $0.scope.sessionId })
        XCTAssertEqual(ids, ["A", "B"], "A·B 미완료, C 완료 제외, D 수집 중 제외")
        _ = a; _ = b
        XCTAssertEqual(Set(SessionDrain.pending(root: root).map { $0.scope.sessionId }), ["A", "B", "D"])
    }

    func testSessionWithoutScopeFileIsIgnoredNotGuessed() throws {
        let d = root.appendingPathComponent("sessions/X"); try FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        XCTAssertTrue(SessionDrain.pending(root: root).isEmpty, "scope 없는 세션은 계정을 알 수 없어 건드리지 않는다")
    }

    // V-C9: 오프라인으로 쌓인 뒤 복귀 kick 한 번에 전송이 재개된다(백오프 대기를 기다리지 않음).
    func testKickResumesImmediatelyAfterNetworkReturn() throws {
        let sid = "S4"; let d = try makeSession(sid, windows: 30, sealed: false)
        var online = false
        http.fallback = { [unowned self] req in online ? route(req) : (503, "") }
        let s = try makeSync(sid, dir: d)
        s.start(); sch.advance(30)
        XCTAssertEqual(serverFeature.count, 0)
        online = true
        s.kick()
        XCTAssertEqual(serverFeature.count, 30, "kick 즉시 재개")
        XCTAssertFalse(s.isComplete, "수집 중(미봉인) 세션은 완료로 판정하지 않는다")
    }

    // V-C4: 종료 직후 40기기 동시 시작 → archive 첫 pump 시점이 0~60s 로 분산.
    func testArchiveFirstPumpIsJitteredForSealedSession() throws {
        let sid = "S5"; let d = try makeSession(sid, windows: 0, raws: ["r1"])
        let sc = SessionScope.load(dir: d)!
        var caps: [Double] = []
        let s = SessionSync(scope: sc, dir: d, outbox: try MetricOutbox(dir: d, sync: .none), queue: try ArchiveQueue(dir: d.appendingPathComponent("archive"), sync: .none),
                            http: http, files: files, scheduler: sch, apiBase: base, token: { _, dn in dn("tok") }, nowMs: { 0 }, jitter: { caps.append($0); return 42 })
        s.start()
        XCTAssertTrue(caps.contains(60), "봉인된 세션의 archive 시작 지터 상한 60초")
        XCTAssertEqual(http.calls.filter { $0.url!.path.contains("presign") }.count, 0)
        sch.advance(41); XCTAssertEqual(http.calls.filter { $0.url!.path.contains("presign") }.count, 0)
        sch.advance(2); XCTAssertGreaterThan(http.calls.filter { $0.url!.path.contains("presign") }.count, 0)
    }

    // V-C6: scope 의 계정이 현재 계정과 다르면 호출자가 SessionSync 를 만들지 않는다 — 판정 함수.
    func testScopeAccountMatching() throws {
        try makeSession("A1", account: "acct-A", windows: 1); try makeSession("B1", account: "acct-B", windows: 1)
        let mine = SessionDrain.pending(root: root).filter { $0.scope.accountId == "acct-B" }.map { $0.scope.sessionId }
        XCTAssertEqual(mine, ["B1"])
        XCTAssertEqual(SessionDrain.pending(root: root).count, 2, "다른 계정 scope 도 보존(목록에는 남음) — 전송 여부는 호출자가 계정으로 거른다")
    }

    func testSnapshotCountsReflectProgress() throws {
        let sid = "S6"; let d = try makeSession(sid, windows: 10)
        let s = try makeSync(sid, dir: d)
        var last: SyncSnapshot?
        s.onSnapshot = { last = $0 }
        s.start(); settle(s)
        XCTAssertEqual(last?.featureAcked, 10); XCTAssertEqual(last?.featurePending, 0); XCTAssertEqual(last?.featureState, "complete")
        XCTAssertEqual(last?.complete, true)
    }
}
