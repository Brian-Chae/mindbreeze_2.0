import XCTest
@testable import MeasurementKit

/// V-A10(종료 후 대조·재전송)·V-C3(ACK 유실)·V-S15(원시 summary) 클라이언트 쪽.
final class ReconcilerTests: XCTestCase {
    var dir: URL!, box: MetricOutbox!, http: ScriptedHTTP!, sch: ManualScheduler!, up: FeatureUploader!, rec: FeatureReconciler!
    let stream = "00000014-0000-4000-8000-000000000014"
    var serverHas = Set<Int>()           // 가짜 서버가 보유한 sequence

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("rc-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        box = try MetricOutbox(dir: dir, sync: .none); http = ScriptedHTTP(); sch = ManualScheduler()
        let base = URL(string: "https://api.example.com/api/v1")!
        up = FeatureUploader(outbox: box, http: http, scheduler: sch, apiBase: base, sessionId: "S", participantId: "P", token: { _, d in d("tok") }, jitter: { $0 })
        rec = FeatureReconciler(outbox: box, uploader: up, http: http, apiBase: base, sessionId: "S", participantId: "P", token: { _, d in d("tok") }, markerDir: dir)
        http.fallback = { [unowned self] req in
            if req.url!.path.hasSuffix("/features/batch") {
                let w = http.bodyWindows(http.calls.count - 1)
                for x in w { if let s = (x["sequence"] as? String).flatMap(Int.init) { serverHas.insert(s) } }
                return (200, restResults(w))
            }
            return (200, summaryJSON())
        }
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

    func fill(_ r: ClosedRange<Int>) throws { for i in r { _ = try box.enqueue(["sequence": "\(i)", "stream_id": stream, "feature_hash": "h\(i)"]) } }

    func summaryJSON(truncated: Bool = false) -> String {
        let has = serverHas.sorted()
        guard let lo = has.first, let hi = has.last else { return #"{"session_id":"S","participant_id":"P","total_count":0,"streams":[],"updated_at":null}"# }
        var ranges: [[Int]] = [], cur: Int?
        for i in lo...hi { if !serverHas.contains(i) { if cur == nil { cur = i } } else if let c = cur { ranges.append([c, i - 1]); cur = nil } }
        let rj = ranges.map { "[\($0[0]),\($0[1])]" }.joined(separator: ",")
        return #"{"session_id":"S","participant_id":"P","total_count":\#(has.count),"streams":[{"stream_id":"\#(stream)","count":\#(has.count),"min_index":\#(lo),"max_index":\#(hi),"contiguous_through":-1,"missing_ranges":[\#(rj)],"truncated":\#(truncated)}],"updated_at":null}"#
    }

    // 순수 계산: 서버 보유 집합 = [min,max] − missing_ranges. 범위 밖(max 이후)·미존재 stream 도 결측.
    func testMissingComputationCoversHolesTailAndUnknownStream() {
        let s = ["streams": [["stream_id": stream, "min_index": 5, "max_index": 20, "missing_ranges": [[8, 9], [15, 15]], "truncated": false]]] as [String: Any]
        let local: [(stream: String?, seq: UInt64)] = [(stream, 1), (stream, 5), (stream, 8), (stream, 9), (stream, 10), (stream, 15), (stream, 20), (stream, 21), ("other", 3), (nil, 7)]
        XCTAssertEqual(FeatureReconciler.missing(local: local, summary: s), [1, 8, 9, 15, 21, 3])
    }
    func testTruncatedSummaryTreatsEverythingAfterLastListedRangeAsMissing() {
        let s = ["streams": [["stream_id": stream, "min_index": 1, "max_index": 600, "missing_ranges": [[10, 20]], "truncated": true]]] as [String: Any]
        let local: [(stream: String?, seq: UInt64)] = [(stream, 5), (stream, 15), (stream, 30)]
        XCTAssertEqual(FeatureReconciler.missing(local: local, summary: s), [15, 30])
    }

    // 정상: 전부 REST 로 저장된 뒤 summary 가 비어 있으면 complete + 마커 기록.
    func testCompleteWhenServerHoldsEverythingAndWritesMarker() throws {
        try fill(1...100)
        up.start()
        for _ in 0..<5 { sch.advance(0.3) }
        XCTAssertEqual(box.pendingSequences, [])
        var state: FeatureReconciler.State?
        rec.run { state = $0 }
        XCTAssertEqual(state, .complete)
        XCTAssertTrue(FileManager.default.fileExists(atPath: dir.appendingPathComponent(FeatureReconciler.markerName).path))
        XCTAssertEqual(http.calls.filter { $0.url!.path.hasSuffix("/features/summary") }.count, 1)
        XCTAssertEqual(http.calls.last?.url?.query, "participant_id=P")
    }

    // V-C3: REST 200 응답 유실 → 로컬은 pending 이라 재전송 → 서버 duplicate. 또는 서버가 실제로 구멍이 있으면 unack 후 재전송.
    func testHolesOnServerUnackAndResendThenComplete() throws {
        try fill(1...100)
        up.start(); for _ in 0..<5 { sch.advance(0.3) }
        serverHas.subtract(Set(40...59)); serverHas.remove(100)       // 서버 쪽 유실 모사(21개)
        var states: [FeatureReconciler.State] = []
        rec.run { states.append($0) }
        XCTAssertEqual(states.first, .resending(21))
        XCTAssertEqual(box.pendingSequences.count, 21)
        up.kick(); for _ in 0..<5 { sch.advance(0.3) }           // 호스트가 uploader 를 깨워 재전송
        XCTAssertEqual(serverHas.count, 100)
        rec.run { states.append($0) }
        XCTAssertEqual(states.last, .complete)
    }

    func testNotCompleteWhileLocalPendingRemains() throws {
        try fill(1...3)
        http.fallback = { _ in (503, "") }
        var state: FeatureReconciler.State?
        rec.run { state = $0 }
        XCTAssertEqual(state, .waiting, "outbox 가 비기 전에는 summary 를 부르지 않는다")
        XCTAssertEqual(http.calls.filter { $0.url!.path.hasSuffix("summary") }.count, 0)
    }

    func testRejectedWindowsAreExcludedFromComparisonSoNoResendLoop() throws {
        try fill(1...10)
        box.markRejected([4], code: "consent_withdrawn")      // 전송 전 격리(서버는 4를 영원히 갖지 않는다)
        up.start(); for _ in 0..<3 { sch.advance(0.3) }
        XCTAssertFalse(serverHas.contains(4))
        var state: FeatureReconciler.State?
        rec.run { state = $0 }
        XCTAssertEqual(state, .complete, "격리 창은 서버에 없어도 완료 판정에서 제외(재전송 루프 방지)")
    }

    func testSummaryHttpFailureReportsRetry() throws {
        try fill(1...2); up.start(); for _ in 0..<3 { sch.advance(0.3) }
        http.fallback = { _ in (500, "") }
        var state: FeatureReconciler.State?
        rec.run { state = $0 }
        XCTAssertEqual(state, .failed)
        XCTAssertFalse(FileManager.default.fileExists(atPath: dir.appendingPathComponent(FeatureReconciler.markerName).path))
    }

    func testEmptyOutboxIsCompleteWithoutSummary() throws {
        var state: FeatureReconciler.State?
        rec.run { state = $0 }
        XCTAssertEqual(state, .complete)
    }
}

final class RawReconcilerTests: XCTestCase {
    var dir: URL!, q: ArchiveQueue!, http: ScriptedHTTP!, rec: RawReconciler!

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("rr-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        q = try ArchiveQueue(dir: dir, sync: .none); http = ScriptedHTTP()
        rec = RawReconciler(queue: q, http: http, apiBase: URL(string: "https://api.example.com/api/v1")!, sessionId: "S", participantId: "P", token: { _, d in d("tok") }, markerDir: dir)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

    func add(_ alias: String, verified: Bool, kind: ArchiveKind = .raw) throws {
        var i = ArchiveItem(alias: alias, kind: kind, file: "f-\(alias)", sha256: "sha-\(alias)", sizeBytes: 1, captureStreamId: nil, monotonicRange: nil)
        i.meta = ["chunk_alias": alias]
        try q.enqueue(i); if verified { try q.markVerified(alias: alias) }
    }
    func summary(_ aliases: [String], truncated: Bool = false) -> String {
        let a = aliases.map { "\"\($0)\"" }.joined(separator: ",")
        return #"{"session_id":"S","participant_id":"P","total":\#(aliases.count),"uploaded":\#(aliases.count),"pending":0,"failed":0,"streams":[],"aliases_uploaded":[\#(a)],"aliases_truncated":\#(truncated),"receipt_hash":"x","updated_at":null}"#
    }

    func testWaitsWhileQueueHasPending() throws {
        try add("a", verified: true); try add("b", verified: false)
        var s: RawReconciler.State?; rec.run { s = $0 }
        XCTAssertEqual(s, .waiting); XCTAssertEqual(http.calls.count, 0)
    }
    func testCompleteWhenServerHoldsAllLocalRawAliases() throws {
        try add("a", verified: true); try add("b", verified: true)
        http.script = [.success((200, summary(["a", "b", "zzz"]), [:]))]
        var s: RawReconciler.State?; rec.run { s = $0 }
        XCTAssertEqual(s, .complete)
        XCTAssertEqual(http.calls[0].url?.path, "/api/v1/sessions/S/biosignal-raw/summary")
        XCTAssertTrue(FileManager.default.fileExists(atPath: dir.appendingPathComponent(RawReconciler.markerName).path))
    }
    func testRequeuesVerifiedAliasMissingOnServer() throws {
        try add("a", verified: true); try add("b", verified: true)
        http.script = [.success((200, summary(["a"]), [:]))]
        var s: RawReconciler.State?; rec.run { s = $0 }
        XCTAssertEqual(s, .resending(1))
        XCTAssertEqual(q.item(alias: "b")?.state, .pending); XCTAssertEqual(q.item(alias: "a")?.state, .verified)
        XCTAssertNil(q.item(alias: "b")?.remoteId)
    }
    func testTruncatedAliasListCannotProveCompletion() throws {
        try add("a", verified: true)
        http.script = [.success((200, summary(["zzz"], truncated: true), [:]))]
        var s: RawReconciler.State?; rec.run { s = $0 }
        XCTAssertEqual(s, .unverifiable, "5000개 초과로 잘린 목록은 완료 근거가 아니다(삭제 금지, 마커 없음)")
        XCTAssertEqual(q.item(alias: "a")?.state, .verified)
    }
    func testFeatureArtifactsAreNotPartOfRawSummary() throws {
        try add("a", verified: true); try add("NF-1", verified: true, kind: .feature)
        http.script = [.success((200, summary(["a"]), [:]))]
        var s: RawReconciler.State?; rec.run { s = $0 }
        XCTAssertEqual(s, .complete)
    }
    func testHttpFailureReportsFailedWithoutChangingQueue() throws {
        try add("a", verified: true)
        http.script = [.success((503, "", [:]))]
        var s: RawReconciler.State?; rec.run { s = $0 }
        XCTAssertEqual(s, .failed); XCTAssertEqual(q.item(alias: "a")?.state, .verified)
    }
}
