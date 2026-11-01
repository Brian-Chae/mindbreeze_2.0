package com.looxidlabs.mindbreeze.measurement.archive

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

/** SDD-270: 앱이 관측한 구멍을 디스크에 남기고(GapEventStore) 서버 biosignal-events 로 올리는(sendGapEvents) 경로. */
class GapEventStoreTest {
    @get:Rule val tmp = TemporaryFolder()
    private val sid = "00000001-0000-4000-8000-000000000001"
    private val stream = "00000003-0000-4000-8000-000000000003"
    private val seg = "00000004-0000-4000-8000-000000000004"
    private var server: MockWebServer? = null
    private val bodies = java.util.Collections.synchronizedList(ArrayList<JSONObject>())
    @After fun stop() { server?.shutdown() }

    private fun store(name: String = "gap-events.json") = GapEventStore(File(tmp.root, name), sid) { 5_000_000L }
    private fun add(s: GapEventStore, signal: String, start: Long, end: Long? = start + 1000, reason: String = "ble_disconnect") =
        s.append(signal, stream, seg, start, end, reason, "observed", 1)

    @Test fun sameGapAppendedTwiceIsOneRowAndSequenceDoesNotAdvance() {
        val s = store()
        val a = add(s, "eeg", 100)
        val b = add(s, "eeg", 100)
        assertNotNull(a); assertNull(b)
        assertEquals(1, s.pending(50).size)
        assertEquals(0L, s.lastSequence())
        // 다른 신호는 같은 시작 시각이어도 다른 구멍
        assertNotNull(add(s, "ppg", 100)); assertEquals(1L, s.lastSequence())
    }

    @Test fun sequenceIsMonotonicAndSurvivesReopen() {
        val s = store()
        add(s, "eeg", 100); add(s, "ppg", 200)
        val r = store() // 프로세스 재생성
        add(r, "acc", 300)
        assertEquals(listOf(0L, 1L, 2L), r.pending(50).map { it.event.getLong("sequence") })
        assertEquals(2L, r.lastSequence())
        assertNull(store("none.json").lastSequence())
    }

    @Test fun eventIdIsDeterministicAcrossStores() {
        val a = add(store("a.json"), "eeg", 777)!!
        val b = add(store("b.json"), "eeg", 777)!!
        assertEquals(a.getString("event_id"), b.getString("event_id"))
    }

    @Test fun eventFollowsServerGapContractAndNeverInventsLossCounts() {
        val e = add(store(), "eeg", 100, null, "clock_reset")!!
        assertEquals("gap", e.getString("event_type"))
        assertEquals("100", e.getString("start_us")); assertTrue(e.isNull("end_us"))
        assertEquals("5000000", e.getString("discovered_at_us"))
        assertTrue(e.isNull("expected_samples") && e.isNull("received_samples"))
        assertEquals(stream, e.getString("stream_id")); assertEquals(seg, e.getString("segment_id"))
        assertEquals("observed", e.getString("observed_or_estimated"))
    }

    private fun start(script: (RecordedRequest) -> MockResponse): String {
        val s = MockWebServer()
        s.dispatcher = object : Dispatcher() { override fun dispatch(request: RecordedRequest): MockResponse { bodies += JSONObject(request.body.readUtf8()); return script(request) } }
        s.start(); server = s
        return s.url("/api/v1").toString().trimEnd('/')
    }
    private fun uploader(base: String, token: String? = "tok") =
        ArchiveUploader(base, ArchiveQueue(File(tmp.root, "q")), tokenProvider = { token }, http = OkHttpClient(), captureStreamId = { null })
    private fun reply(status: String) = { r: RecordedRequest -> MockResponse().setBody(JSONObject().put("events",
        org.json.JSONArray().also { a -> val body = bodies.last().getJSONArray("events"); for (i in 0 until body.length()) a.put(JSONObject().put("event_type", "gap").put("event_id", body.getJSONObject(i).getString("event_id")).put("status", status)) }).toString()) }

