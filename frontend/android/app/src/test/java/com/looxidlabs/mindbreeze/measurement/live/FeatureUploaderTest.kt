package com.looxidlabs.mindbreeze.measurement.live

import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/** SDD-260 N1 (V-A1·A12·C3): REST 배치가 feature 의 유일한 정본 저장 경로다. 소켓 ACK 와 무관하게 outbox 를 비운다. */
class FeatureUploaderTest {
    @get:Rule val tmp = TemporaryFolder()
    private var server: MockWebServer? = null
    private val requests = java.util.Collections.synchronizedList(ArrayList<RecordedRequest>())
    private val bodies = java.util.Collections.synchronizedList(ArrayList<JSONObject>())
    private lateinit var script: (RecordedRequest, JSONObject) -> MockResponse
    private val sid = "00000001-0000-4000-8000-000000000001"
    private val tag = StreamTag("00000014-0000-4000-8000-000000000014", "3", "00000099-0000-4000-8000-000000000099", "00000003-0000-4000-8000-000000000003")
    private val meta = FeatureMeta("linkband2-v1", "web-ts-1", "b0-cohort-2", 25.0)

    private fun frame(seq: Long) = JSONObject("""{"sequence":"$seq","window_start_us":"${seq * 1000000L}","window_end_us":"${(seq + 1) * 1000000L}","observed_at_ms":1760000000000,"sqi":0.8,"contact":{"fp1":"contact","fp2":"contact"},"metrics":{},"feature_hash":"${"a".repeat(64)}"}""")

