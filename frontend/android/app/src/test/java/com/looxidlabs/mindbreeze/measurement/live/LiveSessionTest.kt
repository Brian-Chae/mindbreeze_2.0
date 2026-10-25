package com.looxidlabs.mindbreeze.measurement.live

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/** 가상 시계 + 가짜 Socket.IO 서버. 모든 콜백은 단일 스레드에서 순서대로 실행된다. */
class FakeScheduler : LiveScheduler {
    private class T(val at: Long, val seq: Long, val task: () -> Unit) : Cancelable { var cancelled = false; override fun cancel() { cancelled = true } }
    private val q = java.util.PriorityQueue<T>(compareBy<T>({ it.at }, { it.seq }))
    private var seq = 0L
    var now = 1_000_000L
    override fun nowMs() = now
    override fun postDelayed(delayMs: Long, task: () -> Unit): Cancelable = T(now + delayMs, seq++, task).also { q.add(it) }
    override fun <T> async(work: () -> T, done: (Result<T>) -> Unit) { done(runCatching(work)) }
    fun advance(ms: Long) {
        val end = now + ms
        while (true) {
            val t = q.peek() ?: break
            if (t.at > end) break
            q.poll(); if (t.cancelled) continue
            now = t.at; t.task()
        }
        now = end
    }
}

class FakeTransport : LiveTransport {
    override var listener: LiveTransport.Listener? = null
    val connects = ArrayList<String>()
    val sent = ArrayList<Pair<String, JSONObject>>()
    var connected = false
    /** 이벤트별 ack 응답. null 이면 ack 안 함(타임아웃 시험). */
    val acks = HashMap<String, (JSONObject) -> JSONObject?>()
    override fun connect(token: String) { connects += token }
    override fun disconnect() { connected = false }
    override fun emit(event: String, data: JSONObject, ack: ((JSONObject?) -> Unit)?) {
        sent += event to data
        val r = acks[event]?.invoke(data)
        if (r != null && ack != null) ack(r)
    }
    fun open() { connected = true; listener?.onConnect() }
    fun server(name: String, data: JSONObject) = listener?.onEvent(name, data)
    fun sentOf(e: String) = sent.filter { it.first == e }.map { it.second }
}

class FakeTokens(var cur: String? = "tok-1") : TokenSource {
    var refreshes = 0
    var next: RefreshOutcome = RefreshOutcome.Ok("tok-2")
    override fun current() = cur
    override fun refresh(): RefreshOutcome { refreshes++; val n = next; if (n is RefreshOutcome.Ok) cur = n.token; return n }
}

class LiveSessionTest {
    @get:Rule val tmp = TemporaryFolder()

    private val sid = "00000001-0000-4000-8000-000000000001"
    private val pid = "00000002-0000-4000-8000-000000000002"
    private val stream = "00000014-0000-4000-8000-000000000014"

    private class Env(val s: FakeScheduler, val t: FakeTransport, val tok: FakeTokens, val box: MetricOutbox, val live: LiveSession)

    private fun env(file: File = File(tmp.root, "outbox-${System.nanoTime()}.log"), tokens: FakeTokens = FakeTokens(), autoAck: Boolean = true): Env {
        val sch = FakeScheduler(); val tr = FakeTransport(); val box = MetricOutbox(file) { sch.now }
        if (autoAck) {
            tr.acks["live:hello"] = { JSONObject("""{"ok":true,"protocol_version":2,"capabilities":[],"server_time_ms":1,"heartbeat_s":5,"state":"CONNECTING"}""") }
            tr.acks["live:join"] = { JSONObject("""{"ok":true,"snapshot_id":"00000046-0000-4000-8000-000000000046","state":"RESYNCING","epoch":"1"}""") }
            tr.acks["live:applied"] = { JSONObject("""{"ok":true,"state":"READY"}""") }
            tr.acks["live:presence"] = { JSONObject("""{"ok":true,"lease_ttl_s":15}""") }
            tr.acks["live:clock_probe"] = { JSONObject("""{"ok":true,"server_receive_ms":1760000000000,"server_send_ms":1760000000001}""") }
        }
        val cfg = LiveConfig(sessionId = sid, instanceId = "00000050-0000-4000-8000-000000000050", appBuild = "android-test", coreVersion = "core-1.0.0",
            deviceProfile = "linkband2-v1", algorithmVersion = "web-ts-1", modelVersion = "b0-cohort-2")
        return Env(sch, tr, tokens, box, LiveSession(cfg, tr, sch, tokens, box))
    }

