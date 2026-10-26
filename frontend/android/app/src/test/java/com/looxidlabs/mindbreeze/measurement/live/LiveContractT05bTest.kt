package com.looxidlabs.mindbreeze.measurement.live

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/**
 * T08d — T05b 통합 계약(progress/t05.md 「T06/T07/T08 이 맞춰야 할 변경」) 맞춤 시험.
 * capture.start ACK result 채택 · u64 문자열 · metric 응답(격리/재시도) · device.changed 합집합 소비 · live:device 보고.
 */
class LiveContractT05bTest {
    @get:Rule val tmp = TemporaryFolder()

    private val sid = "00000001-0000-4000-8000-000000000001"
    private val pidSnapshot = "00000002-0000-4000-8000-000000000002"
    /** ACK 가 확정한 participant — snapshot audiences 값과 일부러 다르게 둬 출처를 구분한다. */
    private val pidAck = "00000003-0000-4000-8000-000000000003"
    private val stream = "00000014-0000-4000-8000-000000000014"
    private val stream2 = "00000015-0000-4000-8000-000000000015"
    private val snapId = "00000046-0000-4000-8000-000000000046"

    private class Env(val s: FakeScheduler, val t: FakeTransport, val tok: FakeTokens, val box: MetricOutbox, val live: LiveSession) {
        var wall = 1_760_000_000_000L
    }

    private fun env(file: File = File(tmp.root, "outbox-${System.nanoTime()}.log"), tokens: FakeTokens = FakeTokens(),
                    captureResult: (() -> JSONObject?)? = { defaultResult() }): Env {
        val sch = FakeScheduler(); val tr = FakeTransport(); val box = MetricOutbox(file) { sch.now }
        tr.acks["live:hello"] = { JSONObject("""{"ok":true,"protocol_version":2,"capabilities":[],"server_time_ms":1,"heartbeat_s":5,"state":"CONNECTING"}""") }
        tr.acks["live:join"] = { JSONObject("""{"ok":true,"snapshot_id":"$snapId","state":"RESYNCING","epoch":"1"}""") }
        tr.acks["live:applied"] = { JSONObject("""{"ok":true,"state":"READY"}""") }
        tr.acks["live:presence"] = { JSONObject("""{"ok":true,"lease_ttl_s":15}""") }
        tr.acks["live:command"] = { d ->
            val a = JSONObject().put("command_id", d.getString("command_id")).put("status", "applied").put("epoch", "1")
                .put("cursors", JSONArray()).put("committed", true)
            if (d.getString("kind") == "capture.start") captureResult?.invoke()?.let { a.put("result", it) }
            if (d.getString("kind") == "capture.renew") a.put("result", JSONObject().put("stream_id", d.getJSONObject("payload").getString("stream_id"))
                .put("generation", "3").put("owner_generation", "3").put("lease", JSONObject().put("expires_at_ms", 1760000099000L)))
            a
        }
        val cfg = LiveConfig(sessionId = sid, instanceId = "00000050-0000-4000-8000-000000000050", appBuild = "android-test", coreVersion = "core-1.0.0",
            deviceProfile = "linkband2-v1", algorithmVersion = "web-ts-1", modelVersion = "b0-cohort-2")
        lateinit var e: Env
        val live = LiveSession(cfg, tr, sch, tokens, box, wallMs = { e.wall })
        e = Env(sch, tr, tokens, box, live)
        return e
    }

    private fun defaultResult(gen: Any = "3", streamId: String = stream) = JSONObject().put("stream_id", streamId).put("participant_id", pidAck)
        .put("generation", gen).put("owner_generation", gen)
        .put("lease", JSONObject().put("expires_at_ms", 1760000030000L).put("offline_bound_until_ms", 1760000600000L)).put("clock_uncertain", true)

    private fun snapshot() = JSONObject("""{"protocol_version":2,"schema_version":1,"snapshot_id":"$snapId","request_id":"00000047-0000-4000-8000-000000000047","connection_generation":"1","session_id":"$sid","epoch":"1","audiences":["member:$pidSnapshot","public"],"through":[{"audience":"public","domain":"session","seq":"7"}],"server_time_ms":"1760000000000","auth_revision":"4","participation":{"entities":{},"tombstones":[]},"devices":{"entities":{},"tombstones":[]},"terminal":false}""")

    private fun toReady(e: Env) {
        e.live.start(); e.t.open()
        e.t.server("live:snapshot", snapshot())
        e.t.server("live:sync_complete", JSONObject("""{"snapshot_id":"$snapId"}"""))
        assertEquals(LiveState.READY, e.live.state)
    }

