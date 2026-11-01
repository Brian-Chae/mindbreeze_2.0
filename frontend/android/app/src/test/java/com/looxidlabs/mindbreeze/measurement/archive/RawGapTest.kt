package com.looxidlabs.mindbreeze.measurement.archive

import com.looxidlabs.mindbreeze.measurement.Sensor
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/** SDD-270: raw segment 경계 = 구멍. 웹 capture-session.ts 의 규칙과 같은 사유로 남긴다. */
class RawGapTest {
    @get:Rule val tmp = TemporaryFolder()
    private val sid = "00000001-0000-4000-8000-000000000001"
    private val pid = "00000002-0000-4000-8000-000000000002"

    private fun pkt(sensor: Sensor, rows: Int, t: Long) = ByteArray(4 + rows * sensor.sampleBytes) { (it % 251).toByte() }.also { for (k in 0..3) it[k] = ((t shr (8 * k)) and 0xFF).toByte() }

    @Test fun tickJumpMakesObservedPacketGapBetweenLastAndFirstSample() {
        val gaps = ArrayList<RawGap>()
        val c = RawChunker(Sensor.EEG, sid, 0, 0, {}, {}, { gaps += it })
        for (i in 0 until 10) c.onPacket(pkt(Sensor.EEG, 25, 1000L + i * 3277), i * 100_000L, i + 1L)
        assertTrue(gaps.isEmpty())
        c.onPacket(pkt(Sensor.EEG, 25, 1000L + 10 * 3277 + 2 * 32768), 3_000_000L, 11)
        val g = gaps.single()
        assertEquals("eeg", g.signal); assertEquals("packet_gap", g.reason)
        assertEquals(RawIds.segmentId(sid, Sensor.EEG, 0), g.segmentId)   // 끊기기 전(이전) segment
        assertEquals(900_000L, g.startUs)                                  // 이전 segment 마지막 샘플
        assertEquals(3_000_000L - 24 * 4_000L, g.endUs)                    // 새 segment 첫 샘플
    }

    @Test fun tickRewindIsClockReset() {
        val gaps = ArrayList<RawGap>()
        val c = RawChunker(Sensor.EEG, sid, 0, 0, {}, {}, { gaps += it })
        for (i in 0 until 5) c.onPacket(pkt(Sensor.EEG, 25, 100_000L + i * 3277), i * 100_000L, i + 1L)
        c.onPacket(pkt(Sensor.EEG, 25, 50L), 500_000L, 6)
        assertEquals("clock_reset", gaps.single().reason)
        // SDD-271: 되감김이어도 새 segment 첫 샘플 시각을 알므로 끝을 채운다(열린 구멍을 만들지 않는다)
        assertEquals(500_000L - 24 * 4_000L, gaps.single().endUs)
    }

    @Test fun overlappingRolloverKeepsEndNull() {
        val gaps = ArrayList<RawGap>()
        val c = RawChunker(Sensor.EEG, sid, 0, 0, {}, {}, { gaps += it })
        for (i in 0 until 5) c.onPacket(pkt(Sensor.EEG, 25, 100_000L + i * 3277), i * 100_000L, i + 1L)
        c.onPacket(pkt(Sensor.EEG, 25, 50L), 410_000L, 6) // 새 첫 샘플(314000)이 이전 마지막(400000)보다 앞 → 구멍 아님
        assertEquals(null, gaps.single().endUs)
    }

    @Test fun smoothStreamAndFirstSegmentMakeNoGap() {
        val gaps = ArrayList<RawGap>()
        val c = RawChunker(Sensor.PPG, sid, 0, 0, {}, {}, { gaps += it })
        for (i in 0 until 50) c.onPacket(pkt(Sensor.PPG, 10, 1000L + i * 6554), i * 200_000L, i + 1L)
        assertTrue(gaps.isEmpty())
    }

    private fun archiver(store: GapEventStore, reconnects: () -> Long = { 0L }, state: String = "raw.json") =
        RawArchiver(ArchiveQueue(File(tmp.root, "q")), sid, { pid }, File(tmp.root, state), store, reconnects)
    private fun gapStore() = GapEventStore(File(tmp.root, "gap-events.json"), sid) { 9L }

    @Test fun reconnectBeforeRolloverMakesBleDisconnectForEverySignal() {
        val store = gapStore(); var rc = 0L
        val a = archiver(store, { rc })
        for (i in 0 until 10) { a.onPacket(Sensor.EEG, i * 100_000L, pkt(Sensor.EEG, 25, 1000L + i * 3277)) }
        rc = 1
        a.onPacket(Sensor.EEG, 3_000_000L, pkt(Sensor.EEG, 25, 1000L + 10 * 3277 + 2 * 32768))
        val e = store.pending(50).single().event
        assertEquals("ble_disconnect", e.getString("reason")); assertEquals(1L, e.getLong("reconnect_count"))
        assertEquals("eeg", e.getString("signal"))
    }

    @Test fun processRestartMakesEstimatedProcessTerminatedGapOnFirstLivePacket() {
        val store = gapStore()
        val a = archiver(store)
        for (i in 0 until 10) a.onPacket(Sensor.EEG, i * 100_000L, pkt(Sensor.EEG, 25, 1000L + i * 3277))
        a.flush() // 청크 봉인 + 상태 저장 후 프로세스 종료를 가정
        val b = archiver(store) // 재생성: 상태 파일을 읽는다
        assertTrue(store.pending(50).isEmpty())  // 재생성만으로는 만들지 않는다(첫 실시간 패킷에서)
        b.onPacket(Sensor.EEG, 60_000_000L, pkt(Sensor.EEG, 25, 1000L + 600 * 3277))
        val e = store.pending(50).single().event
        assertEquals("process_terminated", e.getString("reason")); assertEquals("estimated", e.getString("observed_or_estimated"))
        assertEquals("900000", e.getString("start_us"))
        b.onPacket(Sensor.EEG, 60_100_000L, pkt(Sensor.EEG, 25, 1000L + 601 * 3277))
        assertEquals(1, store.pending(50).size) // 한 번만
    }

    @Test fun replayingTheSameJournalTwiceDoesNotDuplicateGaps() {
        val store = gapStore(); var rc = 0L
        val a = archiver(store, { rc })
        for (i in 0 until 10) a.onPacket(Sensor.EEG, i * 100_000L, pkt(Sensor.EEG, 25, 1000L + i * 3277))
        rc = 1
        a.onPacket(Sensor.EEG, 3_000_000L, pkt(Sensor.EEG, 25, 1000L + 10 * 3277 + 2 * 32768))
        val id = store.pending(50).single().event.getString("event_id")
        // 같은 구멍을 다시 관측(복구 재생) → 같은 id → 행 늘지 않음
        val again = store.append("eeg", store.pending(1)[0].event.getString("stream_id"), store.pending(1)[0].event.getString("segment_id"), 900_000L, 2_904_000L, "ble_disconnect", "observed", 1)
        assertNull(again); assertEquals(1, store.pending(50).size); assertEquals(id, store.pending(50)[0].event.getString("event_id"))
    }
}
