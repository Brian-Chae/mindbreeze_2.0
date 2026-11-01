package com.looxidlabs.mindbreeze.measurement.archive

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/** SDD-264: 큐의 raw 항목을 신호별·상태별로 센다(청크 1개 = 항목 1개). feature 산출물은 제외. */
class SignalCountsTest {
    @get:Rule val tmp = TemporaryFolder()

    private fun raw(q: ArchiveQueue, sig: String, idx: Int) =
        q.enqueue("raw", "s1", "p1", "RAW-${sig.uppercase()}-$idx", JSONObject().put("header", JSONObject().put("signal_type", sig).put("chunk_index", idx)), byteArrayOf(idx.toByte(), 1))

    @Test fun countsPerSignalAndStatusAndExcludesFeatureArtifacts() {
        val q = ArchiveQueue(File(tmp.root, "q"))
        val e = (0 until 5).map { raw(q, "eeg", it) }
        raw(q, "ppg", 0); raw(q, "ppg", 1); raw(q, "acc", 0)
        q.enqueue("feature", "s1", "p1", "NF-1", JSONObject().put("signal", "eeg"), byteArrayOf(9))
        e[0].status = ArchiveStatus.VERIFIED; q.update(e[0])
        e[1].status = ArchiveStatus.HALTED; q.update(e[1])
        e[2].status = ArchiveStatus.DEAD_LETTER; q.update(e[2])
        e[3].status = ArchiveStatus.TIME_REVIEW; q.update(e[3])
        val c = q.signalCounts()
        assertEquals(setOf("eeg", "ppg", "acc"), c.keys)
        assertEquals(SignalCounts(pending = 1, uploading = 0, verified = 1, quarantined = 3), c["eeg"])
        assertEquals("eeg 총량 = 큐 raw eeg 항목 수(feature 제외)", 5, c["eeg"]!!.total)
        assertEquals(2, c["ppg"]!!.total); assertEquals(1, c["acc"]!!.total)
    }

    @Test fun unwornSignalsAreZeroNotMissing() {
        val q = ArchiveQueue(File(tmp.root, "q2"))
        raw(q, "eeg", 0)
        val c = q.signalCounts()
        assertEquals(SignalCounts(), c["ppg"]); assertEquals(SignalCounts(), c["acc"])
    }

    @Test fun totalIsStableAcrossStateTransitions() {
        val q = ArchiveQueue(File(tmp.root, "q3"))
        val items = (0 until 4).map { raw(q, "eeg", it) }
        val before = q.signalCounts()["eeg"]!!.total
        items.forEach { it.status = ArchiveStatus.VERIFIED; q.update(it) }
        assertEquals("업로드가 진행돼도 총량은 변하지 않는다(단조)", before, q.signalCounts()["eeg"]!!.total)
    }

    @Test fun malformedMetaWithoutSignalTypeIsIgnored() {
        val q = ArchiveQueue(File(tmp.root, "q4"))
        q.enqueue("raw", "s1", "p1", "RAW-X", JSONObject(), byteArrayOf(1))
        assertEquals(0, q.signalCounts().values.sumOf { it.total })
    }

    // SDD-266: gcVerified 로 payload 가 지워진 VERIFIED 항목도 재생성(재기동·스윕) 후 총량에 남는다
    @Test fun verifiedItemsStayCountedAfterGcAndReload() {
        val dir = File(tmp.root, "q5")
        val q = ArchiveQueue(dir)
        val items = (0 until 8).map { raw(q, "eeg", it) } + (0 until 8).map { raw(q, "ppg", it) } + (0 until 7).map { raw(q, "acc", it) }
        items.take(items.size - 3).forEach { it.status = ArchiveStatus.VERIFIED; q.update(it) }
        q.gcVerified()
        val c = ArchiveQueue(dir).signalCounts()
        assertEquals(8, c["eeg"]!!.total); assertEquals(8, c["ppg"]!!.total); assertEquals(7, c["acc"]!!.total)
    }

    @Test fun nonVerifiedItemWithoutPayloadIsStillSkipped() {
        val dir = File(tmp.root, "q6")
        val q = ArchiveQueue(dir)
        val a = raw(q, "eeg", 0); val b = raw(q, "eeg", 1)
        b.status = ArchiveStatus.VERIFIED; q.update(b)
        a.payloadFile.delete(); b.payloadFile.delete()
        val c = ArchiveQueue(dir).signalCounts()["eeg"]!!
        assertEquals(1, c.total); assertEquals(1, c.verified)
    }

    @Test fun aliasDedupeSurvivesGcAndReload() {
        val dir = File(tmp.root, "q7")
        val q = ArchiveQueue(dir)
        val a = raw(q, "eeg", 0); a.status = ArchiveStatus.VERIFIED; q.update(a); q.gcVerified()
        val q2 = ArchiveQueue(dir)
        raw(q2, "eeg", 0) // 같은 alias 재투입 → 새 청크로 세지 않는다
        assertEquals(1, q2.signalCounts()["eeg"]!!.total)
    }
}
