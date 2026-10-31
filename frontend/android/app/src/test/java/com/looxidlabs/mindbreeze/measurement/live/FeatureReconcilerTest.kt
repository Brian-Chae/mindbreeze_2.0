package com.looxidlabs.mindbreeze.measurement.live

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

/** SDD-260 N2 (V-A10): 종료 후 summary 대조 — 로컬 sequence 집합 − 서버 보유 집합 = ∅ 일 때만 완료, 모자란 창만 재전송 대상으로 되돌린다. */
class FeatureReconcilerTest {
    @get:Rule val tmp = TemporaryFolder()
    private var server: MockWebServer? = null
    private val paths = java.util.Collections.synchronizedList(ArrayList<String>())
    private var summary: String = "{}"
    private var status = 200
    private val sid = "00000001-0000-4000-8000-000000000001"
    private val pid = "00000003-0000-4000-8000-000000000003"
    private val st = "00000014-0000-4000-8000-000000000014"
    private val tag = StreamTag(st, "3", "anchor", pid)

    private fun frame(seq: Long) = JSONObject("""{"sequence":"$seq","window_start_us":"${seq * 1000000L}","window_end_us":"${(seq + 1) * 1000000L}"}""")
    private fun start(): String {
        val s = MockWebServer()
        s.dispatcher = object : Dispatcher() { override fun dispatch(request: RecordedRequest): MockResponse { paths += request.path!!; return MockResponse().setResponseCode(status).setBody(summary) } }
        s.start(); server = s
        return s.url("/api/v1").toString().trimEnd('/')
    }
    @After fun stop() { try { server?.shutdown() } catch (_: Exception) {} }

    private fun sum(streams: String) = """{"session_id":"$sid","participant_id":"$pid","total_count":0,"streams":[$streams],"updated_at":null}"""
    private fun stream(id: String, lo: Int, hi: Int, gaps: String = "", truncated: Boolean = false) =
        """{"stream_id":"$id","count":0,"min_index":$lo,"max_index":$hi,"contiguous_through":-1,"missing_ranges":[$gaps],"truncated":$truncated}"""

    private fun ackedOutbox(range: LongRange): MetricOutbox = MetricOutbox(File(tmp.root, "o-${System.nanoTime()}.log")).also { for (i in range) { it.add(i, frame(i), tag); it.ack(i) } }
    private fun rec(base: String, o: MetricOutbox, token: String? = "tok") = FeatureReconciler(base, sid, o, { pid }, { token }, OkHttpClient())

    @Test fun missingIsLocalMinusServerHeld() {
        val s = JSONObject(sum(stream(st, 1, 10, "[3,4],[8,8]")))
        val local = (1L..12L).map { st to it }
        assertEquals("서버 gap(3~4, 8) + 범위 밖(11, 12)", listOf(3L, 4L, 8L, 11L, 12L), FeatureReconciler.missing(local, s))
    }

    @Test fun unknownStreamAndBelowMinAreMissing() {
        val s = JSONObject(sum(stream(st, 5, 10)))
        assertEquals(listOf(1L, 2L), FeatureReconciler.missing(listOf(st to 1L, st to 2L, st to 6L), s))
        assertEquals(listOf(7L), FeatureReconciler.missing(listOf("other" to 7L), s))
        assertEquals("서버에 stream 이 하나도 없으면 전부 결측", listOf(1L, 2L), FeatureReconciler.missing(listOf(st to 1L, st to 2L), JSONObject(sum(""))))
    }

    @Test fun truncatedGapListTreatsEverythingAfterLastGapAsMissing() {
        val s = JSONObject(sum(stream(st, 1, 100, "[10,12]", truncated = true)))
        val got = FeatureReconciler.missing((1L..20L).map { st to it }, s)
        assertEquals((10L..12L).toList() + (13L..20L).toList(), got)
    }

    @Test fun emptyMissingRangesIsNotEnoughWhenLocalIsBeyondServerMax() {
        // contract §2: 서버 응답만으로 "빈 배열 = 완료" 로 판정하지 않는다 — max_index 이후 로컬 창은 결측.
        val s = JSONObject(sum(stream(st, 1, 5)))
        assertEquals(listOf(6L, 7L), FeatureReconciler.missing((1L..7L).map { st to it }, s))
    }

    @Test fun completeWhenServerHoldsEverythingAndMarksOutbox() {
        summary = sum(stream(st, 1, 6)); val base = start()
        val o = ackedOutbox(1L..6L)
        assertEquals(ReconcileResult.Complete(0), rec(base, o).run())
        assertTrue(o.isReconciled())
        assertEquals("GET /api/v1/sessions/$sid/features/summary?participant_id=$pid", "GET " + paths.single())
    }

    @Test fun missingWindowsAreRequeuedAndNotCompleteYet() {
        summary = sum(stream(st, 1, 6, "[3,4]")); val base = start()
        val o = ackedOutbox(1L..6L)
        val r = rec(base, o).run()
        assertEquals(ReconcileResult.Resending(2, 0), r)
        assertFalse(o.isReconciled())
        assertEquals(listOf(3L, 4L), o.pendingBatch(60).map { it.seq })
    }

    @Test fun waitsWhileWindowsArePending() {
        val base = start()
        val o = MetricOutbox(File(tmp.root, "w.log")).also { it.add(1, frame(1), tag) }
        assertEquals(ReconcileResult.Waiting, rec(base, o).run())
        assertTrue("대기 창이 있으면 서버를 부르지 않는다", paths.isEmpty())
    }

    @Test fun emptyOutboxIsCompleteWithoutCall() {
        val base = start()
        val o = MetricOutbox(File(tmp.root, "e.log"))
        assertEquals(ReconcileResult.Complete(0), rec(base, o).run()); assertTrue(paths.isEmpty())
    }

    @Test fun serverGapsWithoutLocalCopyAreReportedAsLocalMissing() {
        summary = sum(stream(st, 1, 10, "[4,6]")); val base = start()
        val o = ackedOutbox(1L..10L).also { it.quarantine(5, "hash_conflict") } // 5 는 격리(서버에도 없음, 로컬 재전송 대상도 아님)
        val r = rec(base, o).run() as ReconcileResult.Resending
        assertEquals("4,6 만 되돌린다", 2, r.count); assertEquals("gap(local_missing) 진단: 5", 1, r.localMissing)
    }

    @Test fun httpFailuresAreRetryableNotComplete() {
        status = 503; summary = "{}"; val base = start()
        val o = ackedOutbox(1L..2L)
        assertEquals(ReconcileResult.Failed("http_503", false), rec(base, o).run()); assertFalse(o.isReconciled())
        assertEquals(ReconcileResult.Failed("auth_missing", true), rec(base, o, token = null).run())
    }

    @Test fun networkErrorIsRetryable() {
        val base = start(); server!!.shutdown(); server = null
        val o = ackedOutbox(1L..2L)
        assertEquals(ReconcileResult.Failed("network", false), rec(base, o).run())
    }
}
