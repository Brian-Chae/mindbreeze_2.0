import XCTest
@testable import MeasurementKit

/// 실제 python-socketio 5.16.1 합성 서버(scripts/wire_server.py)와 URLSessionWebSocket + SocketIOClient + LiveSession 을 붙여 본다.
/// MK_WIRE_PYTHON(파이썬 경로)이 없으면 건너뛴다. dev 서버·DB·.env 는 쓰지 않는다.
final class WireCompatTests: XCTestCase {
    var proc: Process?
    var port = 0
    let q = DispatchQueue(label: "wire-test")

    override func setUpWithError() throws {
        if let ext = ProcessInfo.processInfo.environment["MK_WIRE_PORT"], let p = Int(ext) { port = p; return }
        guard let py = ProcessInfo.processInfo.environment["MK_WIRE_PYTHON"] else { throw XCTSkip("MK_WIRE_PYTHON 미지정") }
        port = Int.random(in: 20000...40000)
        let p = Process(); p.executableURL = URL(fileURLWithPath: py)
        p.arguments = [projectRoot().appendingPathComponent("frontend/ios/MeasurementKit/scripts/wire_server.py").path, String(port)]
        try p.run(); proc = p
        // 준비 대기
        var ok = false
        for _ in 0..<60 {
            if Self.tcpOpen(port: port) { ok = true; break }
            Thread.sleep(forTimeInterval: 0.1)
        }
        if !ok { throw XCTSkip("합성 서버 기동 실패") }
    }
    override func tearDownWithError() throws { proc?.terminate(); if proc != nil { proc?.waitUntilExit() } }

