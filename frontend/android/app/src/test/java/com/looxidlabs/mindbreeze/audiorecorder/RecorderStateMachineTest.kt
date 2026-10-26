package com.looxidlabs.mindbreeze.audiorecorder

import org.junit.Assert.*
import org.junit.Test

class RecorderStateMachineTest {
    private fun started() = RecorderStateMachine().also { it.start() }

    @Test fun startRecordsAndStopEnds() {
        val m = RecorderStateMachine(); assertEquals("idle", m.state)
        m.start(); assertEquals("recording", m.state); assertTrue(m.capturing)
        m.beginStop(); assertEquals("stopping", m.state); assertFalse(m.capturing)
        m.finishStop(); assertEquals("stopped", m.state)
    }

    @Test fun pauseResume() {
        val m = started(); m.pause(); assertEquals("paused", m.state); assertFalse(m.capturing)
        m.resume(); assertEquals("recording", m.state)
    }

    @Test fun micOffAndOn() {
        val m = started(); m.setMic(false); assertEquals("micOff", m.state); assertFalse(m.capturing)
        m.setMic(true); assertEquals("recording", m.state)
    }

    @Test fun micOffWhilePausedIsRememberedOnResume() {
        val m = started(); m.pause(); m.setMic(false); assertEquals("paused", m.state)
        m.resume(); assertEquals("micOff", m.state)
        m.setMic(true); assertEquals("recording", m.state)
    }

    @Test fun pauseFromMicOffThenResumeStaysMicOff() {
        val m = started(); m.setMic(false); m.pause(); assertEquals("paused", m.state)
        m.resume(); assertEquals("micOff", m.state)
    }

    @Test fun commandsIgnoredWhenNotActive() {
        val m = RecorderStateMachine(); m.pause(); m.resume(); m.setMic(false)
        assertEquals("idle", m.state)
        val e = started(); e.fail(); assertEquals("error", e.state); e.resume(); assertEquals("error", e.state)
    }
}