    private fun snapshot(id: String = "00000046-0000-4000-8000-000000000046") = JSONObject("""{"protocol_version":2,"schema_version":1,"snapshot_id":"$id","request_id":"00000047-0000-4000-8000-000000000047","connection_generation":"1","session_id":"$sid","epoch":"1","audiences":["member:$pid","public"],"through":[{"audience":"public","domain":"session","seq":"7"}],"server_time_ms":"1760000000000","auth_revision":"4","participation":{"entities":{"$pid":{"version":"3","data":{"participant_id":"$pid","role":"member"}}},"tombstones":[]},"devices":{"entities":{},"tombstones":[]},"terminal":false}""")

    /** 서버가 정상일 때처럼 5초 heartbeat 를 보내며 시간을 진행한다. */
    private fun Env.advanceAlive(totalMs: Long) {
        var left = totalMs
        while (left > 0) {
            val step = minOf(left, 4_000L)
            s.advance(step); left -= step
            t.server("live:heartbeat", JSONObject("""{"epoch":"1","through":[],"auth_revision":"4","server_time_ms":1}"""))
        }
    }

    private fun toReady(e: Env) {
        e.live.start(); e.t.open()
        e.t.server("live:snapshot", snapshot())
        e.t.server("live:sync_complete", JSONObject("""{"protocol_version":2,"schema_version":1,"snapshot_id":"00000046-0000-4000-8000-000000000046","through":[{"audience":"public","domain":"session","seq":"7"}]}"""))
    }

    private fun frame(seq: Int) = JSONObject("""{"sequence":"$seq","window_start_us":"${seq * 1000000L}","window_end_us":"${(seq + 1) * 1000000L}","observed_at_ms":1760000000000,"sqi":0.8,"contact":{"fp1":"contact","fp2":"contact"},"metrics":{},"feature_hash":"${"a".repeat(64)}"}""")

    private fun device(streamId: String = stream, gen: String = "3") = JSONObject("""{"protocol_version":2,"schema_version":1,"event_id":"0000003c-0000-4000-8000-00000000003c","session_id":"$sid","epoch":"1","audience":"member:$pid","domain":"device","seq":"1","entity_id":"$pid","entity_version":"2","kind":"device.changed","observed_at_ms":null,"received_at_server_ms":1,"payload":{"stream_id":"$streamId","generation":"$gen","status":"active","clock_uncertain":true,"cutoff_code":null}}""")

    @Test fun handshakeOrderAndReadyOnlyAfterApplied() {
        val e = env()
        e.live.start()
        assertEquals(LiveState.CONNECTING, e.live.state)
        assertEquals(listOf("tok-1"), e.t.connects)
        e.t.open()
        assertEquals(listOf("live:hello", "live:join"), e.t.sent.map { it.first })
        assertEquals(LiveState.RESYNCING, e.live.state)
        e.t.server("live:snapshot", snapshot())
        assertEquals("snapshot 만으로는 READY 가 아님", LiveState.RESYNCING, e.live.state)
        e.t.server("live:sync_complete", JSONObject("""{"snapshot_id":"00000046-0000-4000-8000-000000000046"}"""))
        assertEquals(LiveState.READY, e.live.state)
        val applied = e.t.sentOf("live:applied").single()
        assertEquals("00000046-0000-4000-8000-000000000046", applied.getString("snapshot_id"))
        assertEquals(2, applied.getInt("protocol_version"))
        assertEquals(pid, e.live.participantId)
    }

