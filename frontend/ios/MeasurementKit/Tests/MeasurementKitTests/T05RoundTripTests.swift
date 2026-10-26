#if os(macOS)
import XCTest
@testable import MeasurementKit

/// 실제 T05 백엔드(운영 app.ws:asgi_app + 로컬 PG/Redis 합성 계정, scripts/t05_native_roundtrip.py)와
/// URLSessionWebSocket + SocketIOClient + LiveSession + MeasurementManager + Rust 코어를 붙여 capture.start → metric → ACK 를 한 번 왕복한다.
/// MK_T05_INFO(드라이버가 쓴 info.json)가 없으면 건너뛴다. dev 서버·DB·.env 는 쓰지 않는다.
final class T05RoundTripTests: XCTestCase {
    func testNativeCaptureStartMetricAckRoundTripAgainstRealBackend() throws {
        guard let infoPath = ProcessInfo.processInfo.environment["MK_T05_INFO"] else { throw XCTSkip("MK_T05_INFO 미지정") }
        let info = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: infoPath))) as! [String: String]
        let q = DispatchQueue(label: "t05-roundtrip")
        let sch = DispatchScheduler(queue: q)
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("t05-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        let client = SocketIOClient(baseURL: URL(string: info["url"]!)!, namespace: "/session-live", scheduler: sch,
                                    auth: { ["token": info["token"]!] }, transportFactory: { URLSessionWebSocketTransport(queue: q) })
        let live = LiveSession(client: client, scheduler: sch, sessionId: info["session_id"]!, instanceId: UUID().uuidString.lowercased(),
                               appBuild: "t07b-roundtrip", coreVersion: MeasurementManager.coreVersion, refreshToken: { $0(.success(info["token"]!)) })
        let own = BandOwnership(defaults: UserDefaults(suiteName: "t05-\(UUID().uuidString)")!); own.nativeEnabled = true
        let m = MeasurementManager(root: dir, band: FakeBand(), ownership: own, makeLive: { _ in live },
                                   makeEngine: { d, ctx, _ in try MeasurementEngine(dir: d, configJSON: CoreBridgeTests.cfg, context: ctx, journalSync: .none) },
                                   scheduler: sch)
        var acks: [[String: Any]] = [], metricAcks: [[String: Any]] = [], deviceRejected: [String] = []
        var t0 = Date(), tStartAck: TimeInterval?, tFirstMetricAck: TimeInterval?
        q.sync {
            m.onBridgeEvent = { e in if (e["event"] as? String) == "commandAck", let p = e["payload"] as? [String: Any] { acks.append(p) } }
            live.onMetricAck = { o in metricAcks.append(o); if tFirstMetricAck == nil { tFirstMetricAck = Date().timeIntervalSince(t0) } }
        }
        func waitFor(_ label: String, timeout: TimeInterval = 20, _ cond: @escaping () -> Bool) {
            let end = Date().addingTimeInterval(timeout)
            while Date() < end { var r = false; q.sync { r = cond() }; if r { return }; Thread.sleep(forTimeInterval: 0.05) }
            var dbg = ""; q.sync { dbg = "live=\(live.state) m=\(m.state) blocked=\(m.blockedReason ?? "-") acks=\(acks.map { "\($0["status"] ?? "")/\($0["code"] ?? "")" })" }
            XCTFail("timeout: \(label) \(dbg)")
        }

        q.sync {
            t0 = Date()
            _ = try? m.startMeasurement(sessionId: info["session_id"]!, credentialHandle: "cred_handle_AbCdEfGh0123", configHash: String(repeating: "a", count: 64),
                                        requestId: UUID().uuidString.lowercased())
            live.onDeviceRejected = { deviceRejected.append($0) }
        }
        waitFor("READY") { live.state == .ready }
        waitFor("capture.start ACK result 채택 → CAPTURING") { m.state == .capturing }
        q.sync { tStartAck = Date().timeIntervalSince(t0) }
        var snap: [String: Any] = [:]
        q.sync { snap = m.snapshot() }
        XCTAssertEqual(snap["ownerGeneration"] as? String, "1")
        XCTAssertNotNil(snap["streamId"] as? String)

        // 서버 anchor: clock_probe → capture.reanchor → clock_uncertain=false
        waitFor("reanchor applied(clock_uncertain=false)") {
            acks.contains { a in (a["result"] as? [String: Any])?["clock_uncertain"] as? Bool == false }
        }

        // 수집 → live:metric → durable ACK
        q.sync { for i in 0..<1500 { let p = EngineTests.packets[i]; m.bandLink(didReceive: p.sensor, data: p.bytes, monotonicUs: p.arrivalUs) } }
        q.sync { m.bandLink(didChange: .subscribed, reason: nil); m.bandLink(didReadBattery: 80) }
        waitFor("metric durable ACK 전부", timeout: 30) { (live.outboxCounts?.livePending ?? 1) == 0 && (live.outboxCounts?.liveAcked ?? 0) > 0 }
        var counts: MetricOutbox.Counts?
        q.sync { counts = live.outboxCounts }
        XCTAssertEqual(counts?.rejected, 0, "정상 경로에서 거절 0")
        let allAcks = metricAcks.flatMap { ($0["acks"] as? [[String: Any]]) ?? [] }
        XCTAssertTrue(allAcks.allSatisfy { ($0["durable"] as? Bool) == true && ["accepted", "duplicate"].contains($0["status"] as? String ?? "") })
        XCTAssertTrue(deviceRejected.isEmpty, "\(deviceRejected)")

        // 정지 → capture.close applied
        q.sync { _ = try? m.stopMeasurement(reason: "user_stop", requestId: UUID().uuidString.lowercased()) }
        waitFor("capture.close applied") { acks.contains { ($0["result"] as? [String: Any])?["status"] as? String == "closed" } }

        let out: [String: Any] = ["capture_start_ack_s": tStartAck ?? -1, "first_metric_ack_s": tFirstMetricAck ?? -1,
                                  "metric_windows_acked": counts?.liveAcked ?? 0, "metric_rejected": counts?.rejected ?? -1,
                                  "metric_batches": metricAcks.count, "device_rejected": deviceRejected,
                                  "command_acks": acks.map { "\($0["status"] ?? "")\(($0["code"] as? String).map { "/" + $0 } ?? "")" }]
        if let p = ProcessInfo.processInfo.environment["MK_T05_OUT"] { try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys]).write(to: URL(fileURLWithPath: p)) }
        q.sync { live.stop(); client.close() }
    }

    /// 같은 드라이버(새 회차)로: 10초 넘게 수집해 capture.renew 왕복, 호스트가 session.end → 회원 live:terminal → 자동 봉인 → capture.close.
    func testRenewAndHostSessionEndTerminalAutoSealAgainstRealBackend() throws {
        guard let infoPath = ProcessInfo.processInfo.environment["MK_T05_INFO_TERMINAL"] else { throw XCTSkip("MK_T05_INFO_TERMINAL 미지정") }
        let info = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: infoPath))) as! [String: String]
        let q = DispatchQueue(label: "t05-terminal")
        let sch = DispatchScheduler(queue: q)
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("t05t-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        func makeLive(_ token: String) -> (SocketIOClient, LiveSession) {
            let c = SocketIOClient(baseURL: URL(string: info["url"]!)!, namespace: "/session-live", scheduler: sch,
                                   auth: { ["token": token] }, transportFactory: { URLSessionWebSocketTransport(queue: q) })
            return (c, LiveSession(client: c, scheduler: sch, sessionId: info["session_id"]!, instanceId: UUID().uuidString.lowercased(),
                                   appBuild: "t07b-roundtrip", coreVersion: MeasurementManager.coreVersion, refreshToken: { $0(.success(token)) }))
        }
        let (mc, member) = makeLive(info["token"]!)
        let (hc, host) = makeLive(info["host_token"]!)
        let own = BandOwnership(defaults: UserDefaults(suiteName: "t05t-\(UUID().uuidString)")!); own.nativeEnabled = true
        let m = MeasurementManager(root: dir, band: FakeBand(), ownership: own, makeLive: { _ in member },
                                   makeEngine: { d, ctx, _ in try MeasurementEngine(dir: d, configJSON: CoreBridgeTests.cfg, context: ctx, journalSync: .none) },
                                   scheduler: sch)
        var acks: [[String: Any]] = [], hostAcks: [[String: Any]] = [], sealed: [String] = []
        var endIdBox = ""
        q.sync {
            m.onBridgeEvent = { e in if (e["event"] as? String) == "commandAck", let p = e["payload"] as? [String: Any] { acks.append(p) } }
            m.onSealed = { sid, _ in sealed.append(sid) }
            host.onCommandAck = { hostAcks.append($0) }
        }
        func waitFor(_ label: String, timeout: TimeInterval = 20, _ cond: @escaping () -> Bool) {
            let end = Date().addingTimeInterval(timeout)
            while Date() < end { var r = false; q.sync { r = cond() }; if r { return }; Thread.sleep(forTimeInterval: 0.05) }
            var dbg = ""; q.sync { dbg = "member=\(member.state) host=\(host.state) m=\(m.state) acks=\(acks.map { "\($0["status"] ?? "")/\($0["code"] ?? "")" }) host=\(hostAcks.map { "\($0["command_id"] ?? "")|\($0["status"] ?? "")|\($0["code"] ?? "")" }) endId=\(endIdBox)" }
            XCTFail("timeout: \(label) \(dbg)")
        }
        q.sync { _ = try? m.startMeasurement(sessionId: info["session_id"]!, credentialHandle: "cred_handle_AbCdEfGh0123", configHash: String(repeating: "a", count: 64),
                                             requestId: UUID().uuidString.lowercased()) }
        waitFor("CAPTURING") { m.state == .capturing }
        q.sync { for i in 0..<300 { let p = EngineTests.packets[i]; m.bandLink(didReceive: p.sensor, data: p.bytes, monotonicUs: p.arrivalUs) } }
        // capture.renew 결과: lease 가 있고 participant_id 가 없는 result(start 결과와 구분)
        waitFor("capture.renew applied", timeout: 16) { acks.contains { a in let r = a["result"] as? [String: Any]; return r?["lease"] != nil && r?["participant_id"] == nil } }

        q.sync { host.start() }
        waitFor("host READY") { host.state == .ready }
        let endId = UUID().uuidString.lowercased(); endIdBox = endId
        q.sync { host.dispatch(command: ["command_id": endId, "kind": "session.end", "client_generation": "1", "payload": ["reason": "host_ended"]]) }
        // ACK 가 2초 timeout 을 넘으면 같은 command_id 재시도 → 서버 ledger 가 duplicate 로 원 결과를 돌려준다(부작용 1회). 둘 다 성공.
        waitFor("session.end applied|duplicate") { hostAcks.contains { ($0["command_id"] as? String) == endId && ["applied", "duplicate"].contains(($0["status"] as? String) ?? "") } }
        waitFor("회원 자동 봉인") { m.state == .sealing || m.state == .draining || m.state == .closed }
        waitFor("capture.close applied(ended stream)") { acks.contains { ($0["result"] as? [String: Any])?["status"] as? String == "closed" } }
        q.sync {
            XCTAssertEqual(sealed, [info["session_id"]!])
            XCTAssertEqual(member.state, .terminal, "live:terminal 수신")
            XCTAssertEqual(member.outboxCounts?.rejected ?? -1, 0)
        }
        if let p = ProcessInfo.processInfo.environment["MK_T05_OUT_TERMINAL"] {
            var out: [String: Any] = [:]
            q.sync { out = ["host_session_end": hostAcks.map { "\($0["status"] ?? "")" }, "member_state": member.state.rawValue, "manager_state": m.state.rawValue, "sealed": sealed.count,
                            "command_acks": acks.map { "\($0["status"] ?? "")\(($0["code"] as? String).map { "/" + $0 } ?? "")" },
                            "metric_acked": member.outboxCounts?.liveAcked ?? 0, "metric_pending": member.outboxCounts?.livePending ?? -1] }
            try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys]).write(to: URL(fileURLWithPath: p))
        }
        q.sync { member.stop(); host.stop(); mc.close(); hc.close() }
    }
}
#endif
