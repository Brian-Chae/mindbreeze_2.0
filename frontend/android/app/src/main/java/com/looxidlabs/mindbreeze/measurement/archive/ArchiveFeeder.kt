package com.looxidlabs.mindbreeze.measurement.archive

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.zip.GZIPOutputStream

/**
 * 코어 프레임(1Hz)을 N개씩 묶어 feature 산출물(gzip JSON lines)로 봉인해 ArchiveQueue 에 넣는다.
 * alias 는 (stream, first_sequence) 로 결정적이라 복구 재생으로 같은 창이 다시 만들어져도 큐가 한 번만 받는다.
 * 서버 게이트용 monotonic_range 는 첫 창 시작 ~ 마지막 창 끝(장치 단조시계 µs).
 */
class ArchiveFeeder(
    private val queue: ArchiveQueue,
    private val sessionId: String,
    private val participantId: () -> String?,
    private val streamId: () -> String?,
    private val windowFrames: Int = 60,
    /** feature 산출물이 가리키는 원시 scope(stream_id, segment_id). 서버 규칙: feature 는 signal·segment_id·stream_id 필수. */
    private val scope: (() -> Pair<String, String>)? = null,
) {
    private val buf = ArrayList<JSONObject>()

    @Synchronized
    fun onFrame(f: JSONObject) {
        val seq = f.optString("sequence").toLongOrNull() ?: return
        if (buf.isNotEmpty() && buf.last().optString("sequence").toLongOrNull()?.let { seq != it + 1 } == true) flush() // 순번이 끊기면 구간을 나눈다
        buf.add(f)
        if (buf.size >= windowFrames) flush()
    }

    /** 종료·정지 시 남은 창을 봉인. */
    @Synchronized
    fun flush(): ArchiveItem? {
        if (buf.isEmpty()) return null
        val first = buf.first(); val last = buf.last()
        val raw = ByteArrayOutputStream()
        GZIPOutputStream(raw).use { gz -> for (f in buf) gz.write((f.toString() + "\n").toByteArray()) }
        val payload = raw.toByteArray()
        val firstSeq = first.getString("sequence"); val lastSeq = last.getString("sequence")
        val stream = streamId()
        val (scopeStream, scopeSegment) = scope?.invoke() ?: (RawIds.streamId(sessionId, com.looxidlabs.mindbreeze.measurement.Sensor.EEG) to RawIds.segmentId(sessionId, com.looxidlabs.mindbreeze.measurement.Sensor.EEG, 0))
        val alias = "NF-${stream?.take(8) ?: "X"}-$firstSeq" // 서버 Alias 규칙 ^[A-Z][A-Za-z0-9_-]{0,63}$ — 소문자 시작은 presign 422
        val sha = MessageDigest.getInstance("SHA-256").digest(payload).joinToString("") { "%02x".format(it) }
        val meta = JSONObject()
            .put("artifact_alias", alias).put("artifact_kind", "feature").put("stream_id", scopeStream)
            .put("segment_id", scopeSegment).put("signal", "eeg")
            .put("sequence", firstSeq.toLong()).put("first_sequence", firstSeq.toLong()).put("last_sequence", lastSeq.toLong())
            .put("row_count", buf.size).put("content_encoding", "gzip").put("schema_version", "feature-v1")
            .put("checksum", sha).put("size_bytes", payload.size).put("content_type", "application/x-ndjson")
            .put("time_range", JSONObject().put("from_us", first.getString("window_start_us")).put("to_us", last.getString("window_end_us")))
            .put("monotonic_range", JSONObject().put("from_us", first.getString("window_start_us")).put("to_us", last.getString("window_end_us")))
        buf.clear()
        return queue.enqueue("feature", sessionId, participantId(), alias, meta, payload)
    }
}
