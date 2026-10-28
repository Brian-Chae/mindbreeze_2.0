package com.looxidlabs.mindbreeze.measurement.archive

import com.looxidlabs.mindbreeze.measurement.Sensor
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.util.UUID

/** 앱 네이티브 원시 청크가 쓰는 결정적 식별자. 같은 입력이면 항상 같은 UUID 라서 복구 재생·큐 보정에서 alias 가 어긋나지 않는다. */
object RawIds {
    fun streamId(sessionId: String, sensor: Sensor): String = uuid("mb-raw-stream|$sessionId|${sensor.name.lowercase()}")
    fun segmentId(sessionId: String, sensor: Sensor, ordinal: Int): String = uuid("mb-raw-segment|$sessionId|${sensor.name.lowercase()}|$ordinal")
    private fun uuid(seed: String) = UUID.nameUUIDFromBytes(seed.toByteArray()).toString()
}

/** 봉인된 원시 청크 1개(서버 raw presign 메타 + MBRAW002 바이트). lastRecordIndex 는 이 청크에 든 마지막 journal 레코드 번호(1부터). */
class RawChunk(val alias: String, val meta: JSONObject, val payload: ByteArray, val lastRecordIndex: Long)

/**
 * 한 센서의 BLE 원문 패킷을 서버 raw-v2(MBRAW002) 청크로 봉인한다. 웹 `capture-session.ts` 와 같은 계약이다.
 * - 청크: 10초 분량 샘플 또는 900,000B 중 먼저 도달할 때 / segment 전환 / flush.
 * - segment: 장치 tick 이 되감기거나 기대 경과와 허용오차 이상 어긋나면 새로 시작(이전 segment 는 부분 청크로 봉인).
 * - 패킷은 쪼개지 않는다. 길이가 안 맞는 패킷도 바이트를 그대로 보존하고 샘플은 0 으로 둔다.
 * 시간축 `arrivalUs` 는 코어 창과 같은 창 시간축 µs 이다(서버 raw_window_mono 가 환산하는 축).
 */
