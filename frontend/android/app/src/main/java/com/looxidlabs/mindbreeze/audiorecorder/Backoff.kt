package com.looxidlabs.mindbreeze.audiorecorder

/** 업로드 재시도 지연: 1,2,4,8,16,30,30… 초 */
object Backoff {
    private const val MAX_MS = 30_000L
    fun delayMs(attempt: Int): Long {
        if (attempt >= 5) return MAX_MS
        return minOf(1000L shl maxOf(attempt, 0), MAX_MS)
    }
}
