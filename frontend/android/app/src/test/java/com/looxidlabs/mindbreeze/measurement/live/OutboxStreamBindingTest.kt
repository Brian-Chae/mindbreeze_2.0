package com.looxidlabs.mindbreeze.measurement.live

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/** T12 + SDD-260 N1: outbox 창은 만들어진 stream 에 묶이고, REST 배치는 오래된 순서로 나가며, ACK 된 창도 대조 전까지 보관된다. */
class OutboxStreamBindingTest {
    @get:Rule val tmp = TemporaryFolder()
    private fun frame(seq: Long) = JSONObject("""{"sequence":"$seq","window_start_us":"${seq * 1000000L}","window_end_us":"${(seq + 1) * 1000000L}"}""")
    private val a = StreamTag("sA", "3", "anchorA", "pA")
    private val b = StreamTag("sB", "4", "anchorB", "pA")

    @Test fun tagSurvivesRestartAndEachWindowKeepsOwnIdentity() {
        val f = File(tmp.root, "o.log")
        val o1 = MetricOutbox(f)
        for (i in 1L..3L) o1.add(i, frame(i), a)
        o1.close()
        val o2 = MetricOutbox(f)
        o2.add(4, frame(4), b)
        val batch = o2.pendingBatch(60)
        assertEquals(listOf(1L, 2L, 3L, 4L), batch.map { it.seq }) // 오래된 순서
        assertEquals(listOf(a, a, a, b), batch.map { it.tag })
    }

    @Test fun batchHonorsMaxAndOldestFirst() {
        val o = MetricOutbox(File(tmp.root, "m.log"))
        for (i in 1L..100L) o.add(i, frame(i), a)
        val first = o.pendingBatch(60)
        assertEquals((1L..60L).toList(), first.map { it.seq })
        for (e in first) o.ack(e.seq)
        assertEquals((61L..100L).toList(), o.pendingBatch(60).map { it.seq })
    }

    @Test fun batchNeverMixesParticipants() {
        val o = MetricOutbox(File(tmp.root, "p.log"))
        val other = StreamTag("sC", "1", "anchorC", "pB")
        o.add(1, frame(1), a); o.add(2, frame(2), other); o.add(3, frame(3), a)
        assertEquals(listOf(1L, 3L), o.pendingBatch(60).map { it.seq })
    }

    @Test fun untaggedFramesAreHeldNotQuarantinedUntilBound() {
        val f = File(tmp.root, "u.log")
        val o = MetricOutbox(f)
        o.add(1, frame(1), null); o.add(2, frame(2), null)
        assertTrue("귀속 전 창은 전송 후보가 아니다", o.pendingBatch(60).isEmpty())
        assertEquals(0L, o.quarantined()); assertEquals(2, o.size())
        o.close()
        val o2 = MetricOutbox(f) // 재시작해도 격리하지 않는다(REST 정본은 귀속이 늦어도 잃지 않는다)
        assertEquals(0L, o2.quarantined()); assertEquals(2, o2.size())
        assertEquals(2, o2.bindUntagged(a))
        assertEquals(listOf(1L, 2L), o2.pendingBatch(60).map { it.seq })
        o2.close()
        assertEquals("귀속이 영속된다", listOf(1L, 2L), MetricOutbox(f).pendingBatch(60).map { it.seq })
    }

    @Test fun ackedWindowsAreRetainedForReconcileAndSurviveRestart() {
        val f = File(tmp.root, "r.log")
        val o = MetricOutbox(f)
        for (i in 1L..5L) o.add(i, frame(i), a)
        for (i in 1L..3L) o.ack(i)
        assertEquals(2, o.size()); assertEquals(3L, o.acked())
        assertEquals(listOf(1L, 2L, 3L), o.ackedEntries().map { it.seq })
        o.close()
        val o2 = MetricOutbox(f)
        assertEquals(2, o2.size()); assertEquals(3L, o2.acked())
        assertEquals(listOf(1L, 2L, 3L), o2.ackedEntries().map { it.seq })
        o2.add(2, frame(2), a) // 같은 순번 재투입은 무시
        assertEquals(2, o2.size())
        assertEquals(5L, o2.maxSequence())
    }

    @Test fun requeueMovesAckedBackToPendingAndPersists() {
        val f = File(tmp.root, "q2.log")
        val o = MetricOutbox(f)
        for (i in 1L..4L) { o.add(i, frame(i), a); o.ack(i) }
        assertEquals(2, o.requeue(listOf(2L, 4L, 99L)))
        assertEquals(listOf(2L, 4L), o.pendingBatch(60).map { it.seq })
        o.close()
        val o2 = MetricOutbox(f)
        assertEquals(listOf(2L, 4L), o2.pendingBatch(60).map { it.seq })
        assertEquals(listOf(1L, 3L), o2.ackedEntries().map { it.seq })
    }

    @Test fun reconciledMarkerIsInvalidatedByNewWindow() {
        val f = File(tmp.root, "c.log")
        val o = MetricOutbox(f)
        o.add(1, frame(1), a); o.ack(1)
        assertFalse(o.isReconciled())
        o.markReconciled()
        assertTrue(o.isReconciled())
        o.close()
        val o2 = MetricOutbox(f)
        assertTrue(o2.isReconciled())
        o2.add(2, frame(2), a)
        assertFalse("새 창이 생기면 완료가 아니다", o2.isReconciled())
    }

    @Test fun ackAndQuarantineStillWorkPerSequence() {
        val o = MetricOutbox(File(tmp.root, "q.log"))
        o.add(1, frame(1), a); o.add(2, frame(2), a)
        o.ack(1); o.quarantine(2, "stream_not_owned")
        assertTrue(o.pendingBatch(60).isEmpty()); assertEquals(1L, o.acked()); assertEquals(1L, o.quarantined())
    }
}
