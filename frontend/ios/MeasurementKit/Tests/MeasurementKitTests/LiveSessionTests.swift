import XCTest
@testable import MeasurementKit

final class LiveSessionTests: XCTestCase {
    var t: FakeTransport!; var sch: ManualScheduler!; var client: SocketIOClient!; var live: LiveSession!
    var dir: URL!
    var token = "tok-1"; var refreshCalls = 0; var refreshResult: Result<String, Error> = .success("tok-2")
    let sid = "00000001-0000-4000-8000-000000000001"
    var states: [LiveState] = []; var acks: [[String: Any]] = []

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("ls-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        t = FakeTransport(); sch = ManualScheduler()
        client = SocketIOClient(baseURL: URL(string: "https://x")!, namespace: "/session-live", scheduler: sch, jitter: { 0 },
                                auth: { [unowned self] in ["token": self.token] }, transportFactory: { [unowned self] in self.t })
        live = LiveSession(client: client, scheduler: sch, sessionId: sid, instanceId: "00000002-0000-4000-8000-000000000002",
                           appBuild: "t", coreVersion: "core-1.0.0",
                           refreshToken: { [unowned self] done in self.refreshCalls += 1; done(self.refreshResult.map { tk in self.token = tk; return tk }) })
        live.onState = { [unowned self] s in states.append(s) }
        live.onCommandAck = { [unowned self] a in acks.append(a) }
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

    func sentEvents() -> [(name: String, id: Int?, payload: [String: Any])] {
        t.sent.compactMap { s in
            guard s.hasPrefix("42"), let p = try? SocketIOCodec.decode(s) else { return nil }
            return (p.name, p.id, (p.args.first as? [String: Any]) ?? [:])
        }
    }
    func ackLast(_ body: String) { let id = sentEvents().last!.id!; t.serverSend("43/session-live,\(id)[\(body)]") }

    /// connect → hello ack → join ack → snapshot → sync_complete
    func driveToReady(snapshotId: String = "00000009-0000-4000-8000-000000000009") {
        live.start()
        t.serverOpen(); t.serverSend("40/session-live,{\"sid\":\"n\"}")
        XCTAssertEqual(sentEvents().last?.name, "live:hello"); ackLast("{\"ok\":true,\"protocol_version\":2,\"heartbeat_s\":5}")
        XCTAssertEqual(sentEvents().last?.name, "live:join"); ackLast("{\"ok\":true,\"snapshot_id\":\"\(snapshotId)\",\"state\":\"RESYNCING\",\"epoch\":\"1\"}")
        t.serverSend("42/session-live,[\"live:snapshot\",{\"snapshot_id\":\"\(snapshotId)\",\"epoch\":\"1\",\"through\":[{\"audience\":\"host\",\"domain\":\"metrics\",\"seq\":\"0\"}]}]")
        t.serverSend("42/session-live,[\"live:sync_complete\",{\"snapshot_id\":\"\(snapshotId)\",\"through\":[]}]")
    }

    func testHelloThenJoinThenAppliedOnlyAfterSyncComplete() {
        driveToReady()
        let ev = sentEvents()
        XCTAssertEqual(ev.map { $0.name }, ["live:hello", "live:join", "live:applied"])
        XCTAssertEqual(ev[0].payload["protocol_version"] as? Int, 2)
        XCTAssertEqual(ev[0].payload["capabilities"] as? [String], ["native_background"])   // 계약: JS heartbeat 비의존 native 수집
        XCTAssertEqual(ev[1].payload["session_id"] as? String, sid)
        XCTAssertEqual(ev[2].payload["snapshot_id"] as? String, "00000009-0000-4000-8000-000000000009")
        ackLast("{\"ok\":true,\"state\":\"READY\"}")
        XCTAssertEqual(live.state, .ready)
    }
    func testStaleSnapshotIdIsIgnoredAndDoesNotApply() {
        live.start(); t.serverOpen(); t.serverSend("40/session-live,{}")
        ackLast("{\"ok\":true}"); ackLast("{\"ok\":true,\"snapshot_id\":\"AAAA\",\"epoch\":\"1\"}")
        t.serverSend("42/session-live,[\"live:sync_complete\",{\"snapshot_id\":\"OTHER\",\"through\":[]}]")
        XCTAssertFalse(sentEvents().contains { $0.name == "live:applied" })
    }
    func testMetricNotSentBeforeReady() throws {
        driveToReady()   // applied 응답 전 = RESYNCING
        let box = try MetricOutbox(dir: dir)
        live.attach(outbox: box)
        _ = try box.enqueue(["sequence": "1", "feature_hash": String(repeating: "a", count: 64)])
        live.pump()
        XCTAssertFalse(sentEvents().contains { $0.name == "live:metric" })
    }
    func testMetricBatchSentNewestFirstAndAckedOnlyWhenDurable() throws {
        driveToReady(); ackLast("{\"ok\":true,\"state\":\"READY\"}")
        let box = try MetricOutbox(dir: dir); live.attach(outbox: box)
        for i in 1...3 { _ = try box.enqueue(["sequence": "\(i)", "feature_hash": "h\(i)"]) }
        live.pump()
        let m = sentEvents().last!
        XCTAssertEqual(m.name, "live:metric")
        let seqs = (m.payload["windows"] as! [[String: Any]]).map { $0["sequence"] as! String }
        XCTAssertEqual(seqs, ["3", "2", "1"], "최신창 우선")
        ackLast("{\"acks\":[{\"sequence\":\"3\",\"status\":\"accepted\",\"durable\":true},{\"sequence\":\"2\",\"status\":\"retryable\",\"durable\":false},{\"sequence\":\"1\",\"status\":\"rejected\",\"durable\":false,\"code\":\"hash\"}]}")
        XCTAssertEqual(box.ackedSequences, [3])
        XCTAssertEqual(box.pendingSequences, [1, 2], "ACK 안 된 창은 완료로 세지 않는다")
        XCTAssertEqual(box.rejectedSequences, [1], "거절은 격리(재전송 안 함), 보존")
    }
    func testAckedSetSurvivesReopen() throws {
        let box = try MetricOutbox(dir: dir)
        for i in 1...3 { _ = try box.enqueue(["sequence": "\(i)"]) }
        box.markAcked([2])
        let again = try MetricOutbox(dir: dir)
        XCTAssertEqual(again.pendingSequences, [1, 3])
    }
    func testCommandRetriesSameCommandIdOnTimeoutThenNeverNewId() throws {
        driveToReady(); ackLast("{\"ok\":true,\"state\":\"READY\"}")
        live.dispatch(command: ["command_id": "0000000a-0000-4000-8000-00000000000a", "kind": "hand.set", "payload": ["raised": true]])
        XCTAssertEqual(sentEvents().filter { $0.name == "live:command" }.count, 1)
        sch.advance(2.1)    // timeout 2s → 0.5s 후 재시도
        sch.advance(0.6)
        let cmds = sentEvents().filter { $0.name == "live:command" }
        XCTAssertEqual(cmds.count, 2)
        XCTAssertEqual(cmds.map { $0.payload["command_id"] as? String }, ["0000000a-0000-4000-8000-00000000000a", "0000000a-0000-4000-8000-00000000000a"])
        ackLast("{\"command_id\":\"0000000a-0000-4000-8000-00000000000a\",\"status\":\"applied\",\"epoch\":\"1\",\"cursors\":[],\"committed\":true}")
        XCTAssertEqual(acks.last?["status"] as? String, "applied")
        sch.advance(60); XCTAssertEqual(sentEvents().filter { $0.name == "live:command" }.count, 2, "ACK 뒤 재시도 없음")
    }
    func testRetryableCommittedAckReusesIdAfterRetryAfter() throws {
        driveToReady(); ackLast("{\"ok\":true,\"state\":\"READY\"}")
        live.dispatch(command: ["command_id": "0000000b-0000-4000-8000-00000000000b", "kind": "hand.set", "payload": ["raised": false]])
        ackLast("{\"command_id\":\"0000000b-0000-4000-8000-00000000000b\",\"status\":\"retryable\",\"epoch\":\"1\",\"cursors\":[],\"committed\":true,\"code\":\"projection_pending\",\"retry_after_ms\":800}")
        XCTAssertNil(acks.last, "retryable 은 최종 결과가 아니다")
        sch.advance(0.9)
        let cmds = sentEvents().filter { $0.name == "live:command" }
        XCTAssertEqual(cmds.count, 2); XCTAssertEqual(cmds[1].payload["command_id"] as? String, "0000000b-0000-4000-8000-00000000000b")
    }
    func testPresenceEveryFiveSecondsWithStreamAndOwnerGeneration() throws {
        driveToReady(); ackLast("{\"ok\":true,\"state\":\"READY\"}")
        live.setOwner(streamId: "00000014-0000-4000-8000-000000000014", generation: 3)
        live.setVisibility(.locked)
        let before = sentEvents().filter { $0.name == "live:presence" }.count
        sch.advance(5.1); sch.advance(5.0)
        let p = sentEvents().filter { $0.name == "live:presence" }
        XCTAssertEqual(p.count - before, 2)
        XCTAssertEqual(p.last!.payload["visibility"] as? String, "locked")
        XCTAssertEqual(p.last!.payload["owner_generation"] as? String, "3")
        XCTAssertEqual(p.last!.payload["stream_id"] as? String, "00000014-0000-4000-8000-000000000014")
    }
    func testAuthExpiredEventRefreshesTokenAndReauths() throws {
        driveToReady(); ackLast("{\"ok\":true,\"state\":\"READY\"}")
        t.serverSend("42/session-live,[\"live:auth_expired\",{\"refresh\":true}]")
        XCTAssertEqual(refreshCalls, 1)
        XCTAssertEqual(sentEvents().last?.name, "live:reauth"); XCTAssertEqual(sentEvents().last?.payload["token"] as? String, "tok-2")
    }
    func testAuthRefreshFailureStopsLiveButDoesNotCrash() throws {
        refreshResult = .failure(NSError(domain: "x", code: 401))
        driveToReady(); ackLast("{\"ok\":true,\"state\":\"READY\"}")
        t.serverSend("42/session-live,[\"live:auth_expired\",{\"refresh\":true}]")
        XCTAssertEqual(live.state, .authBlocked)
        XCTAssertFalse(sentEvents().contains { $0.name == "live:reauth" })
    }
    func testConnectTokenExpiredRefreshesThenReconnects() {
        live.start(); t.serverOpen()
        t.serverSend("44/session-live,{\"message\":\"token_expired\"}")
        XCTAssertEqual(refreshCalls, 1)
    }
    func testAccessRevokedStopsPermanentlyAndDoesNotRejoin() throws {
        driveToReady(); ackLast("{\"ok\":true,\"state\":\"READY\"}")
        t.serverSend("42/session-live,[\"live:access_revoked\",{\"code\":\"expelled\",\"revision\":\"4\"}]")
        XCTAssertEqual(live.state, .revoked)
        t.serverDrop(); sch.advance(30)
        XCTAssertEqual(sentEvents().filter { $0.name == "live:join" }.count, 1, "권한 회수 후 자동 재join 금지")
    }
    func testReconnectRejoinsWithNewRequestAndResync() throws {
        driveToReady(); ackLast("{\"ok\":true,\"state\":\"READY\"}")
        t.serverDrop(); sch.advance(0.6)
        t.serverOpen(); t.serverSend("40/session-live,{}")
        XCTAssertEqual(sentEvents().suffix(1).first?.name, "live:hello")
        XCTAssertEqual(live.state, .resyncing)
    }
    func testResyncRequiredTriggersNewJoin() throws {
        driveToReady(); ackLast("{\"ok\":true,\"state\":\"READY\"}")
        t.serverSend("42/session-live,[\"live:resync_required\",{\"reason\":\"seq_gap\"}]")
        XCTAssertEqual(sentEvents().last?.name, "live:resync")
        XCTAssertEqual(live.state, .resyncing)
    }
    func testMissingHeartbeatForTenSecondsMarksDegraded() throws {
        driveToReady(); ackLast("{\"ok\":true,\"state\":\"READY\"}")
        t.serverSend("42/session-live,[\"live:heartbeat\",{\"epoch\":\"1\",\"through\":[],\"auth_revision\":\"1\",\"server_time_ms\":1}]")
        sch.advance(10.5)
        XCTAssertEqual(live.state, .degraded)
        t.serverSend("42/session-live,[\"live:heartbeat\",{\"epoch\":\"1\",\"through\":[],\"auth_revision\":\"1\",\"server_time_ms\":2}]")
        XCTAssertEqual(live.state, .ready, "heartbeat 복귀 시 READY")
    }
    func testTerminalEventStopsMetricSending() throws {
        driveToReady(); ackLast("{\"ok\":true,\"state\":\"READY\"}")
        t.serverSend("42/session-live,[\"live:terminal\",{\"code\":\"session_ended\",\"revision\":\"9\",\"end_cutoff_ms\":1}]")
        XCTAssertEqual(live.state, .terminal)
    }

    func testAcceptedButNotDurableIsNotCountedAsAcked() throws {
        driveToReady(); ackLast("{\"ok\":true,\"state\":\"READY\"}")
        let box = try MetricOutbox(dir: dir); live.attach(outbox: box)
        _ = try box.enqueue(["sequence": "1", "feature_hash": "h"])
        live.pump()
        ackLast("{\"acks\":[{\"sequence\":\"1\",\"status\":\"accepted\",\"durable\":false}]}")
        XCTAssertEqual(box.ackedSequences, [], "durable:true 가 아니면 완료가 아니다")
        XCTAssertEqual(box.pendingSequences, [1])
    }
    func testRevokedSessionRefusesToRejoinEvenIfSocketReconnects() throws {
        driveToReady(); ackLast("{\"ok\":true,\"state\":\"READY\"}")
        t.serverSend("42/session-live,[\"live:access_revoked\",{\"code\":\"expelled\",\"revision\":\"4\"}]")
        let hellos = sentEvents().filter { $0.name == "live:hello" }.count
        client.connect(); t.serverOpen(); t.serverSend("40/session-live,{}")   // 외부에서 다시 붙어도
        XCTAssertEqual(sentEvents().filter { $0.name == "live:hello" }.count, hellos, "hello/join 재시도 금지")
        XCTAssertEqual(live.state, .revoked)
    }
}
