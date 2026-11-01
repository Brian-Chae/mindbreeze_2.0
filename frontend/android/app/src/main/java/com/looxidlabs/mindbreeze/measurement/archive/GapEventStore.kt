package com.looxidlabs.mindbreeze.measurement.archive

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

/**
 * SDD-270: 앱이 관측한 측정 구멍(gap)을 디스크에 먼저 남기는 내구 저장소. 웹 `queue.addGap` 에 해당한다.
 * 서버 `GapEventIn` 계약 그대로의 이벤트를 sequence 순으로 보관하고, 전송 상태(pending/sent/rejected)를 함께 둔다.
 * - event_id 는 (세션, 신호, 시작 시각)으로 정해지는 결정적 UUID 라 복구 재생·재시도에서도 같은 구멍은 같은 id 다(서버가 duplicate 처리).
 * - sequence 는 세션 단위 단조 0,1,2… 로 최초 적재 때 부여·영속한다(서버 `last_gap_sequence` 대조용).
 */
class GapEventStore(private val file: File, val sessionId: String, private val nowUs: () -> Long = { System.currentTimeMillis() * 1000L }) {
    class Entry(val event: JSONObject, val status: String, val attempts: Int)

    private class State(var nextSequence: Long, val entries: ArrayList<Entry>)

    private fun load(): State = try {
        val o = JSONObject(file.readText())
        val a = o.getJSONArray("entries")
        State(o.getLong("next_sequence"), ArrayList<Entry>().also { l -> for (i in 0 until a.length()) a.getJSONObject(i).let { l += Entry(it.getJSONObject("event"), it.getString("status"), it.optInt("attempts")) } })
    } catch (_: Exception) { State(0, ArrayList()) }

    private fun save(s: State) {
        val arr = JSONArray(); s.entries.forEach { arr.put(JSONObject().put("event", it.event).put("status", it.status).put("attempts", it.attempts)) }
        val tmp = File(file.path + ".tmp")
        try {
            file.parentFile?.mkdirs()
            FileOutputStream(tmp).use { it.write(JSONObject().put("next_sequence", s.nextSequence).put("entries", arr).toString().toByteArray()); it.flush(); it.fd.sync() }
            tmp.renameTo(file)
        } catch (_: Exception) { /* 저장 실패는 수집을 막지 않는다 — 같은 구멍은 다음 관측에서 같은 id 로 다시 적재된다 */ }
    }

    /** 구멍 적재. 이미 있는 구멍이면 null(sequence 불변). 상한 초과분은 버린다(폭주 방지). */
    @Synchronized
    fun append(signal: String, streamId: String, segmentId: String, startUs: Long, endUs: Long?, reason: String, observedOrEstimated: String, reconnectCount: Long): JSONObject? {
        val s = load()
        val id = UUID.nameUUIDFromBytes("mb-gap|$sessionId|$signal|$startUs".toByteArray()).toString()
        if (s.entries.any { it.event.getString("event_id") == id }) return null
        if (s.entries.size >= MAX_EVENTS) return null
        val e = JSONObject().put("event_type", "gap").put("event_id", id).put("sequence", s.nextSequence).put("discovered_at_us", nowUs().toString())
            .put("signal", signal).put("stream_id", streamId).put("segment_id", segmentId).put("start_us", startUs.toString())
            .put("end_us", endUs?.toString() ?: JSONObject.NULL).put("reason", reason).put("observed_or_estimated", observedOrEstimated)
            .put("expected_samples", JSONObject.NULL).put("received_samples", JSONObject.NULL).put("reconnect_count", reconnectCount)
        s.nextSequence += 1
        s.entries += Entry(e, "pending", 0)
        save(s)
        return e
    }

    @Synchronized fun pending(max: Int): List<Entry> = load().entries.filter { it.status == "pending" }.take(max)
    @Synchronized fun hasPending(): Boolean = load().entries.any { it.status == "pending" }
    @Synchronized fun lastSequence(): Long? = load().let { if (it.nextSequence == 0L) null else it.nextSequence - 1 }
    @Synchronized fun statuses(): List<String> = load().entries.map { it.status }

    @Synchronized
    fun mark(eventIds: Collection<String>, status: String) {
        val s = load()
        for (i in s.entries.indices) { val x = s.entries[i]; if (x.status == "pending" && x.event.getString("event_id") in eventIds) s.entries[i] = Entry(x.event, status, x.attempts) }
        save(s)
    }

    /** 전송 실패 횟수(진단용). 횟수가 많아도 포기하지 않는다. */
    @Synchronized
    fun noteAttempt() { val s = load(); for (i in s.entries.indices) { val x = s.entries[i]; if (x.status == "pending") s.entries[i] = Entry(x.event, x.status, x.attempts + 1) }; save(s) }

    companion object { const val MAX_EVENTS = 2000 }
}
