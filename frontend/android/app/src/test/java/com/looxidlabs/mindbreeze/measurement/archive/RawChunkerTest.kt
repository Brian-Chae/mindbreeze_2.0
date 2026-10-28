package com.looxidlabs.mindbreeze.measurement.archive

import com.looxidlabs.mindbreeze.measurement.JournalRecord
import com.looxidlabs.mindbreeze.measurement.Sensor
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

class RawChunkerTest {
    @get:Rule val tmp = TemporaryFolder()
    private val sid = "00000001-0000-4000-8000-000000000001"

    private fun tick(b: ByteArray, t: Long) { for (i in 0..3) b[i] = ((t shr (8 * i)) and 0xFF).toByte() }
    /** rows 개 샘플을 가진 패킷(tick 헤더 + 샘플 바이트). 값은 i 로 결정적. */
    private fun packet(sensor: Sensor, rows: Int, tick: Long): ByteArray {
        val b = ByteArray(4 + rows * sensor.sampleBytes) { (it % 251).toByte() }
        tick(b, tick); return b
    }
    private fun sink(out: MutableList<RawChunk>) = { c: RawChunk -> out.add(c); Unit }
    private fun us(ms: Long) = ms * 1000

    /** EEG: 패킷당 25샘플(0.1초), 100패킷 = 10초 → 청크 1개. */
    @Test fun eegTenSecondsSealsOneValidChunk() {
        val out = ArrayList<RawChunk>(); val c = RawChunker(Sensor.EEG, sid, 0, 0, sink(out))
        for (i in 0 until 100) c.onPacket(packet(Sensor.EEG, 25, 1000L + i * 3277), us(i * 100L), i + 1L)
        assertEquals(1, out.size)
        val h = out[0].meta.getJSONObject("header")
        assertEquals(2500, h.getInt("sample_count")); assertEquals(100, h.getInt("packet_count"))
        assertEquals(0, h.getInt("first_sample_index")); assertEquals(2500, h.getInt("end_sample_index_exclusive"))
        assertEquals("native-candidate", h.getJSONObject("parser_profile").getString("platform"))
        assertEquals("eeg", h.getString("signal_type"))
        val sec = h.getJSONArray("sections")
        assertEquals(3, sec.length())
        assertEquals(2500 * 17, sec.getJSONObject(0).getInt("length"))
        assertEquals(sec.getJSONObject(0).getInt("length"), sec.getJSONObject(1).getInt("offset"))
        assertEquals(100 * (4 + 25 * 7), sec.getJSONObject(1).getInt("length"))
        // 바이트 구조: MBRAW002 + header len + header + body 합 == size_bytes
        val p = out[0].payload
        assertEquals("MBRAW002", String(p, 0, 8))
        val hl = ByteBuffer.wrap(p, 8, 4).order(ByteOrder.LITTLE_ENDIAN).int
        val body = (0 until 3).sumOf { sec.getJSONObject(it).getInt("length") }
        assertEquals(p.size, 12 + hl + body); assertEquals(p.size, out[0].meta.getInt("size_bytes"))
        assertEquals(RawChunker.sha256(p), out[0].meta.getString("checksum"))
        assertTrue(p.size <= 1_048_576)
        assertTrue(out[0].alias.matches(Regex("^[A-Z][A-Za-z0-9_-]{0,63}$")))
    }

    @Test fun ppgAndAccUseTheirStridesAndRates() {
        for ((sensor, stride, rate) in listOf(Triple(Sensor.PPG, 8, 50), Triple(Sensor.ACC, 18, 30))) {
            val out = ArrayList<RawChunk>(); val c = RawChunker(sensor, sid, 0, 0, sink(out))
            val rows = 5; var t = 100L; var rec = 0L
            repeat(rate * 10 / rows) { c.onPacket(packet(sensor, rows, t), us(it * 100L), ++rec); t += rows * 32768L / rate }
            assertEquals(sensor.name, 1, out.size)
            val h = out[0].meta.getJSONObject("header")
            assertEquals(rate * 10, h.getInt("sample_count"))
            assertEquals(rate, h.getJSONObject("rate").getInt("numerator"))
            assertEquals(rate * 10 * stride, h.getJSONArray("sections").getJSONObject(0).getInt("length"))
        }
    }

    @Test fun tickRewindStartsNewSegmentAndSealsPartialChunk() {
        val out = ArrayList<RawChunk>(); val c = RawChunker(Sensor.EEG, sid, 0, 0, sink(out))
        c.onPacket(packet(Sensor.EEG, 25, 100000), 0, 1); c.onPacket(packet(Sensor.EEG, 25, 100000 + 3277), us(100), 2)
        c.onPacket(packet(Sensor.EEG, 25, 500), us(200), 3) // 장치 재시작: tick 되감김
        assertEquals(1, out.size)
        assertEquals(50, out[0].meta.getJSONObject("header").getInt("sample_count"))
        c.flush()
        assertEquals(2, out.size)
        assertNotEquals(out[0].meta.getJSONObject("header").getString("segment_id"), out[1].meta.getJSONObject("header").getString("segment_id"))
        assertEquals(0, out[1].meta.getJSONObject("header").getInt("first_sample_index"))
    }

