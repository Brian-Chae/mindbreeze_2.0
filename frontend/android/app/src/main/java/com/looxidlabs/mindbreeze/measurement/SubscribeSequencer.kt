package com.looxidlabs.mindbreeze.measurement

/**
 * 밴드 CCCD 구독을 한 번에 하나씩 직렬화한다(Android GATT 는 동시 descriptor 쓰기를 허용하지 않는다).
 * - write 가 false(GATT 바쁨)면 RETRY_DELAY_MS 후 최대 MAX_RETRIES 번 재시도한다. 이전 구현은 반환값을 무시해 큐가 조용히 멈췄다.
 * - 콜백이 CALLBACK_TIMEOUT_MS 안에 오지 않으면 실패로 끝낸다(호출자가 재연결).
 * 안드로이드에 의존하지 않아 JVM 에서 시험한다. 모든 호출은 같은 스레드(메인 핸들러)에서 한다.
 */
class SubscribeSequencer(
    private val count: Int,
    private val write: (index: Int) -> Boolean,
    /** (delayMs, fn) 예약 → 취소 함수 */
    private val post: (Long, () -> Unit) -> () -> Unit,
    private val onDone: () -> Unit,
    private val onFail: (String) -> Unit,
) {
    private var index = 0
    private var retries = 0
    private var active = false
    private var cancelTimer: (() -> Unit)? = null

    fun start() { active = true; index = 0; retries = 0; attempt() }

    fun stop() { active = false; cancelTimer?.invoke(); cancelTimer = null }

    /** onDescriptorWrite 콜백. success=false 면 즉시 실패. */
    fun onWritten(success: Boolean) {
        if (!active) return
        cancelTimer?.invoke(); cancelTimer = null
        if (!success) { fail("write_failed:$index"); return }
        index++; retries = 0
        if (index >= count) { active = false; onDone() } else attempt()
    }

    private fun attempt() {
        if (!active) return
        if (write(index)) {
            cancelTimer = post(CALLBACK_TIMEOUT_MS) { if (active) fail("callback_timeout:$index") }
        } else if (retries < MAX_RETRIES) {
            retries++
            cancelTimer = post(RETRY_DELAY_MS) { attempt() }
        } else fail("write_rejected:$index")
    }

    private fun fail(reason: String) { active = false; cancelTimer?.invoke(); cancelTimer = null; onFail(reason) }

    companion object {
        const val RETRY_DELAY_MS = 300L
        const val MAX_RETRIES = 5
        const val CALLBACK_TIMEOUT_MS = 4000L
    }
}
