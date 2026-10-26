package com.looxidlabs.mindbreeze.measurement.live

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/** T12: outbox 창은 만들어진 stream 에 묶인다. 재시작·재연결 후 다른 stream 에 잘못 귀속되지 않는다. */
class OutboxStreamBindingTest {
    @get:Rule val tmp = TemporaryFolder()
    private fun frame(seq: Long) = JSONObject("""{"sequence":"$seq","window_start_us":"${seq * 1000000L}","window_end_us":"${(seq + 1) * 1000000L}"}""")
    private val a = StreamTag("sA", "3", "anchorA", "pA")
    private val b = StreamTag("sB", "4", "anchorB", "pA")

    @Test fun tagSurvivesRestartAndOldStreamKeepsOwnIdentity() {
        val f = File(tmp.root, "o.log")
        val o1 = MetricOutbox(f)
        for (i in 1L..3L) o1.add(i, frame(i), a)
        o1.close()
        val o2 = MetricOutbox(f)
        o2.add(4, frame(4), b)
        // 현재 stream B: B 창만 나온다(A 창은 섞이지 않는다)
        val g1 = o2.nextBatch(b, 60)!!
        assertEquals(listOf(4L), g1.map { it.seq }); assertTrue(g1.all { it.tag == b })
        o2.ack(4)
        // B 가 비면 A 창이 A 의 옛 신원(stream_id·generation·anchor)으로 나온다
        val g2 = o2.nextBatch(b, 60)!!
        assertEquals(listOf(1L, 2L, 3L), g2.map { it.seq }); assertTrue(g2.all { it.tag == a })
    }

    @Test fun untaggedInProcessFramesAreClaimedAndPersisted() {
        val f = File(tmp.root, "u.log")
        val o = MetricOutbox(f)
        o.add(1, frame(1), null); o.add(2, frame(2), null)
        assertTrue(o.nextBatch(a, 60)!!.all { it.tag == a })
        o.close()
        val o2 = MetricOutbox(f) // 귀속이 영속돼 재시작 후 다른 stream 이 가져가지 않는다
        assertTrue(o2.nextBatch(b, 60)!!.all { it.tag == a })
    }

    @Test fun untaggedLoadedFromDiskIsNotAttributedToNewStream() {
        val f = File(tmp.root, "legacy.log")
        f.writeText("E\t1\t${frame(1)}\nE\t2\t${frame(2)}\n") // 귀속 기록 없는 이전 형식
        val o = MetricOutbox(f)
        assertNull("귀속 불명 창은 새 stream 으로 보내지 않는다", o.nextBatch(b, 60))
        assertEquals(0, o.size()); assertEquals(2L, o.quarantinedByCode()["stream_unattributed"])
    }

    @Test fun ackAndQuarantineStillWorkPerSequence() {
        val o = MetricOutbox(File(tmp.root, "q.log"))
        o.add(1, frame(1), a); o.add(2, frame(2), a)
        o.ack(1); o.quarantine(2, "stream_not_active")
        assertNull(o.nextBatch(a, 60)); assertEquals(1L, o.acked()); assertEquals(1L, o.quarantined())
    }
}
