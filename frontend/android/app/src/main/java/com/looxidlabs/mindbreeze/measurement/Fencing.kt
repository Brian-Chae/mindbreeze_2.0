package com.looxidlabs.mindbreeze.measurement

import java.util.concurrent.atomic.AtomicLong

/** GATT callback 세대 fencing. 새 연결을 만들면 이전 세대 콜백은 폐기된다. */
class InstanceFence {
    private val current = AtomicLong(0)
    private val seq = AtomicLong(0)

    fun acquire(): Long { val g = seq.incrementAndGet(); current.set(g); return g }
    fun isCurrent(gen: Long): Boolean = gen != 0L && current.get() == gen
    fun release(gen: Long): Boolean = current.compareAndSet(gen, 0)
}

/** 프로세스 내 MeasurementService 인스턴스는 하나만 활성. */
class SingleServiceGate {
    private var holder: String? = null

    @Synchronized
    fun tryStart(id: String): Boolean {
        if (holder == null || holder == id) { holder = id; return true }
        return false
    }

    @Synchronized
    fun stopped(id: String) { if (holder == id) holder = null }
}

data class CounterSnapshot(
    val eegPackets: Long, val ppgPackets: Long, val accPackets: Long,
    val invalidPackets: Long, val fencedCallbacks: Long, val eegSamples: Long,
    val ppgSamples: Long, val accSamples: Long, val frames: Long,
    val journalRecords: Long, val reconnects: Long,
    val lastWindowIndex: Long, val lastNotificationMonoMs: Long,
)

/** JS 와 무관한 native 카운터. */
class MeasurementCounters {
    private val eeg = AtomicLong(); private val ppg = AtomicLong(); private val acc = AtomicLong()
    private val invalid = AtomicLong(); private val fenced = AtomicLong()
    private val eegS = AtomicLong(); private val ppgS = AtomicLong(); private val accS = AtomicLong()
    private val frames = AtomicLong(); private val journal = AtomicLong(); private val reconnects = AtomicLong()
    private val lastWindow = AtomicLong(-1); private val lastNotif = AtomicLong(0)

    /** 현재 세대의 콜백만 카운트하고 true. 구 세대는 fenced 로 집계하고 false. */
    fun acceptNotification(fence: InstanceFence, gen: Long, sensor: Sensor, @Suppress("UNUSED_PARAMETER") size: Int, nowMonoMs: Long = 0): Boolean {
        if (!fence.isCurrent(gen)) { fenced.incrementAndGet(); return false }
        when (sensor) { Sensor.EEG -> eeg.incrementAndGet(); Sensor.PPG -> ppg.incrementAndGet(); Sensor.ACC -> acc.incrementAndGet() }
        lastNotif.set(nowMonoMs)
        return true
    }

    fun invalid() = invalid.incrementAndGet()
    fun samples(sensor: Sensor, n: Int) {
        when (sensor) { Sensor.EEG -> eegS.addAndGet(n.toLong()); Sensor.PPG -> ppgS.addAndGet(n.toLong()); Sensor.ACC -> accS.addAndGet(n.toLong()) }
    }
    fun frame(windowIndex: Long) { frames.incrementAndGet(); lastWindow.set(windowIndex) }
    fun journaled() = journal.incrementAndGet()
    fun reconnected() = reconnects.incrementAndGet()

    fun snapshot() = CounterSnapshot(
        eeg.get(), ppg.get(), acc.get(), invalid.get(), fenced.get(), eegS.get(), ppgS.get(), accS.get(),
        frames.get(), journal.get(), reconnects.get(), lastWindow.get(), lastNotif.get(),
    )
}

/** 같은 밴드를 JS BLE 플러그인과 native 가 동시에 소유하지 않게 하는 플래그(기본 off = 기존 JS 경로). */
class BandOwnership {
    enum class Owner { NONE, JS, NATIVE }

    @Volatile var nativeEnabled: Boolean = false
    private var owner = Owner.NONE

    @Synchronized
    fun claim(who: Owner): Boolean {
        if (who == Owner.NATIVE && !nativeEnabled) return false
        if (owner == Owner.NONE || owner == who) { owner = who; return true }
        return false
    }

    @Synchronized fun release(who: Owner) { if (owner == who) owner = Owner.NONE }
    @Synchronized fun current(): Owner = owner
}
