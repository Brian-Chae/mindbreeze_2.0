import XCTest
@testable import MeasurementKit

final class FakeHTTP: HTTPClient {
    var calls: [(URLRequest)] = []
    var responses: [(status: Int, body: String, headers: [String: String])] = []
    var delay: (() -> Void)?
    func send(_ req: URLRequest, completion: @escaping (Result<(Int, Data, [String: String]), Error>) -> Void) {
        calls.append(req)
        let r: (status: Int, body: String, headers: [String: String]) = responses.isEmpty ? (status: 500, body: "", headers: [:]) : responses.removeFirst()
        completion(.success((r.status, Data(r.body.utf8), r.headers)))
    }
}

final class CredentialTests: XCTestCase {
    var store: InMemoryCredentialStore!; var http: FakeHTTP!; var tp: TokenProvider!
    override func setUp() {
        store = InMemoryCredentialStore(); http = FakeHTTP()
        tp = TokenProvider(store: store, http: http, apiBase: URL(string: "https://api.example.com/api/v1")!)
    }
    func put(account: String = "acct-1", refresh: String = "r1") -> String {
        try! store.save(Credential(accountId: account, accessToken: "a0", refreshToken: refresh, apiBase: "https://api.example.com/api/v1"))
    }
    func testHandleIsOpaqueAndRoundTrips() throws {
        let h = put()
        XCTAssertTrue(h.range(of: "^[A-Za-z0-9_-]{16,128}$", options: .regularExpression) != nil, h)
        XCTAssertFalse(h.contains("r1")); XCTAssertEqual(try store.load(handle: h)?.accountId, "acct-1")
        XCTAssertNil(try store.load(handle: "nope-nope-nope-nope"))
    }
    func testRefreshRotatesTokenFromNativeHeaderAndSendsNativeMarker() {
        let h = put()
        http.responses = [(200, "{\"access_token\":\"a1\",\"token_type\":\"bearer\"}", ["X-MB-Refresh-Token": "r2"])]
        var got: Result<String, Error>?
        tp.accessToken(handle: h, forceRefresh: true) { got = $0 }
        XCTAssertEqual(try got?.get(), "a1")
        XCTAssertEqual(http.calls[0].url?.absoluteString, "https://api.example.com/api/v1/auth/refresh")
        XCTAssertEqual(http.calls[0].value(forHTTPHeaderField: "X-MB-Native"), "capacitor")
        XCTAssertEqual(String(data: http.calls[0].httpBody!, encoding: .utf8), "{\"refresh_token\":\"r1\"}")
        XCTAssertEqual(try store.load(handle: h)?.refreshToken, "r2", "회전된 refresh 저장")
        XCTAssertEqual(try store.load(handle: h)?.accessToken, "a1")
    }
    func testSingleFlightConcurrentRefreshesShareOneRequest() {
        let h = put()
        var pending: [(Result<(Int, Data, [String: String]), Error>) -> Void] = []
        let slow = SlowHTTP { pending.append($0) }
        tp = TokenProvider(store: store, http: slow, apiBase: URL(string: "https://api.example.com/api/v1")!)
        var n = 0
        tp.accessToken(handle: h, forceRefresh: true) { _ in n += 1 }
        tp.accessToken(handle: h, forceRefresh: true) { _ in n += 1 }
        XCTAssertEqual(slow.count, 1, "refresh 토큰 회전 충돌을 막으려면 동시 요청은 하나로 병합")
        pending[0](.success((200, Data("{\"access_token\":\"a9\"}".utf8), [:])))
        XCTAssertEqual(n, 2)
    }
    func testInvalidRefreshIs401ClassifiedInvalidAnd5xxTransient() {
        let h = put()
        http.responses = [(401, "{}", [:])]
        var r1: Result<String, Error>?; tp.accessToken(handle: h, forceRefresh: true) { r1 = $0 }
        XCTAssertEqual((r1?.failureValue as? TokenRefreshError), .invalid)
        http.responses = [(503, "", [:])]
        var r2: Result<String, Error>?; tp.accessToken(handle: h, forceRefresh: true) { r2 = $0 }
        XCTAssertEqual((r2?.failureValue as? TokenRefreshError), .transient)
        XCTAssertEqual(try store.load(handle: h)?.refreshToken, "r1", "실패 시 기존 토큰 유지")
    }
    func testAccountScopeIsolationAndWipe() throws {
        let h1 = put(account: "A"); let h2 = put(account: "B", refresh: "rb")
        XCTAssertNotEqual(h1, h2)
        store.wipe(accountId: "A")
        XCTAssertNil(try store.load(handle: h1)); XCTAssertNotNil(try store.load(handle: h2))
    }
    func testNoSecretsInDescription() {
        let c = Credential(accountId: "A", accessToken: "SECRETACCESS", refreshToken: "SECRETREFRESH", apiBase: "x")
        XCTAssertFalse("\(c)".contains("SECRET")); XCTAssertFalse(String(reflecting: c).contains("SECRET"))
    }
}
final class SlowHTTP: HTTPClient {
    var count = 0; let onSend: (@escaping (Result<(Int, Data, [String: String]), Error>) -> Void) -> Void
    init(_ f: @escaping (@escaping (Result<(Int, Data, [String: String]), Error>) -> Void) -> Void) { onSend = f }
    func send(_ req: URLRequest, completion: @escaping (Result<(Int, Data, [String: String]), Error>) -> Void) { count += 1; onSend(completion) }
}
extension Result { var failureValue: Failure? { if case .failure(let e) = self { return e }; return nil } }
