package com.looxidlabs.mindbreeze.measurement

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/** 프로세스가 죽었다 다시 뜬 뒤에도 같은 journal 에 이어 쓰고, 코어 상태가 끊김 없이 이어지는지(체크포인트 + 꼬리 재생). */
class ResumeTest {
    @get:Rule val tmp = TemporaryFolder()
    private val synth = File(System.getProperty("mb.contract.dir") ?: "../../contracts", "biosignal-golden/v1/synth")

    private class Rec(val arrivalUs: Long, val sensor: Sensor, val off: Int, val len: Int)

    private fun schedule(): List<Rec> {
        val a = JSONArray(File(synth, "schedule.json").readText())
        return List(a.length()) { i ->
            val r = a.getJSONArray(i)
            Rec(r.getLong(0), when (r.getString(1)) { "eeg" -> Sensor.EEG; "ppg" -> Sensor.PPG; else -> Sensor.ACC }, r.getInt(2), r.getInt(3))
        }
    }

    private fun feed(e: MeasurementEngine, gen: Long, blob: ByteArray, recs: List<Rec>, clock: LongArray) {
        for (r in recs) { clock[0] = r.arrivalUs / 1000; e.onNotification(gen, r.sensor, blob.copyOfRange(r.off, r.off + r.len)) }
    }

    @Test fun killAndResumeProducesSameFramesAsUninterruptedRun() {
        assumeTrue(MeasurementCore.available())
        val blob = File(synth, "stream.bin").readBytes(); val sched = schedule().take(2400)
        val clock = LongArray(1)
        // 기준: 중단 없는 실행
        val base = ArrayList<String>()
        val e0 = MeasurementEngine.openOrResume(File(tmp.root, "base.journal"), File(tmp.root, "base.ck"), clockMs = { clock[0] }, syncEach = false, wallAnchorMs = 1_760_000_000_000L, anchorMonoUs = 0L, checkpointEveryPackets = 100)
        e0.frameSink = { base += it.getString("feature_hash") }
        feed(e0, e0.fence.acquire(), blob, sched, clock); e0.close()

        // 중단 실행: 1234 번째 패킷 후 "프로세스 사망"(close/destroy 없이 버림) → 재생성
        val jf = File(tmp.root, "a.journal"); val ck = File(tmp.root, "a.ck")
        val got = ArrayList<String>()
        val e1 = MeasurementEngine.openOrResume(jf, ck, clockMs = { clock[0] }, syncEach = true, wallAnchorMs = 1_760_000_000_000L, anchorMonoUs = 0L, checkpointEveryPackets = 100)
        e1.frameSink = { got += it.getString("feature_hash") }
        feed(e1, e1.fence.acquire(), blob, sched.take(1234), clock)
        // 사망: 핸들을 닫지 않는다. 다음 프로세스는 파일만 본다.
        val e2 = MeasurementEngine.openOrResume(jf, ck, clockMs = { clock[0] }, syncEach = true, wallAnchorMs = 1_760_000_000_000L, anchorMonoUs = 0L, checkpointEveryPackets = 100)
        val afterResume = ArrayList<String>()
        e2.frameSink = { afterResume += it.getString("feature_hash") }
        assertEquals("이어쓰기: 기존 journal 레코드 보존", 1234L, e2.journalCount)
        feed(e2, e2.fence.acquire(), blob, sched.drop(1234), clock)
        assertEquals(2400L, e2.journalCount)
        // 이어쓴 이후 프레임들은 기준 실행의 같은 위치 프레임과 해시가 같아야 한다
        val merged = got.take(got.size - (got.size - base.indexOf(afterResume.first()).coerceAtLeast(0))) + afterResume
        assertTrue("재개 후 프레임 존재", afterResume.isNotEmpty())
        assertEquals(base.takeLast(afterResume.size), afterResume)
        assertTrue(merged.isNotEmpty())
    }

    @Test fun resumeWithoutCheckpointReplaysWholeJournal() {
        assumeTrue(MeasurementCore.available())
        val blob = File(synth, "stream.bin").readBytes(); val sched = schedule().take(800)
        val clock = LongArray(1)
        val jf = File(tmp.root, "b.journal"); val ck = File(tmp.root, "b.ck")
        val e1 = MeasurementEngine.openOrResume(jf, ck, clockMs = { clock[0] }, syncEach = false, wallAnchorMs = 1_760_000_000_000L, anchorMonoUs = 0L, checkpointEveryPackets = 100000)
        val first = ArrayList<String>(); e1.frameSink = { first += it.getString("feature_hash") }
        feed(e1, e1.fence.acquire(), blob, sched, clock)
        val e2 = MeasurementEngine.openOrResume(jf, ck, clockMs = { clock[0] }, syncEach = false, wallAnchorMs = 1_760_000_000_000L, anchorMonoUs = 0L, checkpointEveryPackets = 100000)
        val replayed = ArrayList<String>(); e2.frameSink = { replayed += it.getString("feature_hash") }
        e2.replayPending()
        assertEquals(first, replayed)
    }

    @Test fun corruptCheckpointFallsBackToFullReplay() {
        assumeTrue(MeasurementCore.available())
        val blob = File(synth, "stream.bin").readBytes(); val sched = schedule().take(500)
        val clock = LongArray(1)
        val jf = File(tmp.root, "c.journal"); val ck = File(tmp.root, "c.ck")
        val e1 = MeasurementEngine.openOrResume(jf, ck, clockMs = { clock[0] }, syncEach = false, wallAnchorMs = 1_760_000_000_000L, anchorMonoUs = 0L, checkpointEveryPackets = 50)
        feed(e1, e1.fence.acquire(), blob, sched, clock)
        assertTrue(ck.exists())
        ck.writeBytes(ByteArray(64) { 7 }) // 손상
        val e2 = MeasurementEngine.openOrResume(jf, ck, clockMs = { clock[0] }, syncEach = false, wallAnchorMs = 1_760_000_000_000L, anchorMonoUs = 0L, checkpointEveryPackets = 50)
        assertNull("손상 체크포인트는 전체 재생으로 대체", e2.coreError)
        assertEquals(500L, e2.journalCount)
    }

    @Test fun tornJournalTailIsTruncatedOnResume() {
        assumeTrue(MeasurementCore.available())
        val blob = File(synth, "stream.bin").readBytes(); val sched = schedule().take(300)
        val clock = LongArray(1)
        val jf = File(tmp.root, "d.journal"); val ck = File(tmp.root, "d.ck")
        val e1 = MeasurementEngine.openOrResume(jf, ck, clockMs = { clock[0] }, syncEach = true, wallAnchorMs = 1_760_000_000_000L, anchorMonoUs = 0L, checkpointEveryPackets = 100)
        feed(e1, e1.fence.acquire(), blob, sched, clock)
        java.io.FileOutputStream(jf, true).use { it.write(byteArrayOf(0, 0, 1, 0, 9, 9)) } // 쓰기 중 사망한 찢긴 꼬리
        val e2 = MeasurementEngine.openOrResume(jf, ck, clockMs = { clock[0] }, syncEach = true, wallAnchorMs = 1_760_000_000_000L, anchorMonoUs = 0L, checkpointEveryPackets = 100)
        assertEquals(300L, e2.journalCount)
    }
}
