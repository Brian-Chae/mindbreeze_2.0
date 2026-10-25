package com.looxidlabs.mindbreeze.measurement

import org.junit.Assert.*
import org.junit.Test

class MetricFramerTest {
    private fun eegPacket(tick: Long, n: Int, ch1Raw: Int = 1000): Packet {
        val s = List(n) { EegSample(false, false, ch1Raw * 0.000480, -ch1Raw * 0.000480) }
        return Packet(Sensor.EEG, tick, n, 0, eeg = s)
    }

    @Test fun emitsOneFramePerDeviceSecondRegardlessOfArrivalTime() {
        val fr = MetricFramer()
        val frames = ArrayList<MetricFrame>()
        // 25샘플 = 0.1초 패킷, 10초 분량을 도착시각 0으로 몰아서 넣어도 장치 clock 기준 1Hz
        var tick = 32768L * 100
        repeat(100) { frames += fr.onPacket(eegPacket(tick, 25)); tick += 3277 }
        assertTrue("frames=${frames.size}", frames.size in 9..10)
        val idx = frames.map { it.windowIndex }
        assertEquals(idx.sorted(), idx)
        assertEquals(idx.size, idx.toSet().size)
    }

    @Test fun batchSizeDoesNotChangeFrameCount() {
        fun run(batch: Int): Int {
            val fr = MetricFramer(); var n = 0; var tick = 0L
            val total = 250 * 5
            var done = 0
            while (done < total) { n += fr.onPacket(eegPacket(tick, batch)).size; tick += (32768L * batch / 250); done += batch }
            return n
        }
        assertEquals(run(25), run(50))
    }

    @Test fun frameCarriesRmsAndLeadoffAndSampleCount() {
        val fr = MetricFramer(); var tick = 32768L * 10
        val out = ArrayList<MetricFrame>()
        repeat(12) { out += fr.onPacket(eegPacket(tick, 25)); tick += 3277 }
        val f = out.first()
        assertEquals(250, f.eegSamples, )
        assertTrue(f.rmsCh1Uv > 0.0)
        assertFalse(f.leadoffCh1)
    }

    @Test fun nonEegPacketsDoNotAdvanceClock() {
        val fr = MetricFramer()
        val ppg = Packet(Sensor.PPG, 32768L * 50, 1, 0, ppg = listOf(PpgSample(1, 2)))
        assertTrue(fr.onPacket(ppg).isEmpty())
    }
}
