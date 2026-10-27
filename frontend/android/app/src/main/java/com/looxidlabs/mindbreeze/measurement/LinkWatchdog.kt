package com.looxidlabs.mindbreeze.measurement

/**
 * BLE 링크 워치독 (안드로이드 비의존 — JVM 시험 가능).
 * 1) 단계 워치독: connect → MTU → 서비스 발견 중 하나의 콜백이 오지 않으면 [onTimeout] (호출자가 gen fence 를 유지한 채 재연결).
 * 2) 무수신 워치독: 구독 완료 후 [SILENCE_MS] 동안 패킷이 없으면 [onTimeout].
 *    Doze/CPU 수면 직후에는 점검 타이머(uptime 기준)가 BLE 콜백보다 먼저 돌아 무수신으로 오판할 수 있다.
 *    그래서 "직전 점검 이후 경과가 점검 주기를 크게 초과"(= 타이머 지연 = CPU 수면)한 점검에서 무수신이면
 *    재연결하지 않고 1회 유예한다. 다음 점검에서도 무수신일 때만 재연결한다.
 * [post] 는 (delayMs, fn) 예약 → 취소 함수. [now] 는 단조 시각(ms). 상태 갱신([touch])은 다른 스레드에서 불려도 안전하다.
 */
class LinkWatchdog(
    private val post: (Long, () -> Unit) -> () -> Unit,
    private val now: () -> Long,
    private val onTimeout: (String) -> Unit,
) {
    private var cancelStage: (() -> Unit)? = null
    private var cancelSilence: (() -> Unit)? = null
    @Volatile private var lastPacketAt = 0L
    @Volatile private var silenceActive = false
    @Volatile private var lastCheckAt = 0L
    @Volatile private var graceUsed = false

    /** 단계 시작. 이전 단계는 취소된다. 제한시간 안에 [stageDone] 이 없으면 timeout. */
    fun armStage(name: String, timeoutMs: Long) {
        cancelStage?.invoke()
        cancelStage = post(timeoutMs) { cancelStage = null; onTimeout("stage_timeout:$name") }
    }

    fun stageDone() { cancelStage?.invoke(); cancelStage = null }

    /** 구독 완료 이후 호출. 패킷 무수신 감시 시작(시작 시점부터 [SILENCE_MS] 카운트). */
    fun startSilence() {
        stopSilence()
        silenceActive = true
        lastPacketAt = now()
        lastCheckAt = lastPacketAt
        graceUsed = false
        scheduleCheck()
    }

    fun stopSilence() { silenceActive = false; cancelSilence?.invoke(); cancelSilence = null }

    /** 패킷 수신 시 호출. */
    fun touch() { lastPacketAt = now(); graceUsed = false }

    fun stop() { stageDone(); stopSilence() }

    private fun scheduleCheck() {
        cancelSilence = post(CHECK_INTERVAL_MS) {
            if (!silenceActive) return@post
            val t = now()
            val quiet = t - lastPacketAt
            val sinceLastCheck = t - lastCheckAt
            lastCheckAt = t
            if (quiet >= SILENCE_MS) {
                // 타이머가 늦게 돌았다 = CPU 수면 직후. 밀린 BLE 콜백이 처리될 시간을 1회 준다.
                if (sinceLastCheck > CHECK_INTERVAL_MS + SLEEP_TOLERANCE_MS && !graceUsed) {
                    graceUsed = true
                    scheduleCheck()
                    return@post
                }
                silenceActive = false; cancelSilence = null
                onTimeout("silence:${quiet}ms")
            } else scheduleCheck()
        }
    }

    companion object {
        const val CONNECT_TIMEOUT_MS = 30_000L
        const val MTU_TIMEOUT_MS = 5_000L
        const val DISCOVER_TIMEOUT_MS = 10_000L
        const val SUBSCRIBE_TIMEOUT_MS = 20_000L
        const val SILENCE_MS = 5_000L
        const val CHECK_INTERVAL_MS = 1_000L
        /** 점검 주기 대비 이 값을 넘겨 늦게 돌면 CPU 수면(타이머 지연)으로 본다. */
        const val SLEEP_TOLERANCE_MS = 1_500L
    }
}