    /** PPG tick 갱신이 ±수십 ms 불규칙해도 segment 가 쪼개지지 않는다(웹에서 패킷마다 쪼개지던 문제). */
    @Test fun irregularPpgTicksDoNotSplitSegments() {
        val out = ArrayList<RawChunk>(); val c = RawChunker(Sensor.PPG, sid, 0, 0, sink(out))
        var t = 1000L
        for (i in 0 until 100) { c.onPacket(packet(Sensor.PPG, 5, t), us(i * 100L), i + 1L); t += 3277 + (if (i % 2 == 0) 900 else -900) } // ≈ ±27ms
        c.flush()
        assertEquals(1, out.map { it.meta.getJSONObject("header").getString("segment_id") }.toSet().size)
        assertEquals(500, out.sumOf { it.meta.getJSONObject("header").getInt("sample_count") })
    }

    @Test fun malformedPacketKeepsBytesWithZeroSamples() {
        val out = ArrayList<RawChunk>(); val c = RawChunker(Sensor.EEG, sid, 0, 0, sink(out))
        val bad = ByteArray(10) { 1 }; tick(bad, 5)
        c.onPacket(bad, 0, 1); c.flush()
        val h = out.single().meta.getJSONObject("header")
        assertEquals(0, h.getInt("sample_count")); assertEquals(1, h.getInt("packet_count"))
        assertEquals(0, h.getJSONArray("sections").getJSONObject(0).getInt("length"))
        assertEquals(10, h.getJSONArray("sections").getJSONObject(1).getInt("length"))
    }

    @Test fun flushWithoutPacketsDoesNothingAndChunkIndexIncrements() {
        val out = ArrayList<RawChunk>(); val c = RawChunker(Sensor.EEG, sid, 0, 0, sink(out))
        c.flush(); assertTrue(out.isEmpty())
        for (i in 0 until 200) c.onPacket(packet(Sensor.EEG, 25, 1000L + i * 3277), us(i * 100L), i + 1L)
        assertEquals(listOf(0, 1), out.map { it.meta.getJSONObject("header").getInt("chunk_index") })
        assertEquals(2500, out[1].meta.getJSONObject("header").getInt("first_sample_index"))
    }

    @Test fun archiverReplayIsIdempotentAndEnqueuesOncePerAlias() {
        val q = ArchiveQueue(File(tmp.root, "q")); val state = File(tmp.root, "raw.json")
        val recs = (0 until 100).map { JournalRecord(Sensor.EEG, it * 100L, packet(Sensor.EEG, 25, 1000L + it * 3277)) }
        val a1 = RawArchiver(q, sid, { "p" }, state)
        a1.replay(recs) { it * 1000 }; a1.flush()
        assertEquals(1, q.all().size)
        // 프로세스 재생성 → 같은 journal 재생: 이미 청크에 든 레코드는 건너뜀
        val a2 = RawArchiver(q, sid, { "p" }, state)
        a2.replay(recs) { it * 1000 }; a2.flush()
        assertEquals(1, q.all().size)
        assertEquals("raw", q.all()[0].kind)
    }

    /** 서버 계약 fixture 내보내기: 환경변수 SDD252_FIXTURE_DIR 가 있으면 EEG/PPG/ACC 청크 메타·feature 메타를 기록한다(pytest 가 그대로 presign 에 보낸다). */
    @Test fun exportServerContractFixtures() {
        val dir = System.getenv("SDD252_FIXTURE_DIR")?.let { File(it) } ?: return
        dir.mkdirs()
        val outAll = JSONObject()
        for (sensor in Sensor.values()) {
            val out = ArrayList<RawChunk>(); val c = RawChunker(sensor, sid, 0, 0, sink(out)); var t = 5000L
            val rows = if (sensor == Sensor.EEG) 25 else 5
            for (i in 0 until 5) { c.onPacket(packet(sensor, rows, t), us(i * 100L), i + 1L); t += rows * 32768L / sensor.sampleRateHz }
            c.flush()
            outAll.put(sensor.name.lowercase(), out[0].meta)
            File(dir, "native-raw-${sensor.name.lowercase()}.bin").writeBytes(out[0].payload)
        }
        File(dir, "native-raw-meta.json").writeText(outAll.toString(2))
        val q = ArchiveQueue(File(tmp.root, "fq"))
        val f = ArchiveFeeder(q, sid, { null }, { "00000014-0000-4000-8000-000000000014" }, windowFrames = 3,
            scope = { RawIds.streamId(sid, Sensor.EEG) to RawIds.segmentId(sid, Sensor.EEG, 0) })
        for (s in 1L..3L) f.onFrame(JSONObject().put("sequence", s.toString()).put("window_start_us", (s * 1_000_000).toString())
            .put("window_end_us", ((s + 1) * 1_000_000).toString()))
        File(dir, "native-feature-meta.json").writeText(q.all()[0].meta.toString(2))
        File(dir, "native-feature.bin").writeBytes(q.all()[0].payloadFile.readBytes())
    }
}
