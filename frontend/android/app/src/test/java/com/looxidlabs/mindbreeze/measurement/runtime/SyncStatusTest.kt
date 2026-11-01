package com.looxidlabs.mindbreeze.measurement.runtime

import com.looxidlabs.mindbreeze.measurement.archive.SignalCounts
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** SDD-260: feature.counts · archive.counts · reconcile.state payload 형식·방출 시점·완료 판정. */
class SyncStatusTest {
    private val sid = "s1"
    private val c = SyncCounts(featurePending = 3, featureAcked = 57, featureRejected = 1, archivePending = 2, archiveUploading = 0, archiveVerified = 9, archiveQuarantined = 4)

    @Test fun payloadsMatchContractAndOrder() {
        val p = SyncEvents.payloads(sid, c, SyncState("resending", "syncing", false))
        assertEquals(listOf("feature.counts", "archive.counts", "reconcile.state"), p.map { it.first })
        val f = p[0].second; val a = p[1].second; val r = p[2].second
        assertEquals(setOf("sessionId", "pending", "acked", "rejected"), f.keys().asSequence().toSet())
        assertEquals(3, f.getInt("pending")); assertEquals(57L, f.getLong("acked")); assertEquals(1L, f.getLong("rejected"))
        assertEquals(setOf("sessionId", "pending", "uploading", "verified", "quarantined"), a.keys().asSequence().toSet())
        assertEquals(2, a.getInt("pending")); assertEquals(9, a.getInt("verified")); assertEquals(4, a.getInt("quarantined"))
        assertEquals(setOf("sessionId", "feature", "raw", "complete"), r.keys().asSequence().toSet())
        assertEquals("resending", r.getString("feature")); assertFalse(r.getBoolean("complete"))
    }

    @Test fun completeIsFalseUntilBothReconcilesFinish() {
        val b = SyncStatusBoard()
        assertFalse(b.state(sid).complete)
        b.setFeature(sid, "complete"); assertFalse("feature 만 끝났다고 완료가 아니다", b.state(sid).complete)
        b.setRaw(sid, "unverifiable"); assertFalse(b.state(sid).complete)
        b.markComplete(sid); assertTrue(b.state(sid).complete)
        b.setRaw(sid, "resending"); assertFalse("재전송이 생기면 다시 미완료", b.state(sid).complete)
    }

    @Test fun gateEmitsOnChangeThenEveryTwoSecondsThenSilentWhenComplete() {
        val g = SyncEventGate(2000); val s = SyncState()
        assertTrue(g.due(sid, c, s, 0))
        assertFalse(g.due(sid, c, s, 1000))
        assertTrue("주기 2초", g.due(sid, c, s, 2000))
        assertTrue("값 변경 즉시", g.due(sid, c.copy(featurePending = 2), s, 2100))
        val done = SyncState("complete", "complete", true)
        assertTrue(g.due(sid, c, done, 2200))
        assertFalse("완료 후 그대로면 침묵", g.due(sid, c, done, 9000))
    }

    @Test fun emitterSendsThreeEventsPerDueSessionAndRuntimeUsesLiveCounts() {
        val b = SyncStatusBoard(); val out = ArrayList<Pair<String, JSONObject>>()
        val e = SyncEmitter(b, SyncEventGate(2000)) { n, p -> out += n to p }
        b.setCounts("old", c); b.setFeature("old", "retrying")
        e.emit("live", SyncCounts(featurePending = 5), 0)
        assertEquals(6, out.size)
        assertEquals(5, out.first { it.first == "feature.counts" && it.second.getString("sessionId") == "live" }.second.getInt("pending"))
        assertEquals("retrying", out.first { it.first == "reconcile.state" && it.second.getString("sessionId") == "old" }.second.getString("feature"))
        out.clear(); e.emit("live", SyncCounts(featurePending = 5), 500); assertTrue("2초 전엔 보내지 않는다", out.isEmpty())
        e.emit(null, null, 2500); assertEquals("old 만 주기 도래", 3, out.size)
    }

    // ---- SDD-264: archive.counts additive `signals` ----
    @Test fun archiveCountsCarriesSignalsOnlyWhenKnownAndKeepsLegacyFields() {
        val none = SyncEvents.payloads(sid, c, SyncState())[1].second
        assertFalse("signals 를 모르면 싣지 않는다(0 으로 오해 금지)", none.has("signals"))
        val sig = mapOf("eeg" to SignalCounts(3, 0, 70, 2), "ppg" to SignalCounts(0, 0, 40, 0))
        val a = SyncEvents.payloads(sid, c.copy(signals = sig), SyncState())[1].second
        assertEquals(setOf("sessionId", "pending", "uploading", "verified", "quarantined", "signals"), a.keys().asSequence().toSet())
        assertEquals(2, a.getInt("pending")); assertEquals(9, a.getInt("verified")) // 기존 필드 불변
        val s = a.getJSONObject("signals")
        assertEquals(setOf("eeg", "ppg", "acc"), s.keys().asSequence().toSet())
        assertEquals(setOf("pending", "uploading", "verified", "quarantined"), s.getJSONObject("eeg").keys().asSequence().toSet())
        assertEquals(75, s.getJSONObject("eeg").let { it.getInt("pending") + it.getInt("uploading") + it.getInt("verified") + it.getInt("quarantined") })
        assertEquals("착용 안 한 신호는 0 으로 항상 존재", 0, s.getJSONObject("acc").getInt("verified"))
    }
}
