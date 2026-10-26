package com.looxidlabs.mindbreeze.audiorecorder

import org.junit.Assert.assertEquals
import org.junit.Test

class BackoffTest {
    @Test fun doublesFromOneSecondUpToThirtySeconds() {
        assertEquals(listOf(1000L, 2000L, 4000L, 8000L, 16000L, 30000L, 30000L), (0..6).map { Backoff.delayMs(it) })
        assertEquals(30000L, Backoff.delayMs(500))
    }
}
