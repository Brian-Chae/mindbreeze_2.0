package com.looxidlabs.mindbreeze.measurement

import org.junit.Assert.*
import org.junit.Test

class FencingTest {
    @Test fun newerGenerationFencesOlder() {
        val f = InstanceFence()
        val g1 = f.acquire(); assertTrue(f.isCurrent(g1))
        val g2 = f.acquire()
        assertFalse(f.isCurrent(g1)); assertTrue(f.isCurrent(g2)); assertTrue(g2 > g1)
    }

    @Test fun releaseOnlyWorksForCurrentGeneration() {
        val f = InstanceFence()
        val g1 = f.acquire(); val g2 = f.acquire()
        assertFalse(f.release(g1)); assertTrue(f.isCurrent(g2))
        assertTrue(f.release(g2)); assertFalse(f.isCurrent(g2))
    }

    @Test fun duplicateServiceStartIsRejectedWhileActive() {
        val gate = SingleServiceGate()
        assertTrue(gate.tryStart("svcA"))
        assertFalse(gate.tryStart("svcB"))
        assertTrue(gate.tryStart("svcA")) // 같은 인스턴스 재start 는 멱등
        gate.stopped("svcB"); assertFalse(gate.tryStart("svcB"))
        gate.stopped("svcA"); assertTrue(gate.tryStart("svcB"))
    }

    @Test fun staleGattCallbackIsDroppedByCounters() {
        val c = MeasurementCounters(); val f = InstanceFence()
        val gOld = f.acquire(); val gNew = f.acquire()
        val bytes = ByteArray(11)
        assertTrue(c.acceptNotification(f, gNew, Sensor.EEG, bytes.size))
        assertFalse(c.acceptNotification(f, gOld, Sensor.EEG, bytes.size))
        assertEquals(1L, c.snapshot().eegPackets)
        assertEquals(1L, c.snapshot().fencedCallbacks)
    }
}
