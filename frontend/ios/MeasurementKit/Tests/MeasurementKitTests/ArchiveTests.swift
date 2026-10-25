import XCTest
@testable import MeasurementKit

final class ArchiveClassifierTests: XCTestCase {
    func c(_ stage: ArchiveStage, _ status: Int, _ body: String = "{}") -> ArchiveDecision { ArchiveClassifier.classify(stage: stage, status: status, body: Data(body.utf8)) }
    func testPutSignatureExpired403Represigns() { XCTAssertEqual(c(.put, 403).action, .represign) }
    func testApi403ConsentOrPermissionHaltsPreservingData() {
        let d = c(.presign, 403, "{\"detail\":{\"code\":\"archive_rejected\",\"reason\":\"consent_withdrawn\"}}")
        XCTAssertEqual(d.action, .halt); XCTAssertEqual(d.code, "consent_withdrawn")
        XCTAssertEqual(c(.verify, 403).action, .halt)
    }
    func test409PendingTimeReviewVsHashConflict() {
        XCTAssertEqual(c(.presign, 409, "{\"detail\":{\"code\":\"pending_time_review\",\"reason\":\"window_unproven\"}}").action, .timeReview)
        XCTAssertEqual(c(.presign, 409, "{\"detail\":{\"code\":\"hash_conflict\"}}").action, .quarantine)
    }
    func test413SplitCandidate422Quarantine() {
        XCTAssertTrue(c(.presign, 413).splitCandidate); XCTAssertEqual(c(.presign, 413).action, .quarantine)
        XCTAssertEqual(c(.presign, 422).action, .quarantine)
    }
    func testRetryableStatusesBackoffWithRetryAfter() {
        for s in [500, 502, 503, 408, 429] { XCTAssertEqual(c(.put, s).action, .backoff, "\(s)") }
        XCTAssertEqual(c(.presign, 429, "{\"retry_after\":7}").retryAfterMs, 7000)
        XCTAssertEqual(c(.presign, 401).action, .backoff)
    }
    func testVerify404RepresignsAndOtherStage404Quarantines() {
        XCTAssertEqual(c(.verify, 404).action, .represign); XCTAssertEqual(c(.presign, 404).action, .quarantine)
    }
    func testNetworkErrorsAreBackoffAndBackoffIsBoundedForever() {
        XCTAssertEqual(ArchiveClassifier.classifyNetworkError(.put).action, .backoff)
        XCTAssertEqual(ArchiveClassifier.backoffMs(attempts: 0), 1000)
        XCTAssertEqual(ArchiveClassifier.backoffMs(attempts: 1000), 60_000, "횟수로 영구 실패시키지 않는다")
        XCTAssertEqual(ArchiveClassifier.backoffMs(attempts: 2, retryAfterMs: 90_000), 90_000)
    }
}