    private fun start(): String {
        val s = MockWebServer()
        s.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val b = JSONObject(request.body.readUtf8().ifEmpty { "{}" })
                requests += request; bodies += b
                return script(request, b)
            }
        }
        s.start(); server = s
        return s.url("/api/v1").toString().trimEnd('/')
    }
    @After fun stop() { try { server?.shutdown() } catch (_: Exception) {} }

    private fun outbox(n: Int = 100): MetricOutbox = MetricOutbox(File(tmp.root, "o-${System.nanoTime()}.log")).also { for (i in 1L..n) it.add(i, frame(i), tag) }

    private fun uploader(base: String, o: MetricOutbox, refresh: (() -> Boolean)? = null, token: String? = "access-tok") =
        FeatureUploader(base, sid, o, { meta }, { token }, refresh, OkHttpClient())

    private fun okBody(b: JSONObject, status: String = "accepted"): MockResponse {
        val ws = b.getJSONArray("windows"); val res = JSONArray()
        for (i in 0 until ws.length()) res.put(JSONObject().put("stream_id", ws.getJSONObject(i).getString("stream_id")).put("sequence", ws.getJSONObject(i).getString("sequence")).put("status", status).put("durable", true))
        return MockResponse().setBody(JSONObject().put("session_id", sid).put("participant_id", tag.participantId).put("results", res).toString())
    }
    private fun okAll(status: String = "accepted"): (RecordedRequest, JSONObject) -> MockResponse = { _, b -> okBody(b, status) }

    // V-A1: 소켓 없이 REST 로 60창 저장
    @Test fun postsOldestFirst60WindowsAndKeepsAckedCopy() {
        script = okAll()
        val base = start(); val o = outbox(100)
        val r = uploader(base, o).flushOnce() as FlushResult.Done
        assertEquals(60, r.accepted); assertTrue(r.more)
        val req = requests.single()
        assertEquals("POST", req.method); assertEquals("/api/v1/sessions/$sid/features/batch", req.path)
        assertEquals("Bearer access-tok", req.getHeader("Authorization")); assertEquals("capacitor", req.getHeader("X-MB-Native"))
        val b = bodies.single()
        assertEquals(tag.participantId, b.getString("participant_id"))
        val ws = b.getJSONArray("windows")
        assertEquals((1L..60L).map { it.toString() }, (0 until 60).map { ws.getJSONObject(it).getString("sequence") })
        val w = ws.getJSONObject(0)
        assertEquals(sid, w.getString("session_id")); assertEquals(tag.streamId, w.getString("stream_id")); assertEquals("3", w.getString("stream_generation"))
        assertEquals(tag.anchorId, w.getString("clock_anchor_id")); assertEquals("linkband2-v1", w.getString("device_profile_version"))
        assertEquals("b0-cohort-2", w.getString("model_version")); assertEquals(25.0, w.getDouble("clock_uncertainty_ms"), 0.0)
        assertEquals(40, o.size()); assertEquals(60L, o.acked()); assertEquals(60, o.ackedEntries().size) // 대조 전까지 사본 보관
    }

    @Test fun duplicateIsAckedToo() {
        script = okAll("duplicate")
        val base = start(); val o = outbox(3)
        assertEquals(3, (uploader(base, o).flushOnce() as FlushResult.Done).duplicate)
        assertEquals(0, o.size())
    }

    @Test fun emptyOutboxIsIdleAndSendsNothing() {
        script = okAll()
        val base = start(); val o = outbox(0)
        assertEquals(FlushResult.Idle, uploader(base, o).flushOnce())
        assertTrue(requests.isEmpty())
    }

    // V-A12: 4종 거절만 격리, 나머지는 재시도
    @Test fun onlyFourRejectCodesAreQuarantined() {
        script = { _, b ->
            val ws = b.getJSONArray("windows")
            val codes = mapOf("1" to null, "2" to "consent_withdrawn", "3" to "hash_conflict", "4" to "participant_mismatch", "5" to "stream_not_owned", "6" to "weird_internal")
            val res = JSONArray()
            for (i in 0 until ws.length()) {
                val q = ws.getJSONObject(i).getString("sequence"); val c = codes[q]
                res.put(JSONObject().put("stream_id", tag.streamId).put("sequence", q).put("status", if (c == null) "accepted" else "rejected").apply { if (c != null) put("code", c) else put("durable", true) })
            }
            MockResponse().setBody(JSONObject().put("results", res).toString())
        }
        val base = start(); val o = outbox(6)
        val r = uploader(base, o).flushOnce() as FlushResult.Done
        assertEquals(1, r.accepted); assertEquals(4, r.quarantined)
        assertEquals(mapOf("consent_withdrawn" to 1L, "hash_conflict" to 1L, "participant_mismatch" to 1L, "stream_not_owned" to 1L), o.quarantinedByCode())
        assertTrue("알 수 없는 거절 코드는 격리하지 않고 재시도 대상", o.contains(6)); assertEquals(1, o.size())
        assertFalse("재시도 대상이 남았으면 즉시 반복하지 않는다", r.more)
    }

    @Test fun serverErrorsAndNetworkFailureKeepEverythingPending() {
        script = { _, _ -> MockResponse().setResponseCode(503) }
        val base = start(); val o = outbox(5)
        val up = uploader(base, o)
        val r = up.flushOnce() as FlushResult.Retry
        assertEquals("http_503", r.reason); assertEquals(5, o.size()); assertEquals(0L, o.acked())
        server!!.shutdown(); server = null
        assertEquals("network", (up.flushOnce() as FlushResult.Retry).reason)
        assertEquals(5, o.size())
    }

    @Test fun retryAfterHeaderOn429IsReported() {
        script = { _, _ -> MockResponse().setResponseCode(429).setHeader("Retry-After", "4") }
        val base = start(); val o = outbox(1)
        assertEquals(4000L, (uploader(base, o).flushOnce() as FlushResult.Retry).retryAfterMs)
    }

    @Test fun unauthorizedRefreshesAndWaitsWithoutLoss() {
        script = { _, _ -> MockResponse().setResponseCode(401) }
        var refreshed = 0
        val base = start(); val o = outbox(2)
        val r = uploader(base, o, refresh = { refreshed++; true }).flushOnce() as FlushResult.Retry
        assertTrue(r.authWait); assertEquals(1, refreshed); assertEquals(2, o.size())
    }

    @Test fun missingTokenWaitsWithoutRequest() {
        script = okAll()
        val base = start(); val o = outbox(2)
        val r = uploader(base, o, token = null).flushOnce() as FlushResult.Retry
        assertTrue(r.authWait); assertTrue(requests.isEmpty()); assertEquals(2, o.size())
    }

    @Test fun invalidMessageHalvesBatchThenQuarantinesSingleWindow() {
        script = { _, b ->
            val ws = b.getJSONArray("windows")
            val poison = (0 until ws.length()).any { ws.getJSONObject(it).getString("sequence") == "3" }
            if (poison) MockResponse().setResponseCode(422).setBody("""{"detail":{"code":"invalid_message","field":"windows[0]"}}""") else okBody(b)
        }
        val base = start(); val o = outbox(4); val up = uploader(base, o)
        var guard = 0
        while (o.size() > 0 && guard++ < 20) up.flushOnce()
        assertEquals("독이 든 창 1건만 격리, 나머지 3건 저장", 3L, o.acked())
        assertEquals(1L, o.quarantinedByCode()["invalid_message"])
    }

    @Test fun resultLengthMismatchIsRetriedNotAcked() {
        script = { _, _ -> MockResponse().setBody("""{"results":[]}""") }
        val base = start(); val o = outbox(2)
        assertEquals("response_mismatch", (uploader(base, o).flushOnce() as FlushResult.Retry).reason)
        assertEquals(2, o.size())
    }

    @Test fun oneBatchNeverMixesParticipants() {
        script = okAll()
        val base = start(); val o = MetricOutbox(File(tmp.root, "mix.log"))
        o.add(1, frame(1), tag); o.add(2, frame(2), tag.copy(participantId = "other")); o.add(3, frame(3), tag)
        uploader(base, o).flushOnce()
        assertEquals(tag.participantId, bodies.single().getString("participant_id"))
        assertEquals(2, bodies.single().getJSONArray("windows").length())
        assertEquals(listOf(2L), (o.pendingBatch(60).map { it.seq }))
    }

    // 지터 · 재시도 간격 (full jitter 0..min(60s, 1s×2^n))
    @Test fun syncLoopBackoffIsFullJitterBoundedAndResetsOnSuccess() {
        var mode = "fail"
        val loop = FeatureSyncLoop(flush = { if (mode == "fail") FlushResult.Retry("network") else FlushResult.Done(1, 0, 0, false) }, rnd = { 1.0 })
        val delays = (1..9).map { loop.step() }
        assertEquals(listOf(1000L, 2000L, 4000L, 8000L, 16000L, 32000L, 60000L, 60000L, 60000L), delays)
        val loopZero = FeatureSyncLoop(flush = { FlushResult.Retry("network") }, rnd = { 0.0 })
        assertEquals(0L, loopZero.step())
        mode = "ok"
        assertEquals("성공 후 5초 주기", 5000L, loop.step())
        mode = "fail"
        assertEquals("실패 카운터 초기화", 1000L, loop.step())
    }

    @Test fun syncLoopRunsImmediatelyWhileBacklogRemains() {
        val loop = FeatureSyncLoop(flush = { FlushResult.Done(60, 0, 0, true) }, rnd = { 1.0 })
        assertEquals(0L, loop.step())
        val idle = FeatureSyncLoop(flush = { FlushResult.Idle }, rnd = { 1.0 })
        assertEquals(5000L, idle.step())
    }

    @Test fun retryAfterIsALowerBoundForTheNextAttempt() {
        val loop = FeatureSyncLoop(flush = { FlushResult.Retry("http_429", retryAfterMs = 4000) }, rnd = { 0.0 })
        assertEquals(4000L, loop.step())
    }
}
