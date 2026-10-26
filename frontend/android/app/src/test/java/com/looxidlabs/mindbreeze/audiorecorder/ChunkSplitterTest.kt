package com.looxidlabs.mindbreeze.audiorecorder

import org.junit.Assert.*
import org.junit.Test

class ChunkSplitterTest {
    private fun ramp(from: Int, n: Int) = ShortArray(n) { ((from + it) % 30000).toShort() }

    @Test fun splitsExactlyAtChunkBoundariesWithoutLossOrDuplication() {
        val out = ArrayList<ShortArray>()
        val s = ChunkSplitter(1000) { out += it }
        var fed = 0
        for (n in listOf(300, 700, 1, 999, 1500, 501)) { s.write(ramp(fed, n), n); fed += n }
        assertEquals(fed / 1000, out.size)
        assertTrue(out.all { it.size == 1000 })
        val flat = out.flatMap { it.toList() }
        assertEquals((0 until flat.size).map { (it % 30000).toShort() }, flat) // 연속·무중복
        assertEquals(fed % 1000, s.buffered)
    }

    @Test fun flushEmitsRemainderOnceAndClears() {
        val out = ArrayList<ShortArray>()
        val s = ChunkSplitter(1000) { out += it }
        s.write(ramp(0, 250), 250)
        assertEquals(250, s.flush()); assertEquals(1, out.size); assertEquals(250, out[0].size)
        assertEquals(0, s.flush()); assertEquals(1, out.size)
    }

    @Test fun defaultChunkIsFiveSecondsAt44100() {
        assertEquals(220_500, ChunkSplitter.DEFAULT_SAMPLES_PER_CHUNK)
    }

    @Test fun writeHonorsLenNotArraySize() {
        val out = ArrayList<ShortArray>()
        val s = ChunkSplitter(10) { out += it }
        s.write(ramp(0, 50), 10)
        assertEquals(1, out.size); assertEquals(0, s.buffered)
    }
}
