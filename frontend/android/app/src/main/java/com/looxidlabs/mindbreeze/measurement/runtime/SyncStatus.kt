package com.looxidlabs.mindbreeze.measurement.runtime

import com.looxidlabs.mindbreeze.measurement.archive.ArchiveCounts
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/**
 * SDD-260 저장 진행 표시(docs/sdd-260-native-js-events.md). 화면 표시용이며 저장 판정·삭제에는 쓰지 않는다.
 * iOS SyncSnapshot(SessionSync.swift)과 같은 필드·상태 문자열을 쓴다.
 */
data class SyncCounts(
    val featurePending: Int = 0, val featureAcked: Long = 0, val featureRejected: Long = 0,
    val archivePending: Int = 0, val archiveUploading: Int = 0, val archiveVerified: Int = 0, val archiveQuarantined: Int = 0,
) {
    companion object {
        /** archiveQuarantined = 사람이 봐야 하는 항목(중단·사망 편지·시간 검토). 안드로이드 큐에는 uploading 상태가 없어 0. */
        fun of(featurePending: Int, featureAcked: Long, featureRejected: Long, a: ArchiveCounts) = SyncCounts(
            featurePending, featureAcked, featureRejected, a.archivePending, 0, a.archiveVerified, a.halted + a.deadLetter + a.pendingTimeReview,
        )
    }
}

/** feature/raw = syncing · resending · retrying · unverifiable · complete. complete = feature·원시 대조가 모두 끝남(그 전에는 절대 true 가 아니다). */
data class SyncState(val feature: String = "syncing", val raw: String = "syncing", val complete: Boolean = false)

object SyncEvents {
    const val FEATURE_COUNTS = "feature.counts"
    const val ARCHIVE_COUNTS = "archive.counts"
    const val RECONCILE_STATE = "reconcile.state"

    /** 이벤트명 → payload, 항상 이 순서(feature.counts, archive.counts, reconcile.state). */
    fun payloads(sessionId: String, c: SyncCounts, s: SyncState): List<Pair<String, JSONObject>> = listOf(
        FEATURE_COUNTS to JSONObject().put("sessionId", sessionId).put("pending", c.featurePending).put("acked", c.featureAcked).put("rejected", c.featureRejected),
        ARCHIVE_COUNTS to JSONObject().put("sessionId", sessionId).put("pending", c.archivePending).put("uploading", c.archiveUploading)
            .put("verified", c.archiveVerified).put("quarantined", c.archiveQuarantined),
        RECONCILE_STATE to JSONObject().put("sessionId", sessionId).put("feature", s.feature).put("raw", s.raw).put("complete", s.complete),
    )
}

/**
 * 방출 시점 규칙: 값이 바뀌면 즉시, 그대로면 periodMs(2초)마다 한 번. 이미 complete 이고 값이 그대로면 더는 보내지 않는다.
 * (마지막 값이 정본이라 중간 유실은 다음 주기에 복구된다.)
 */
class SyncEventGate(private val periodMs: Long = 2000) {
    private class Last(val fingerprint: String, val atMs: Long)
    private val last = HashMap<String, Last>()

    @Synchronized
    fun due(sessionId: String, c: SyncCounts, s: SyncState, nowMs: Long): Boolean {
        val fp = "$c|$s"
        val prev = last[sessionId]
        val send = when {
            prev == null || prev.fingerprint != fp -> true
            s.complete -> false
            else -> nowMs - prev.atMs >= periodMs
        }
        if (send) last[sessionId] = Last(fp, nowMs)
        return send
    }
}

/** 세션별 대조 상태·카운트. 측정 종료 후 ScopeSweeper(WorkManager·포그라운드)가 쓰고 MeasurementPlugin 이 읽는다. */
class SyncStatusBoard {
    private val states = ConcurrentHashMap<String, SyncState>()
    private val counts = ConcurrentHashMap<String, SyncCounts>()

    fun state(sessionId: String): SyncState = states[sessionId] ?: SyncState()
    fun counts(sessionId: String): SyncCounts = counts[sessionId] ?: SyncCounts()
    fun sessions(): Set<String> = states.keys + counts.keys

    fun setFeature(sessionId: String, v: String) { states.compute(sessionId) { _, o -> (o ?: SyncState()).copy(feature = v, complete = false) } }
    fun setRaw(sessionId: String, v: String) { states.compute(sessionId) { _, o -> (o ?: SyncState()).copy(raw = v, complete = false) } }
    fun setCounts(sessionId: String, c: SyncCounts) { counts[sessionId] = c }

    /** feature·원시 대조가 모두 끝난 뒤에만 호출한다(ScopeSweeper.markComplete). */
    fun markComplete(sessionId: String) { states[sessionId] = SyncState("complete", "complete", true) }

    companion object { val global = SyncStatusBoard() }
}

/**
 * 세 이벤트를 게이트 규칙(변경 즉시·2초 주기·완료 후 침묵)으로 내보낸다. 순수 로직이라 JVM 에서 검증한다.
 * 측정 중인 세션은 live 카운트(runtimeCounts)를, 그 밖의 세션(종료 후 스위퍼가 처리 중)은 board 값을 쓴다.
 */
class SyncEmitter(private val board: SyncStatusBoard, private val gate: SyncEventGate, private val send: (String, JSONObject) -> Unit) {
    fun emit(runtimeSession: String?, runtimeCounts: SyncCounts?, nowMs: Long) {
        val sids = LinkedHashSet<String>()
        if (runtimeSession != null && runtimeCounts != null) sids += runtimeSession
        sids += board.sessions()
        for (sid in sids) {
            val c = if (sid == runtimeSession && runtimeCounts != null) runtimeCounts else board.counts(sid)
            val st = board.state(sid)
            if (!gate.due(sid, c, st, nowMs)) continue
            for ((name, payload) in SyncEvents.payloads(sid, c, st)) send(name, payload)
        }
    }
}
