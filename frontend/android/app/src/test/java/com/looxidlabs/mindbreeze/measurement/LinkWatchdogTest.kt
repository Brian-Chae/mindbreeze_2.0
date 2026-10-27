package com.looxidlabs.mindbreeze.measurement

import org.junit.Assert.*
import org.junit.Test

/** 단계 워치독(MTU·서비스 발견·구독 미응답) + 무수신 워치독. */
class LinkWatchdogTest {
    private class Clock {
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

    private fun make(c: Clock, fired: MutableList<String>) = LinkWatchdog(c::post, { c.now }, { fired += it })

    @Test fun stageTimeoutFiresWhenCallbackMissing() {
        val c = Clock(); val f = ArrayList<String>(); val w = make(c, f)
        w.armStage("mtu", 5_000)
        c.advance(4_999); assertTrue(f.isEmpty())
        c.advance(2); assertEquals(listOf("stage_timeout:mtu"), f)
    }

    @Test fun stageDoneCancelsTimeout() {
        val c = Clock(); val f = ArrayList<String>(); val w = make(c, f)
        w.armStage("discover", 10_000); w.stageDone()
        c.advance(60_000); assertTrue(f.isEmpty())
    }

    @Test fun nextStageReplacesPrevious() {
        val c = Clock(); val f = ArrayList<String>(); val w = make(c, f)
        w.armStage("mtu", 5_000); c.advance(3_000)
        w.armStage("discover", 10_000); c.advance(9_000)
        assertTrue(f.isEmpty())
        c.advance(2_000); assertEquals(listOf("stage_timeout:discover"), f)
    }

    @Test fun silenceFiresAfterFiveSecondsWithoutPackets() {
        val c = Clock(); val f = ArrayList<String>(); val w = make(c, f)
        w.startSilence()
        c.advance(4_000); assertTrue(f.isEmpty())
        c.advance(2_000); assertEquals(1, f.size); assertTrue(f[0].startsWith("silence:"))
        c.advance(30_000); assertEquals(1, f.size)  // 한 번만
    }

    @Test fun packetsKeepSilenceWatchdogQuiet() {
        val c = Clock(); val f = ArrayList<String>(); val w = make(c, f)
        w.startSilence()
        repeat(20) { c.advance(1_000); w.touch() }
        assertTrue(f.isEmpty())
        c.advance(6_000); assertEquals(1, f.size)
    }

    @Test fun stopCancelsEverything() {
        val c = Clock(); val f = ArrayList<String>(); val w = make(c, f)
        w.armStage("mtu", 5_000); w.startSilence(); w.stop()
        c.advance(60_000); assertTrue(f.isEmpty())
    }

    @Test fun restartAfterSilenceTimeoutRearms() {
        val c = Clock(); val f = ArrayList<String>(); val w = make(c, f)
        w.startSilence(); c.advance(6_000); assertEquals(1, f.size)
        w.startSilence(); c.advance(6_000); assertEquals(2, f.size)
    }
}