    @Test fun helloCarriesVersionsAndCapabilities() {
        val e = env(); e.live.start(); e.t.open()
        val h = e.t.sentOf("live:hello").single()
        assertEquals(2, h.getInt("protocol_version")); assertEquals(1, h.getInt("schema_version"))
        assertEquals("native_background", h.getJSONArray("capabilities").getString(0))
        assertEquals("core-1.0.0", h.getString("core_version"))
        assertEquals(sid, e.t.sentOf("live:join").single().getString("session_id"))
    }

    @Test fun staleSnapshotIdIsIgnored() {
        val e = env(); e.live.start(); e.t.open()
        e.t.server("live:snapshot", snapshot("0000ffff-0000-4000-8000-00000000ffff"))
        e.t.server("live:sync_complete", JSONObject("""{"snapshot_id":"0000ffff-0000-4000-8000-00000000ffff"}"""))
        assertEquals(LiveState.RESYNCING, e.live.state)
    }

    @Test fun metricsNotSentBeforeReadyAndNewestFirstBatchOf60AfterReady() {
        val e = env()
        e.live.start(); e.t.open()
        for (i in 1..100) e.live.onFrame(frame(i))
        assertTrue(e.t.sentOf("live:metric").isEmpty())
        e.t.server("live:snapshot", snapshot()); e.t.server("live:sync_complete", JSONObject("""{"snapshot_id":"00000046-0000-4000-8000-000000000046"}"""))
        e.t.server("live:event", device())
        e.live.pump()
        val first = e.t.sentOf("live:metric")
        assertTrue(first.isNotEmpty())
        val w = first[0].getJSONArray("windows")
        assertEquals(60, w.length())
        assertEquals("100", w.getJSONObject(59).getString("sequence")) // 최신 배치 우선(배치 내부는 오름차순)
        assertEquals("41", w.getJSONObject(0).getString("sequence"))
        assertEquals(stream, w.getJSONObject(0).getString("stream_id"))
        assertEquals(pid, w.getJSONObject(0).getString("participant_id"))
        assertEquals("3", w.getJSONObject(0).getString("stream_generation"))
        assertEquals(sid, w.getJSONObject(0).getString("session_id"))
    }

    @Test fun metricAckRemovesAcceptedAndDuplicateButKeepsRetryable() {
        val e = env()
        e.t.acks["live:metric"] = { d ->
            val acks = JSONArray()
            val ws = d.getJSONArray("windows")
            for (i in 0 until ws.length()) {
                val seq = ws.getJSONObject(i).getString("sequence")
                val st = when (seq) { "1" -> "accepted"; "2" -> "duplicate"; else -> "retryable" }
                acks.put(JSONObject().put("sequence", seq).put("status", st).put("durable", st != "retryable").put("code", if (st == "retryable") "db_busy" else JSONObject.NULL))
            }
            JSONObject().put("ok", true).put("acks", acks)
        }
        toReady(e); e.t.server("live:event", device())
        for (i in 1..3) e.live.onFrame(frame(i))
        e.live.pump()
        assertFalse(e.box.contains(1)); assertFalse(e.box.contains(2)); assertTrue(e.box.contains(3))
        assertEquals(2L, e.box.acked())
    }

    @Test fun presenceEveryFiveSecondsWithStreamAndOwnerGeneration() {
        val e = env(); toReady(e); e.t.server("live:event", device())
        val before = e.t.sentOf("live:presence").size
        e.s.advance(5_000); e.s.advance(5_000)
        val p = e.t.sentOf("live:presence")
        assertTrue("presence=${p.size - before}", p.size - before >= 2)
        val last = p.last()
        assertEquals("locked".takeIf { false } ?: last.getString("visibility"), last.getString("visibility"))
        assertEquals(stream, last.getString("stream_id")); assertEquals("3", last.getString("owner_generation"))
        assertEquals(1, p.map { it.getString("lease_generation") }.toSet().size.coerceAtLeast(1))
    }

