import XCTest
@testable import MeasurementKit

/// 응답을 순서대로 돌려주는 HTTP 가짜(성공·네트워크 오류 혼합).
final class ScriptedHTTP: HTTPClient {
    var calls: [URLRequest] = []
    var script: [Result<(Int, String, [String: String]), Error>] = []
    /// 스크립트가 비었을 때 쓸 기본 응답 생성기(요청 → 응답).
    var fallback: ((URLRequest) -> (Int, String))?
    func send(_ req: URLRequest, completion: @escaping (Result<(Int, Data, [String: String]), Error>) -> Void) {
        calls.append(req)
        if !script.isEmpty {
            switch script.removeFirst() {
            case .success(let (s, b, h)): completion(.success((s, Data(b.utf8), h)))
            case .failure(let e): completion(.failure(e))
            }
        } else if let f = fallback { let (s, b) = f(req); completion(.success((s, Data(b.utf8), [:]))) }
        else { completion(.success((500, Data(), [:]))) }
    }
    func bodyWindows(_ i: Int) -> [[String: Any]] {
        ((try? JSONSerialization.jsonObject(with: calls[i].httpBody ?? Data())) as? [String: Any])?["windows"] as? [[String: Any]] ?? []
    }
    func seqs(_ i: Int) -> [Int] { bodyWindows(i).compactMap { ($0["sequence"] as? String).flatMap(Int.init) } }
}

/// REST 응답 JSON 생성 도우미.
func restResults(_ windows: [[String: Any]], status: String = "accepted", code: String? = nil, overrides: [Int: (String, String?)] = [:]) -> String {
    let rs: [[String: Any]] = windows.enumerated().map { i, w in
        let (st, c) = overrides[i] ?? (status, code)
        var r: [String: Any] = ["stream_id": w["stream_id"] ?? "s", "sequence": w["sequence"] ?? "0", "status": st]
        if st == "rejected" { r["code"] = c ?? "hash_conflict" } else { r["durable"] = true }
        return r
    }
    let o: [String: Any] = ["session_id": "S", "participant_id": "P", "results": rs, "counts": ["accepted": 0, "duplicate": 0, "rejected": 0]]
    return String(data: try! JSONSerialization.data(withJSONObject: o), encoding: .utf8)!
}

