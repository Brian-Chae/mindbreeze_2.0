package com.looxidlabs.mindbreeze.audiorecorder

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class ChunkQueueTest {
    @get:Rule val tmp = TemporaryFolder()

    private fun put(q: ChunkQueue, sid: String, idx: Int, bytes: Int = 10) {
        val t = q.tempFile(sid, idx); t.writeBytes(ByteArray(bytes) { 1 }); q.commit(sid, idx, t)
    }

    @Test fun pendingIsOrderedNumericallyNotLexically() {
        val q = ChunkQueue(tmp.root)
        listOf(10, 2, 0, 1).forEach { put(q, "s1", it) }
        assertEquals(listOf(0, 1, 2, 10), q.pending("s1").map { it.index })
    }

    @Test fun restartRestoresQueueAndDropsHalfWrittenTemp() {
        val q = ChunkQueue(tmp.root)
        put(q, "s1", 0); put(q, "s1", 1)
        q.tempFile("s1", 2).writeBytes(byteArrayOf(1, 2, 3)) // 확정 전 조각
        q.saveMeta("s1", ChunkQueue.Meta("https://x/api/v1", 2))
        val q2 = ChunkQueue(tmp.root)
        assertEquals(listOf(0, 1), q2.pending("s1").map { it.index })
        assertFalse(q2.tempFile("s1", 2).exists())
        assertEquals(ChunkQueue.Meta("https://x/api/v1", 2), q2.loadMeta("s1"))
        assertEquals(listOf("s1"), q2.sessionsWithPending())
    }

    @Test fun removeDeletesFileAndTotalBytesTracksDisk() {
        val q = ChunkQueue(tmp.root)
        put(q, "s1", 0, 100); put(q, "s2", 0, 50)
        assertEquals(150L, q.totalBytes())
        q.remove(q.pending("s1").single())
        assertEquals(50L, q.totalBytes()); assertTrue(q.pending("s1").isEmpty())
    }

    @Test fun nextFiltersByApiBase() {
        val q = ChunkQueue(tmp.root)
        put(q, "a", 0); put(q, "b", 0)
        q.saveMeta("a", ChunkQueue.Meta("https://a", 1)); q.saveMeta("b", ChunkQueue.Meta("https://b", 1))
        assertEquals("b", q.next("https://b")!!.sessionId)
        assertNull(q.next("https://c"))
    }

    @Test fun sweepRemovesEmptySessionsExceptGiven() {
        val q = ChunkQueue(tmp.root)
        put(q, "old", 0); q.remove(q.pending("old").single()); q.saveMeta("old", ChunkQueue.Meta("u", 1))
        put(q, "keep", 0)
        q.sweepEmpty(except = "cur")
        assertFalse(File(tmp.root, "old").exists()); assertTrue(File(tmp.root, "keep").exists())
    }
}
