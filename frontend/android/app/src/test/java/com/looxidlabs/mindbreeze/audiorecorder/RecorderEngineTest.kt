package com.looxidlabs.mindbreeze.audiorecorder

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.util.concurrent.atomic.AtomicInteger

class RecorderEngineTest {
    @get:Rule val tmp = TemporaryFolder()

    class FakeSource : AudioSource {
        val started = AtomicInteger(); val stopped = AtomicInteger()
        override fun start() { started.incrementAndGet() }
        override fun read(buf: ShortArray): Int { Thread.sleep(2); return 0 }
        override fun stop() { stopped.incrementAndGet() }
        override fun release() {}
    }
    class FakeEncoder(var fail: Boolean = false, val bytes: Int = 10) : ChunkEncoder {
        val sizes = ArrayList<Int>()
        override fun encode(pcm: ShortArray, out: File) {
            if (fail) throw IllegalStateException("codec")
            synchronized(sizes) { sizes += pcm.size }; out.writeBytes(ByteArray(bytes) { 7 })
        }
    }
    class Rec : EngineListener {
        val states = ArrayList<String>(); val errors = ArrayList<String>(); val recoverable = ArrayList<Boolean>()
        override fun onState(sessionId: String?, state: String, reason: String?) { synchronized(states) { states += state } }
        override fun onError(sessionId: String?, code: String, message: String, recoverable: Boolean) { synchronized(errors) { errors += code; this.recoverable += recoverable } }
    }
    class Sink(val q: ChunkQueue) : UploadSink {
        val wakes = AtomicInteger(); var drain = false
        override fun wake() { wakes.incrementAndGet(); if (drain) q.sessionsWithPending().forEach { s -> q.pending(s).forEach { q.remove(it) } } }
    }

    private fun engine(enc: ChunkEncoder = FakeEncoder(), max: Long = Long.MAX_VALUE, rec: Rec = Rec(), samples: Int = 100): Triple<RecorderEngine, ChunkQueue, Sink> {
        val q = ChunkQueue(tmp.root); val sink = Sink(q)
        return Triple(RecorderEngine(q, enc, sink, rec, samples, max, stopWaitMs = 300), q, sink)
    }
    private fun pcm(n: Int) = ShortArray(n) { 1 }

    @Test fun startUsesStartChunkIndexAndEmitsChunksInOrder() {
        val (e, q, _) = engine()
        e.start("s1", "https://x", 7, FakeSource())
        e.onPcm(pcm(250), 250)
        val r = e.stop()
        // 100,100 확정 + 50 flush → 인덱스 7,8,9
        assertEquals(listOf(7, 8, 9), q.pending("s1").map { it.index })
        assertEquals(9, r.lastChunkIndex); assertEquals(3, r.pendingCount)
    }

    @Test fun pauseFlushesPartialAndResumeContinuesIndex() {
        val (e, q, _) = engine(); val src = FakeSource()
        e.start("s1", "https://x", 0, src)
        e.onPcm(pcm(130), 130); e.pause(); e.waitEncoded()
        assertEquals("paused", e.status().state); assertEquals(listOf(0, 1), q.pending("s1").map { it.index })
        e.onPcm(pcm(500), 500) // 일시정지 중 입력은 버린다
        e.resume(); e.onPcm(pcm(100), 100); e.waitEncoded()
        assertEquals(listOf(0, 1, 2), q.pending("s1").map { it.index })
        assertTrue(src.stopped.get() >= 1 && src.started.get() >= 2)
        e.stop()
    }

    @Test fun micOffExcludesIntervalAndDoesNotAdvanceIndex() {
        val (e, q, _) = engine()
        e.start("s1", "https://x", 0, FakeSource())
        e.setMicEnabled(false); e.onPcm(pcm(1000), 1000); e.waitEncoded()
        assertEquals("micOff", e.status().state); assertTrue(q.pending("s1").isEmpty()); assertEquals(0, e.status().nextChunkIndex)
        e.setMicEnabled(true); e.onPcm(pcm(100), 100); e.waitEncoded()
        assertEquals(listOf(0), q.pending("s1").map { it.index }); assertEquals(1, e.status().nextChunkIndex)
        e.stop()
    }

    @Test fun diskFullPausesAndReportsRecoverableError() {
        val rec = Rec(); val (e, q, _) = engine(FakeEncoder(bytes = 100), max = 150, rec = rec)
        e.start("s1", "https://x", 0, FakeSource())
        e.onPcm(pcm(300), 300); e.waitEncoded()
        assertTrue(rec.errors.contains("disk_full")); assertEquals("paused", e.status().state)
        e.stop()
    }

    @Test fun encoderFailureReportsAudioEngineFailedAndKeepsGoing() {
        val rec = Rec(); val enc = FakeEncoder(fail = true); val (e, q, _) = engine(enc, rec = rec)
        e.start("s1", "https://x", 0, FakeSource())
        e.onPcm(pcm(100), 100); e.waitEncoded()
        assertEquals(listOf("audio_engine_failed"), rec.errors); assertTrue(q.pending("s1").isEmpty())
        e.stop()
    }

    @Test fun stopWaitsForDrainAndReportsUploadedCount() {
        val (e, q, sink) = engine(); sink.drain = true
        e.start("s1", "https://x", 0, FakeSource())
        e.onPcm(pcm(200), 200)
        e.waitEncoded()
        e.onUploaded("s1", 0); e.onUploaded("s1", 1)
        val r = e.stop()
        assertEquals(0, r.pendingCount); assertEquals(2, r.uploadedCount); assertEquals(1, r.lastChunkIndex)
        assertEquals("stopped", e.status().state); assertEquals(1, e.status().lastUploadedIndex)
    }

    @Test fun metaPersistsNextIndexForRestart() {
        val (e, q, _) = engine()
        e.start("s1", "https://api", 4, FakeSource()); e.onPcm(pcm(100), 100); e.waitEncoded()
        assertEquals(ChunkQueue.Meta("https://api", 5), q.loadMeta("s1"))
        e.stop()
    }
}
