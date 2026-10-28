import XCTest
@testable import MeasurementKit

/// T07b — capture.start ACK result 채택, device.changed 합집합 소비, live:device, capture.renew/reanchor, terminal 자동 봉인.
final class ManagerT07bTests: XCTestCase {
    var dir: URL!, band: FakeBand!, live: FakeLive!, own: BandOwnership!, sch: ManualScheduler!, m: MeasurementManager!
    var sealed: [(String, String?)] = []
    var mono: UInt64 = 5_000_000
    let sid = "00000001-0000-4000-8000-000000000001", req = "0000001e-0000-4000-8000-00000000001e"
    let stream = FakeLive.stream
    /// participant 는 서버 ACK 값만 쓴다 — 다른 값이 envelope 에 들어가면 participant_mismatch.
    let ackPid = "0000000c-0000-4000-8000-00000000000c"

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("mgb-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        band = FakeBand(); live = FakeLive(); sch = ManualScheduler()
        own = BandOwnership(defaults: UserDefaults(suiteName: "mb-\(UUID().uuidString)")!); own.nativeEnabled = true
        m = make(band, live, own)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

    func make(_ b: FakeBand, _ l: FakeLive, _ o: BandOwnership) -> MeasurementManager {
        let mm = MeasurementManager(root: dir, band: b, ownership: o, makeLive: { _ in l },
                                    makeEngine: { d, ctx, _ in try MeasurementEngine(dir: d, configJSON: CoreBridgeTests.cfg, context: ctx, journalSync: .none) },
                                    scheduler: sch, nowMs: { 1_760_000_000_000 }, monoUs: { [unowned self] in self.mono })
        mm.onSealed = { [unowned self] s, h in sealed.append((s, h)) }
        return mm
    }
    func startAndAdopt(ready: Bool = true) throws {
        _ = try m.startMeasurement(sessionId: sid, credentialHandle: "cred_handle_AbCdEfGh0123", configHash: String(repeating: "a", count: 64), requestId: req)
        if ready { live.state = .ready; m.liveStateChanged(.ready) }
        live.ackCaptureStart(participant: ackPid)
    }
    func feed(_ r: Range<Int>) { for i in r { let p = EngineTests.packets[i]; m.bandLink(didReceive: p.sensor, data: p.bytes, monotonicUs: p.arrivalUs) } }
    func windows() -> [[String: Any]] { live.outbox?.nextBatch(max: 60, excluding: []) ?? [] }
    func deviceEvent(stream s: String, generation: Any, status: String, cutoff: String? = nil, participant: String? = nil) -> [String: Any] {
        ["domain": "device", "kind": "device.changed", "audience": "member:\(participant ?? ackPid)", "seq": "2", "entity_id": participant ?? ackPid,
         "payload": ["participant_id": participant ?? ackPid, "stream_id": s, "generation": generation, "status": status,
                     "clock_uncertain": true, "cutoff_code": cutoff ?? NSNull()] as [String: Any]]
    }

    // MARK: 1. capture.start ACK result

    func testCaptureStartOmitsExpectedEpochSoLiveSessionFillsServerEpoch() throws {
        _ = try m.startMeasurement(sessionId: sid, credentialHandle: "cred_handle_AbCdEfGh0123", configHash: String(repeating: "a", count: 64), requestId: req)
        XCTAssertNil(live.command("capture.start")?["expected_epoch"], "\"0\" 고정이면 서버(epoch≥1)가 매번 epoch_mismatch")
    }
    func testAckResultAdoptsStreamGenerationAndParticipantImmediately() throws {
        try startAndAdopt()
        XCTAssertEqual(m.state, .capturing, "device.changed 를 기다리지 않는다")
        XCTAssertEqual(live.owner?.0, stream); XCTAssertEqual(live.owner?.1, 3)
        feed(0..<600)
        let w = windows()
        XCTAssertFalse(w.isEmpty)
        XCTAssertTrue(w.allSatisfy { ($0["participant_id"] as? String) == ackPid }, "metric 의 participant_id = ACK result.participant_id")
        XCTAssertTrue(w.allSatisfy { ($0["stream_generation"] as? String) == "3" })
    }
    func testAckWithoutResultOrIntegerGenerationIsNotAdopted() throws {
        _ = try m.startMeasurement(sessionId: sid, credentialHandle: "cred_handle_AbCdEfGh0123", configHash: String(repeating: "a", count: 64), requestId: req)
        let id = live.command("capture.start")!["command_id"] as! String
        live.onCommandAck?(["command_id": id, "status": "applied", "epoch": "1", "cursors": [], "committed": true,
                            "result": ["stream_id": stream, "participant_id": ackPid, "generation": 3, "owner_generation": 3]])
        XCTAssertEqual(m.state, .arming, "u64 는 십진 문자열만 — 정수 generation 은 계약 위반이라 채택하지 않는다")
    }
    func testCaptureStartRejectedBlocksWithContractReason() throws {
        _ = try m.startMeasurement(sessionId: sid, credentialHandle: "cred_handle_AbCdEfGh0123", configHash: String(repeating: "a", count: 64), requestId: req)
        live.ack("capture.start", status: "rejected", code: "eeg_consent_required")
        XCTAssertEqual(m.state, .blocked); XCTAssertEqual(m.blockedReason, "consent_missing")
        XCTAssertEqual(band.disconnects, 1)
    }
    func testCaptureStartResultUnknownRedispatchesSameCommandId() throws {
        _ = try m.startMeasurement(sessionId: sid, credentialHandle: "cred_handle_AbCdEfGh0123", configHash: String(repeating: "a", count: 64), requestId: req)
        let id = live.command("capture.start")!["command_id"] as? String
        live.ack("capture.start", status: "retryable", code: "result_unknown")
        let starts = live.dispatched.filter { ($0["kind"] as? String) == "capture.start" }
        XCTAssertEqual(starts.count, 2); XCTAssertEqual(starts[1]["command_id"] as? String, id, "새 stream 을 만들지 않도록 같은 ID 로 ledger 결과 조회")
    }

    // MARK: 2·3. device.changed 합집합 소비

    func testIntegerGenerationInDeviceEventIsIgnoredButStringFences() throws {
        try startAndAdopt()
        live.onEvent?(deviceEvent(stream: "00000099-0000-4000-8000-000000000099", generation: 4, status: "active"))
        XCTAssertEqual(m.state, .capturing, "정수 generation 가정 제거")
        live.onEvent?(deviceEvent(stream: "00000099-0000-4000-8000-000000000099", generation: "4", status: "active"))
        XCTAssertEqual(m.state, .blocked); XCTAssertEqual(m.blockedReason, "owner_fenced")
    }
    func testOwnStreamSupersededFences() throws {
        try startAndAdopt()
        live.onEvent?(deviceEvent(stream: stream, generation: "3", status: "superseded"))
        XCTAssertEqual(m.blockedReason, "owner_fenced"); XCTAssertNil(live.owner)
    }
    func testOtherParticipantEventIsIgnored() throws {
        try startAndAdopt()
        live.onEvent?(deviceEvent(stream: "00000099-0000-4000-8000-000000000099", generation: "9", status: "active", participant: "0000000d-0000-4000-8000-00000000000d"))
        XCTAssertEqual(m.state, .capturing)
    }
    func testConsentWithdrawnCutoffStopsAndQuarantinesWithoutUpload() throws {
        try startAndAdopt(); feed(0..<300)
        live.onEvent?(deviceEvent(stream: stream, generation: "3", status: "revoked", cutoff: "consent_withdrawn"))
        XCTAssertEqual(m.state, .blocked); XCTAssertEqual(m.blockedReason, "consent_missing")
        XCTAssertEqual(band.disconnects, 1); XCTAssertNil(live.owner)
        XCTAssertNil(live.command("capture.close"), "revoked stream 은 서버가 close 를 거절(stream_not_open)")
        XCTAssertEqual(m.archiveQueue?.counts.pending, 0, "동의 철회 후 업로드 금지 — 로컬 격리")
        XCTAssertTrue(sealed.isEmpty)
        feed(300..<320)
        XCTAssertEqual((m.snapshot()["collection"] as! [String: Any])["last_committed_sample_sequence"] as? String, "300", "cutoff 후 수집 안 함")
    }
    func testExpelledCutoffMapsToCaptureLeaseDenied() throws {
        try startAndAdopt()
        live.onEvent?(deviceEvent(stream: stream, generation: "3", status: "revoked", cutoff: "expelled"))
        XCTAssertEqual(m.blockedReason, "capture_lease_denied")
    }
    func testOwnStreamEndedAutoSealsClosesAndStartsArchive() throws {
        try startAndAdopt(); feed(0..<400)
        live.onEvent?(deviceEvent(stream: stream, generation: "3", status: "ended", cutoff: "completed"))
        XCTAssertEqual(m.state, .sealing)
        XCTAssertEqual((live.command("capture.close")?["payload"] as? [String: Any])?["reason"] as? String, "session_ended")
        XCTAssertEqual(sealed.first?.0, sid); XCTAssertEqual(sealed.first?.1, "cred_handle_AbCdEfGh0123")
        XCTAssertGreaterThanOrEqual(m.archiveQueue?.counts.pending ?? 0, 2)
    }

    // MARK: 5. live:terminal

    func testLiveTerminalAutoSealsAndDrains() throws {
        try startAndAdopt(); feed(0..<400)
        live.state = .terminal; m.liveStateChanged(.terminal)
        XCTAssertEqual(m.state, .sealing)
        XCTAssertNotNil(live.command("capture.close"))
        XCTAssertEqual(sealed.count, 1)
        m.liveStateChanged(.terminal)
        XCTAssertEqual(sealed.count, 1, "멱등")
    }
    func testTerminalBeforeStreamClosesCleanly() throws {
        _ = try m.startMeasurement(sessionId: sid, credentialHandle: "cred_handle_AbCdEfGh0123", configHash: String(repeating: "a", count: 64), requestId: req)
        m.liveStateChanged(.terminal)
        XCTAssertEqual(m.state, .closed); XCTAssertFalse(own.isNativeOwning)
    }

    // MARK: 4. capture.renew

    func testRenewEveryTenSecondsOnlyWhenReadyAndOneAtATime() throws {
        try startAndAdopt()
        let base = live.dispatched.filter { ($0["kind"] as? String) == "capture.renew" }.count
        sch.advance(10.1)
        let r = live.dispatched.filter { ($0["kind"] as? String) == "capture.renew" }
        XCTAssertEqual(r.count, base + 1)
        let p = r.last!["payload"] as! [String: Any]
        XCTAssertEqual(p["stream_id"] as? String, stream); XCTAssertEqual(p["owner_generation"] as? String, "3")
        XCTAssertTrue(MeasurementManager.isUUID(p["clock_anchor_id"] as! String))
        XCTAssertNil(r.last!["expected_epoch"])
        sch.advance(10)
        XCTAssertEqual(live.dispatched.filter { ($0["kind"] as? String) == "capture.renew" }.count, base + 1, "앞 renew 미응답이면 쌓지 않는다")
        live.ack("capture.renew", result: ["stream_id": stream, "generation": "3", "owner_generation": "3", "lease": ["expires_at_ms": 1_760_000_060_000]])
        sch.advance(10)
        XCTAssertEqual(live.dispatched.filter { ($0["kind"] as? String) == "capture.renew" }.count, base + 2)
        live.state = .degraded
        live.ack("capture.renew")
        sch.advance(10)
        XCTAssertEqual(live.dispatched.filter { ($0["kind"] as? String) == "capture.renew" }.count, base + 3, "heartbeat 지연(DEGRADED)에도 lease 는 갱신")
        live.state = .connecting
        live.ack("capture.renew")
        sch.advance(10)
        XCTAssertEqual(live.dispatched.filter { ($0["kind"] as? String) == "capture.renew" }.count, base + 3, "미연결 중에는 보내지 않는다")
    }
    func testRenewStaleOwnerGenerationFences() throws {
        try startAndAdopt()
        sch.advance(10.1)
        live.ack("capture.renew", status: "rejected", code: "stale_owner_generation")
        XCTAssertEqual(m.blockedReason, "owner_fenced")
        let n = live.dispatched.count
        sch.advance(30)
        XCTAssertEqual(live.dispatched.count, n, "fence 후 타이머 정지")
    }

    // MARK: 4. clock_probe → capture.reanchor

    func testClockProbeThenReanchorInCoreTimeDomainAndMeasuredUncertainty() throws {
        try startAndAdopt()
        feed(0..<300)
        XCTAssertTrue(windows().allSatisfy { ($0["clock_uncertainty_ms"] as? Double) == 300_000 }, "anchor 전은 알 수 없음(계약 최댓값)")
        XCTAssertEqual(live.probes.count, 1, "stream 채택 직후 probe")
        mono = 5_250_000
        live.probes[0].done(.success(ClockProbeResult(probeId: "0000001f-0000-4000-8000-00000000001f", clientMonotonicUs: live.probes[0].us,
                                                       serverReceiveMs: 1, serverSendMs: 2, rttSeconds: 0.042)))
        let ra = live.command("capture.reanchor")!
        let p = ra["payload"] as! [String: Any]
        XCTAssertEqual(p["stream_id"] as? String, stream)
        XCTAssertEqual(p["clock_probe_id"] as? String, "0000001f-0000-4000-8000-00000000001f")
        // 코어 시간축: anchor wall(1_760_000_000_000 ms)·1000 + (현재 단조 − anchor 단조)
        XCTAssertEqual(p["monotonic_us"] as? String, "1760000000250000")
        XCTAssertNotNil(U64.parse(p["device_ticks"]), "device_ticks 는 u64 문자열")
        XCTAssertNotEqual(p["device_ticks"] as? String, "0", "수락된 EEG 패킷의 확장 tick")
        live.ack("capture.reanchor", result: ["stream_id": stream, "clock_uncertain": false])
        let before = Set(windows().compactMap { $0["sequence"] as? String })
        feed(300..<900)
        let after = windows().filter { !before.contains($0["sequence"] as! String) }
        XCTAssertFalse(after.isEmpty)
        XCTAssertTrue(after.allSatisfy { ($0["clock_anchor_id"] as? String) == "0000001f-0000-4000-8000-00000000001f" })
        XCTAssertTrue(after.allSatisfy { ($0["clock_uncertainty_ms"] as? Double) == 42 }, "고정 300000 대신 실측 RTT 상한")
        // 재연결 READY 마다 다시 잡는다
        m.liveStateChanged(.ready)
        XCTAssertEqual(live.probes.count, 2)
    }
    func testReanchorStillUncertainKeepsUnknownUncertainty() throws {
        try startAndAdopt()
        live.probes[0].done(.success(ClockProbeResult(probeId: "0000001f-0000-4000-8000-00000000001f", clientMonotonicUs: 1, serverReceiveMs: 1, serverSendMs: 2, rttSeconds: 0.01)))
        live.ack("capture.reanchor", result: ["stream_id": stream, "clock_uncertain": true])
        feed(0..<600)
        XCTAssertTrue(windows().allSatisfy { ($0["clock_uncertainty_ms"] as? Double) == 300_000 }, "서버가 probe 를 확인 못 하면 오차를 주장하지 않는다")
    }
    func testClockResyncEveryFiveMinutes() throws {
        try startAndAdopt()
        live.probes[0].done(.failure(.transport))
        sch.advance(300.1)
        XCTAssertEqual(live.probes.count, 2)
    }

    // MARK: 3. live:device

    func testDeviceReportOnAdoptAndChangesWithMonotonicSeq() throws {
        try startAndAdopt()
        XCTAssertEqual(live.devices.count, 1)
        let d0 = live.devices[0]
        XCTAssertEqual(d0["stream_id"] as? String, stream); XCTAssertEqual(d0["device_seq"] as? String, "1")
        XCTAssertEqual(d0["contact"] as? [String: String], ["fp1": "unknown", "fp2": "unknown"])
        m.bandLink(didChange: .subscribed, reason: nil)
        m.bandLink(didReadBattery: 77); m.bandLink(didReadBattery: 77)
        let seqs = live.devices.compactMap { ($0["device_seq"] as? String).flatMap { UInt64($0) } }
        XCTAssertEqual(seqs, [1, 2, 3], "변화만 보고, device_seq 단조")
        XCTAssertEqual(live.devices.last?["battery_pct"] as? Int, 77); XCTAssertEqual(live.devices.last?["band_state"] as? String, "connected")
    }
    func testStreamNotActiveStopsDeviceReporting() throws {
        try startAndAdopt()
        live.onDeviceRejected?("stream_not_active")
        m.bandLink(didChange: .subscribed, reason: nil)
        XCTAssertEqual(live.devices.count, 1)
    }
    func testDeviceSeqSurvivesRelaunch() throws {
        try startAndAdopt()
        m.bandLink(didChange: .subscribed, reason: nil)
        let last = UInt64(live.devices.last!["device_seq"] as! String)!
        let own2 = BandOwnership(defaults: UserDefaults(suiteName: "mb-\(UUID().uuidString)")!); own2.nativeEnabled = true
        let l2 = FakeLive(); let b2 = FakeBand(); let m2 = make(b2, l2, own2)
        XCTAssertTrue(m2.recoverOnLaunch())
        m2.bandLink(didChange: .subscribed, reason: nil)
        XCTAssertGreaterThan(UInt64(l2.devices.last!["device_seq"] as! String)!, last, "재시작 후 같은 seq 면 서버가 duplicate 로 버린다")
    }

    // MARK: registerCredential

    func testRegisterCredentialResultCarriesOnlyOpaqueHandle() throws {
        let store = InMemoryCredentialStore()
        let req = NativeBridgeAPI.parseRegisterCredential(["accountId": "acct-1", "accessToken": "SECRET-A", "refreshToken": "SECRET-R",
                                                           "apiBase": "https://api.example.test/api/v1", "callbackId": "1"])!
        let h = try store.save(Credential(accountId: req.accountId, accessToken: req.accessToken, refreshToken: req.refreshToken, apiBase: req.apiBase))
        let r = NativeBridgeAPI.registerCredentialResult(handle: h)
        XCTAssertEqual(Array(r.keys), ["credentialHandle"])
        let json = String(data: try JSONSerialization.data(withJSONObject: r), encoding: .utf8)!
        XCTAssertFalse(json.contains("SECRET"))
        XCTAssertNil(NativeBridgeAPI.parseRegisterCredential(["accountId": "a", "accessToken": "", "refreshToken": "r", "apiBase": "x"]))
        // 이후 manager 의 snapshot·이벤트에도 토큰이 없다
        var evs: [[String: Any]] = []; m.onBridgeEvent = { evs.append($0) }
        _ = try m.startMeasurement(sessionId: sid, credentialHandle: h, configHash: String(repeating: "a", count: 64), requestId: req_())
        let all = String(data: try JSONSerialization.data(withJSONObject: ["s": m.snapshot(), "e": evs]), encoding: .utf8)!
        XCTAssertFalse(all.contains("SECRET"))
    }
    func req_() -> String { req }

    // MARK: T12 — startMeasurement peripheralId(웹뷰 BLE 로 선택된 장치 이어받기)

    func testStartWithPeripheralIdPassesItToBand() throws {
        let pid = UUID()
        _ = try m.startMeasurement(sessionId: sid, credentialHandle: "cred_handle_AbCdEfGh0123", configHash: String(repeating: "a", count: 64), requestId: req, peripheralId: pid.uuidString)
        XCTAssertEqual(band.lastExpected, pid)
    }
    func testStartWithoutPeripheralIdKeepsScan() throws {
        _ = try m.startMeasurement(sessionId: sid, credentialHandle: "cred_handle_AbCdEfGh0123", configHash: String(repeating: "a", count: 64), requestId: req)
        XCTAssertEqual(band.connects, 1)
        XCTAssertNil(band.lastExpected)
    }
    func testStartWithInvalidPeripheralIdFallsBackToScan() throws {
        _ = try m.startMeasurement(sessionId: sid, credentialHandle: "cred_handle_AbCdEfGh0123", configHash: String(repeating: "a", count: 64), requestId: req, peripheralId: "not-a-uuid")
        XCTAssertNil(band.lastExpected)
    }
    func testPeripheralIdDoesNotLeakFromPreviousStart() throws {
        _ = try m.startMeasurement(sessionId: sid, credentialHandle: "cred_handle_AbCdEfGh0123", configHash: String(repeating: "a", count: 64), requestId: req, peripheralId: UUID().uuidString)
        _ = try m.stopMeasurement(reason: "user_stop", requestId: "0000002e-0000-4000-8000-00000000002e")
        band.lastExpected = nil
        _ = try m.startMeasurement(sessionId: sid, credentialHandle: "cred_handle_AbCdEfGh0123", configHash: String(repeating: "a", count: 64), requestId: "0000003e-0000-4000-8000-00000000003e")
        XCTAssertNil(band.lastExpected, "peripheralId 를 안 주면 이전 값이 아니라 스캔")
    }

    // MARK: T12 시간축 — window_*_us 와 reanchor monotonic_us 가 같은 축(wall_ms·1000 + 단조 경과)

    func testWindowEndUsSharesAxisWithReanchorMonotonicUs() throws {
        try startAndAdopt()
        feed(0..<300)
        let ws = windows()
        let lastEnd = ws.compactMap { U64.parse($0["window_end_us"]) }.max()!
        let lastArrival = EngineTests.packets[0..<300].map { $0.arrivalUs }.max()!
        // 기대 축: anchor wall(1_760_000_000_000ms)·1000 + (도착 단조 − anchor 단조 5_000_000)
        let expected = UInt64(1_760_000_000_000) * 1000 + (lastArrival - 5_000_000)
        let diff = lastEnd > expected ? lastEnd - expected : expected - lastEnd
        XCTAssertLessThan(diff, 5_000_000, "창 끝은 도착 시각 축에서 5초 이내 — 다른 축이면 1e15 단위로 어긋난다")
        // reanchor 는 같은 축의 '현재' 값
        mono = lastArrival
        live.probes[0].done(.success(ClockProbeResult(probeId: "0000001f-0000-4000-8000-00000000001f", clientMonotonicUs: live.probes[0].us, serverReceiveMs: 1, serverSendMs: 2, rttSeconds: 0.01)))
        let mu = U64.parse((live.command("capture.reanchor")!["payload"] as! [String: Any])["monotonic_us"])!
        XCTAssertEqual(mu, expected, "reanchor monotonic_us 는 도착 시각 축 그대로")
        XCTAssertLessThan(mu > lastEnd ? mu - lastEnd : lastEnd - mu, 5_000_000)
    }
}
