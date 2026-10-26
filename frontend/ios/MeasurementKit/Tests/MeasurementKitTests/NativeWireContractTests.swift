import XCTest
@testable import MeasurementKit

/// 실제 MeasurementManager + 실제 LiveSession + Socket.IO 코덱을 붙여, native 가 서버로 보내는 wire 메시지 전부를 모은다.
/// MK_WIRE_OUT 지정 시 파일로 내보내 contracts/session-live-v2 ajv 검증기(scripts/validate-wire-output.mjs)로 확인한다.
final class NativeWireContractTests: XCTestCase {
    func testManagerAndLiveSessionWireMessagesEndToEnd() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("nw-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let sid = "00000001-0000-4000-8000-000000000001", stream = "00000014-0000-4000-8000-000000000014", pid = "0000000c-0000-4000-8000-00000000000c"
        let t = FakeTransport(), sch = ManualScheduler()
        let client = SocketIOClient(baseURL: URL(string: "https://x")!, namespace: "/session-live", scheduler: sch, jitter: { 0 },
                                    auth: { ["token": "tok"] }, transportFactory: { t })
        let live = LiveSession(client: client, scheduler: sch, sessionId: sid, instanceId: "00000002-0000-4000-8000-000000000002",
                               appBuild: "t", coreVersion: "core-1.0.0", refreshToken: { $0(.success("tok")) })
        let own = BandOwnership(defaults: UserDefaults(suiteName: "nw-\(UUID().uuidString)")!); own.nativeEnabled = true
        var mono: UInt64 = 5_000_000
        let m = MeasurementManager(root: dir, band: FakeBand(), ownership: own, makeLive: { _ in live },
                                   makeEngine: { d, ctx in try MeasurementEngine(dir: d, configJSON: CoreBridgeTests.cfg, context: ctx, journalSync: .none) },
                                   scheduler: sch, nowMs: { 1_760_000_000_000 }, monoUs: { mono })

        func sent() -> [(name: String, id: Int?, payload: [String: Any])] {
            t.sent.compactMap { s in
                guard s.hasPrefix("42"), let p = try? SocketIOCodec.decode(s) else { return nil }
                return (p.name, p.id, (p.args.first as? [String: Any]) ?? [:])
            }
        }
        func last(_ n: String, kind: String? = nil) -> (name: String, id: Int?, payload: [String: Any])? {
            sent().last { $0.name == n && (kind == nil || ($0.payload["kind"] as? String) == kind) }
        }
        func reply(_ e: (name: String, id: Int?, payload: [String: Any])?, _ body: [String: Any]) {
            let d = try! JSONSerialization.data(withJSONObject: [body]); t.serverSend("43/session-live,\(e!.id!)\(String(data: d, encoding: .utf8)!)")
        }

        _ = try m.startMeasurement(sessionId: sid, credentialHandle: "cred_handle_AbCdEfGh0123", configHash: String(repeating: "a", count: 64),
                                   requestId: "0000001e-0000-4000-8000-00000000001e")
        t.serverOpen(); t.serverSend("40/session-live,{}")
        reply(last("live:hello"), ["ok": true])
        reply(last("live:join"), ["ok": true, "snapshot_id": "00000009-0000-4000-8000-000000000009", "state": "RESYNCING", "epoch": "4"])
        t.serverSend("42/session-live,[\"live:snapshot\",{\"snapshot_id\":\"00000009-0000-4000-8000-000000000009\",\"epoch\":\"4\",\"through\":[{\"audience\":\"member:\(pid)\",\"domain\":\"device\",\"seq\":\"2\"}]}]")
        t.serverSend("42/session-live,[\"live:sync_complete\",{\"snapshot_id\":\"00000009-0000-4000-8000-000000000009\",\"through\":[]}]")
        reply(last("live:applied"), ["ok": true, "state": "READY"])
        XCTAssertEqual(live.state, .ready)

        // capture.start: READY 에서 서버 epoch 로 채워져 나간다
        let start = last("live:command", kind: "capture.start")!
        XCTAssertEqual(start.payload["expected_epoch"] as? String, "4")
        reply(start, ["command_id": start.payload["command_id"]!, "status": "applied", "epoch": "4", "cursors": [], "entity_version": "1", "committed": true,
                      "result": ["stream_id": stream, "participant_id": pid, "generation": "3", "owner_generation": "3",
                                 "lease": ["expires_at_ms": 1_760_000_030_000, "offline_bound_until_ms": 1_760_000_600_000], "clock_uncertain": true]])
        XCTAssertEqual(m.state, .capturing)

        // clock_probe → capture.reanchor
        let probe = last("live:clock_probe")!
        mono = 5_100_000
        reply(probe, ["ok": true, "protocol_version": 2, "schema_version": 1, "probe_id": probe.payload["probe_id"]!, "client_monotonic_us": probe.payload["client_monotonic_us"]!,
                      "server_receive_ms": 1_760_000_000_050, "server_send_ms": 1_760_000_000_051])
        let reanchor = last("live:command", kind: "capture.reanchor")!
        reply(reanchor, ["command_id": reanchor.payload["command_id"]!, "status": "applied", "epoch": "4", "cursors": [], "entity_version": "2", "committed": true,
                         "result": ["stream_id": stream, "clock_uncertain": false]])

        // 수집 → live:metric · live:device
        m.bandLink(didChange: .subscribed, reason: nil)
        m.bandLink(didReadBattery: 81)
        for i in 0..<1500 { let p = EngineTests.packets[i]; m.bandLink(didReceive: p.sensor, data: p.bytes, monotonicUs: p.arrivalUs) }
        let metric = last("live:metric")!
        let wins = metric.payload["windows"] as! [[String: Any]]
        XCTAssertTrue(wins.allSatisfy { ($0["participant_id"] as? String) == pid })
        let acks = wins.map { ["session_id": sid, "participant_id": pid, "stream_id": stream, "sequence": $0["sequence"]!, "status": "accepted", "durable": true,
                               "feature_hash": $0["feature_hash"]!, "received_at_server_ms": 1_760_000_001_000] as [String: Any] }
        reply(metric, ["protocol_version": 2, "schema_version": 1, "acks": acks])
        let dev = last("live:device")!
        reply(dev, ["protocol_version": 2, "schema_version": 1, "session_id": sid, "stream_id": stream, "device_seq": dev.payload["device_seq"]!,
                    "status": "accepted", "durable": true, "received_at_server_ms": 1_760_000_001_000])
        sch.advance(10.1)   // presence 5초 + capture.renew 10초
        XCTAssertNotNil(last("live:command", kind: "capture.renew"))
        XCTAssertNotNil(last("live:presence"))

        // 회차 종료 → 자동 봉인 → capture.close
        t.serverSend("42/session-live,[\"live:terminal\",{\"protocol_version\":2,\"schema_version\":1,\"session_id\":\"\(sid)\",\"code\":\"completed\",\"revision\":\"9\"}]")
        XCTAssertEqual(m.state, .sealing)
        XCTAssertNotNil(last("live:command", kind: "capture.close"))

        let kindOf: [String: String] = ["live:hello": "hello", "live:join": "join", "live:applied": "applied", "live:presence": "presence",
                                        "live:command": "command", "live:metric": "metric-batch", "live:device": "device", "live:clock_probe": "clock-probe",
                                        "live:resync": "resync"]
        let out: [[String: Any]] = sent().map { ["event": $0.name, "kind": kindOf[$0.name] ?? "unknown", "message": $0.payload] }
        XCTAssertFalse(out.contains { ($0["kind"] as? String) == "unknown" }, "\(out.map { $0["event"]! })")
        let names = Set(out.compactMap { $0["event"] as? String })
        for n in ["live:command", "live:metric", "live:device", "live:clock_probe", "live:presence"] { XCTAssertTrue(names.contains(n), n) }
        if let path = ProcessInfo.processInfo.environment["MK_WIRE_OUT"] {
            try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys]).write(to: URL(fileURLWithPath: path))
        }
    }
}