final class ArchiveQueueTests: XCTestCase {
    var dir: URL!
    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("aq-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }
    func item(_ alias: String) -> ArchiveItem {
        ArchiveItem(alias: alias, kind: .raw, file: "f-\(alias)", sha256: String(repeating: "a", count: 64), sizeBytes: 10,
                    captureStreamId: "00000014-0000-4000-8000-000000000014", monotonicRange: ("100", "200"))
    }
    func testPersistsAcrossReopenAndMapsTaskToItem() throws {
        let q = try ArchiveQueue(dir: dir, sync: .none)
        try q.enqueue(item("a")); try q.enqueue(item("b"))
        try q.attach(taskId: 77, alias: "b", url: "https://s3/put")
        let again = try ArchiveQueue(dir: dir, sync: .none)
        XCTAssertEqual(again.item(forTask: 77)?.alias, "b")
        XCTAssertEqual(again.item(forTask: 77)?.state, .uploading)
        XCTAssertEqual(again.item(alias: "a")?.state, .pending)
    }
    func testEnqueueIsIdempotentByAliasAndNeverOverwritesDifferentBytes() throws {
        let q = try ArchiveQueue(dir: dir, sync: .none)
        try q.enqueue(item("a"))
        try q.enqueue(item("a"))
        XCTAssertEqual(q.counts.pending, 1)
        var other = item("a"); other = ArchiveItem(alias: "a", kind: .raw, file: "x", sha256: String(repeating: "b", count: 64), sizeBytes: 11, captureStreamId: nil, monotonicRange: nil)
        XCTAssertThrowsError(try q.enqueue(other), "같은 alias 에 다른 바이트 금지")
    }
    func testStateTransitionsAndCounts() throws {
        let q = try ArchiveQueue(dir: dir, sync: .none)
        for a in ["a", "b", "c", "d", "e"] { try q.enqueue(item(a)) }
        try q.markVerified(alias: "a")
        try q.apply(.init(stage: .put, action: .backoff, code: "http_503", retryAfterMs: nil, splitCandidate: false), alias: "b", now: 0)
        try q.apply(.init(stage: .presign, action: .halt, code: "consent_withdrawn", retryAfterMs: nil, splitCandidate: false), alias: "c", now: 0)
        try q.apply(.init(stage: .presign, action: .timeReview, code: "window_unproven", retryAfterMs: nil, splitCandidate: false), alias: "d", now: 0)
        try q.apply(.init(stage: .presign, action: .quarantine, code: "hash_conflict", retryAfterMs: nil, splitCandidate: false), alias: "e", now: 0)
        let c = q.counts
        XCTAssertEqual(c.verified, 1); XCTAssertEqual(c.pending, 1, "backoff 는 pending 유지"); XCTAssertEqual(c.pendingAuthorization, 1)
        XCTAssertEqual(c.pendingTimeReview, 1); XCTAssertEqual(c.quarantined, 1)
        XCTAssertEqual(q.item(alias: "b")?.attempts, 1)
        XCTAssertEqual(q.dueItems(now: 0).map { $0.alias }, [], "backoff 대기 중")
        XCTAssertEqual(q.dueItems(now: 1_100).map { $0.alias }, ["b"])
    }
    func testManyBackoffAttemptsNeverBecomePermanentFailure() throws {
        let q = try ArchiveQueue(dir: dir, sync: .none); try q.enqueue(item("a"))
        for _ in 0..<50 { try q.apply(.init(stage: .put, action: .backoff, code: "network", retryAfterMs: nil, splitCandidate: false), alias: "a", now: 0) }
        XCTAssertEqual(q.item(alias: "a")?.state, .pending)
        XCTAssertEqual(q.counts.quarantined, 0)
    }
    func testHaltedItemsStayOnDiskAndAreNotDue() throws {
        let q = try ArchiveQueue(dir: dir, sync: .none); try q.enqueue(item("a"))
        try q.apply(.init(stage: .presign, action: .halt, code: "expelled", retryAfterMs: nil, splitCandidate: false), alias: "a", now: 0)
        XCTAssertEqual(q.dueItems(now: 10_000_000).count, 0)
        XCTAssertEqual(try ArchiveQueue(dir: dir, sync: .none).item(alias: "a")?.state, .pendingAuthorization, "payload 자동 삭제 없음, 사유 보존")
        XCTAssertEqual(try ArchiveQueue(dir: dir, sync: .none).item(alias: "a")?.lastCode, "expelled")
    }
    func testRepresignKeepsPendingAndClearsTask() throws {
        let q = try ArchiveQueue(dir: dir, sync: .none); try q.enqueue(item("a")); try q.attach(taskId: 5, alias: "a", url: "u")
        try q.apply(.init(stage: .put, action: .represign, code: "put_signature_expired", retryAfterMs: nil, splitCandidate: false), alias: "a", now: 0)
        XCTAssertNil(q.item(forTask: 5)); XCTAssertEqual(q.item(alias: "a")?.state, .pending)
        XCTAssertEqual(q.dueItems(now: 0).map { $0.alias }, ["a"], "represign 은 즉시 재시도")
    }
    func testOrphanTaskReattachAfterRelaunchFindsItem() throws {
        let q = try ArchiveQueue(dir: dir, sync: .none); try q.enqueue(item("a")); try q.attach(taskId: 9, alias: "a", url: "u")
        let relaunched = try ArchiveQueue(dir: dir, sync: .none)
        XCTAssertEqual(relaunched.item(forTask: 9)?.alias, "a", "OS 완료 callback 이 재실행 앱에서 큐 항목에 재연결")
        XCTAssertNil(relaunched.item(forTask: 123), "알 수 없는 task 는 무시")
    }
    func testPresignBodyCarriesCaptureStreamAndMonotonicRange() throws {
        let b = ArchiveRequests.presignBody(item("a"), participantId: "p")
        XCTAssertEqual(b["capture_stream_id"] as? String, "00000014-0000-4000-8000-000000000014")
        let chunk = (b["chunks"] as! [[String: Any]])[0]
        let mr = chunk["monotonic_range"] as? [String: String]
        XCTAssertEqual(mr?["from_us"], "100"); XCTAssertEqual(mr?["to_us"], "200")
        var noStream = item("z"); noStream.captureStreamId = nil
        XCTAssertNil(ArchiveRequests.presignBody(noStream, participantId: "p")["capture_stream_id"], "없으면 현행 본문")
    }
}
