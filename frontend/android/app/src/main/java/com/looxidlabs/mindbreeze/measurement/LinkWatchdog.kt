package com.looxidlabs.mindbreeze.measurement

/**
 * BLE 링크 워치독 (안드로이드 비의존 — JVM 시험 가능).
 * 1) 단계 워치독: connect → MTU → 서비스 발견 중 하나의 콜백이 오지 않으면 [onTimeout] (호출자가 gen fence 를 유지한 채 재연결).
 * 2) 무수신 워치독: 구독 완료 후 [SILENCE_MS] 동안 패킷이 없으면 [onTimeout].
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
        scheduleCheck()
    }

    fun stopSilence() { silenceActive = false; cancelSilence?.invoke(); cancelSilence = null }

    /** 패킷 수신 시 호출. */
    fun touch() { lastPacketAt = now() }

    fun stop() { stageDone(); stopSilence() }

    private fun scheduleCheck() {
        cancelSilence = post(CHECK_INTERVAL_MS) {
            if (!silenceActive) return@post
            val quiet = now() - lastPacketAt
            if (quiet >= SILENCE_MS) {
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
    }
}
