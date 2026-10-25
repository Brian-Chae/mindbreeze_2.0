package com.looxidlabs.mindbreeze.measurement.archive

import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

enum class ArchiveStatus { PENDING, VERIFIED, HALTED, TIME_REVIEW, DEAD_LETTER }

class ArchiveItem(
    val id: String, val seq: Long, val kind: String, val sessionId: String, val participantId: String?, val alias: String,
    val meta: JSONObject, val payloadFile: File,
    var status: ArchiveStatus = ArchiveStatus.PENDING, var attempts: Int = 0, var nextAttemptAtMs: Long = 0,
    var lastReason: String? = null, var lastStage: String? = null, var verifiedAtUs: String? = null, var serverId: String? = null,
)

data class ArchiveCounts(
    val archivePending: Int, val archiveVerified: Int, val pendingTimeReview: Int, val halted: Int, val deadLetter: Int,
    val oldestPendingAgeMs: Long?, val diskUsedBytes: Long,
)

/**
 * 산출물 파일(payload) + 항목 메타(json)를 디스크에 두는 durable 큐. 항목은 서버 verify 영수증을 받기 전에는 지우지 않는다.
 * 메타 갱신은 임시 파일 → fsync → rename 으로 원자적이라 프로세스가 죽어도 이전 또는 새 상태 중 하나가 남는다.
 */
class ArchiveQueue(private val dir: File, private val nowMs: () -> Long = { System.currentTimeMillis() }) {
    private val items = LinkedHashMap<String, ArchiveItem>()
    private var nextSeq = 1L
    private val enqueuedAt = HashMap<String, Long>()

    init { dir.mkdirs(); load() }

    private fun metaFile(id: String) = File(dir, "$id.json")
    private fun payloadOf(id: String) = File(dir, "$id.bin")

    private fun load() {
        val loaded = ArrayList<ArchiveItem>()
        dir.listFiles { f -> f.name.endsWith(".json") }?.forEach { f ->
            try {
                val o = JSONObject(f.readText())
                val id = o.getString("id")
                if (!payloadOf(id).exists()) return@forEach
                loaded += ArchiveItem(
                    id, o.getLong("seq"), o.getString("kind"), o.getString("session_id"), o.optString("participant_id").ifEmpty { null },
                    o.getString("alias"), o.getJSONObject("meta"), payloadOf(id),
                    ArchiveStatus.valueOf(o.getString("status")), o.optInt("attempts"), o.optLong("next_attempt_at"),
                    o.optString("last_reason").ifEmpty { null }, o.optString("last_stage").ifEmpty { null },
                    o.optString("verified_at_us").ifEmpty { null }, o.optString("server_id").ifEmpty { null },
                ).also { enqueuedAt[id] = o.optLong("enqueued_at", nowMs()) }
            } catch (_: Exception) { /* 찢긴 메타는 건너뜀 — payload 는 남아 수동 복구 가능 */ }
        }
        loaded.sortBy { it.seq }
        for (i in loaded) items[i.id] = i
        nextSeq = (loaded.maxOfOrNull { it.seq } ?: 0L) + 1
    }

    @Synchronized
    fun enqueue(kind: String, sessionId: String, participantId: String?, alias: String, meta: JSONObject, payload: ByteArray): ArchiveItem {
        items.values.firstOrNull { it.alias == alias && it.kind == kind && it.sessionId == sessionId }?.let { return it } // 같은 alias 재투입은 한 번만
        val id = UUID.randomUUID().toString()
        val pf = payloadOf(id)
        FileOutputStream(pf).use { it.write(payload); it.flush(); it.fd.sync() } // payload 먼저 → 메타가 있으면 payload 도 반드시 있다
        val item = ArchiveItem(id, nextSeq++, kind, sessionId, participantId, alias, meta, pf)
        enqueuedAt[id] = nowMs()
        items[id] = item
        persist(item)
        return item
    }

    @Synchronized
    fun update(item: ArchiveItem) { persist(item) }

    private fun persist(i: ArchiveItem) {
        val o = JSONObject().put("id", i.id).put("seq", i.seq).put("kind", i.kind).put("session_id", i.sessionId)
            .put("participant_id", i.participantId ?: "").put("alias", i.alias).put("meta", i.meta).put("status", i.status.name)
            .put("attempts", i.attempts).put("next_attempt_at", i.nextAttemptAtMs).put("last_reason", i.lastReason ?: "")
            .put("last_stage", i.lastStage ?: "").put("verified_at_us", i.verifiedAtUs ?: "").put("server_id", i.serverId ?: "")
            .put("enqueued_at", enqueuedAt[i.id] ?: nowMs())
        val tmp = File(dir, "${i.id}.json.tmp")
        FileOutputStream(tmp).use { it.write(o.toString().toByteArray()); it.flush(); it.fd.sync() }
        tmp.renameTo(metaFile(i.id))
    }

    @Synchronized fun get(id: String): ArchiveItem? = items[id]
    @Synchronized fun pending(): List<ArchiveItem> = items.values.filter { it.status == ArchiveStatus.PENDING }.sortedBy { it.seq }
    @Synchronized fun all(): List<ArchiveItem> = items.values.sortedBy { it.seq }

    @Synchronized
    fun counts(): ArchiveCounts {
        val now = nowMs()
        val pend = items.values.filter { it.status == ArchiveStatus.PENDING }
        return ArchiveCounts(
            pend.size, items.values.count { it.status == ArchiveStatus.VERIFIED },
            items.values.count { it.status == ArchiveStatus.TIME_REVIEW }, items.values.count { it.status == ArchiveStatus.HALTED },
            items.values.count { it.status == ArchiveStatus.DEAD_LETTER },
            pend.minOfOrNull { enqueuedAt[it.id] ?: now }?.let { now - it },
            items.values.sumOf { it.payloadFile.length() },
        )
    }

    /** 영수증을 받은 항목의 payload 만 정리(GC). 메타(영수증)는 완결성 검증용으로 남긴다. */
    @Synchronized
    fun gcVerified() { for (i in items.values) if (i.status == ArchiveStatus.VERIFIED && i.payloadFile.exists()) i.payloadFile.delete() }
}