final class FeatureUploaderTests: XCTestCase {
    var dir: URL!, box: MetricOutbox!, http: ScriptedHTTP!, sch: ManualScheduler!, up: FeatureUploader!
    var tokenCalls: [Bool] = [], tokenValue: String? = "tok", caps: [Double] = []
    let stream = "00000014-0000-4000-8000-000000000014"

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("fu-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        box = try MetricOutbox(dir: dir, sync: .none); http = ScriptedHTTP(); sch = ManualScheduler()
        up = FeatureUploader(outbox: box, http: http, scheduler: sch, apiBase: URL(string: "https://api.example.com/api/v1")!, sessionId: "S", participantId: "P",
                             token: { [unowned self] force, done in tokenCalls.append(force); done(tokenValue) },
                             jitter: { [unowned self] cap in caps.append(cap); return cap })
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

    func fill(_ n: Int, from: Int = 1) throws {
        for i in from..<(from + n) { _ = try box.enqueue(["sequence": "\(i)", "stream_id": stream, "participant_id": "P", "feature_hash": "h\(i)"]) }
    }

    // V-A1: 소켓 없이 REST 배치(오름차순 ≤60창)로 저장되고 accepted 만 acked.
    func testPostsAscendingBatchOf60ToBatchEndpointAndAcksAccepted() throws {
        try fill(100)
        http.fallback = { [unowned self] _ in (200, restResults(http.bodyWindows(http.calls.count - 1))) }
        up.start()
        XCTAssertEqual(http.calls.count, 1)
        XCTAssertEqual(http.calls[0].url?.path, "/api/v1/sessions/S/features/batch")
        XCTAssertEqual(http.calls[0].httpMethod, "POST")
        XCTAssertEqual(http.calls[0].value(forHTTPHeaderField: "Authorization"), "Bearer tok")
        XCTAssertEqual(http.seqs(0), Array(1...60), "오래된 창부터 오름차순 60창")
        XCTAssertEqual(box.ackedSequences.count, 60)
        sch.advance(FeatureUploader.drainDelay + 0.01)
        XCTAssertEqual(http.seqs(1), Array(61...100), "적체가 있으면 5초를 기다리지 않고 이어서 보낸다")
        XCTAssertEqual(box.pendingSequences, [])
        let body = (try JSONSerialization.jsonObject(with: http.calls[0].httpBody!) as! [String: Any])
        XCTAssertEqual(body["participant_id"] as? String, "P")
    }

    func testIdleUntilFivSecondTimerThenSendsNewWindow() throws {
        http.fallback = { [unowned self] _ in (200, restResults(http.bodyWindows(http.calls.count - 1))) }
        up.start()
        XCTAssertEqual(http.calls.count, 0)
        try fill(1)
        sch.advance(4.9); XCTAssertEqual(http.calls.count, 0)
        sch.advance(0.2); XCTAssertEqual(http.calls.count, 1, "5초 주기")
    }

    // V-A12: 4종만 격리, 그 밖의 코드는 재시도 대상으로 pending 유지.
    func testOnlyFourRejectCodesAreQuarantinedOthersStayPending() throws {
        try fill(5)
        http.script = [.success((200, restResults(box.restBatch(max: 60), overrides: [
            0: ("rejected", "consent_withdrawn"), 1: ("rejected", "hash_conflict"), 2: ("rejected", "stream_not_owned"),
            3: ("rejected", "something_new"), 4: ("accepted", nil)]), [:]))]
        up.start()
        XCTAssertEqual(box.rejectedSequences, [1, 2, 3])
        XCTAssertEqual(box.rejectCode(1), "consent_withdrawn")
        XCTAssertEqual(box.ackedSequences, [5])
        XCTAssertEqual(box.pendingSequences, [1, 2, 3, 4], "격리 창은 pending(미완료) 유지, 미지의 코드(4)는 재시도 대상")
        XCTAssertEqual(box.restBatch(max: 60).compactMap { ($0["sequence"] as? String) }, ["4"], "격리 창은 다시 보내지 않는다")
        XCTAssertGreaterThan(sch.pendingCount, 0, "재시도 예약")
    }

    func testNetworkErrorAnd5xxRetryWithFullJitterThenAccepted() throws {
        try fill(3)
        http.script = [.failure(URLError(.timedOut)), .success((503, "", [:]))]
        http.fallback = { [unowned self] _ in (200, restResults(http.bodyWindows(http.calls.count - 1))) }
        up.start()
        XCTAssertEqual(http.calls.count, 1); XCTAssertEqual(caps, [1], "n=0 → 상한 1s")
        sch.advance(1.01); XCTAssertEqual(http.calls.count, 2)
        XCTAssertEqual(caps, [1, 2], "5xx 는 상한 2s")
        sch.advance(2.01); XCTAssertEqual(http.calls.count, 3)
        XCTAssertEqual(box.ackedSequences, [1, 2, 3]); XCTAssertEqual(box.rejectedSequences, [])
        XCTAssertEqual(http.seqs(0), http.seqs(2), "재시도에서도 같은 창을 보낸다")
    }

    func testBackoffCapIs60Seconds() throws {
        try fill(1)
        http.fallback = { _ in (503, "") }
        up.start()
        for _ in 0..<10 { sch.advance(61) }
        XCTAssertEqual(caps.max(), 60)
        XCTAssertEqual(box.pendingSequences, [1], "횟수로 영구 포기하지 않는다")
    }

    func test401ForcesTokenRefreshOnNextAttempt() throws {
        try fill(1)
        http.script = [.success((401, "{}", [:]))]
        http.fallback = { [unowned self] _ in (200, restResults(http.bodyWindows(http.calls.count - 1))) }
        up.start()
        sch.advance(1.01)
        XCTAssertEqual(tokenCalls, [false, true])
        XCTAssertEqual(box.ackedSequences, [1])
    }

    func testNoTokenWaitsAndRetries() throws {
        try fill(1)
        tokenValue = nil
        up.start()
        XCTAssertEqual(http.calls.count, 0)
        tokenValue = "tok"
        http.fallback = { [unowned self] _ in (200, restResults(http.bodyWindows(http.calls.count - 1))) }
        sch.advance(1.01)
        XCTAssertEqual(box.ackedSequences, [1])
    }

    func test422IsolatesPoisonWindowOnly() throws {
        try fill(3)
        http.script = [.success((422, "{\"detail\":{\"code\":\"invalid_message\",\"field\":\"sqi\"}}", [:]))]
        http.fallback = { [unowned self] req in
            let w = http.bodyWindows(http.calls.count - 1)
            if w.count == 1, (w[0]["sequence"] as? String) == "1" { return (422, "{\"detail\":{\"code\":\"invalid_message\"}}") }
            return (200, restResults(w))
        }
        up.start()
        for _ in 0..<6 { sch.advance(0.3) }
        XCTAssertEqual(box.rejectedSequences, [1]); XCTAssertEqual(box.rejectCode(1), "invalid_message")
        XCTAssertEqual(box.ackedSequences, [2, 3], "원인 창만 격리하고 나머지는 저장")
    }

    func testOnlyOneRequestInFlight() throws {
        try fill(2)
        let d = DeferredHTTP()
        let u = FeatureUploader(outbox: box, http: d, scheduler: sch, apiBase: URL(string: "https://x/api/v1")!, sessionId: "S", participantId: "P", token: { _, done in done("t") }, jitter: { $0 })
        u.start(); u.kick(); u.kick()
        XCTAssertEqual(d.calls.count, 1)
    }

    func testIdleCallbackFiresWhenNothingPending() throws {
        var idle = 0
        up.onIdle = { idle += 1 }
        up.start(); XCTAssertEqual(idle, 1)
    }

    // outbox: unack 영속, 소켓용 방송 창은 ACK 와 무관.
    func testUnackSurvivesReopenAndBroadcastIgnoresAck() throws {
        try fill(3)
        box.markAcked([1, 2, 3])
        XCTAssertEqual(box.unack([2]), 1)
        XCTAssertEqual(MetricOutbox.pendingOf(dir: dir), [2])
        XCTAssertEqual(box.broadcastWindows(after: 1, count: 5).compactMap { $0["sequence"] as? String }, ["2", "3"])
        XCTAssertEqual(box.broadcastWindows(after: 0, count: 2).compactMap { $0["sequence"] as? String }, ["2", "3"], "최신 count 개")
    }
}

extension MetricOutbox {
    static func pendingOf(dir: URL) -> [UInt64] { (try? MetricOutbox(dir: dir, sync: .none))?.pendingSequences ?? [] }
}
