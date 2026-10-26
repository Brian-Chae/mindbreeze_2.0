import XCTest
@testable import MeasurementKit

final class FakeFileUploader: FileUploading {
    var started: [(url: URL, file: URL, headers: [String: String], alias: String)] = []
    var nextTaskId = 100
    var liveTasks: Set<Int> = []
    func startUpload(to url: URL, headers: [String: String], file: URL, alias: String) -> Int {
        nextTaskId += 1; started.append((url, file, headers, alias)); liveTasks.insert(nextTaskId); return nextTaskId
    }
    func liveTaskIds() -> Set<Int> { liveTasks }
}

final class UploaderTests: XCTestCase {
    var dir: URL!, q: ArchiveQueue!, http: FakeHTTP!, up: FakeFileUploader!, u: ArchiveUploader!
    var now = 0
    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("up-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        q = try ArchiveQueue(dir: dir, sync: .none); http = FakeHTTP(); up = FakeFileUploader()
        u = ArchiveUploader(queue: q, http: http, files: up, apiBase: URL(string: "https://api.example.com/api/v1")!, sessionId: "S", participantId: "P",
                            token: { $0("tok") }, fileURL: { [unowned self] in self.dir.appendingPathComponent($0.file) }, nowMs: { [unowned self] in self.now })
        try Data("payload".utf8).write(to: dir.appendingPathComponent("f-a"))
        try q.enqueue(ArchiveItem(alias: "a", kind: .raw, file: "f-a", sha256: Hashing.sha256Hex(Data("payload".utf8)), sizeBytes: 7, captureStreamId: "00000014-0000-4000-8000-000000000014", monotonicRange: ("1", "2")))
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }
    func presignOK(_ id: String = "chunk-1") -> (status: Int, body: String, headers: [String: String]) {
        (200, "{\"chunks\":[{\"chunk_id\":\"\(id)\",\"chunk_alias\":\"a\",\"checksum\":\"x\",\"size_bytes\":7,\"upload_url\":\"https://s3.example.com/put?sig=1\",\"upload_headers\":{\"Content-Type\":\"application/octet-stream\"},\"upload_status\":\"pending\"}]}", [:])
    }
    func ackOK(_ id: String = "chunk-1") -> (status: Int, body: String, headers: [String: String]) {
        (200, "{\"chunks\":[{\"chunk_id\":\"\(id)\",\"upload_status\":\"uploaded\",\"verified_at_us\":\"5\",\"failure_reason\":null,\"checksum\":\"x\",\"size_bytes\":7}]}", [:])
    }
    func put(_ status: Int) { let t = up.nextTaskId; u.uploadCompleted(taskId: t, status: status, error: nil) }

    func testHappyPathPresignThenBackgroundPutThenVerifyAck() {
        http.responses = [presignOK()]
        u.pump()
        XCTAssertEqual(http.calls[0].url?.path, "/api/v1/sessions/S/biosignal-raw/presign")
        XCTAssertEqual(up.started.count, 1)
        XCTAssertEqual(up.started[0].url.host, "s3.example.com"); XCTAssertEqual(up.started[0].headers["Content-Type"], "application/octet-stream")
        XCTAssertEqual(q.item(alias: "a")?.state, .uploading)
        http.responses = [ackOK()]
        put(200)
        XCTAssertEqual(http.calls[1].url?.path, "/api/v1/sessions/S/biosignal-raw/ack")
        XCTAssertEqual(q.item(alias: "a")?.state, .verified)
    }
    func testHttp200WithoutVerifiedAckIsNotCompletion() {
        http.responses = [presignOK()]; u.pump()
        http.responses = [(200, "{\"chunks\":[{\"chunk_id\":\"chunk-1\",\"upload_status\":\"failed\",\"verified_at_us\":null,\"failure_reason\":\"size_mismatch\"}]}", [:])]
        put(200)
        XCTAssertNotEqual(q.item(alias: "a")?.state, .verified, "PUT 200 만으로 receipt 를 만들지 않는다")
        XCTAssertEqual(q.item(alias: "a")?.state, .pending)
    }
    func testPutSignatureExpired403RepresignsImmediately() {
        http.responses = [presignOK()]; u.pump()
        http.responses = [presignOK("chunk-2")]
        put(403)
        XCTAssertEqual(q.item(alias: "a")?.lastCode, "put_signature_expired")
        XCTAssertEqual(http.calls.filter { $0.url!.path.hasSuffix("presign") }.count, 2, "새 presign")
        XCTAssertEqual(up.started.count, 2)
    }
    func testAckLostAfterPutSucceedsConvergesOnReplay() {
        http.responses = [presignOK()]; u.pump()
        http.responses = [(503, "", [:])]            // ACK 요청 실패(응답 유실 모사)
        put(200)
        XCTAssertEqual(q.item(alias: "a")?.state, .pending)
        XCTAssertEqual(q.item(alias: "a")?.attempts, 1)
        now = 5_000
        http.responses = [presignOK("chunk-1"), ackOK()]   // 서버는 같은 바이트 재제출을 멱등 처리
        u.pump(); put(200)
        XCTAssertEqual(q.item(alias: "a")?.state, .verified)
    }
    func testPresignConsent403HaltsAndNeverPuts() {
        http.responses = [(403, "{\"detail\":{\"code\":\"archive_rejected\",\"reason\":\"consent_withdrawn\"}}", [:])]
        u.pump()
        XCTAssertEqual(q.item(alias: "a")?.state, .pendingAuthorization); XCTAssertEqual(up.started.count, 0)
        u.pump(); XCTAssertEqual(http.calls.count, 1, "halt 항목은 자동 재전송하지 않음")
    }
    func testPresignPendingTimeReviewKeepsLocal() {
        http.responses = [(409, "{\"detail\":{\"code\":\"pending_time_review\",\"reason\":\"window_unproven\"}}", [:])]
        u.pump(); XCTAssertEqual(q.item(alias: "a")?.state, .pendingTimeReview)
    }
    func testAtMostTwoConcurrentUploads() throws {
        for n in ["b", "c", "d"] {
            try Data("x".utf8).write(to: dir.appendingPathComponent("f-\(n)"))
            try q.enqueue(ArchiveItem(alias: n, kind: .raw, file: "f-\(n)", sha256: Hashing.sha256Hex(Data("x".utf8)), sizeBytes: 1, captureStreamId: nil, monotonicRange: nil))
        }
        http.responses = [presignOK("1"), presignOK("2"), presignOK("3"), presignOK("4")]
        u.pump()
        XCTAssertEqual(up.started.count, 2)
    }
    func testLocalFileMissingOrTamperedIsQuarantinedNotUploaded() throws {
        try Data("tampered!!".utf8).write(to: dir.appendingPathComponent("f-a"))
        http.responses = [presignOK()]
        u.pump()
        XCTAssertEqual(q.item(alias: "a")?.state, .quarantined); XCTAssertEqual(q.item(alias: "a")?.lastCode, "local_hash_mismatch")
        XCTAssertEqual(up.started.count, 0)
    }
    func testRelaunchReleasesOrphanUploadingItems() throws {
        http.responses = [presignOK()]; u.pump()
        let q2 = try ArchiveQueue(dir: dir, sync: .none)
        try q2.releaseOrphans(liveTaskIds: [])
        XCTAssertEqual(q2.item(alias: "a")?.state, .pending)
        let q3 = try ArchiveQueue(dir: dir, sync: .none)
        try q3.releaseOrphans(liveTaskIds: [up.nextTaskId])
        XCTAssertEqual(q3.item(alias: "a")?.state, .pending, "q2 에서 이미 되돌림")
    }
}
