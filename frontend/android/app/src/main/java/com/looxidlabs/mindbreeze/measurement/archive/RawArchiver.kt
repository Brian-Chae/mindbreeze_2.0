package com.looxidlabs.mindbreeze.measurement.archive

import com.looxidlabs.mindbreeze.measurement.JournalRecord
import com.looxidlabs.mindbreeze.measurement.Sensor
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

/**
 * 센서별 RawChunker 를 묶어 봉인된 원시 청크를 ArchiveQueue(kind=raw)에 넣는다.
 * 프로세스가 죽었다 살아나면 raw.journal 에서 "아직 청크에 못 든 레코드"만 다시 먹인다(센서별 lastSealed 기준).
 * 재시작 직후 첫 패킷은 새 segment(ordinal+1)로 시작해 앞선 segment 의 alias 와 겹치지 않는다.
 */
class RawArchiver(
    private val queue: ArchiveQueue,
    private val sessionId: String,
    private val participantId: () -> String?,
    private val stateFile: File,
    /** SDD-270: 구멍 저장소(없으면 구멍을 남기지 않는다 — 기존 시험·호출 호환). */
    private val gaps: GapEventStore? = null,
    /** 밴드 재연결 누계. 롤오버 직전에 늘었으면 그 구멍은 ble_disconnect 다. */
    private val reconnects: () -> Long = { 0L },
) {
    private val lastUs = HashMap<Sensor, Long>()
    private val lastReconnects = HashMap<Sensor, Long>()
    /** 이전 실행이 남긴 마지막 샘플 시각 — 첫 패킷에서 process_terminated 구멍으로 바꾼다. */
    private val restartFrom = HashMap<Sensor, Long>()
    private val ordinals = HashMap<Sensor, Int>()
    private val lastSealed = HashMap<Sensor, Long>()
    private val chunkers = HashMap<Sensor, RawChunker>()
    private var recordCount = 0L
    private var originUs: Long? = null

    init { loadState() }

    private fun loadState() {
        val o = try { JSONObject(stateFile.readText()) } catch (_: Exception) { return }
        if (o.has("origin_us")) originUs = o.optLong("origin_us")
        for (s in Sensor.values()) {
            ordinals[s] = o.optJSONObject("ordinal")?.optInt(s.name, -1) ?: -1
            lastSealed[s] = o.optJSONObject("sealed")?.optLong(s.name, 0L) ?: 0L
            o.optJSONObject("last_us")?.optLong(s.name, 0L)?.takeIf { it > 0 }?.let { restartFrom[s] = it }
        }
    }

    private fun saveState() {
        val o = JSONObject().put("origin_us", originUs ?: 0L).put("ordinal", JSONObject().also { j -> ordinals.forEach { (s, v) -> j.put(s.name, v) } })
            .put("sealed", JSONObject().also { j -> lastSealed.forEach { (s, v) -> j.put(s.name, v) } })
            .put("last_us", JSONObject().also { j -> lastUs.forEach { (s, v) -> j.put(s.name, v) } })
        val tmp = File(stateFile.path + ".tmp")
        try {
            FileOutputStream(tmp).use { it.write(o.toString().toByteArray()); it.flush(); it.fd.sync() }
            tmp.renameTo(stateFile)
        } catch (_: Exception) { /* 상태 저장 실패는 수집을 막지 않는다 — 다음 청크에서 다시 기록 */ }
    }

    private fun chunker(s: Sensor, arrivalUs: Long = 0L): RawChunker {
        if (originUs == null) { originUs = arrivalUs; saveState() }
        return chunkers.getOrPut(s) { build(s) }
    }

    private fun build(s: Sensor) = run {
        RawChunker(s, sessionId, originUs ?: 0L, (ordinals[s] ?: -1) + 1, { c -> onChunk(s, c) }, { ord -> ordinals[s] = ord; saveState() }, { g -> onGap(s, g) })
    }

    private fun onGap(s: Sensor, g: RawGap) {
        val store = gaps ?: return
        val rc = reconnects()
        val reason = if (g.reason == "packet_gap" && rc > (lastReconnects[s] ?: 0L)) "ble_disconnect" else g.reason
        lastReconnects[s] = rc
        store.append(g.signal, RawIds.streamId(sessionId, s), g.segmentId, g.startUs, g.endUs, reason, "observed", rc)
    }

    /** 재시작 뒤 첫 패킷: 이전 실행의 마지막 샘플 ~ 지금. 종료 시각을 정확히 모르므로 estimated. */
    private fun restartGap(s: Sensor, arrivalUs: Long, packetLen: Int) {
        val from = restartFrom.remove(s) ?: return
        val store = gaps ?: return
        val rows = maxOf(0, (packetLen - 4) / s.sampleBytes)
        val end = arrivalUs - maxOf(0, rows - 1).toLong() * 1_000_000L / s.sampleRateHz
        val seg = chunkers[s]?.currentSegmentId ?: RawIds.segmentId(sessionId, s, maxOf(ordinals[s] ?: 0, 0))
        val rc = reconnects(); lastReconnects[s] = rc
        store.append(s.name.lowercase(), RawIds.streamId(sessionId, s), seg, from, if (end >= from) end else null, "process_terminated", "estimated", rc)
    }

    private fun onChunk(s: Sensor, c: RawChunk) {
        queue.enqueue("raw", sessionId, participantId(), c.alias, c.meta, c.payload)
        lastSealed[s] = c.lastRecordIndex
        saveState()
    }

    /** 현재 EEG(등) segment 의 id — feature 산출물 scope 에 쓴다. */
    fun segmentId(s: Sensor): String = chunkers[s]?.currentSegmentId ?: RawIds.segmentId(sessionId, s, (ordinals[s] ?: -1) + 1)
    fun streamId(s: Sensor): String = RawIds.streamId(sessionId, s)

    @Synchronized
    fun onPacket(sensor: Sensor, arrivalUs: Long, bytes: ByteArray) {
        recordCount += 1
        restartGap(sensor, arrivalUs, bytes.size)
        lastUs[sensor] = arrivalUs
        chunker(sensor, arrivalUs).onPacket(bytes, arrivalUs, recordCount)
    }

    /** 복구: journal 의 아직 청크에 못 든 레코드를 먹인다. arrivalToUs 는 도착 단조 ms → 창 시간축 µs. */
    @Synchronized
    fun replay(records: List<JournalRecord>, arrivalToUs: (Long) -> Long) {
        for ((i, r) in records.withIndex()) {
            val idx = i + 1L
            recordCount = idx
            if (idx <= (lastSealed[r.sensor] ?: 0L)) continue
            val us = arrivalToUs(r.arrivalMonoMs)
            lastUs[r.sensor] = us; if (restartFrom.containsKey(r.sensor)) restartFrom[r.sensor] = us
            chunker(r.sensor, us).onPacket(r.payload, us, idx)
        }
    }

    /** 정지·종료: 남은 샘플을 모두 봉인. */
    @Synchronized
    fun flush() { for (c in chunkers.values) c.flush() }
}
