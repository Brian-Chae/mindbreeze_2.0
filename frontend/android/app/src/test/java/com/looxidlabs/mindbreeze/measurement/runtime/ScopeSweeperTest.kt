package com.looxidlabs.mindbreeze.measurement.runtime

import com.looxidlabs.mindbreeze.measurement.archive.ArchiveQueue
import com.looxidlabs.mindbreeze.measurement.archive.RawReconciler
import com.looxidlabs.mindbreeze.measurement.archive.RawReconcileResult
import com.looxidlabs.mindbreeze.measurement.live.MetricOutbox
import com.looxidlabs.mindbreeze.measurement.live.RefreshOutcome
import com.looxidlabs.mindbreeze.measurement.live.StreamTag
import com.looxidlabs.mindbreeze.measurement.live.TokenSource
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
import java.security.MessageDigest

/** SDD-260 N3(V-C5·V-C6)·N5: 앱을 다시 열어도 클래스 화면에 들어가지 않고, 모든 세션 scope 가 feature·원시를 서버와 맞춘다. */
class ScopeSweeperTest {
    @get:Rule val tmp = TemporaryFolder()
    private var server: MockWebServer? = null
    private val log = java.util.Collections.synchronizedList(ArrayList<String>())
    /** 세션 → 서버가 보유한 sequence 집합(features/batch 로 채워짐). */
    private val held = java.util.Collections.synchronizedMap(HashMap<String, java.util.TreeSet<Long>>())
    private val rawAliases = java.util.Collections.synchronizedList(ArrayList<String>())

    private fun sidOf(path: String) = Regex("/sessions/([^/]+)/").find(path)!!.groupValues[1]