    /// websocket-only 서버는 polling 요청을 400 으로 거절하므로 TCP 연결 가능 여부로 준비를 확인한다.
    static func tcpOpen(port: Int) -> Bool {
        let fd = socket(AF_INET, SOCK_STREAM, 0); guard fd >= 0 else { return false }
        defer { close(fd) }
        var addr = sockaddr_in(); addr.sin_family = sa_family_t(AF_INET); addr.sin_port = in_port_t(UInt16(port).bigEndian); addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        return withUnsafePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0 } }
    }

    final class Box<T> { var v: T; init(_ v: T) { self.v = v } }

    func makeLive(token: Box<String>, refresh: @escaping (@escaping (Result<String, Error>) -> Void) -> Void) -> (SocketIOClient, LiveSession) {
        let sch = DispatchScheduler(queue: q)
        let client = SocketIOClient(baseURL: URL(string: "http://127.0.0.1:\(port)")!, namespace: "/session-live", scheduler: sch,
                                    auth: { ["token": token.v] }, transportFactory: { [q] in URLSessionWebSocketTransport(queue: q) })
        let live = LiveSession(client: client, scheduler: sch, sessionId: "00000001-0000-4000-8000-000000000001", instanceId: UUID().uuidString.lowercased(),
                               appBuild: "t", coreVersion: "core-1.0.0", refreshToken: refresh)
        return (client, live)
    }
    func waitFor(_ label: String, timeout: TimeInterval = 10, _ cond: @escaping () -> Bool) {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end { var r = false; q.sync { r = cond() }; if r { return }; Thread.sleep(forTimeInterval: 0.05) }
        XCTFail("timeout: \(label)")
    }
    /// 큐 밖에서 폴링(조건 안에서 stats() 를 부르면 같은 큐가 교착된다).
    func waitOutside(_ label: String, timeout: TimeInterval = 10, _ cond: () -> Bool) {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end { if cond() { return }; Thread.sleep(forTimeInterval: 0.1) }
        XCTFail("timeout: \(label)")
    }
    /// 서버 통계를 별도 소켓으로 조회
    func stats() -> [String: Any] {
        let sch = DispatchScheduler(queue: q)
        let c = SocketIOClient(baseURL: URL(string: "http://127.0.0.1:\(port)")!, namespace: "/session-live", scheduler: sch, auth: { ["token": "good-stats"] }, transportFactory: { [q] in URLSessionWebSocketTransport(queue: q) })
        var out: [String: Any] = [:]; let got = expectation(description: "stats")
        q.async { c.onConnect = { c.emit("test:stats", [:], ackTimeout: 3) { if case .success(let v) = $0 { out = (v as? [String: Any]) ?? [:] }; got.fulfill() } }; c.connect() }
        wait(for: [got], timeout: 6); q.sync { c.close() }
        return out
    }

    func testRealServerHelloJoinSnapshotAppliedReadyAndMetricAckAndPresence() throws {
        let token = Box("good-1")
        let (client, live) = makeLive(token: token) { $0(.success("good-2")) }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("wc-\(UUID().uuidString)"); try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let box = try MetricOutbox(dir: dir, sync: .none)
        for i in 1...3 { _ = try box.enqueue(["session_id": "s", "participant_id": "p", "stream_id": "st", "sequence": "\(i)", "feature_hash": String(repeating: "a", count: 64)]) }
        q.sync { live.attach(outbox: box); live.setOwner(streamId: "00000014-0000-4000-8000-000000000014", generation: 3); live.start() }
        waitFor("ready") { live.state == .ready }
        q.sync { live.pump() }
        waitFor("metric acked") { box.ackedSequences == [1, 2, 3] }
        waitFor("presence", timeout: 8) { true }
        Thread.sleep(forTimeInterval: 5.3)
        let s = stats()
        XCTAssertGreaterThanOrEqual(s["presence"] as? Int ?? 0, 1)
        XCTAssertEqual((s["last_presence"] as? [String: Any])?["owner_generation"] as? String, "3")
        XCTAssertEqual(s["metric_windows"] as? Int, 3)
        XCTAssertEqual(s["applied"] as? Int, 1)
        q.sync { live.stop(); client.close() }
    }

    func testAckLostCommandRetriesSameIdAndServerAppliesOnce() throws {
        let (client, live) = makeLive(token: Box("good-1")) { $0(.success("good-2")) }
        q.sync { live.start() }
        waitFor("ready") { live.state == .ready }
        let cid = UUID().uuidString.lowercased()
        var final: [String: Any]?
        q.sync { live.onCommandAck = { final = $0 }; live.dispatch(command: ["command_id": cid, "kind": "test.drop_first", "expected_epoch": "1", "client_generation": "1", "payload": [:]]) }
        waitFor("ack after retry", timeout: 8) { final != nil }
        XCTAssertEqual(final?["status"] as? String, "duplicate", "서버가 같은 command_id 를 두 번 받았고 두 번째는 duplicate")
        XCTAssertEqual((stats()["commands"] as? [String: Int])?[cid], 2)
        q.sync { live.stop(); client.close() }
    }

    func testExpiredTokenAtConnectRefreshesAndReconnectsWithNewToken() throws {
        let token = Box("expired"); var refreshes = 0
        let (client, live) = makeLive(token: token) { done in refreshes += 1; token.v = "good-new"; done(.success("good-new")) }
        q.sync { live.start() }
        waitFor("ready after refresh", timeout: 10) { live.state == .ready }
        XCTAssertEqual(refreshes, 1)
        XCTAssertEqual((stats()["tokens"] as? [String])?.suffix(3).contains("good-new"), true)
        q.sync { live.stop(); client.close() }
    }

    func testServerPushedAuthExpiredTriggersReauth() throws {
        let token = Box("good-1")
        let (client, live) = makeLive(token: token) { token.v = "good-2"; $0(.success("good-2")) }
        q.sync { live.start() }
        waitFor("ready") { live.state == .ready }
        q.sync { client.emit("test:push", ["event": "live:auth_expired", "payload": ["refresh": true]], ackTimeout: 3, ack: { _ in }) }
        waitOutside("reauth", timeout: 8) { (self.stats()["reauth"] as? Int ?? 0) >= 1 }
        q.sync { live.stop(); client.close() }
    }

    func testServerDropReconnectsAndRejoinsToReady() throws {
        let (client, live) = makeLive(token: Box("good-1")) { $0(.success("good-2")) }
        q.sync { live.start() }
        waitFor("ready") { live.state == .ready }
        q.sync { client.emit("test:push", ["event": "live:resync_required", "payload": ["reason": "seq_gap"]], ackTimeout: 3, ack: { _ in }) }
        waitOutside("back to ready after resync", timeout: 8) { var r = false; self.q.sync { r = live.state == .ready }; return r && (self.stats()["join"] as? Int ?? 0) >= 2 }
        q.sync { live.stop(); client.close() }
    }
}