    private fun toCapturing(e: Env) { toReady(e); e.live.startCapture() }

    private fun frame(seq: Long) = JSONObject("""{"sequence":"$seq","window_start_us":"${seq * 1000000L}","window_end_us":"${(seq + 1) * 1000000L}","observed_at_ms":1760000000000,"sqi":0.8,"contact":{"fp1":"contact","fp2":"contact"},"metrics":{},"feature_hash":"${"a".repeat(64)}"}""")

    private var devSeq = 1
    private fun deviceEvent(payload: String, entity: String = pidAck) = JSONObject("""{"protocol_version":2,"schema_version":1,"event_id":"0000003c-0000-4000-8000-0000000000${"%02x".format(devSeq)}","session_id":"$sid","epoch":"1","audience":"member:$entity","domain":"device","seq":"${devSeq++}","entity_id":"$entity","entity_version":"2","kind":"device.changed","observed_at_ms":null,"received_at_server_ms":1,"payload":$payload}""")

    private fun metricAcks(status: (String) -> Pair<String, String?>): (JSONObject) -> JSONObject = { d ->
        val acks = JSONArray()
        val ws = d.getJSONArray("windows")
        for (i in 0 until ws.length()) {
            val w = ws.getJSONObject(i); val (st, code) = status(w.getString("sequence"))
            acks.put(JSONObject().put("session_id", sid).put("participant_id", w.getString("participant_id")).put("stream_id", w.getString("stream_id"))
                .put("sequence", w.getString("sequence")).put("status", st).put("durable", st == "accepted" || st == "duplicate")
                .put("feature_hash", w.getString("feature_hash")).put("received_at_server_ms", 1).apply { if (code != null) put("code", code) })
        }
        JSONObject().put("protocol_version", 2).put("schema_version", 1).put("acks", acks)
    }

    private fun sentSequences(e: Env): List<String> = e.t.sentOf("live:metric").flatMap { m ->
        val w = m.getJSONArray("windows"); (0 until w.length()).map { w.getJSONObject(it).getString("sequence") }
    }

    // ------------------------------------------------------------------ 1. capture.start ACK result
    @Test fun captureStartAckResultIsAdoptedWithoutDeviceChanged() {
        val e = env(); toCapturing(e)
        assertEquals(stream, e.live.streamId)
        assertEquals(pidAck, e.live.participantId)
        assertEquals("3", e.live.ownerGeneration)
        assertEquals(1760000030000L, e.live.leaseExpiresAtMs)
        e.t.acks["live:metric"] = metricAcks { "accepted" to null }
        e.live.onFrame(frame(1))
        val w = e.t.sentOf("live:metric").single().getJSONArray("windows").getJSONObject(0)
        assertEquals("metric participant_id 는 ACK result 값", pidAck, w.getString("participant_id"))
        assertEquals(stream, w.getString("stream_id")); assertEquals("3", w.getString("stream_generation"))
    }

    @Test fun snapshotAudiencesNoLongerSetParticipant() {
        val e = env(); toReady(e)
        assertNull("participant_id 는 snapshot audiences 에서 뽑지 않는다", e.live.participantId)
    }

    @Test fun deviceChangedAloneDoesNotStartMetricSending() {
        val e = env(captureResult = null); toReady(e)
        e.t.server("live:event", deviceEvent("""{"stream_id":"$stream","generation":"3","status":"active","clock_uncertain":true,"cutoff_code":null}"""))
        e.live.onFrame(frame(1)); e.live.pump()
        assertTrue(e.t.sentOf("live:metric").isEmpty())
        assertNull(e.live.streamId)
    }

    @Test fun generationMustBeU64DecimalString() {
        for ((gen, adopted) in listOf<Pair<Any, Boolean>>(3 to false, "03" to false, "18446744073709551616" to false, "-1" to false,
                "18446744073709551615" to true, "0" to true)) {
            val e = env(captureResult = { defaultResult(gen) }); toCapturing(e)
            if (adopted) assertEquals("gen=$gen", gen, e.live.ownerGeneration) else {
                assertNull("gen=$gen 은 채택하지 않음", e.live.streamId); assertNull("gen=$gen", e.live.ownerGeneration)
            }
        }
    }

