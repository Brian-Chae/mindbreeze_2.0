import XCTest
@testable import MeasurementKit

/// iOS 종료 기록(close intent) — Android CloseIntentTest.kt 와 같은 계약·의미.
final class CloseIntentTests: XCTestCase {
    var dir: URL!, q: ArchiveQueue!, store: CloseIntentStore!, http: FakeHTTP!, up: FakeFileUploader!, u: ArchiveUploader!
    var now = 0
    let sid = "00000001-0000-4000-8000-000000000001"
    let stream = "11111111-1111-4111-8111-111111111111", seg = "22222222-2222-4222-8222-222222222222"

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("ci-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        q = try ArchiveQueue(dir: dir, sync: .none); store = CloseIntentStore(file: dir.appendingPathComponent("close-intent.json"))
        http = FakeHTTP(); up = FakeFileUploader()
        u = ArchiveUploader(queue: q, http: http, files: up, apiBase: URL(string: "https://api.example.com/api/v1")!, sessionId: sid, participantId: "P",
                            token: { $0("tok") }, fileURL: { [unowned self] in self.dir.appendingPathComponent($0.file) }, nowMs: { [unowned self] in self.now })
        u.closeIntents = store
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

    func enqueueRaw(_ alias: String, chunk: Int, samples: Int) throws {
        let header: [String: Any] = ["stream_id": stream, "segment_id": seg, "signal_type": "acc", "chunk_index": chunk, "sample_count": samples]
        var it = ArchiveItem(alias: alias, kind: .raw, file: "f-\(alias)", sha256: "sha-\(alias)", sizeBytes: 1, captureStreamId: stream, monotonicRange: ("1", "2"))
        it.meta = ["chunk_alias": alias, "header": header, "checksum": "sha-\(alias)"]
        try q.enqueue(it)
    }
    func enqueueFeature(_ alias: String) throws {
        var it = ArchiveItem(alias: alias, kind: .feature, file: "f-\(alias)", sha256: "sha-\(alias)", sizeBytes: 1, captureStreamId: stream, monotonicRange: ("1", "2"))
        it.meta = ["artifact_alias": alias, "checksum": "sha-\(alias)"]
        try q.enqueue(it)
    }

    func testRecordBuildsExpectedSetAndStreams() throws {
        try enqueueRaw("RAW-A-0", chunk: 0, samples: 300); try enqueueRaw("RAW-A-1", chunk: 1, samples: 120); try enqueueFeature("NF-1")
        let i = store.record(queue: q, sessionId: sid, participantId: "P", reason: "user_stop", nowUs: 123)!
        XCTAssertEqual(i["event_type"] as? String, "close_intent"); XCTAssertEqual(i["end_reason"] as? String, "user_stop"); XCTAssertEqual(i["closed_at_us"] as? String, "123")
        let exp = i["expected_artifacts"] as! [[String: Any]]
        XCTAssertEqual(exp.map { $0["alias"] as! String }.sorted(), ["NF-1", "RAW-A-0", "RAW-A-1"])
        XCTAssertEqual(exp.first { $0["alias"] as? String == "NF-1" }?["sha256"] as? String, "sha-NF-1")
        let st = i["streams"] as! [[String: Any]]
        XCTAssertEqual(st.count, 1)
        XCTAssertEqual(st[0]["signal"] as? String, "acc"); XCTAssertEqual(st[0]["last_chunk_sequence"] as? Int, 1); XCTAssertEqual(st[0]["received_samples"] as? Int, 420)
        XCTAssertTrue(st[0]["last_feature_sequence"] is NSNull); XCTAssertTrue(i["last_gap_sequence"] is NSNull)
        XCTAssertEqual((i["snapshots"] as! [Any]).count, 0)
    }

    func testIntentIdMatchesAndroidNameUUID() {
        // Java UUID.nameUUIDFromBytes(...) = MD5 + version 3. 기대값은 python hashlib 으로 같은 규칙을 적용해 얻은 값.
        XCTAssertEqual(CloseIntentStore.nameUUID("mb-close-intent|S|a,b"), "8fb1893b-1fde-3a72-bb94-2fece37d7361")
    }

    func testNoRawOrFeatureMeansNoIntent() throws {
        XCTAssertNil(store.record(queue: q, sessionId: sid, participantId: "P", reason: "user_stop", nowUs: 1))
        XCTAssertNil(store.pending())
    }

    func testSameContentKeepsIntentAndDoesNotResend() throws {
        try enqueueRaw("RAW-A-0", chunk: 0, samples: 10)
        let a = store.record(queue: q, sessionId: sid, participantId: "P", reason: "user_stop", nowUs: 1)!
        store.markSent()
        let b = store.record(queue: q, sessionId: sid, participantId: "P", reason: "later", nowUs: 2)!
        XCTAssertEqual(a["intent_id"] as? String, b["intent_id"] as? String)
        XCTAssertNil(store.pending(), "같은 내용은 이미 보냈으면 다시 보내지 않는다")
    }

    func testPersistsAcrossRestartWithParticipant() throws {
        try enqueueRaw("RAW-A-0", chunk: 0, samples: 10)
        store.record(queue: q, sessionId: sid, participantId: "P9", reason: "user_stop", nowUs: 1)
        let again = CloseIntentStore(file: dir.appendingPathComponent("close-intent.json"))
        XCTAssertEqual(again.pending()?.participantId, "P9"); XCTAssertEqual(again.pending()?.attempts, 0)
    }

    func testAttemptsCapAtTwelve() throws {
        try enqueueRaw("RAW-A-0", chunk: 0, samples: 10)
        store.record(queue: q, sessionId: sid, participantId: "P", reason: "user_stop", nowUs: 1)
        for _ in 0..<11 { store.markAttempt() }
        XCTAssertNotNil(store.pending())
        store.markAttempt()
        XCTAssertNil(store.pending(), "12회 후 중단")
    }

    // MARK: 전송

    private func intentCalls() -> [URLRequest] { http.calls.filter { $0.url!.path.hasSuffix("/biosignal-events") } }

    func testSendsIntentOnlyAfterQueueDrainedWithServerBody() throws {
        // 실제 파일·sha 로 큐에 넣고, 서버가 이미 보유(uploaded)한 응답으로 업로드를 끝낸다.
        let payload = Data("x".utf8), sha = Hashing.sha256Hex(payload)
        try payload.write(to: dir.appendingPathComponent("f-RAW-A-0"))
        var it = ArchiveItem(alias: "RAW-A-0", kind: .raw, file: "f-RAW-A-0", sha256: sha, sizeBytes: 1, captureStreamId: stream, monotonicRange: ("1", "2"))
        it.meta = ["chunk_alias": "RAW-A-0", "header": ["stream_id": stream, "segment_id": seg, "signal_type": "acc", "chunk_index": 0, "sample_count": 10] as [String: Any], "checksum": sha]
        try q.enqueue(it)
        store.record(queue: q, sessionId: sid, participantId: "P", reason: "user_stop", nowUs: 1)
        http.responses = [(200, "{\"chunks\":[{\"chunk_id\":\"c1\",\"upload_status\":\"pending\",\"upload_url\":\"https://s3.example.com/put?sig=1\",\"upload_headers\":{}}]}", [:])]
        u.pump()
        XCTAssertEqual(intentCalls().count, 0, "업로드 진행 중에는 종료 기록을 보내지 않는다")
        http.responses = [(200, "{\"chunks\":[{\"chunk_id\":\"c1\",\"upload_status\":\"uploaded\",\"verified_at_us\":\"5\"}]}", [:]),
                          (200, "{\"events\":[{\"status\":\"recorded\"}]}", [:])]
        u.uploadCompleted(taskId: up.nextTaskId, status: 200, error: nil)
        XCTAssertEqual(q.item(alias: "RAW-A-0")?.state, .verified)
        XCTAssertEqual(intentCalls().count, 1, "큐가 다 비면 종료 기록을 1회 보낸다")
        let body = try JSONSerialization.jsonObject(with: intentCalls()[0].httpBody!) as! [String: Any]
        XCTAssertEqual(body["participant_id"] as? String, "P")
        XCTAssertEqual(((body["events"] as! [[String: Any]])[0])["event_type"] as? String, "close_intent")
        XCTAssertEqual(intentCalls()[0].url?.path, "/api/v1/sessions/\(sid)/biosignal-events")
        XCTAssertNil(store.pending())
        u.pump()
        XCTAssertEqual(intentCalls().count, 1, "보낸 뒤 재전송 없음")
    }

    func testIntentNotSentWhileUploadsStillDue() throws {
        try enqueueRaw("RAW-A-0", chunk: 0, samples: 10)       // 파일 없음 → 격리되어도 이번 pump 에선 due 였다
        store.record(queue: q, sessionId: sid, participantId: "P", reason: "user_stop", nowUs: 1)
        http.responses = []
        u.pump()
        XCTAssertEqual(intentCalls().count, 0, "업로드할 항목이 남아 있으면 먼저 업로드")
    }

    private func pumpWithIntent(_ resp: (Int, String)) throws {
        try enqueueRaw("RAW-A-0", chunk: 0, samples: 10)
        store.record(queue: q, sessionId: sid, participantId: "P", reason: "user_stop", nowUs: 1)
        try q.markVerified(alias: "RAW-A-0")      // 업로드는 끝난 상태
        http.responses = [(resp.0, resp.1, [:])]
        u.pump()
    }
    func testDuplicateConflictAndRejected4xxClose() throws {
        for (st, body) in [(200, "{\"events\":[{\"status\":\"duplicate\"}]}"), (200, "{\"events\":[{\"status\":\"conflict\"}]}"), (422, "{}")] {
            try tearDownWithError(); try setUpWithError()
            try pumpWithIntent((st, body)); XCTAssertNil(store.pending(), "\(st) \(body)")
        }
    }
    func testNetworkAuthAnd5xxKeepIntentAndCountAttempt() throws {
        for st in [500, 401, 429] {
            try tearDownWithError(); try setUpWithError()
            var scheduled = 0; u.scheduleRetry = { _, _ in scheduled += 1 }
            try pumpWithIntent((st, "{}"))
            XCTAssertEqual(store.pending()?.attempts, 1, "\(st)"); XCTAssertEqual(scheduled, 1)
        }
    }
}