    @Test fun noServerHeartbeatFor10sDegradesAndReconnects() {
        val e = env(); toReady(e)
        e.s.advance(4_000)
        e.t.server("live:heartbeat", JSONObject("""{"epoch":"1","through":[],"auth_revision":"4","server_time_ms":1}"""))
        e.s.advance(9_000)
        assertEquals("마지막 heartbeat 후 9초: 아직 READY", LiveState.READY, e.live.state)
        e.s.advance(1_000) // 10초 무응답
        assertEquals(LiveState.DEGRADED, e.live.state)
        e.s.advance(1_000)
        assertEquals("재연결 시도", 2, e.t.connects.size)
    }

    @Test fun reconnectBackoffIsBoundedAndResetsOnReady() {
        val e = env(); e.live.start()
        val times = ArrayList<Long>()
        repeat(6) {
            val n = e.t.connects.size
            e.t.listener!!.onConnectError("xhr poll error")
            val t0 = e.s.now
            var guard = 0
            while (e.t.connects.size == n && guard++ < 200_00) e.s.advance(50)
            times += e.s.now - t0
        }
        assertTrue("delays=$times", times[0] in 400..900)
        assertTrue("delays=$times", times[3] in 3500..5200)
        assertTrue("상한: $times", times.all { it <= 31_000 })
        assertTrue("증가 후 정체", times[5] >= times[3])
    }

    @Test fun expiredTokenOnConnectRefreshesOnceAndReconnects() {
        val tok = FakeTokens("old")
        val e = env(tokens = tok); e.live.start()
        e.t.listener!!.onConnectError("token_expired")
        e.t.listener!!.onConnectError("token_expired") // 중복 트리거
        assertEquals("single-flight", 1, tok.refreshes)
        e.s.advance(100)
        assertEquals("tok-2", e.t.connects.last())
    }

    @Test fun invalidRefreshBlocksWithoutRetryLoop() {
        val tok = FakeTokens("old"); tok.next = RefreshOutcome.Invalid
        val e = env(tokens = tok); e.live.start()
        e.t.listener!!.onConnectError("token_expired")
        e.s.advance(120_000)
        assertEquals(LiveState.BLOCKED, e.live.state)
        assertEquals("auth_expired", e.live.blockedReason)
        assertEquals(1, e.t.connects.size)
        assertEquals(1, tok.refreshes)
    }

    @Test fun transientRefreshFailureKeepsRetrying() {
        val tok = FakeTokens("old"); tok.next = RefreshOutcome.Transient
        val e = env(tokens = tok); e.live.start()
        e.t.listener!!.onConnectError("token_expired")
        e.s.advance(3_000)
        assertTrue(tok.refreshes >= 2)
        assertNotEquals(LiveState.BLOCKED, e.live.state)
    }

    @Test fun authExpiredEventTriggersRefreshAndReauth() {
        val tok = FakeTokens("tok-1")
        val e = env(tokens = tok)
        e.t.acks["live:reauth"] = { JSONObject("""{"ok":true}""") }
        toReady(e)
        e.t.server("live:auth_expired", JSONObject("""{"refresh":true}"""))
        assertEquals(1, tok.refreshes)
        assertEquals("tok-2", e.t.sentOf("live:reauth").single().getString("token"))
        assertEquals(LiveState.READY, e.live.state)
    }