    @Test fun sequenceAboveInt31IsNotQueued() {
        val e = env(); toReady(e)
        e.live.onFrame(frame(2147483647L)); e.live.onFrame(frame(2147483648L))
        assertTrue(e.box.contains(2147483647L)); assertFalse(e.box.contains(2147483648L))
        assertEquals(1L, e.box.quarantinedByCode()["sequence_out_of_range"])
    }

    // ------------------------------------------------------------------ 2. live:metric 응답
    @Test fun rejectedWindowsAreQuarantinedAndNeverResent() {
        val e = env(); toCapturing(e)
        e.t.acks["live:metric"] = metricAcks { s -> when (s) { "1" -> "rejected" to "stale_owner_generation"; "2" -> "accepted" to null; else -> "retryable" to "db_busy" } }
        for (i in 1L..3L) e.live.onFrame(frame(i))
        e.s.advance(10_000)
        val sent = sentSequences(e)
        assertEquals("거절 창 1 은 한 번만 전송: $sent", 1, sent.count { it == "1" })
        assertTrue("retryable 3 은 재전송: $sent", sent.count { it == "3" } >= 2)
        assertFalse(e.box.contains(1)); assertFalse(e.box.contains(2)); assertTrue(e.box.contains(3))
        assertEquals("rejected 는 acked 로 세지 않음", 1L, e.box.acked())
        assertEquals(1L, e.box.quarantined())
        assertEquals(1L, e.box.quarantinedByCode()["stale_owner_generation"])
    }

    @Test fun batchNotReadyAndIngestUnavailableAreRetriedWithoutLoss() {
        for (code in listOf("not_ready", "metric_ingest_unavailable")) {
            val e = env(); toCapturing(e)
            var calls = 0
            e.t.acks["live:metric"] = { d -> if (calls++ == 0) JSONObject().put("ok", false).put("code", code).put("retryable", true).put("retry_after_ms", 500) else metricAcks { "accepted" to null }(d) }
            e.live.onFrame(frame(1)); e.live.onFrame(frame(2))
            e.s.advance(1_000)
            assertEquals(code, 2, e.t.sentOf("live:metric").size)
            assertEquals(code, 0, e.box.size()); assertEquals(code, 0L, e.box.quarantined())
        }
    }

    @Test fun batchNonRetryableErrorQuarantinesBatchWithoutResend() {
        val e = env(); toCapturing(e)
        e.t.acks["live:metric"] = { JSONObject().put("ok", false).put("code", "invalid_field").put("retryable", false).put("field", "windows[0].metrics") }
        e.live.onFrame(frame(1)); e.live.onFrame(frame(2))
        e.s.advance(20_000)
        assertEquals("창마다 한 번만 전송(재전송 없음)", listOf("1", "2"), sentSequences(e))
        assertEquals(0, e.box.size())
        assertEquals(2L, e.box.quarantinedByCode()["invalid_field"])
    }

    @Test fun quarantineSurvivesRestartAndBlocksReAdd() {
        val f = File(tmp.root, "q.log")
        val b1 = MetricOutbox(f)
        for (i in 1L..3L) b1.add(i, frame(i))
        b1.quarantine(1, "participant_mismatch"); b1.ack(2); b1.close()
        val b2 = MetricOutbox(f)
        assertEquals(1, b2.size()); assertTrue(b2.contains(3))
        assertEquals(1L, b2.quarantined()); assertEquals(1L, b2.quarantinedByCode()["participant_mismatch"])
        b2.add(1, frame(1))
        assertFalse("격리된 순번은 재투입되지 않음", b2.contains(1))
    }

    // ------------------------------------------------------------------ 3. device.changed 합집합 / live:device
    @Test fun deviceChangedEndStatusOrCutoffStopsCaptureAndSeals() {
        for (payload in listOf(
            """{"stream_id":"$stream","generation":"3","status":"revoked","clock_uncertain":true,"cutoff_code":"consent_withdrawn"}""",
            """{"stream_id":"$stream","generation":"3","status":"ended","cutoff_code":"session_ended"}""",
            """{"stream_id":"$stream","generation":"3","status":"active","cutoff_code":"expelled","device_seq":"5","band_state":"connected"}""",
        )) {
            val e = env(); toCapturing(e)
            val ended = ArrayList<Pair<String, String?>>()
            e.live.onStreamEnded = { st, code -> ended += st to code }
            e.t.server("live:event", deviceEvent(payload))
            val p = JSONObject(payload)
            assertEquals(payload, listOf(p.getString("status") to p.optString("cutoff_code").ifEmpty { null }), ended)
            assertNull(e.live.streamId)
            assertEquals(p.getString("status"), e.live.streamEnded)
            e.live.onFrame(frame(1)); e.live.pump()
            assertTrue("종료 후 live 송신 없음", e.t.sentOf("live:metric").isEmpty())
        }
    }

