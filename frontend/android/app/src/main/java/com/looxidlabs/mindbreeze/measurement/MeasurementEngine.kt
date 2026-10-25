package com.looxidlabs.mindbreeze.measurement

import android.os.SystemClock
import java.io.File

enum class MeasurementState { IDLE, ARMING, CAPTURING, RECONNECTING, SEALING, CLOSED, BLOCKED }

/** 패킷 수신 → journal(fsync) → 1Hz 프레임 → 카운터. BLE/Android 에 의존하지 않아 JVM 단위 시험이 가능하다. */
class MeasurementEngine(
    private val journalFile: File,
    private val clockMs: () -> Long = { SystemClock.elapsedRealtime() },
    private val syncEach: Boolean = true,
) {
    val counters = MeasurementCounters()
    val fence = InstanceFence()
    private val unwrap = TickUnwrapper()
    private val framer = MetricFramer()
    private var journal: AppendOnlyJournal? = null
    @Volatile var lastFrame: MetricFrame? = null
        private set

    fun open() { journal = AppendOnlyJournal.open(journalFile, syncEach) }

    /** 세대(gen)가 현재가 아니면 폐기. 반환: 처리됐는지. */
    @Synchronized
    fun onNotification(gen: Long, sensor: Sensor, bytes: ByteArray): Boolean {
        val now = clockMs()
        if (!counters.acceptNotification(fence, gen, sensor, bytes.size, now)) return false
        val j = journal ?: return false
        // 원문 먼저 영속화 후 파싱(파싱 실패 원문도 보관)
        j.append(JournalRecord(sensor, now, bytes)); counters.journaled()
        when (val r = PacketParser.parse(sensor, bytes)) {
            is ParseResult.Invalid -> counters.invalid()
            is ParseResult.Ok -> {
                val p = r.packet
                counters.samples(sensor, p.sampleCount)
                if (sensor == Sensor.EEG) {
                    val ext = p.copy(rawTick = unwrap.unwrap(sensor, p.rawTick))
                    for (f in framer.onPacket(ext)) { lastFrame = f; counters.frame(f.windowIndex) }
                }
            }
        }
        return true
    }

    @Synchronized fun close() { journal?.close(); journal = null }
    val journalCount get() = journal?.count ?: 0L
    val journalBytes get() = journal?.bytesWritten ?: 0L
}
