import XCTest
@testable import MeasurementKit

/// T07b — T05b 통합 계약 보정: expected_epoch 자동 채움, live:metric 응답 처리, live:device, live:clock_probe, terminal drain.
final class LiveSessionT07bTests: XCTestCase {
    var t: FakeTransport!; var sch: ManualScheduler!; var client: SocketIOClient!; var live: LiveSession!
    var dir: URL!
    let sid = "00000001-0000-4000-8000-000000000001"
    var acks: [[String: Any]] = []

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("lsb-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        t = FakeTransport(); sch = ManualScheduler()
        client = SocketIOClient(baseURL: URL(string: "https://x")!, namespace: "/session-live", scheduler: sch, jitter: { 0 },
                                auth: { ["token": "tok"] }, transportFactory: { [unowned self] in self.t })
        live = LiveSession(client: client, scheduler: sch, sessionId: sid, instanceId: "00000002-0000-4000-8000-000000000002",
                           appBuild: "t", coreVersion: "core-1.0.0", refreshToken: { $0(.success("tok")) })
        live.onCommandAck = { [unowned self] a in acks.append(a) }
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

    func sent() -> [(name: String, id: Int?, payload: [String: Any])] {
        t.sent.compactMap { s in
            guard s.hasPrefix("42"), let p = try? SocketIOCodec.decode(s) else { return nil }
            return (p.name, p.id, (p.args.first as? [String: Any]) ?? [:])
        }
    }
    func named(_ n: String) -> [(name: String, id: Int?, payload: [String: Any])] { sent().filter { $0.name == n } }
    func ack(_ name: String, _ body: String) { let id = named(name).last!.id!; t.serverSend("43/session-live,\(id)[\(body)]") }

    func ready(epoch: String = "7") {
        live.start(); t.serverOpen(); t.serverSend("40/session-live,{}")
        ack("live:hello", "{\"ok\":true}")
        ack("live:join", "{\"ok\":true,\"snapshot_id\":\"S1\",\"state\":\"RESYNCING\",\"epoch\":\"\(epoch)\"}")
        t.serverSend("42/session-live,[\"live:snapshot\",{\"snapshot_id\":\"S1\",\"epoch\":\"\(epoch)\",\"through\":[]}]")
        t.serverSend("42/session-live,[\"live:sync_complete\",{\"snapshot_id\":\"S1\",\"through\":[]}]")
        ack("live:applied", "{\"ok\":true,\"state\":\"READY\"}")
        XCTAssertEqual(live.state, .ready)
    }

    // MARK: expected_epoch

    func testNativeCommandWithoutExpectedEpochIsFilledFromSnapshotEpoch() {
        ready(epoch: "7")
        live.dispatch(command: ["command_id": "0000000a-0000-4000-8000-00000000000a", "kind": "capture.start", "client_generation": "1", "payload": [:]])
        XCTAssertEqual(named("live:command").last?.payload["expected_epoch"] as? String, "7", "서버 epoch 와 다르면 매번 epoch_mismatch")
    }
    func testEpochMismatchRetriesSameIdWithServerEpoch() {
        ready(epoch: "7")
        live.dispatch(command: ["command_id": "0000000a-0000-4000-8000-00000000000a", "kind": "capture.start", "client_generation": "1", "payload": [:]])
        ack("live:command", "{\"command_id\":\"0000000a-0000-4000-8000-00000000000a\",\"status\":\"retryable\",\"epoch\":\"8\",\"cursors\":[],\"committed\":false,\"code\":\"epoch_mismatch\",\"retry_after_ms\":0}")
        sch.advance(0.01)
        let cmds = named("live:command")
        XCTAssertEqual(cmds.count, 2)
        XCTAssertEqual(cmds[1].payload["command_id"] as? String, "0000000a-0000-4000-8000-00000000000a", "새 ID 금지")
        XCTAssertEqual(cmds[1].payload["expected_epoch"] as? String, "8")
        XCTAssertTrue(acks.isEmpty, "epoch_mismatch 는 최종 결과가 아니다")
    }
    func testExplicitExpectedEpochFromJsIsKept() {
        ready(epoch: "7")
        live.dispatch(command: ["command_id": "0000000b-0000-4000-8000-00000000000b", "kind": "hand.set", "expected_epoch": "5", "client_generation": "1", "payload": ["raised": true]])
        XCTAssertEqual(named("live:command").last?.payload["expected_epoch"] as? String, "5")
    }

    // MARK: live:metric = 방송 전용 (SDD-260: 소켓 ACK/오류는 outbox 를 바꾸지 않는다)

    func box(_ n: Int) throws -> MetricOutbox {
        let b = try MetricOutbox(dir: dir, sync: .none); live.attach(outbox: b)
        for i in 1...n { _ = try b.enqueue(["sequence": "\(i)", "feature_hash": "h\(i)"]) }
        return b
    }
    func testSocketAckNeverChangesOutboxState() throws {
        ready()
        let b = try box(3)
        live.pump()
        ack("live:metric", "{\"protocol_version\":2,\"schema_version\":1,\"acks\":[{\"sequence\":\"3\",\"status\":\"projected\"},{\"sequence\":\"2\",\"status\":\"ignored\",\"code\":\"stream_not_owned\"},{\"sequence\":\"1\",\"status\":\"accepted\",\"durable\":true}]}")
        XCTAssertEqual(b.ackedSequences, [], "소켓 ACK 로 acked 되는 창 0 — 정본은 REST 응답뿐")
        XCTAssertEqual(b.rejectedSequences, [], "소켓 거절/무시로 격리되는 창 0")
        XCTAssertEqual(b.pendingSequences, [1, 2, 3])
    }
    func testSocketErrorsNeverHaltOrIsolateNorRetryStale() throws {
        ready()
        let b = try box(3)
        live.pump()
        ack("live:metric", "{\"ok\":false,\"code\":\"invalid_message\",\"retryable\":false,\"field\":\"sqi\"}")
        sch.advance(3)
        XCTAssertEqual(named("live:metric").count, 1, "방송은 재시도/분할 전송하지 않는다")
        XCTAssertEqual(b.rejectedSequences, []); XCTAssertEqual(b.pendingSequences, [1, 2, 3])
        // 다음 새 창이 오면 방송은 계속된다(연결 단위 오류로 영구 중단되지 않는다)
        _ = try b.enqueue(["sequence": "4", "feature_hash": "h4"])
        live.pump()
        let last = named("live:metric").last!
        XCTAssertEqual((last.payload["windows"] as? [[String: Any]])?.compactMap { $0["sequence"] as? String }, ["4"], "이미 방송한 창은 다시 보내지 않는다")
    }
    func testBroadcastCarriesOnlyLatestFiveWindowsAscending() throws {
        ready()
        _ = try box(12)
        live.pump()
        let w = named("live:metric").last!.payload["windows"] as! [[String: Any]]
        XCTAssertEqual(w.compactMap { $0["sequence"] as? String }, ["8", "9", "10", "11", "12"], "적체를 따라잡지 않고 최신 5창만 방송")
    }
    func testSequenceAboveInt31IsNeverQueuedForLive() throws {
        let b = try MetricOutbox(dir: dir, sync: .none)
        _ = try b.enqueue(["sequence": "2147483647", "feature_hash": "h"])
        _ = try b.enqueue(["sequence": "2147483648", "feature_hash": "h"])
        XCTAssertEqual(b.pendingSequences, [2147483647], "서버 window_index(Integer) 한도 초과 창은 live 로 보내지 않는다(feature journal·archive 에는 남음)")
        XCTAssertEqual(b.counts().outOfRange, 1)
    }
    func testTerminalStopsBroadcastButDoesNotTouchOutbox() throws {
        ready()
        let b = try box(1)
        t.serverSend("42/session-live,[\"live:terminal\",{\"session_id\":\"\(sid)\",\"code\":\"completed\",\"revision\":\"9\"}]")
        XCTAssertEqual(live.state, .terminal)
        live.pump()
        XCTAssertEqual(named("live:metric").count, 0, "종료 후 방송 없음")
        XCTAssertEqual(b.pendingSequences, [1], "저장 대기 창은 그대로(REST 가 계속 처리)")
    }

    // MARK: live:device

    func device(_ seq: String) -> [String: Any] {
        ["stream_id": "00000014-0000-4000-8000-000000000014", "device_seq": seq, "band_state": "connected",
         "contact": ["fp1": "contact", "fp2": "unknown"], "sqi": NSNull(), "battery_pct": 70, "state_reason": NSNull()]
    }
    func testDeviceReportWaitsForReadyThenSendsLatestOnly() {
        live.reportDevice(device("1")); live.reportDevice(device("2"))
        XCTAssertTrue(named("live:device").isEmpty, "READY 전에는 보내지 않는다(서버 not_ready)")
        ready()
        let d = named("live:device")
        XCTAssertEqual(d.count, 1)
        XCTAssertEqual(d[0].payload["device_seq"] as? String, "2")
        XCTAssertEqual(d[0].payload["protocol_version"] as? Int, 2); XCTAssertEqual(d[0].payload["schema_version"] as? Int, 1)
        XCTAssertEqual(d[0].payload["session_id"] as? String, sid)
        XCTAssertEqual(Set(d[0].payload.keys), ["protocol_version", "schema_version", "session_id", "stream_id", "device_seq", "band_state", "contact", "sqi", "battery_pct", "state_reason"])
    }
    func testDeviceStreamNotActiveStopsAndNotifies() {
        var rejected: [String] = []
        live.onDeviceRejected = { rejected.append($0) }
        ready(); live.reportDevice(device("1"))
        ack("live:device", "{\"ok\":false,\"code\":\"stream_not_active\",\"retryable\":false}")
        XCTAssertEqual(rejected, ["stream_not_active"])
        sch.advance(10)
        XCTAssertEqual(named("live:device").count, 1, "비재시도 오류는 재전송 안 함")
    }
    func testDeviceRetryableIsResent() {
        ready(); live.reportDevice(device("1"))
        ack("live:device", "{\"ok\":false,\"code\":\"db_unavailable\",\"retryable\":true,\"retry_after_ms\":1000}")
        sch.advance(1.1)
        XCTAssertEqual(named("live:device").count, 2)
        ack("live:device", "{\"protocol_version\":2,\"schema_version\":1,\"status\":\"accepted\",\"durable\":true,\"device_seq\":\"1\"}")
        sch.advance(10)
        XCTAssertEqual(named("live:device").count, 2)
    }

    // MARK: live:clock_probe

    func testClockProbeSendsU64StringAndReturnsServerTimes() {
        ready()
        var got: ClockProbeResult?
        live.clockProbe(clientMonotonicUs: 1_234_567) { got = try? $0.get() }
        let p = named("live:clock_probe").last!
        XCTAssertEqual(p.payload["client_monotonic_us"] as? String, "1234567")
        XCTAssertTrue(p.payload["server_receive_ms"] is NSNull && p.payload["server_send_ms"] is NSNull, "계약: 요청은 null")
        let pid = p.payload["probe_id"] as! String
        XCTAssertTrue(MeasurementManager.isUUID(pid))
        ack("live:clock_probe", "{\"ok\":true,\"protocol_version\":2,\"schema_version\":1,\"probe_id\":\"\(pid)\",\"client_monotonic_us\":\"1234567\",\"server_receive_ms\":100,\"server_send_ms\":101}")
        XCTAssertEqual(got?.probeId, pid); XCTAssertEqual(got?.serverReceiveMs, 100)
    }
    func testClockProbeRejectedReportsFailure() {
        ready()
        var failed = false
        live.clockProbe(clientMonotonicUs: 1) { if case .failure = $0 { failed = true } }
        ack("live:clock_probe", "{\"ok\":false,\"code\":\"live_unavailable\",\"retryable\":true}")
        XCTAssertTrue(failed)
    }
}
