package com.looxidlabs.mindbreeze.measurement

import android.content.Context
import android.os.Handler
import android.os.HandlerThread
import kotlin.math.sin

/**
 * 밴드 없이 서비스 생존·Doze 동작을 시험하기 위한 합성 패킷 생성기(실측 아님, 결과에 synthetic=true 로 표기).
 * 100ms 마다 EEG 25샘플 / PPG 5샘플 / ACC 패킷을 장치 tick 기준으로 만든다.
 */
class SyntheticSource(private val ctx: Context, private val engine: MeasurementEngine) {
    private val thread = HandlerThread("synthetic-band").apply { start() }
    private val handler = Handler(thread.looper)
    private var gen = 0L
    private var tick = 0L
    private var n = 0L
    @Volatile private var running = false

    private val task = object : Runnable {
        override fun run() {
            if (!running) return
            engine.onNotification(gen, Sensor.EEG, eeg())
            engine.onNotification(gen, Sensor.PPG, ppg())
            if (n % 3 == 0L) engine.onNotification(gen, Sensor.ACC, acc())
            MeasurementManager.ensureWake(ctx)
            tick += DEVICE_TICK_HZ / 10
            n++
            handler.postDelayed(this, 100)
        }
    }

    fun start() {
        gen = engine.fence.acquire(); running = true
        MeasurementManager.setState(MeasurementState.CAPTURING)
        handler.post(task)
    }

    fun stop() {
        running = false
        handler.removeCallbacksAndMessages(null)
        engine.fence.release(gen)
        thread.quitSafely()
    }

    private fun hdr(t: Long) = byteArrayOf(t.toByte(), (t shr 8).toByte(), (t shr 16).toByte(), (t shr 24).toByte())

    private fun eeg(): ByteArray {
        val b = java.io.ByteArrayOutputStream(); b.write(hdr(tick))
        repeat(25) { i ->
            val v = (sin((n * 25 + i) * 0.05) * 20000).toInt()
            b.write(0)
            for (ch in 0..1) { val x = if (ch == 0) v else -v; b.write((x shr 16) and 0xFF); b.write((x shr 8) and 0xFF); b.write(x and 0xFF) }
        }
        return b.toByteArray()
    }

    private fun ppg(): ByteArray = hdr(tick) + ByteArray(5 * 6) { (it * 7).toByte() }
    private fun acc(): ByteArray = hdr(tick) + ByteArray(3 * 6)
}
