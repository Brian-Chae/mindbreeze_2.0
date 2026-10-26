import XCTest
@testable import MeasurementKit

final class SocketIOCodecTests: XCTestCase {
    func testEncodeEventWithAckIdAndNamespace() {
        let p = SocketIOPacket.event(namespace: "/session-live", id: 7, name: "live:hello", args: [["a": 1]])
        XCTAssertEqual(SocketIOCodec.encode(p), "42/session-live,7[\"live:hello\",{\"a\":1}]")
    }
    func testEncodeConnectWithAuth() {
        let s = SocketIOCodec.encode(.connect(namespace: "/session-live", payload: ["token": "t"]))
        XCTAssertEqual(s, "40/session-live,{\"token\":\"t\"}")
    }
    func testDecodeConnectAckErrorEventAckDisconnect() throws {
        XCTAssertEqual(try SocketIOCodec.decode("40/session-live,{\"sid\":\"x\"}").kind, .connect)
        let err = try SocketIOCodec.decode("44/session-live,{\"message\":\"token_expired\"}")
        XCTAssertEqual(err.kind, .connectError); XCTAssertEqual(err.errorMessage, "token_expired")
        let ev = try SocketIOCodec.decode("42/session-live,12[\"live:heartbeat\",{\"epoch\":\"1\"}]")
        XCTAssertEqual(ev.kind, .event); XCTAssertEqual(ev.id, 12); XCTAssertEqual(ev.name, "live:heartbeat")
        XCTAssertEqual((ev.args.first as? [String: Any])?["epoch"] as? String, "1")
        let ack = try SocketIOCodec.decode("43/session-live,5[{\"ok\":true}]")
        XCTAssertEqual(ack.kind, .ack); XCTAssertEqual(ack.id, 5)
        XCTAssertEqual(try SocketIOCodec.decode("41/session-live,").kind, .disconnect)
    }
    func testDecodeEventWithoutIdAndDefaultNamespaceAndKoreanText() throws {
        let ev = try SocketIOCodec.decode("42[\"e\",\"한글\"]")
        XCTAssertEqual(ev.namespace, "/"); XCTAssertNil(ev.id); XCTAssertEqual(ev.args.first as? String, "한글")
    }
    func testDecodeRejectsGarbage() {
        XCTAssertThrowsError(try SocketIOCodec.decode("4"))
        XCTAssertThrowsError(try SocketIOCodec.decode("42/session-live,[1]"))   // 이벤트명이 문자열이 아님
        XCTAssertThrowsError(try SocketIOCodec.decode("9x"))
    }
}

final class SocketIOClientTests: XCTestCase {
    var t: FakeTransport!; var sch: ManualScheduler!; var c: SocketIOClient!
    var token = "tok-1"
    var connected = 0; var drops: [String] = []; var errors: [String] = []

    override func setUp() {
        t = FakeTransport(); sch = ManualScheduler()
        c = SocketIOClient(baseURL: URL(string: "https://api.example.com")!, namespace: "/session-live", scheduler: sch,
                           auth: { [unowned self] in ["token": self.token] }, transportFactory: { [unowned self] in self.t })
        c.onConnect = { [unowned self] in connected += 1 }
        c.onDisconnect = { [unowned self] r in drops.append(r) }
        c.onConnectError = { [unowned self] m in errors.append(m) }
    }
    func open() { c.connect(); t.serverOpen(); t.serverSend("40/session-live,{\"sid\":\"n1\"}") }