class RawChunker(
    private val sensor: Sensor,
    private val sessionId: String,
    private val originUs: Long,
    firstOrdinal: Int,
    private val sink: (RawChunk) -> Unit,
    private val onNewSegment: (Int) -> Unit = {},
) {
    private class Pkt(val bytes: ByteArray, val rows: Int, val malformed: String?, val tickRaw: Long?, val firstSample: Int, val arrivalUs: Long, val tickUnwrapped: Long?, val record: Long)

    private val stride = when (sensor) { Sensor.EEG -> 17; Sensor.PPG -> 8; Sensor.ACC -> 18 }
    private val sampleBytes = sensor.sampleBytes
    private val rate = sensor.sampleRateHz
    private val toleranceUs: Long = if (sensor == Sensor.EEG) 2_000_000L / rate else PPG_ACC_TOLERANCE_US
    private var ordinal = firstOrdinal - 1
    private var segmentId = ""
    private var chunkIndex = 0
    private var nextSample = 0
    private var anchorUtcUs = 0L
    private var anchorTick: Long? = null
    private var anchorTickUnwrapped: Long? = null
    private var lastTick: Long? = null
    private var lastRaw: Long? = null
    private var wraps = 0L
    private val pkts = ArrayList<Pkt>()
    private var pktSamples = 0
    private var pktBytes = 0

    val currentSegmentId: String get() = if (segmentId.isEmpty()) RawIds.segmentId(sessionId, sensor, maxOf(ordinal + 1, 0)) else segmentId

    fun onPacket(bytes: ByteArray, arrivalUs: Long, record: Long) {
        if (bytes.isEmpty()) return
        val malformed = bytes.size < 4 + sampleBytes || (bytes.size - 4) % sampleBytes != 0
        val raw = if (bytes.size >= 4) u32(bytes) else null
        val rows = if (malformed) 0 else (bytes.size - 4) / sampleBytes
        var tickUnwrapped: Long? = null
        var roll = segmentId.isEmpty()
        if (raw != null) {
            val prev = lastRaw
            if (prev != null && raw < prev && prev - raw > 0x80000000L) wraps++ // 32bit wrap
            val unwrapped = wraps * (1L shl 32) + raw
            val prevTick = lastTick
            if (prevTick != null && !roll) {
                val elapsedUs = (unwrapped - prevTick) * 1_000_000L / DEVICE_TICK_HZ
                val expectedUs = rows.toLong() * 1_000_000L / rate
                if (unwrapped < prevTick || kotlin.math.abs(elapsedUs - expectedUs) > toleranceUs) roll = true
            }
            if (roll && !segmentId.isEmpty()) { /* 이전 segment 봉인은 아래 startSegment 에서 */ }
            tickUnwrapped = unwrapped
            lastRaw = raw; lastTick = unwrapped
        }
        if (roll) startSegment(arrivalUs, rows, raw, tickUnwrapped)
        val first = if (rows > 0) nextSample else -1
        pkts.add(Pkt(bytes, rows, if (malformed) "truncated_packet" else null, raw, first, arrivalUs, tickUnwrapped, record))
        nextSample += rows; pktSamples += rows; pktBytes += bytes.size + rows * stride + MAP_ROW_ESTIMATE
        if (pktSamples >= CHUNK_SECONDS * rate || pktBytes >= CHUNK_SOFT_BYTES) seal()
    }

    private fun startSegment(arrivalUs: Long, rows: Int, raw: Long?, unwrapped: Long?) {
        seal() // 이전 segment 의 남은 샘플
        ordinal += 1
        segmentId = RawIds.segmentId(sessionId, sensor, ordinal)
        chunkIndex = 0; nextSample = 0
        anchorUtcUs = arrivalUs - maxOf(0, rows - 1).toLong() * 1_000_000L / rate // 헤더 tick = 패킷 마지막 샘플 시각
        anchorTick = raw; anchorTickUnwrapped = unwrapped
        wraps = if (raw != null && unwrapped != null) (unwrapped - raw) / (1L shl 32) else 0
        onNewSegment(ordinal)
    }

    /** 남은 샘플을 부분 청크로 봉인(정지·종료·segment 전환). 패킷이 없으면 아무것도 하지 않는다. */
    fun flush() = seal()

    private fun seal() {
        if (pkts.isEmpty()) return
        val samples = pkts.sumOf { it.rows }
        val body = ByteArrayOutputStream()
        val sampleBuf = ByteBuffer.allocate(samples * stride).order(ByteOrder.LITTLE_ENDIAN)
        val packetsOut = ByteArrayOutputStream()
        val mapText = StringBuilder()
        var offset = 0
        for ((i, p) in pkts.withIndex()) {
            writeRows(sampleBuf, p.bytes, p.rows)
            packetsOut.write(p.bytes)
            mapText.append(JSONObject().put("packet_seq", i).put("byte_offset", offset).put("byte_length", p.bytes.size)
                .put("first_sample_index", if (p.rows > 0) p.firstSample else JSONObject.NULL).put("sample_count", p.rows)
                .put("tick_raw", p.tickRaw?.toString() ?: JSONObject.NULL).put("tick_unwrapped", p.tickUnwrapped?.toString() ?: JSONObject.NULL)
                .put("received_utc_us", p.arrivalUs.toString()).put("received_monotonic_us", p.arrivalUs.toString())
                .put("header_anchor", "last_sample").put("clock_segment_id", segmentId)
                .put("malformed_reason", p.malformed ?: JSONObject.NULL).toString()).append('\n')
            offset += p.bytes.size
        }
        val mapBytes = mapText.toString().toByteArray(Charsets.UTF_8)
        val samplesBytes = sampleBuf.array()
        val firstIndex = pkts.firstOrNull { it.rows > 0 }?.firstSample ?: nextSample
        val sections = JSONArray()
            .put(section("samples", 0, samplesBytes.size, stride, encoding()))
            .put(section("packets", samplesBytes.size, offset, 0, "bytes"))
            .put(section("packet_map", samplesBytes.size + offset, mapBytes.size, 0, "utf8-jsonl"))
        val streamId = RawIds.streamId(sessionId, sensor)
        val header = JSONObject()
            .put("schema_version", "mb-biosignal-raw-v2").put("signal_type", sensor.name.lowercase()).put("stream_id", streamId).put("segment_id", segmentId)
            .put("chunk_index", chunkIndex).put("parser_profile", profile())
            .put("rate", JSONObject().put("numerator", rate).put("denominator", 1)).put("observed_rate", JSONObject.NULL)
            .put("observed_rate_window_us", JSONObject.NULL).put("observed_rate_reason", "not_measured")
            .put("channels", JSONArray(channels())).put("units", JSONArray(units())).put("scale", JSONArray(scale()))
            .put("sample_count", samples).put("packet_count", pkts.size).put("first_sample_index", firstIndex)
            .put("end_sample_index_exclusive", firstIndex + samples).put("time_basis", "host_estimated")
            .put("anchor", JSONObject().put("sample_index", 0).put("utc_us", anchorUtcUs.toString()).put("monotonic_us", anchorUtcUs.toString())
                .put("relative_us", (anchorUtcUs - originUs).toString()).put("device_tick_raw", anchorTick?.toString() ?: JSONObject.NULL)
                .put("device_tick_unwrapped", anchorTickUnwrapped?.toString() ?: JSONObject.NULL).put("clock_segment_id", segmentId)
                .put("uncertainty_us", JSONObject.NULL).put("rule", "anchor_plus_index_delta_over_rate"))
            .put("sections", sections)
        val headerBytes = header.toString().toByteArray(Charsets.UTF_8)
        body.write("MBRAW002".toByteArray()); body.write(ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(headerBytes.size).array())
        body.write(headerBytes); body.write(samplesBytes); body.write(packetsOut.toByteArray()); body.write(mapBytes)
        val payload = body.toByteArray()
        val alias = "RAW-${sensor.name}-${streamId.replace("-", "").take(8)}-${segmentId.replace("-", "").take(8)}-${chunkIndex.toString().padStart(6, '0')}"
        val meta = JSONObject().put("chunk_alias", alias).put("header", header).put("checksum", sha256(payload))
            .put("size_bytes", payload.size).put("content_type", "application/octet-stream")
        val last = pkts.last().record
        pkts.clear(); pktSamples = 0; pktBytes = 0; chunkIndex += 1
        sink(RawChunk(alias, meta, payload, last))
    }

    private fun section(name: String, offset: Int, length: Int, stride: Int, encoding: String) =
        JSONObject().put("name", name).put("offset", offset).put("length", length).put("row_stride", stride).put("encoding", encoding)

    private fun profile() = JSONObject().put("firmware", "unknown").put("device_model", "LINK-BAND-2.0").put("profile_id", PROFILE_ID).put("version", "1")
        .put("parameters_hash", PROFILE_HASH).put("platform", "native-candidate").put("verification", "unverified").put("packet_endian", "little")
        .put("tick_hz", 32768).put("tick_bits", 32).put("header_anchor", "last_sample")

    private fun encoding() = when (sensor) { Sensor.EEG -> "eeg-i32-i32-u8-f32-f32-le"; Sensor.PPG -> "ppg-u32-u32-le"; Sensor.ACC -> "acc-i16-i16-i16-f32-f32-f32-le" }
    private fun channels() = when (sensor) { Sensor.EEG -> listOf("fp1", "fp2"); Sensor.PPG -> listOf("red", "ir"); Sensor.ACC -> listOf("x", "y", "z") }
    private fun units() = when (sensor) { Sensor.EEG -> listOf("uV", "uV"); Sensor.PPG -> listOf("ADC_count", "ADC_count"); Sensor.ACC -> listOf("g", "g", "g") }
    private fun scale() = when (sensor) { Sensor.EEG -> listOf(EEG_ADC_SCALE, EEG_ADC_SCALE); Sensor.PPG -> listOf(1.0, 1.0); Sensor.ACC -> listOf(ACC_ADC_SCALE, ACC_ADC_SCALE, ACC_ADC_SCALE) }

    private fun writeRows(out: ByteBuffer, d: ByteArray, rows: Int) {
        for (i in 0 until rows) {
            val o = 4 + i * sampleBytes
            when (sensor) {
                Sensor.EEG -> { val a = s24(d, o + 1); val b = s24(d, o + 4)
                    out.putInt(a).putInt(b).put(d[o]).putFloat((a * EEG_ADC_SCALE).toFloat()).putFloat((b * EEG_ADC_SCALE).toFloat()) }
                Sensor.PPG -> out.putInt(u24(d, o)).putInt(u24(d, o + 3))
                Sensor.ACC -> { val x = s16(d, o); val y = s16(d, o + 2); val z = s16(d, o + 4)
                    out.putShort(x.toShort()).putShort(y.toShort()).putShort(z.toShort())
                        .putFloat((x * ACC_ADC_SCALE).toFloat()).putFloat((y * ACC_ADC_SCALE).toFloat()).putFloat((z * ACC_ADC_SCALE).toFloat()) }
            }
        }
    }

    companion object {
        const val CHUNK_SECONDS = 10
        const val CHUNK_SOFT_BYTES = 900_000
        const val MAP_ROW_ESTIMATE = 260
        const val DEVICE_TICK_HZ = 32768L
        /** PPG/ACC 는 tick 이 패킷마다 균일하게 갱신되지 않아 EEG 처럼 2샘플로 자르면 패킷마다 segment 가 쪼개진다. */
        const val PPG_ACC_TOLERANCE_US = 500_000L
        const val EEG_ADC_SCALE = 4.033 / 12 / 8388607 * 1e6
        const val ACC_ADC_SCALE = 2.0 / 32768
        const val PROFILE_ID = "mb-native-clock-v1"
        val PROFILE_HASH: String = sha256("""{"profile":"$PROFILE_ID","tick_hz":32768,"tick_bits":32,"endian":"little","anchor":"last_sample"}""".toByteArray())
        private fun u32(d: ByteArray) = (d[0].toLong() and 0xFF) or ((d[1].toLong() and 0xFF) shl 8) or ((d[2].toLong() and 0xFF) shl 16) or ((d[3].toLong() and 0xFF) shl 24)
        private fun u24(d: ByteArray, o: Int) = ((d[o].toInt() and 0xFF) shl 16) or ((d[o + 1].toInt() and 0xFF) shl 8) or (d[o + 2].toInt() and 0xFF)
        private fun s24(d: ByteArray, o: Int): Int { val v = u24(d, o); return if (v and 0x800000 != 0) v - 0x1000000 else v }
        private fun s16(d: ByteArray, o: Int) = ((d[o].toInt() and 0xFF) or (d[o + 1].toInt() shl 8)).toShort().toInt()
        fun sha256(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }
    }
}
