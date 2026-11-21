package com.looxidlabs.mindbreeze.measurement

/**
 * SDD-331 재연결 정책(순수 로직 — 시계는 호출부가 넘긴다). JS `reconnect-policy.ts`, iOS `ReconnectBackoff` 와 같은 값.
 * 밴드 펌웨어는 끊긴 뒤 0~2분 안에 sleep 하므로, 끊긴 직후 120초는 2~3초 고정 간격으로 촘촘히 붙이고 시도마다 10초로 끊는다.
 * 120초 뒤에는 기존 느린 백오프(1·2·4·8·15·30초)로 낮추고, 직접 연결이 연속 실패하면 스캔으로 같은 밴드를 다시 찾는다.
 */
class BandReconnectPolicy(private val random: () -> Double = { Math.random() }) {
    private var gapStartMs: Long? = null
    private var slowAttempt = 0
    /** 직접 연결 연속 실패 수 */
    var directFailures = 0
        private set

    /** 끊김 시작(또는 '다시 연결'/'깨웠어요') — 빠른 창을 다시 연다. */
    fun startWindow(nowMs: Long) { gapStartMs = nowMs; slowAttempt = 0; directFailures = 0 }

    val windowOpen: Boolean get() = gapStartMs != null

    /** 연결 성공 — 전부 초기화. */
    fun reset() { gapStartMs = null; slowAttempt = 0; directFailures = 0 }

    fun noteFailure() { directFailures += 1 }

    private fun elapsed(nowMs: Long): Long = gapStartMs?.let { nowMs - it } ?: 0L

    fun isFast(nowMs: Long): Boolean = elapsed(nowMs) < FAST_WINDOW_MS

    /** 연결 단계(connect) 제한 — 빠른 창은 10초, 이후 기존 30초. */
    fun connectTimeoutMs(nowMs: Long): Long = if (isFast(nowMs)) ATTEMPT_TIMEOUT_MS else SLOW_CONNECT_TIMEOUT_MS

    /** 다음 재시도까지 대기. 느린 단계에 있을 때만 백오프 단계가 오른다. */
    fun nextDelayMs(nowMs: Long): Long {
        if (isFast(nowMs)) return (FAST_INTERVAL_MS + (random() * 2 - 1) * FAST_JITTER_MS).toLong()
        val base = SLOW_STEPS_MS[minOf(slowAttempt, SLOW_STEPS_MS.size - 1)]
        slowAttempt += 1
        return (base * (1 + (random() * 2 - 1) * 0.2)).toLong()
    }

    /** 느린 단계에서 직접 연결이 SCAN_AFTER_FAILURES 회 연속 실패했으면 스캔으로 다시 찾는다. */
    fun shouldScan(nowMs: Long): Boolean = !isFast(nowMs) && directFailures >= SCAN_AFTER_FAILURES

    companion object {
        const val FAST_WINDOW_MS = 120_000L
        const val FAST_INTERVAL_MS = 2_500L
        const val FAST_JITTER_MS = 500.0
        const val ATTEMPT_TIMEOUT_MS = 10_000L
        const val SLOW_CONNECT_TIMEOUT_MS = 30_000L
        const val SCAN_AFTER_FAILURES = 2
        val SLOW_STEPS_MS = longArrayOf(1_000, 2_000, 4_000, 8_000, 15_000, 30_000)
    }
}