    func testHandshakeUsesWebsocketOnlyEIO4AndSendsAuthInConnectPacket() {
        c.connect()
        XCTAssertEqual(t.connectedURL?.absoluteString, "wss://api.example.com/socket.io/?EIO=4&transport=websocket")
        t.serverOpen()
        XCTAssertEqual(t.sent, ["40/session-live,{\"token\":\"tok-1\"}"])
        t.serverSend("40/session-live,{\"sid\":\"n1\"}")
        XCTAssertEqual(connected, 1); XCTAssertTrue(c.isConnected)
    }
    func testPingIsAnsweredWithPong() { open(); t.serverSend("2"); XCTAssertEqual(t.sent.last, "3") }
    func testEmitWithAckResolvesByIdAndOutOfOrder() {
        open()
        var r1: Any?; var r2: Any?
        c.emit("a", ["x": 1], ackTimeout: 2) { if case .success(let v) = $0 { r1 = v } }
        c.emit("b", ["y": 2], ackTimeout: 2) { if case .success(let v) = $0 { r2 = v } }
        XCTAssertTrue(t.sent[1].hasPrefix("42/session-live,1[\"a\""), t.sent[1])
        XCTAssertTrue(t.sent[2].hasPrefix("42/session-live,2[\"b\""))
        t.serverSend("43/session-live,2[{\"n\":2}]"); t.serverSend("43/session-live,1[{\"n\":1}]")
        XCTAssertEqual((r1 as? [String: Any])?["n"] as? Int, 1); XCTAssertEqual((r2 as? [String: Any])?["n"] as? Int, 2)
    }
    func testAckTimeoutFiresOnceAndLateAckIsIgnored() {
        open()
        var results: [String] = []
        c.emit("a", [:], ackTimeout: 2) { switch $0 { case .success: results.append("ok"); case .failure(let e): results.append("\(e)") } }
        sch.advance(2.1)
        t.serverSend("43/session-live,1[{}]")
        XCTAssertEqual(results, ["timeout"])
    }
    func testServerEventDispatchedAndServerRequestedAckIsAnswered() {
        open()
        var got: [Any] = []
        c.on("live:event") { args, reply in got = args; reply?([["ok": true]]) }
        t.serverSend("42/session-live,9[\"live:event\",{\"k\":1}]")
        XCTAssertEqual(got.count, 1)
        XCTAssertEqual(t.sent.last, "43/session-live,9[{\"ok\":true}]")
    }
    func testConnectErrorReportedAndNoStaleAuthReuse() {
        c.connect(); t.serverOpen()
        t.serverSend("44/session-live,{\"message\":\"token_expired\"}")
        XCTAssertEqual(errors, ["token_expired"]); XCTAssertFalse(c.isConnected)
    }
    func testReconnectBackoffAndFreshAuthEachAttempt() {
        open()
        var transports = [t!]
        c = SocketIOClient(baseURL: URL(string: "http://h")!, namespace: "/session-live", scheduler: sch, jitter: { 0 },
                           auth: { [unowned self] in ["token": self.token] }, transportFactory: { let n = FakeTransport(); transports.append(n); return n })
        c.connect(); transports.last!.serverOpen(); transports.last!.serverSend("40/session-live,{}")
        let first = transports.count
        transports.last!.serverDrop()
        XCTAssertEqual(transports.count, first, "즉시 재연결하지 않고 backoff 대기")
        token = "tok-2"
        sch.advance(0.6); XCTAssertEqual(transports.count, first + 1)
        transports.last!.serverOpen()
        XCTAssertEqual(transports.last!.sent.first, "40/session-live,{\"token\":\"tok-2\"}", "재연결마다 최신 토큰")
        transports.last!.serverDrop()       // 연결 전 실패 → 다음 backoff 1s
        sch.advance(0.9); XCTAssertEqual(transports.count, first + 1)
        sch.advance(0.2); XCTAssertEqual(transports.count, first + 2)
    }
    func testPendingAcksFailOnDisconnectAndNoSilentLoss() {
        open()
        var res: String?
        c.emit("a", [:], ackTimeout: 2) { if case .failure(let e) = $0 { res = "\(e)" } }
        t.serverDrop()
        XCTAssertEqual(res, "disconnected")
    }
    func testNoPingForIntervalPlusTimeoutTriggersReconnect() {
        open()
        let before = drops.count
        sch.advance(46)   // pingInterval 25s + pingTimeout 20s
        XCTAssertEqual(drops.count, before + 1); XCTAssertTrue(t.closed)
    }
    func testExplicitCloseDoesNotReconnect() {
        open(); c.close(); sch.advance(60)
        XCTAssertEqual(sch.pendingCount, 0)
    }
}
