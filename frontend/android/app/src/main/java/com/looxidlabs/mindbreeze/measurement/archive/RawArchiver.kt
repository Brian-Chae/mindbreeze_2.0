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
) {
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
        }
    }

    private fun saveState() {
        val o = JSONObject().put("origin_us", originUs ?: 0L).put("ordinal", JSONObject().also { j -> ordinals.forEach { (s, v) -> j.put(s.name, v) } })
            .put("sealed", JSONObject().also { j -> lastSealed.forEach { (s, v) -> j.put(s.name, v) } })
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
        RawChunker(s, sessionId, originUs ?: 0L, (ordinals[s] ?: -1) + 1, { c -> onChunk(s, c) }, { ord -> ordinals[s] = ord; saveState() })
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
            chunker(r.sensor, us).onPacket(r.payload, us, idx)
        }
    }

    /** 정지·종료: 남은 샘플을 모두 봉인. */
    @Synchronized
    fun flush() { for (c in chunkers.values) c.flush() }
}
