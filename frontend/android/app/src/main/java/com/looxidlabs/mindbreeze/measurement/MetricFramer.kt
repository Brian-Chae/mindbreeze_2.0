package com.looxidlabs.mindbreeze.measurement

import kotlin.math.sqrt

/** 장치 sample clock 기준 1Hz 간이 프레임(SPIKE 용 RMS/leadoff — 실제 DSP 는 T02 Rust 코어로 대체). */
data class MetricFrame(
    val windowIndex: Long, val eegSamples: Int,
    val rmsCh1Uv: Double, val rmsCh2Uv: Double,
    val leadoffCh1: Boolean, val leadoffCh2: Boolean,
)

class MetricFramer {
    private var cur = -1L
    private var n = 0
    private var s1 = 0.0; private var s2 = 0.0
    private var lo1 = false; private var lo2 = false

    /** rawTick 은 wrap 확장된 값이어야 한다. 도착 시각은 전혀 사용하지 않는다. */
    fun onPacket(p: Packet): List<MetricFrame> {
        val eeg = p.eeg ?: return emptyList()
        val out = ArrayList<MetricFrame>(1)
        for (i in eeg.indices) {
            val w = (p.rawTick * 250 + i.toLong() * DEVICE_TICK_HZ) / (DEVICE_TICK_HZ * 250)
            if (cur < 0) cur = w
            if (w > cur) { flush()?.let(out::add); cur = w }
            val s = eeg[i]
            n++; s1 += s.ch1Uv * s.ch1Uv; s2 += s.ch2Uv * s.ch2Uv
            lo1 = lo1 || s.leadoffCh1; lo2 = lo2 || s.leadoffCh2
        }
        return out
    }

    private fun flush(): MetricFrame? {
        if (n == 0) return null
        val f = MetricFrame(cur, n, sqrt(s1 / n), sqrt(s2 / n), lo1, lo2)
        n = 0; s1 = 0.0; s2 = 0.0; lo1 = false; lo2 = false
        return f
    }
}
