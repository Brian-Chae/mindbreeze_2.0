package com.looxidlabs.mindbreeze.measurement

import android.content.Context
import android.os.PowerManager
import android.os.SystemClock
import java.io.File

/**
 * 프로세스 단일 측정 관리자. Activity/WebView 와 무관하게 Service 가 보유한다.
 * 플러그인(WebView)은 같은 프로세스의 이 객체에 직접 붙어 조회한다.
 */
object MeasurementManager {
    val gate = SingleServiceGate()
    val ownership = BandOwnership()

    @Volatile var state: MeasurementState = MeasurementState.IDLE
        private set
    @Volatile var engine: MeasurementEngine? = null
        private set
    @Volatile var startedAtMonoMs: Long = 0
        private set
    @Volatile var synthetic: Boolean = false
        private set
    @Volatile var wakeLockHeld: Boolean = false
        private set
    @Volatile var blockedReason: String? = null
        private set
    @Volatile var serviceStarts: Long = 0
        private set

    private var wakeLock: PowerManager.WakeLock? = null
    private var wakeAcquiredAt = 0L
    private const val WAKE_TIMEOUT_MS = 10 * 60 * 1000L
    private const val WAKE_RENEW_MS = 4 * 60 * 1000L

    @Synchronized fun setState(s: MeasurementState, reason: String? = null) { state = s; blockedReason = reason }
    @Synchronized fun noteServiceStart() { serviceStarts++ }

    @Synchronized
    fun begin(ctx: Context, isSynthetic: Boolean): MeasurementEngine {
        engine?.let { return it }
        val dir = File(ctx.filesDir, "measurement").apply { mkdirs() }
        val e = MeasurementEngine(File(dir, "raw-${System.currentTimeMillis()}.journal"))
        e.open()
        engine = e; synthetic = isSynthetic
        startedAtMonoMs = SystemClock.elapsedRealtime()
        return e
    }

    /** NativeRuntime 이 만든 엔진(코어 포함, 복구 이어쓰기)을 채택한다. */
    @Synchronized
    fun adopt(e: MeasurementEngine, isSynthetic: Boolean, rt: com.looxidlabs.mindbreeze.measurement.runtime.NativeRuntime?) {
        engine = e; synthetic = isSynthetic; runtime = rt
        com.looxidlabs.mindbreeze.measurement.runtime.NativeRuntimeHolder.set(rt)
        startedAtMonoMs = SystemClock.elapsedRealtime()
    }

    @Volatile var runtime: com.looxidlabs.mindbreeze.measurement.runtime.NativeRuntime? = null
        private set

    @Synchronized
    fun end() {
        runtime = null
        com.looxidlabs.mindbreeze.measurement.runtime.NativeRuntimeHolder.set(null)
        engine?.close(); engine = null
        releaseWake()
        state = MeasurementState.CLOSED
    }

    /** CAPTURING 구간에만 partial wakelock. timeout 으로 누수를 막고 수신 경로에서 갱신한다. */
    @Synchronized
    fun ensureWake(ctx: Context) {
        if (engine == null) return
        val now = SystemClock.elapsedRealtime()
        if (wakeLock?.isHeld == true && now - wakeAcquiredAt < WAKE_RENEW_MS) return
        val pm = ctx.applicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager
        val wl = wakeLock ?: pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "mindbreeze:measurement").also {
            it.setReferenceCounted(false); wakeLock = it
        }
        wl.acquire(WAKE_TIMEOUT_MS)
        wakeAcquiredAt = now; wakeLockHeld = true
    }

    @Synchronized
    fun releaseWake() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLockHeld = false
    }

    fun snapshotMap(): Map<String, Any?> {
        val e = engine
        val c = e?.counters?.snapshot()
        val now = SystemClock.elapsedRealtime()
        return mapOf(
            "state" to state.name, "blockedReason" to blockedReason, "synthetic" to synthetic,
            "wakeLockHeld" to wakeLockHeld, "serviceStarts" to serviceStarts,
            "uptimeMs" to if (e != null) now - startedAtMonoMs else 0L,
            "eegPackets" to (c?.eegPackets ?: 0L), "ppgPackets" to (c?.ppgPackets ?: 0L), "accPackets" to (c?.accPackets ?: 0L),
            "eegSamples" to (c?.eegSamples ?: 0L), "ppgSamples" to (c?.ppgSamples ?: 0L), "accSamples" to (c?.accSamples ?: 0L),
            "invalidPackets" to (c?.invalidPackets ?: 0L), "fencedCallbacks" to (c?.fencedCallbacks ?: 0L),
            "frames" to (c?.frames ?: 0L), "lastWindowIndex" to (c?.lastWindowIndex ?: -1L),
            "journalRecords" to (e?.journalCount ?: 0L), "journalBytes" to (e?.journalBytes ?: 0L),
            "reconnects" to (c?.reconnects ?: 0L),
            "msSinceLastNotification" to if (c != null && c.lastNotificationMonoMs > 0) now - c.lastNotificationMonoMs else -1L,
            "rmsCh1Uv" to e?.lastFrame?.rmsCh1Uv, "rmsCh2Uv" to e?.lastFrame?.rmsCh2Uv,
            "nativeOwnerFlag" to ownership.nativeEnabled, "owner" to ownership.current().name,
        )
    }
}