    @Test fun recordedDuplicateAndConflictAllCloseTheEvent() {
        for (status in listOf("recorded", "duplicate", "conflict")) {
            bodies.clear()
            val s = store("s-$status.json"); add(s, "eeg", 1); add(s, "ppg", 2)
            val base = start(reply(status))
            assertTrue(status, uploader(base).sendGapEvents("00000002-0000-4000-8000-000000000002", s))
            assertTrue(s.pending(50).isEmpty())
            val sent = bodies.single()
            assertEquals("00000002-0000-4000-8000-000000000002", sent.getString("participant_id"))
            assertEquals(2, sent.getJSONArray("events").length())
            assertEquals(listOf(0L, 1L), (0 until 2).map { sent.getJSONArray("events").getJSONObject(it).getLong("sequence") })
            assertFalse(sent.getJSONArray("events").getJSONObject(0).has("status")) // 내부 상태는 서버로 보내지 않는다
            server!!.shutdown()
        }
    }

    @Test fun transientFailuresKeepEventsPendingForever() {
        val s = store(); add(s, "eeg", 1)
        for (code in listOf(500, 503, 401, 408, 429)) {
            val base = start { MockResponse().setResponseCode(code).setBody("{}") }
            assertFalse("HTTP $code", uploader(base).sendGapEvents(null, s))
            assertEquals("HTTP $code", 1, s.pending(50).size)
            server!!.shutdown()
        }
        repeat(30) { s.noteAttempt() } // 시도 횟수가 많아도 영구 포기하지 않는다
        assertEquals(1, s.pending(50).size)
    }

    @Test fun noTokenSendsNothingAndKeepsEvents() {
        val s = store(); add(s, "eeg", 1)
        val base = start { MockResponse().setBody("{}") }
        assertFalse(uploader(base, token = null).sendGapEvents(null, s))
        assertEquals(0, bodies.size); assertEquals(1, s.pending(50).size)
    }

    @Test fun rejectedByValidationDoesNotBlockTheRestOfTheBatch() {
        val s = store(); add(s, "eeg", 1); add(s, "ppg", 2)
        val bad = s.pending(50)[0].event.getString("event_id")
        val base = start { r ->
            val ev = bodies.last().getJSONArray("events")
            if (ev.length() > 1) MockResponse().setResponseCode(422).setBody("{}")
            else if (ev.getJSONObject(0).getString("event_id") == bad) MockResponse().setResponseCode(422).setBody("{}")
            else reply("recorded")(r)
        }
        assertTrue(uploader(base).sendGapEvents(null, s))
        assertTrue(s.pending(50).isEmpty())
        assertEquals(listOf("rejected", "sent"), s.statuses())
    }

    @Test fun closeIntentCarriesLastGapSequenceAndKeepsOldIdWhenNoGaps() {
        val q = ArchiveQueue(File(tmp.root, "cq"))
        val arch = RawArchiver(q, sid, { "00000002-0000-4000-8000-000000000002" }, File(tmp.root, "raw.json"))
        val pkt = ByteArray(4 + 25 * com.looxidlabs.mindbreeze.measurement.Sensor.EEG.sampleBytes) { 1 }
        for (i in 0 until 100) arch.onPacket(com.looxidlabs.mindbreeze.measurement.Sensor.EEG, i * 100_000L, pkt.copyOf().also { b -> val t = 1000L + i * 3277; for (k in 0..3) b[k] = ((t shr (8 * k)) and 0xFF).toByte() })
        arch.flush()
        val plain = CloseIntentStore(File(tmp.root, "c1.json")).record(q, sid, "user_stop", 1L)!!
        assertTrue(plain.isNull("last_gap_sequence"))
        val same = CloseIntentStore(File(tmp.root, "c2.json")).record(q, sid, "user_stop", 1L, null)!!
        assertEquals(plain.getString("intent_id"), same.getString("intent_id"))
        val withGap = CloseIntentStore(File(tmp.root, "c3.json")).record(q, sid, "user_stop", 1L, 4L)!!
        assertEquals(4L, withGap.getLong("last_gap_sequence"))
        assertNotEquals(plain.getString("intent_id"), withGap.getString("intent_id"))
    }
}