    private fun start(): String {
        val s = MockWebServer()
        s.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val p = request.path!!; log += "${request.method} ${p.substringBefore('?')}"
                val sid = sidOf(p)
                return when {
                    p.contains("/features/batch") -> {
                        val ws = JSONObject(request.body.readUtf8()).getJSONArray("windows"); val res = JSONArray()
                        for (i in 0 until ws.length()) {
                            val w = ws.getJSONObject(i); val q = w.getString("sequence").toLong()
                            val isNew = held.getOrPut(sid) { java.util.TreeSet() }.add(q)
                            res.put(JSONObject().put("stream_id", w.getString("stream_id")).put("sequence", q.toString()).put("status", if (isNew) "accepted" else "duplicate").put("durable", true))
                        }
                        MockResponse().setBody(JSONObject().put("results", res).toString())
                    }
                    p.contains("/features/summary") -> {
                        val h = held[sid] ?: java.util.TreeSet()
                        val streams = JSONArray()
                        if (h.isNotEmpty()) {
                            val gaps = JSONArray(); var prev = h.first()
                            for (x in h) { if (x > prev + 1) gaps.put(JSONArray().put(prev + 1).put(x - 1)); prev = x }
                            streams.put(JSONObject().put("stream_id", STREAM).put("count", h.size).put("min_index", h.first()).put("max_index", h.last()).put("contiguous_through", -1).put("missing_ranges", gaps).put("truncated", false))
                        }
                        MockResponse().setBody(JSONObject().put("streams", streams).put("total_count", h.size).toString())
                    }
                    p.contains("/biosignal-raw/summary") -> MockResponse().setBody(JSONObject().put("aliases_uploaded", JSONArray(rawAliases)).put("aliases_truncated", false).toString())
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        s.start(); server = s
        return s.url("/api/v1").toString().trimEnd('/')
    }
    @After fun stop() { try { server?.shutdown() } catch (_: Exception) {} }

    private fun frame(seq: Long) = JSONObject("""{"sequence":"$seq","window_start_us":"${seq * 1000000L}","window_end_us":"${(seq + 1) * 1000000L}","observed_at_ms":1760000000000,"sqi":0.8,"contact":{},"metrics":{},"feature_hash":"${"a".repeat(64)}"}""")

    private fun scope(root: File, sid: String, base: String, account: String?, n: Int): File {
        val dir = File(root, sid).apply { mkdirs() }
        ScopeInfo.save(File(dir, ScopeInfo.FILE), ScopeInfo(sid, base, account, PID, STREAM, "linkband2-v1", "web-ts-1", "b0-cohort-2", 25.0))
        val o = MetricOutbox(File(dir, "outbox.log"))
        for (i in 1L..n) o.add(i, frame(i), StreamTag(STREAM, "3", "anchor", PID))
        o.close()
        return dir
    }

    private class Tok(var t: String?) : TokenSource { override fun current() = t; override fun refresh(): RefreshOutcome = RefreshOutcome.Transient }

    private fun sweeper(root: File, account: String?, active: Set<String> = emptySet()): ScopeSweeper {
        val tok = Tok(jwt(account))
        return ScopeSweeper(root, { tok }, OkHttpClient(), { it in active })
    }

    private fun jwt(sub: String?): String? = sub?.let {
        fun b64(s: String) = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(s.toByteArray())
        b64("""{"alg":"HS256"}""") + "." + b64("""{"sub":"$it"}""") + ".sig"
    }

    // V-C5: 세션 A·B 가 끊긴 채 남아 있고 앱을 다시 열면(클래스 화면 미진입) 둘 다 올라가고 대조까지 끝난다.
    @Test fun allScopesAreDrainedAndReconciledWithoutRuntime() {
        val base = start(); val root = tmp.newFolder("measurement")
        val a = scope(root, "aaaaaaaa-0000-4000-8000-000000000001", base, "acct-1", 130)
        val b = scope(root, "bbbbbbbb-0000-4000-8000-000000000002", base, "acct-1", 7)
        val rep = sweeper(root, "acct-1").sweepOnce()
        assertEquals(0, rep.incomplete)
        assertEquals(130, held.getValue("aaaaaaaa-0000-4000-8000-000000000001").size); assertEquals(7, held.getValue("bbbbbbbb-0000-4000-8000-000000000002").size)
        for (d in listOf(a, b)) {
            assertTrue("완료 표식: ${d.name}", File(d, ScopeSweeper.MARKER).exists())
            val o = MetricOutbox(File(d, "outbox.log")); assertEquals(0, o.size()); assertTrue(o.isReconciled()); o.close()
        }
        assertTrue("summary 로 대조했다", log.any { it.contains("/features/summary") })
        val before = log.size
        assertEquals("완료된 scope 는 다시 건드리지 않는다", 0, sweeper(root, "acct-1").sweepOnce().incomplete)
        assertEquals(before, log.size)
    }

    // V-C6: 다른 계정 scope 는 보존만 한다(전송 0).
    @Test fun otherAccountScopeIsPreservedUntouched() {
        val base = start(); val root = tmp.newFolder("measurement")
        val a = scope(root, "aaaaaaaa-0000-4000-8000-000000000001", base, "acct-A", 5)
        val b = scope(root, "bbbbbbbb-0000-4000-8000-000000000002", base, "acct-B", 3)
        val rep = sweeper(root, "acct-B").sweepOnce()
        assertNull("A 의 데이터는 서버로 가지 않는다", held["aaaaaaaa-0000-4000-8000-000000000001"])
        assertEquals(3, held.getValue("bbbbbbbb-0000-4000-8000-000000000002").size)
        assertFalse(File(a, ScopeSweeper.MARKER).exists())
        val oa = MetricOutbox(File(a, "outbox.log")); assertEquals("A 로컬 보존", 5, oa.size()); oa.close()
        assertEquals(1, rep.preserved)
        // A 가 다시 로그인하면 재개된다
        assertEquals(0, sweeper(root, "acct-A").sweepOnce().incomplete)
        assertEquals(5, held.getValue("aaaaaaaa-0000-4000-8000-000000000001").size)
        assertTrue(File(b, ScopeSweeper.MARKER).exists())
    }

    @Test fun activeRuntimeScopeIsSkippedSoOutboxHasSingleWriter() {
        val base = start(); val root = tmp.newFolder("measurement")
        scope(root, "aaaaaaaa-0000-4000-8000-000000000001", base, "acct-1", 4)
        val rep = sweeper(root, "acct-1", active = setOf("aaaaaaaa-0000-4000-8000-000000000001")).sweepOnce()
        assertTrue(log.isEmpty()); assertEquals(0, rep.incomplete); assertEquals(1, rep.active)
    }

    @Test fun noTokenWaitsWithoutLosingAnything() {
        val base = start(); val root = tmp.newFolder("measurement")
        val a = scope(root, "aaaaaaaa-0000-4000-8000-000000000001", base, "acct-1", 4)
        val rep = ScopeSweeper(root, { Tok(null) }, OkHttpClient(), { false }).sweepOnce()
        assertTrue(rep.authWait); assertEquals(1, rep.incomplete); assertTrue(log.isEmpty())
        val o = MetricOutbox(File(a, "outbox.log")); assertEquals(4, o.size()); o.close()
    }

    @Test fun serverDownKeepsScopeIncompleteForRetry() {
        val base = start(); val root = tmp.newFolder("measurement")
        scope(root, "aaaaaaaa-0000-4000-8000-000000000001", base, "acct-1", 4)
        server!!.shutdown(); server = null
        val rep = sweeper(root, "acct-1").sweepOnce()
        assertEquals(1, rep.incomplete); assertFalse(rep.authWait)
        assertFalse(File(root, "aaaaaaaa-0000-4000-8000-000000000001/${ScopeSweeper.MARKER}").exists())
    }

    // 서버가 일부 창을 잃은 경우(장애 복구): 대조가 모자란 창만 되돌려 다시 보낸다.
    @Test fun reconcileResendsWindowsTheServerLost() {
        val base = start(); val root = tmp.newFolder("measurement")
        val sid = "aaaaaaaa-0000-4000-8000-000000000001"
        scope(root, sid, base, "acct-1", 10)
        assertEquals(0, sweeper(root, "acct-1").sweepOnce().incomplete)
        held.getValue(sid).removeAll(setOf(3L, 4L, 10L)) // 서버 측 유실 주입
        File(root, "$sid/${ScopeSweeper.MARKER}").delete()
        val o = MetricOutbox(File(root, "$sid/outbox.log")); o.add(11, frame(11), StreamTag(STREAM, "3", "anchor", PID)); o.close()
        assertEquals(0, sweeper(root, "acct-1").sweepOnce().incomplete)
        assertEquals((1L..11L).toSet(), held.getValue(sid).toSet())
    }

    // ---- N5 RawReconciler
    private fun sha(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }
    private fun rawItem(q: ArchiveQueue, alias: String, keepPayload: Boolean = true) {
        val payload = "raw-$alias".toByteArray()
        val meta = JSONObject().put("chunk_alias", alias).put("checksum", sha(payload)).put("size_bytes", payload.size)
        val it = q.enqueue("raw", "s", PID, alias, meta, payload)
        it.status = com.looxidlabs.mindbreeze.measurement.archive.ArchiveStatus.VERIFIED; q.update(it)
        if (!keepPayload) it.payloadFile.delete()
    }

    @Test fun rawReconcileRequeuesAliasesTheServerLacks() {
        rawAliases.addAll(listOf("R1", "R3")); val base = start()
        val q = ArchiveQueue(tmp.newFolder("archive"))
        for (a in listOf("R1", "R2", "R3", "R4")) rawItem(q, a)
        val r = RawReconciler(base, "s", q, { PID }, { "tok" }, OkHttpClient()).run()
        assertEquals(RawReconcileResult.Resending(2, 0), r)
        assertEquals(listOf("R2", "R4"), q.pending().map { it.alias })
        assertEquals(0, q.pending().first().attempts)
    }

    @Test fun rawReconcileCompleteWhenServerHasAll() {
        rawAliases.addAll(listOf("R1", "R2")); val base = start()
        val q = ArchiveQueue(tmp.newFolder("archive")); rawItem(q, "R1"); rawItem(q, "R2")
        assertEquals(RawReconcileResult.Complete, RawReconciler(base, "s", q, { PID }, { "tok" }, OkHttpClient()).run())
    }

    @Test fun rawReconcileWaitsWhilePendingAndReportsLostPayload() {
        rawAliases.add("R1"); val base = start()
        val q = ArchiveQueue(tmp.newFolder("archive"))
        rawItem(q, "R1")
        q.enqueue("raw", "s", PID, "P1", JSONObject().put("checksum", "x").put("size_bytes", 1), ByteArray(1))
        assertEquals(RawReconcileResult.Waiting, RawReconciler(base, "s", q, { PID }, { "tok" }, OkHttpClient()).run())
        assertTrue(log.isEmpty())
    }

    @Test fun jwtSubIsReadWithoutVerification() {
        assertEquals("acct-1", JwtSub.of(jwt("acct-1")))
        assertNull(JwtSub.of("not-a-jwt")); assertNull(JwtSub.of(null))
    }

    @Test fun scopeInfoRoundTrips() {
        val f = File(tmp.root, "scope.json")
        val i = ScopeInfo("s", "http://x/api/v1", "acct", PID, STREAM, "p", "a", "m", 12.5)
        ScopeInfo.save(f, i)
        assertEquals(i, ScopeInfo.load(f))
        assertNull(ScopeInfo.load(File(tmp.root, "none.json")))
    }

    companion object {
        const val PID = "00000003-0000-4000-8000-000000000003"
        const val STREAM = "00000014-0000-4000-8000-000000000014"
    }
}