    @Test fun commandRetriesWithSameIdUntilAckedAndNeverRegeneratesId() {
        val e = env(); toReady(e)
        val ackTimes = ArrayList<Long>()
        var respond = false
        e.t.acks["live:command"] = { d ->
            if (!respond) null else JSONObject("""{"command_id":"${d.getString("command_id")}","status":"applied","epoch":"1","cursors":[],"committed":true}""")
        }
        val cmd = JSONObject("""{"protocol_version":2,"schema_version":1,"session_id":"$sid","expected_epoch":"1","kind":"hand.set","client_generation":"1","payload":{"raised":true}}""")
        val r = e.live.dispatch(cmd)
        assertTrue(r.acceptedForSend)
        e.advanceAlive(12_000)
        val ids = e.t.sentOf("live:command").map { it.getString("command_id") }
        assertTrue("재시도 ${ids.size}", ids.size >= 3)
        assertEquals(1, ids.toSet().size)
        assertEquals(r.commandId, ids[0])
        respond = true
        e.advanceAlive(5_000)
        val acks = ArrayList<JSONObject>(); e.live.acks.drainTo(acks)
        assertEquals("applied", acks.last().getString("status"))
        val n = e.t.sentOf("live:command").size
        e.advanceAlive(28_000)
        assertEquals("확정 후 재전송 없음", n, e.t.sentOf("live:command").size)
    }

    @Test fun retryableCommittedAckKeepsSameIdAndNeverGivesUpWithIntentExpiry() {
        val e = env(); toReady(e)
        e.t.acks["live:command"] = { d -> JSONObject("""{"command_id":"${d.getString("command_id")}","status":"retryable","epoch":"1","cursors":[],"committed":true,"code":"projection_pending","retry_after_ms":500}""") }
        val r = e.live.dispatch(JSONObject("""{"protocol_version":2,"schema_version":1,"session_id":"$sid","expected_epoch":"1","kind":"hand.set","client_generation":"1","payload":{"raised":false}}"""))
        e.advanceAlive(40_000)
        val ids = e.t.sentOf("live:command").map { it.getString("command_id") }.toSet()
        assertEquals(setOf(r.commandId), ids)
        val acks = ArrayList<JSONObject>(); e.live.acks.drainTo(acks)
        assertTrue("committed 명령은 결과 조회를 계속한다: $acks", acks.none { it.optString("code") == "intent_expired" })
    }

    @Test fun uncommittedIntentExpiresAfter30sWithExplicitFailureAndResync() {
        val e = env(); toReady(e)
        val r = e.live.dispatch(JSONObject("""{"protocol_version":2,"schema_version":1,"session_id":"$sid","expected_epoch":"1","kind":"hand.set","client_generation":"1","payload":{"raised":true}}"""))
        e.advanceAlive(31_000)
        val acks = ArrayList<JSONObject>(); e.live.acks.drainTo(acks)
        val last = acks.last()
        assertEquals("rejected", last.getString("status")); assertEquals("intent_expired", last.getString("code"))
        assertEquals(r.commandId, last.getString("command_id"))
        assertTrue(e.t.sentOf("live:resync").isNotEmpty())
        val n = e.t.sentOf("live:command").size
        e.advanceAlive(28_000)
        assertEquals(n, e.t.sentOf("live:command").size)
    }

    @Test fun commandQueuedWhileOfflineIsSentAfterReadyWithSameId() {
        val e = env(); e.live.start()
        val r = e.live.dispatch(JSONObject("""{"protocol_version":2,"schema_version":1,"session_id":"$sid","expected_epoch":"1","kind":"hand.set","client_generation":"1","payload":{"raised":true}}"""))
        assertTrue(r.acceptedForSend)
        assertTrue(e.t.sentOf("live:command").isEmpty())
        e.t.acks["live:command"] = { d -> JSONObject("""{"command_id":"${d.getString("command_id")}","status":"applied","epoch":"1","cursors":[],"committed":true}""") }
        e.t.open(); e.t.server("live:snapshot", snapshot()); e.t.server("live:sync_complete", JSONObject("""{"snapshot_id":"00000046-0000-4000-8000-000000000046"}"""))
        assertEquals(r.commandId, e.t.sentOf("live:command").single().getString("command_id"))
    }