    @Test fun newerGenerationOnOtherStreamSupersedesOurs() {
        val e = env(); toCapturing(e)
        val ended = ArrayList<String>()
        e.live.onStreamEnded = { st, _ -> ended += st }
        e.t.server("live:event", deviceEvent("""{"stream_id":"$stream2","generation":"2","status":"active","cutoff_code":null}"""))
        assertEquals("구 세대 이벤트는 무시", stream, e.live.streamId)
        e.t.server("live:event", deviceEvent("""{"stream_id":"$stream2","generation":"18446744073709551615","status":"active","cutoff_code":null}"""))
        assertEquals(listOf("superseded"), ended)
        assertNull(e.live.streamId)
    }

    @Test fun deviceChangedForOtherParticipantOrBadGenerationIsIgnored() {
        val e = env(); toCapturing(e)
        var ended = 0
        e.live.onStreamEnded = { _, _ -> ended++ }
        e.t.server("live:event", deviceEvent("""{"stream_id":"$stream","generation":"3","status":"revoked","cutoff_code":"expelled"}""", entity = pidSnapshot))
        e.t.server("live:event", deviceEvent("""{"stream_id":"$stream2","generation":9,"status":"active","cutoff_code":null}"""))
        assertEquals(0, ended); assertEquals(stream, e.live.streamId); assertEquals("3", e.live.ownerGeneration)
        // 밴드 필드만 있는(stream 수명 필드 부재) 이벤트도 종료로 오해하지 않는다
        e.t.server("live:event", deviceEvent("""{"stream_id":"$stream","device_seq":"7","band_state":"lost"}"""))
        assertEquals(0, ended); assertEquals(stream, e.live.streamId)
    }

    @Test fun endedStreamIsNotRecapturedAutomatically() {
        val e = env(); toCapturing(e)
        e.t.server("live:event", deviceEvent("""{"stream_id":"$stream","generation":"3","status":"ended","cutoff_code":"session_ended"}"""))
        val before = e.t.sentOf("live:command").count { it.getString("kind") == "capture.start" }
        assertNull(e.live.startCaptureIfAllowed())
        assertEquals(before, e.t.sentOf("live:command").count { it.getString("kind") == "capture.start" })
    }

    @Test fun deviceReportsCarryMonotonicSeqAndWireShape() {
        val e = env(); toCapturing(e)
        e.t.acks["live:device"] = { d -> JSONObject().put("ok", true).put("stream_id", d.getString("stream_id")).put("device_seq", d.getString("device_seq")).put("status", "accepted").put("durable", true) }
        val contact = JSONObject("""{"fp1":"contact","fp2":"no_contact"}""")
        e.live.reportDevice("connected", contact, 0.7, 80, null)
        e.live.reportDevice("connected", contact, 0.7, 80, null) // 같은 ms
        e.wall -= 60_000 // 벽시계가 뒤로 가도 단조
        e.live.reportDevice("reconnecting", contact, null, null, "ble_disconnect")
        val sent = e.t.sentOf("live:device")
        assertEquals(3, sent.size)
        val seqs = sent.map { it.getString("device_seq").toULong() }
        assertTrue("단조 증가 $seqs", seqs.zipWithNext().all { (a, b) -> b > a })
        val m = sent[0]
        assertEquals(setOf("protocol_version", "schema_version", "session_id", "stream_id", "device_seq", "band_state", "contact", "sqi", "battery_pct", "state_reason"), m.keys().asSequence().toSet())
        assertEquals(stream, m.getString("stream_id")); assertEquals(sid, m.getString("session_id"))
        assertTrue(sent[2].isNull("sqi")); assertEquals("ble_disconnect", sent[2].getString("state_reason"))
    }

    @Test fun streamNotActiveStopsDeviceReporting() {
        val e = env(); toCapturing(e)
        e.t.acks["live:device"] = { JSONObject().put("ok", false).put("code", "stream_not_active").put("retryable", false) }
        val c = JSONObject("""{"fp1":"contact","fp2":"contact"}""")
        e.live.reportDevice("connected", c, 0.9, 50, null)
        e.s.advance(10_000)
        e.live.reportDevice("connected", c, 0.9, 50, null)
        assertEquals(1, e.t.sentOf("live:device").size)
    }

