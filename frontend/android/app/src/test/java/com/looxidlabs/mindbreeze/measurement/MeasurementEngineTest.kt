package com.looxidlabs.mindbreeze.measurement

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class MeasurementEngineTest {
    @get:Rule val tmp = TemporaryFolder()

    private fun hdr(t: Long) = byteArrayOf(t.toByte(), (t shr 8).toByte(), (t shr 16).toByte(), (t shr 24).toByte())
    private fun eeg(tick: Long, n: Int) = hdr(tick) + ByteArray(n * 7) { if (it % 7 == 3) 5 else 0 }

    @Test fun journalsRawBeforeParseAndCountsFrames() {
        val f = File(tmp.root, "e.journal")
        val e = MeasurementEngine(f, clockMs = { 1000 }, syncEach = false); e.open()
        val gen = e.fence.acquire()
        var tick = 0L
        repeat(60) { assertTrue(e.onNotification(gen, Sensor.EEG, eeg(tick, 25))); tick += 3277 }
        e.onNotification(gen, Sensor.EEG, ByteArray(3)) // 잘린 패킷도 원문 보존
        val c = e.counters.snapshot()
        assertEquals(61L, c.eegPackets)
        assertEquals(1500L, c.eegSamples)
        assertEquals(1L, c.invalidPackets)
        assertEquals(61L, c.journalRecords)
        assertTrue("frames=${c.frames}", c.frames in 5..6)
        e.close()
        assertEquals(61, AppendOnlyJournal.recover(f).records.size)
    }

    @Test fun staleGenerationDoesNotTouchJournal() {
        val f = File(tmp.root, "s.journal")
        val e = MeasurementEngine(f, clockMs = { 1 }, syncEach = false); e.open()
        val old = e.fence.acquire(); val cur = e.fence.acquire()
        assertFalse(e.onNotification(old, Sensor.EEG, eeg(0, 25)))
        assertTrue(e.onNotification(cur, Sensor.EEG, eeg(0, 25)))
        assertEquals(1L, e.counters.snapshot().journalRecords)
        assertEquals(1L, e.counters.snapshot().fencedCallbacks)
    }

    @Test fun tickWrapDoesNotCreateGiantFrameGap() {
        val e = MeasurementEngine(File(tmp.root, "w.journal"), clockMs = { 1 }, syncEach = false); e.open()
        val g = e.fence.acquire()
        var tick = 0xFFFFFFFFL - 3277L * 5
        repeat(20) { e.onNotification(g, Sensor.EEG, eeg(tick and 0xFFFFFFFFL, 25)); tick += 3277 }
        val c = e.counters.snapshot()
        assertTrue("frames=${c.frames}", c.frames in 1..3)
        assertTrue(c.lastWindowIndex > 0)
    }

    @Test fun ownershipFlagDefaultOffBlocksNative() {
        val o = BandOwnership()
        assertFalse(o.claim(BandOwnership.Owner.NATIVE))
        assertTrue(o.claim(BandOwnership.Owner.JS))
        o.nativeEnabled = true
        assertFalse(o.claim(BandOwnership.Owner.NATIVE))   // JS 소유 중
        o.release(BandOwnership.Owner.JS)
        assertTrue(o.claim(BandOwnership.Owner.NATIVE))
        assertFalse(o.claim(BandOwnership.Owner.JS))
    }
}
