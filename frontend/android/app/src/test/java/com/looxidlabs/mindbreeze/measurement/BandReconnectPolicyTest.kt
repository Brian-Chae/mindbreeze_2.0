package com.looxidlabs.mindbreeze.measurement

import org.junit.Assert.*
import org.junit.Test

/** SDD-331: 120초 빠른 창(2~3초 간격·시도당 10초) → 느린 백오프 + 스캔 복귀 → 성공 시 리셋. */
class BandReconnectPolicyTest {
    private fun mid() = BandReconnectPolicy { 0.5 }

    @Test fun fastWindowRetriesAtFixedIntervalAtLeast40TimesIn120s() {
        val p = mid(); p.startWindow(0)
        var t = 0L; var attempts = 0
        while (p.isFast(t)) { attempts++; t += p.nextDelayMs(t) }
        assertTrue("시도 $attempts", attempts >= 40)
        assertEquals(48, attempts)
    }

    @Test fun fastIntervalStaysInTwoToThreeSeconds() {
        assertEquals(2_000L, BandReconnectPolicy { 0.0 }.also { it.startWindow(0) }.nextDelayMs(0))
        assertEquals(3_000L, BandReconnectPolicy { 1.0 }.also { it.startWindow(0) }.nextDelayMs(0))
    }

    @Test fun connectStageLimitIs10sInFastWindowThen30s() {
        val p = mid(); p.startWindow(0)
        assertEquals(10_000L, p.connectTimeoutMs(119_999))
        assertEquals(30_000L, p.connectTimeoutMs(120_000))
    }

    @Test fun slowBackoffAfter120s() {
        val p = mid(); p.startWindow(0)
        assertEquals(listOf(1_000L, 2_000L, 4_000L, 8_000L, 15_000L, 30_000L, 30_000L), (0 until 7).map { p.nextDelayMs(120_000) })
    }

    @Test fun scanFallbackOnlyInSlowPhaseAfterConsecutiveFailures() {
        val p = mid(); p.startWindow(0)
        repeat(5) { p.noteFailure() }
        assertFalse(p.shouldScan(60_000))
        assertTrue(p.shouldScan(120_000))
        p.startWindow(200_000)            // '깨웠어요' — 창 재시작, 실패 수도 초기화
        assertFalse(p.shouldScan(200_000))
    }

    @Test fun resetOnSuccess() {
        val p = mid(); p.startWindow(0); p.noteFailure(); p.noteFailure(); p.nextDelayMs(130_000)
        p.reset()
        assertEquals(0, p.directFailures)
        assertTrue(p.isFast(1_000_000))   // 창 없음 = 경과 0
    }
}
