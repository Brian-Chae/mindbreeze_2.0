package com.looxidlabs.mindbreeze.measurement.archive

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayInputStream
import java.io.File
import java.security.MessageDigest
import java.util.zip.GZIPInputStream

class ArchiveFeederTest {
    @get:Rule val tmp = TemporaryFolder()

    private fun frame(seq: Long) = JSONObject().put("sequence", seq.toString()).put("window_start_us", (seq * 1_000_000).toString())
        .put("window_end_us", ((seq + 1) * 1_000_000).toString()).put("observed_at_ms", 1L).put("feature_hash", "a".repeat(64))

    private fun feeder(q: ArchiveQueue) = ArchiveFeeder(q, "00000001-0000-4000-8000-000000000001", { "00000002-0000-4000-8000-000000000002" }, { "00000014-0000-4000-8000-000000000014" }, windowFrames = 10)

    @Test fun sealsEveryNFramesWithChecksumRowCountAndMonotonicRange() {
        val q = ArchiveQueue(File(tmp.root, "q")); val f = feeder(q)
        for (s in 1L..25L) f.onFrame(frame(s))
        assertEquals(2, q.all().size)
        val a = q.all()[0]
        assertEquals(10, a.meta.getInt("row_count")); assertEquals("NF-00000014-1", a.alias)
        assertEquals("1000000", a.meta.getJSONObject("monotonic_range").getString("from_us"))
        assertEquals("11000000", a.meta.getJSONObject("monotonic_range").getString("to_us"))
        val bytes = a.payloadFile.readBytes()
        assertEquals(a.meta.getString("checksum"), MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) })
        assertEquals(bytes.size, a.meta.getInt("size_bytes"))
        val lines = GZIPInputStream(ByteArrayInputStream(bytes)).bufferedReader().readLines()
        assertEquals(10, lines.size); assertEquals("1", JSONObject(lines[0]).getString("sequence"))
        f.flush()
        assertEquals(3, q.all().size)
        assertEquals(5, q.all()[2].meta.getInt("row_count"))
    }

    @Test fun replayedFramesDoNotDuplicateArtifacts() {
        val q = ArchiveQueue(File(tmp.root, "q")); val f = feeder(q)
        for (s in 1L..10L) f.onFrame(frame(s))
        val f2 = feeder(q) // 복구 재생: 같은 프레임이 다시 들어와도 같은 alias 는 한 번만
        for (s in 1L..10L) f2.onFrame(frame(s))
        assertEquals(1, q.all().size)
    }

    @Test fun sequenceGapSplitsArtifactsSoRowsStayContiguous() {
        val q = ArchiveQueue(File(tmp.root, "q")); val f = feeder(q)
        for (s in listOf(1L, 2L, 3L, 7L, 8L)) f.onFrame(frame(s))
        f.flush()
        val metas = q.all().map { it.meta }
        assertEquals(listOf(1L, 7L), metas.map { it.getLong("first_sequence") })
        assertEquals(listOf(3L, 8L), metas.map { it.getLong("last_sequence") })
    }
}
