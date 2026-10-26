package com.looxidlabs.mindbreeze.measurement

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class RawPreviewBufferTest {
    @get:Rule val tmp = TemporaryFolder()

    @Test fun emptyBufferGivesEmptyArrays() {
        val p = RawPreviewBuffer().preview(120)
        assertTrue(p.eegFp1.isEmpty() && p.eegFp2.isEmpty() && p.ppgRed.isEmpty() && p.ppgIr.isEmpty())
    }

    @Test fun dropsOldestBeyondCapacity() {
        val b = RawPreviewBuffer(eegCapacity = 10, ppgCapacity = 4)
        b.addEeg(List(15) { EegSample(false, false, it.toDouble(), -it.toDouble()) })
        b.addPpg(List(6) { PpgSample(it, it * 2) })
        val p = b.preview(100)
        assertEquals(listOf(5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0), p.eegFp1)
        assertEquals(listOf(2.0, 3.0, 4.0, 5.0), p.ppgRed)
        assertEquals(listOf(4.0, 6.0, 8.0, 10.0), p.ppgIr)
    }

    @Test fun downsamplesKeepingFirstAndLast() {
        val b = RawPreviewBuffer(eegCapacity = 1000, ppgCapacity = 1000)
        b.addEeg(List(1000) { EegSample(false, false, it.toDouble(), 0.0) })
        val p = b.preview(120)
        assertEquals(120, p.eegFp1.size)
        assertEquals(0.0, p.eegFp1.first(), 0.0)
        assertEquals(999.0, p.eegFp1.last(), 0.0)
    }

    @Test fun engineFillsPreviewFromPackets() {
        val e = MeasurementEngine(File(tmp.root, "p.journal"), clockMs = { 1000 }, syncEach = false); e.open()
        val gen = e.fence.acquire()
        val hdr = byteArrayOf(0, 0, 0, 0)
        e.onNotification(gen, Sensor.EEG, hdr + ByteArray(7 * 25) { if (it % 7 == 3) 5 else 0 })
        e.onNotification(gen, Sensor.PPG, hdr + ByteArray(6 * 10) { if (it % 3 == 2) 9 else 0 })
        val p = e.rawPreview(120)
        assertEquals(25, p.eegFp1.size)
        assertEquals(10, p.ppgRed.size)
        assertEquals(10, p.ppgIr.size)
        e.close()
    }
}
