package com.looxidlabs.mindbreeze.measurement.archive

import com.looxidlabs.mindbreeze.measurement.Sensor
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/** 네이티브 종료 기록(close intent) — 실기기 회차 2a11d64c 에서 한 건도 안 가던 결함의 회귀 시험. */
class CloseIntentTest {
    @get:Rule val tmp = TemporaryFolder()
    private val sid = "00000001-0000-4000-8000-000000000001"
    private var server: MockWebServer? = null
    private val bodies = java.util.Collections.synchronizedList(ArrayList<JSONObject>())
    @After fun stop() { server?.shutdown() }

    private fun tick(b: ByteArray, t: Long) { for (i in 0..3) b[i] = ((t shr (8 * i)) and 0xFF).toByte() }
    private fun packet(sensor: Sensor, rows: Int, t: Long): ByteArray = ByteArray(4 + rows * sensor.sampleBytes) { (it % 251).toByte() }.also { tick(it, t) }

    /** 3신호 raw 를 RawArchiver 로 봉인(=큐 적재)하고, feature 1개를 더 넣는다. */
    private fun fill(q: ArchiveQueue) {
        val arch = RawArchiver(q, sid, { "00000002-0000-4000-8000-000000000002" }, File(tmp.root, "raw.json"))
        for (i in 0 until 130) {
            arch.onPacket(Sensor.EEG, i * 100_000L, packet(Sensor.EEG, 25, 1000L + i * 3277))
            if (i % 2 == 0) arch.onPacket(Sensor.PPG, i * 100_000L, packet(Sensor.PPG, 10, 1000L + (i / 2) * 6554))
            if (i % 11 == 0) arch.onPacket(Sensor.ACC, i * 100_000L, packet(Sensor.ACC, 30, 1000L + (i / 11) * 37864))
        }
        arch.flush()
        val f = ArchiveFeeder(q, sid, { "00000002-0000-4000-8000-000000000002" }, { "00000014-0000-4000-8000-000000000014" }, windowFrames = 2,
            scope = { arch.streamId(Sensor.EEG) to arch.segmentId(Sensor.EEG) })
        for (s in 1L..2L) f.onFrame(JSONObject().put("sequence", s.toString()).put("window_start_us", (s * 1_000_000).toString()).put("window_end_us", ((s + 1) * 1_000_000).toString()))
    }

    @Test fun recordsExpectedSetFromQueueAndStreamsForAllThreeSignals() {
        val q = ArchiveQueue(File(tmp.root, "q")); fill(q)
        val store = CloseIntentStore(File(tmp.root, "ci.json"))
        val intent = store.record(q, sid, "user_stop", 9_000_000L)!!
        assertEquals("close_intent", intent.getString("event_type"))
        val exp = intent.getJSONArray("expected_artifacts")
        assertEquals(q.all().size, exp.length())
        val byAlias = (0 until exp.length()).associate { exp.getJSONObject(it).getString("alias") to exp.getJSONObject(it) }
        for (i in q.all()) assertEquals(i.meta.getString("checksum"), byAlias.getValue(i.alias).getString("sha256"))
        assertTrue(q.all().any { it.kind == "feature" })
        val streams = intent.getJSONArray("streams")
        assertEquals(setOf("eeg", "ppg", "acc"), (0 until streams.length()).map { streams.getJSONObject(it).getString("signal") }.toSet())
        for (k in 0 until streams.length()) {
            val s = streams.getJSONObject(k)
            assertTrue(s.getLong("received_samples") > 0)
            assertTrue(s.getLong("last_chunk_sequence") >= 0)
            assertTrue(s.isNull("last_feature_sequence")) // feature 는 expected set 으로 대조
        }
        assertTrue(intent.getJSONArray("snapshots").length() == 0 && intent.isNull("last_gap_sequence"))
        assertEquals("9000000", intent.getString("closed_at_us"))
    }

    @Test fun intentIsPersistedDeterministicAndNotRewrittenAfterSent() {
        val q = ArchiveQueue(File(tmp.root, "q")); fill(q)
        val file = File(tmp.root, "ci.json")
        val a = CloseIntentStore(file).record(q, sid, "user_stop", 1L)!!
        // 프로세스 재생성 후에도 pending 이고 같은 intent_id
        val reopened = CloseIntentStore(file)
        assertEquals(a.getString("intent_id"), reopened.pending()!!.intent.getString("intent_id"))
        reopened.markSent()
        assertNull(CloseIntentStore(file).pending())
        // 같은 큐로 다시 종료해도 같은 intent_id → 다시 pending 으로 되돌리지 않는다
        CloseIntentStore(file).record(q, sid, "user_stop", 2L)
        assertNull(CloseIntentStore(file).pending())
    }

    @Test fun nothingRecordedWhenQueueEmpty() {
        val q = ArchiveQueue(File(tmp.root, "q"))
        assertNull(CloseIntentStore(File(tmp.root, "ci.json")).record(q, sid, "user_stop", 1L))
    }

    @Test fun attemptsAreBoundedSoDeadServerDoesNotLoopForever() {
        val q = ArchiveQueue(File(tmp.root, "q")); fill(q)
        val store = CloseIntentStore(File(tmp.root, "ci.json")); store.record(q, sid, "user_stop", 1L)
        repeat(CloseIntentStore.MAX_ATTEMPTS) { store.markAttempt() }
        assertNull(store.pending())
    }

    private fun start(script: (RecordedRequest) -> MockResponse): String {
        val s = MockWebServer()
        s.dispatcher = object : Dispatcher() { override fun dispatch(request: RecordedRequest): MockResponse { bodies += JSONObject(request.body.readUtf8()); return script(request) } }
        s.start(); server = s
        return s.url("/api/v1").toString().trimEnd('/')
    }
    private fun uploader(base: String, q: ArchiveQueue) = ArchiveUploader(base, q, tokenProvider = { "tok" }, http = OkHttpClient(), captureStreamId = { null })

    @Test fun sendPostsToBiosignalEventsAndAcceptsRecordedDuplicateConflict() {
        for (status in listOf("recorded", "duplicate", "conflict")) {
            bodies.clear()
            val base = start { MockResponse().setBody("""{"events":[{"event_type":"close_intent","event_id":"x","status":"$status"}],"close_state":"pending_upload"}""") }
            val q = ArchiveQueue(File(tmp.root, "q-$status")); fill(q)
            val intent = CloseIntentStore(File(tmp.root, "ci-$status.json")).record(q, sid, "user_stop", 1L)!!
            assertTrue(status, uploader(base, q).sendCloseIntent(sid, "00000002-0000-4000-8000-000000000002", intent))
            val sent = bodies.single()
            assertEquals("00000002-0000-4000-8000-000000000002", sent.getString("participant_id"))
            assertEquals(intent.getString("intent_id"), sent.getJSONArray("events").getJSONObject(0).getString("intent_id"))
            server!!.shutdown()
        }
    }

    @Test fun transientFailuresKeepIntentPendingAndClientErrorsClose() {
        val q = ArchiveQueue(File(tmp.root, "q")); fill(q)
        val intent = CloseIntentStore(File(tmp.root, "ci.json")).record(q, sid, "user_stop", 1L)!!
        for ((code, expectedOk) in listOf(500 to false, 503 to false, 401 to false, 429 to false, 422 to true)) {
            val base = start { MockResponse().setResponseCode(code).setBody("{}") }
            assertEquals("HTTP $code", expectedOk, uploader(base, q).sendCloseIntent(sid, null, intent))
            server!!.shutdown()
        }
    }
}