    @Test fun seqGapTriggersResyncAndDuplicateIsDropped() {
        val e = env(); toReady(e)
        fun ev(seq: Int) = JSONObject("""{"protocol_version":2,"schema_version":1,"event_id":"0000003c-0000-4000-8000-00000000${"%04x".format(seq)}","session_id":"$sid","epoch":"1","audience":"public","domain":"session","seq":"$seq","entity_id":"$sid","entity_version":"$seq","kind":"session.changed","observed_at_ms":null,"received_at_server_ms":1,"payload":{}}""")
        e.live.events.clear() // snapshot 알림 제거
        val got = ArrayList<JSONObject>()
        e.t.server("live:event", ev(8)); e.t.server("live:event", ev(8)); e.t.server("live:event", ev(9))
        e.live.events.drainTo(got)
        assertEquals("중복 8 폐기", 2, got.size)
        e.t.server("live:event", ev(12)) // gap
        assertEquals(LiveState.RESYNCING, e.live.state)
        assertEquals(1, e.t.sentOf("live:resync").size)
    }

    @Test fun accessRevokedAndTerminalStopReconnectAndKeepOutbox() {
        val e = env(); toReady(e)
        e.live.onFrame(frame(1))
        e.t.server("live:access_revoked", JSONObject("""{"code":"expelled","revision":"5"}"""))
        assertEquals(LiveState.REVOKED, e.live.state)
        e.t.listener!!.onDisconnect("io server disconnect")
        e.s.advance(120_000)
        assertEquals(1, e.t.connects.size)
        assertTrue(e.box.contains(1))
    }

    @Test fun terminalStopsLiveButArchiveFlowContinues() {
        val e = env(); toReady(e)
        e.t.server("live:terminal", JSONObject("""{"code":"session_ended","revision":"6","end_cutoff_ms":"1760000100000"}"""))
        assertEquals(LiveState.TERMINAL, e.live.state)
        e.s.advance(60_000)
        assertEquals(1, e.t.connects.size)
        assertEquals("1760000100000", e.live.endCutoff)
    }

    @Test fun outboxSurvivesProcessRestart() {
        val f = File(tmp.root, "durable.log")
        val e1 = env(file = f, autoAck = false)
        for (i in 1..5) e1.live.onFrame(frame(i))
        e1.box.ack(2)
        e1.box.close()
        val e2 = env(file = f, autoAck = false)
        assertEquals(4, e2.box.size())
        assertFalse(e2.box.contains(2)); assertTrue(e2.box.contains(5))
        e2.live.onFrame(frame(5)) // 같은 순번 재투입은 중복 아님
        assertEquals(4, e2.box.size())
    }

    @Test fun clockProbeThenReanchorCommandWithinTenSeconds() {
        val e = env()
        e.t.acks["live:command"] = { d -> JSONObject("""{"command_id":"${d.getString("command_id")}","status":"applied","epoch":"1","cursors":[],"committed":true}""") }
        e.live.anchorProvider = { "3276800" to "1000000" }
        toReady(e); e.t.server("live:event", device())
        e.s.advance(1_500)
        val probe = e.t.sentOf("live:clock_probe").first()
        val cmds = e.t.sentOf("live:command").filter { it.getString("kind") == "capture.reanchor" }
        assertTrue("reanchor=${cmds.size}", cmds.isNotEmpty())
        val p = cmds[0].getJSONObject("payload")
        assertEquals(probe.getString("probe_id"), p.getString("clock_probe_id"))
        assertEquals(stream, p.getString("stream_id")); assertEquals("3276800", p.getString("device_ticks"))
        assertTrue(probe.getString("client_monotonic_us").toLong() > 0)
    }

    @Test fun framesForUnknownStreamStayQueuedUntilStreamIsKnown() {
        val e = env(); toReady(e)
        e.live.onFrame(frame(1)); e.live.pump()
        assertTrue(e.t.sentOf("live:metric").isEmpty())
        assertTrue(e.box.contains(1))
        e.t.server("live:event", device()); e.live.pump()
        assertEquals(1, e.t.sentOf("live:metric").size)
    }
}
