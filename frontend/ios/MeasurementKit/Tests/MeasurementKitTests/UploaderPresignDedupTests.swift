import XCTest
@testable import MeasurementKit

/// 응답을 보류하는 HTTP 가짜 — presign 이 "진행 중"인 상태를 만든다.
final class DeferredHTTP: HTTPClient {
    var calls: [URLRequest] = []
    var pending: [(Result<(Int, Data, [String: String]), Error>) -> Void] = []
    func send(_ req: URLRequest, completion: @escaping (Result<(Int, Data, [String: String]), Error>) -> Void) {
        calls.append(req); pending.append(completion)
    }
}

/// dev 사고 재현: 복귀 직후 pump 가 연속 호출돼도 같은 항목에 presign 이 중복 발사되면 안 된다.
final class UploaderPresignDedupTests: XCTestCase {
    func testPumpRepeatedWhilePresignInFlightSendsSinglePresign() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("dd-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let q = try ArchiveQueue(dir: dir, sync: .none)
        let http = DeferredHTTP(), up = FakeFileUploader()
        let u = ArchiveUploader(queue: q, http: http, files: up, apiBase: URL(string: "https://api.example.com/api/v1")!, sessionId: "S", participantId: "P",
                                token: { $0("tok") }, fileURL: { dir.appendingPathComponent($0.file) }, nowMs: { 0 })
        for n in 0..<5 {
            try Data("payload\(n)".utf8).write(to: dir.appendingPathComponent("f-\(n)"))
            try q.enqueue(ArchiveItem(alias: "a\(n)", kind: .raw, file: "f-\(n)", sha256: Hashing.sha256Hex(Data("payload\(n)".utf8)), sizeBytes: 8,
                                      captureStreamId: "00000014-0000-4000-8000-000000000014", monotonicRange: ("1", "2")))
        }
        for _ in 0..<3 { u.pump() }      // 복귀 직후 연속 pump
        XCTAssertEqual(http.calls.count, ArchiveUploader.maxConcurrent, "presign 동시 상한 = maxConcurrent, 같은 항목 중복 없음")
        XCTAssertEqual(Set(http.calls.map { $0.httpBody.flatMap { String(data: $0, encoding: .utf8) } ?? "" }).count, http.calls.count, "서로 다른 항목")
        // 하나가 실패로 끝나면 슬롯이 해제돼 다음 pump 에서 다른 항목이 진행된다
        http.pending.removeFirst()(.success((500, Data(), [:])))
        u.pump()
        XCTAssertGreaterThan(http.calls.count, ArchiveUploader.maxConcurrent)
    }
}