    @Test fun deviceReportRetriesOnNotReadyAndSendsLatestAfterReady() {
        val e = env(); toCapturing(e)
        var calls = 0
        e.t.acks["live:device"] = { d -> if (calls++ == 0) JSONObject().put("ok", false).put("code", "not_ready").put("retryable", true).put("retry_after_ms", 500)
            else JSONObject().put("ok", true).put("stream_id", d.getString("stream_id")).put("device_seq", d.getString("device_seq")).put("status", "accepted").put("durable", true) }
        val c = JSONObject("""{"fp1":"contact","fp2":"contact"}""")
        e.live.reportDevice("connected", c, 0.9, 50, null)
        e.s.advance(1_000)
        assertEquals(2, e.t.sentOf("live:device").size)
        e.s.advance(10_000)
        assertEquals("확정 후 재전송 없음", 2, e.t.sentOf("live:device").size)
    }

    @Test fun terminalOrAccessRevokedWhileCapturingEndsStream() {
        // 실측: session.end 시 live:terminal 이 device.changed 보다 먼저 오면 TERMINAL 상태라 이벤트가 버려져 측정이 계속됐다
        for ((name, payload, expect) in listOf(
            Triple("live:terminal", """{"code":"session_ended","revision":"6","end_cutoff_ms":"1760000100000"}""", "ended" to "session_ended"),
            Triple("live:access_revoked", """{"code":"expelled","revision":"5"}""", "revoked" to "expelled"),
        )) {
            val e = env(); toCapturing(e)
            val ended = ArrayList<Pair<String, String?>>()
            e.live.onStreamEnded = { st, c -> ended += st to c }
            e.t.server(name, JSONObject(payload))
            assertEquals(name, listOf(expect), ended)
            assertEquals(expect.first, e.live.streamEnded); assertNull(e.live.streamId)
            e.t.server("live:event", deviceEvent("""{"stream_id":"$stream","generation":"3","status":"ended","cutoff_code":"completed"}"""))
            assertEquals("중복 종료 신호 없음", 1, ended.size)
        }
    }

    // ------------------------------------------------------------------ lease 갱신(실측 결함: renew 없으면 30초 뒤 lease 만료)
    private fun Env.alive(ms: Long) { var left = ms; while (left > 0) { val st = minOf(left, 4_000L); s.advance(st); left -= st
        t.server("live:heartbeat", JSONObject("""{"epoch":"1","through":[],"auth_revision":"4","server_time_ms":1}""")) } }

    @Test fun captureLeaseIsRenewedBeforeExpiryAndStopsAfterStreamEnds() {
        val e = env(); toCapturing(e)
        e.alive(25_000)
        val renews = e.t.sentOf("live:command").filter { it.getString("kind") == "capture.renew" }
        assertTrue("30초 lease 안에 2회 이상 갱신: ${renews.size}", renews.size >= 2)
        val p = renews.first().getJSONObject("payload")
        assertEquals(stream, p.getString("stream_id")); assertEquals("3", p.getString("owner_generation"))
        assertTrue(p.getString("clock_anchor_id").matches(Regex("^[0-9a-f-]{36}$")))
        assertEquals("renew ACK lease 반영", 1760000099000L, e.live.leaseExpiresAtMs)
        e.t.server("live:event", deviceEvent("""{"stream_id":"$stream","generation":"3","status":"ended","cutoff_code":"session_ended"}"""))
        val n = e.t.sentOf("live:command").count { it.getString("kind") == "capture.renew" }
        e.alive(30_000)
        assertEquals("종료 후 갱신 없음", n, e.t.sentOf("live:command").count { it.getString("kind") == "capture.renew" })
    }

    // ------------------------------------------------------------------ 4. 토큰 비노출
    @Test fun tokensNeverAppearInBridgeBoundEventsOrAcks() {
        val e = env(tokens = FakeTokens("tok-secret-1").apply { next = RefreshOutcome.Ok("tok-secret-2") })
        e.t.acks["live:reauth"] = { JSONObject("""{"ok":true}""") }
        toCapturing(e)
        e.t.server("live:auth_expired", JSONObject("""{"refresh":true}"""))
        e.t.server("live:access_revoked", JSONObject("""{"code":"expelled","revision":"5"}"""))
        val out = ArrayList<JSONObject>(); e.live.events.drainTo(out); e.live.acks.drainTo(out)
        assertTrue(out.isNotEmpty())
        val txt = out.joinToString("\n")
        assertFalse(txt, txt.contains("tok-secret"))
    }
}
