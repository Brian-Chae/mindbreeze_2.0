package com.looxidlabs.mindbreeze.measurement

import org.junit.Assert.*
import org.junit.Test

/** 밴드 CCCD 구독 직렬화: 쓰기 거절 재시도 · 콜백 무응답 워치독 · stop 후 무발화. */
class SubscribeSequencerTest {
    private class FakeClock {
        var now = 0L
        private class Task(val at: Long, val fn: () -> Unit, var cancelled: Boolean = false)
        private val tasks = ArrayList<Task>()
        fun post(delayMs: Long, fn: () -> Unit): () -> Unit { val t = Task(now + delayMs, fn); tasks += t; return { t.cancelled = true } }
        fun advance(ms: Long) {
            val end = now + ms
            while (true) {
                val next = tasks.filter { !it.cancelled && it.at <= end }.minByOrNull { it.at } ?: break
                tasks.remove(next); now = next.at; next.fn()
            }
            now = end
        }
    }

    private class Probe(val clock: FakeClock, val accept: (Int, Int) -> Boolean) {
        val started = ArrayList<Int>(); var done = 0; var failed: String? = null
        private var attempts = HashMap<Int, Int>()
        val seq = SubscribeSequencer(3, write = { i -> val n = (attempts[i] ?: 0) + 1; attempts[i] = n; started += i; accept(i, n) },
            post = clock::post, onDone = { done++ }, onFail = { failed = it })
    }

    @Test fun subscribesInOrderThenDone() {
        val c = FakeClock(); val p = Probe(c) { _, _ -> true }
        p.seq.start(); assertEquals(listOf(0), p.started)
        p.seq.onWritten(true); assertEquals(listOf(0, 1), p.started)
        p.seq.onWritten(true); assertEquals(listOf(0, 1, 2), p.started)
        assertEquals(0, p.done)
        p.seq.onWritten(true); assertEquals(1, p.done); assertNull(p.failed)
    }

    @Test fun rejectedWriteIsRetriedAfterDelay() {
        val c = FakeClock(); val p = Probe(c) { i, n -> !(i == 1 && n < 3) }  // PPG 쓰기가 두 번 거절된 뒤 수락
        p.seq.start(); p.seq.onWritten(true)
        assertEquals(listOf(0, 1), p.started)
        c.advance(300); assertEquals(listOf(0, 1, 1), p.started)
        c.advance(300); assertEquals(listOf(0, 1, 1, 1), p.started)
        p.seq.onWritten(true); p.seq.onWritten(true)
        assertEquals(1, p.done); assertNull(p.failed)
    }

    @Test fun givesUpAfterMaxRetries() {
        val c = FakeClock(); val p = Probe(c) { i, _ -> i == 0 }
        p.seq.start(); p.seq.onWritten(true)
        c.advance(300 * 10)
        assertEquals("write_rejected:1", p.failed); assertEquals(0, p.done)
        assertEquals(1 + SubscribeSequencer.MAX_RETRIES + 1, p.started.size)
    }

    @Test fun watchdogFailsWhenCallbackNeverArrives() {
        val c = FakeClock(); val p = Probe(c) { _, _ -> true }
        p.seq.start(); p.seq.onWritten(true)
        c.advance(SubscribeSequencer.CALLBACK_TIMEOUT_MS - 1); assertNull(p.failed)
        c.advance(2); assertEquals("callback_timeout:1", p.failed)
        p.seq.onWritten(true)  // 늦게 온 콜백은 무시
        assertEquals(0, p.done); assertEquals(listOf(0, 1), p.started)
    }

    @Test fun failedStatusReportsFailure() {
        val c = FakeClock(); val p = Probe(c) { _, _ -> true }
        p.seq.start(); p.seq.onWritten(false)
        assertEquals("write_failed:0", p.failed)
    }

    @Test fun stopCancelsPendingRetryAndWatchdog() {
        val c = FakeClock(); val p = Probe(c) { i, _ -> i != 1 }
        p.seq.start(); p.seq.onWritten(true)   // idx1 거절 → 재시도 예약
        p.seq.stop(); c.advance(60_000)
        assertNull(p.failed); assertEquals(listOf(0, 1), p.started)
        val p2 = Probe(c) { _, _ -> true }; p2.seq.start(); p2.seq.stop(); c.advance(60_000)
        assertNull(p2.failed)
    }
}
