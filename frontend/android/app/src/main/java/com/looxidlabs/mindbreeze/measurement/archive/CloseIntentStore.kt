package com.looxidlabs.mindbreeze.measurement.archive

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

/**
 * 네이티브 종료 기록(biosignal close intent). 웹 `capture-session.ts close()` 와 같은 서버 계약(`CloseIntentIn`)이다.
 *
 * 실기기 회차(2a11d64c)에서 네이티브가 올린 raw·feature 에 대한 close intent 가 한 건도 없어 manifest 가 unknown 에 머물렀다.
 * 종료(stop) 때 ArchiveQueue 에 든 raw·feature 항목으로 expected set 을 만들어 디스크에 먼저 쓰고(서버 응답 이전),
 * 업로드 drain 뒤 `POST /sessions/{sid}/biosignal-events` 로 보낸다. 같은 내용이면 intent_id 가 같아 서버가 멱등 처리한다.
 * 서버는 JS 가 따로 보낸 intent(indices·normalization)와 합집합으로 판정한다.
 */
class CloseIntentStore(private val file: File) {
    class Pending(val intent: JSONObject, val attempts: Int)

    /** 종료 시점 큐 스냅샷으로 intent 를 만들어 저장한다. 큐에 raw·feature 가 없으면 만들지 않는다(null). 같은 내용이 이미 보내졌으면 다시 쓰지 않는다. */
    @Synchronized
    fun record(queue: ArchiveQueue, sessionId: String, reason: String, nowUs: Long): JSONObject? {
        val items = queue.all().filter { it.sessionId == sessionId && (it.kind == "raw" || it.kind == "feature") }
        if (items.isEmpty()) return null
        val expected = JSONArray()
        // (stream_id, segment_id, signal) → [마지막 chunk_index, 수신 샘플]
        val streams = LinkedHashMap<Triple<String, String, String>, LongArray>()
        for (i in items) {
            expected.put(JSONObject().put("kind", i.kind).put("alias", i.alias).put("sha256", i.meta.getString("checksum")))
            if (i.kind != "raw") continue
            val h = i.meta.optJSONObject("header") ?: continue
            val key = Triple(h.getString("stream_id"), h.getString("segment_id"), h.getString("signal_type"))
            val agg = streams.getOrPut(key) { longArrayOf(-1L, 0L) }
            agg[0] = maxOf(agg[0], h.getLong("chunk_index")); agg[1] += h.optLong("sample_count")
        }
        val streamArr = JSONArray()
        for ((k, v) in streams) streamArr.put(JSONObject().put("stream_id", k.first).put("segment_id", k.second).put("signal", k.third)
            // feature 순번은 코어 프레임 순번(1부터)이라 서버의 0..last 구멍 판정과 맞지 않아 보내지 않는다 — feature 는 expected set 으로 대조한다.
            .put("last_chunk_sequence", if (v[0] >= 0) v[0] else JSONObject.NULL).put("last_feature_sequence", JSONObject.NULL).put("received_samples", v[1]))
        val intentId = UUID.nameUUIDFromBytes(("mb-close-intent|$sessionId|" + items.map { it.alias }.sorted().joinToString(",")).toByteArray()).toString()
        val prev = load()
        if (prev != null && prev.first.optString("intent_id") == intentId) return prev.first // 같은 내용: 그대로(이미 보냈으면 다시 보내지 않는다)
        val intent = JSONObject().put("event_type", "close_intent").put("intent_id", intentId).put("expected_artifacts", expected)
            .put("streams", streamArr).put("snapshots", JSONArray()).put("last_gap_sequence", JSONObject.NULL)
            .put("end_reason", reason.take(64)).put("closed_at_us", nowUs.toString())
        save(intent, sent = false, attempts = 0)
        return intent
    }

    /** 아직 서버가 받지 않은 intent(없으면 null). 재시도 한도를 넘으면 더 보내지 않는다. */
    @Synchronized
    fun pending(): Pending? {
        val (intent, sent, attempts) = load() ?: return null
        if (sent || attempts >= MAX_ATTEMPTS) return null
        return Pending(intent, attempts)
    }

    @Synchronized fun markSent() { load()?.let { save(it.first, sent = true, attempts = it.third) } }
    @Synchronized fun markAttempt() { load()?.let { save(it.first, sent = false, attempts = it.third + 1) } }

    private fun load(): Triple<JSONObject, Boolean, Int>? = try {
        val o = JSONObject(file.readText())
        Triple(o.getJSONObject("intent"), o.optBoolean("sent"), o.optInt("attempts"))
    } catch (_: Exception) { null }

    private fun save(intent: JSONObject, sent: Boolean, attempts: Int) {
        val tmp = File(file.path + ".tmp")
        try {
            FileOutputStream(tmp).use { it.write(JSONObject().put("intent", intent).put("sent", sent).put("attempts", attempts).toString().toByteArray()); it.flush(); it.fd.sync() }
            tmp.renameTo(file)
        } catch (_: Exception) { /* 저장 실패해도 다음 종료/재시도에서 다시 만든다 */ }
    }

    companion object { const val MAX_ATTEMPTS = 12 }
}
