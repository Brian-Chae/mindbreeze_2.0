package com.looxidlabs.mindbreeze.measurement.bridge

import com.looxidlabs.mindbreeze.measurement.archive.ArchiveCounts
import org.json.JSONArray
import org.json.JSONObject

/** 스냅샷을 만들 때 필요한 값(수집·live·archive 상태의 읽기 전용 사본). */
data class BridgeInputs(
    val managerGeneration: Long, val seq: Long, val sessionId: String, val state: String, val blockedReason: String?,
    val streamId: String?, val ownerGeneration: String?,
    val nativeRuntime: String, val core: String, val algorithm: String, val model: String, val deviceProfile: String,
    val lastFrame: JSONObject?, val freshness: String,
    val bandState: String, val lastCommittedSample: Long?,
    val eegPackets: Long, val ppgPackets: Long, val accPackets: Long, val eegSamples: Long, val ppgSamples: Long, val accSamples: Long,
    val metricWindows: Long, val nativeHeartbeat: Long,
    val socket: String, val lastAckSequence: Long, val through: JSONArray,
    val liveAcked: Long, val livePending: Int, val archive: ArchiveCounts, val lastVerifiedAtMs: Long?,
    val gaps: List<JSONObject>,
)

/**
 * measurement-bridge 계약(MeasurementSnapshot/BridgeEvent)을 만든다. raw 샘플·토큰·서명 URL은 절대 싣지 않는다.
 * 64비트 값은 십진 문자열로 직렬화한다(JS 안전 정수 경계).
 */
object BridgeModel {
    const val BRIDGE_VERSION = 1
    const val DISK_LIMIT = 536870912L

    private fun u(n: Long) = n.coerceAtLeast(0).toString()

    fun metricsSnapshot(f: JSONObject?, freshness: String): Any {
        if (f == null) return JSONObject.NULL
        return JSONObject().put("sequence", f.getString("sequence")).put("observed_at_ms", f.opt("observed_at_ms") ?: JSONObject.NULL)
            .put("freshness", freshness).put("sqi", f.opt("sqi") ?: JSONObject.NULL).put("contact", f.get("contact")).put("metrics", f.get("metrics"))
    }

    fun queue(i: BridgeInputs) = JSONObject()
        .put("live_pending", i.livePending).put("live_acked", i.liveAcked)
        .put("archive_pending", i.archive.archivePending).put("archive_verified", i.archive.archiveVerified)
        .put("pending_authorization", i.archive.halted).put("pending_time_review", i.archive.pendingTimeReview)
        .put("oldest_pending_age_ms", i.archive.oldestPendingAgeMs ?: JSONObject.NULL)
        .put("disk_used_bytes", i.archive.diskUsedBytes).put("disk_limit_bytes", DISK_LIMIT)

    fun snapshot(i: BridgeInputs): JSONObject {
        val counters = JSONObject()
            .put("packets", JSONObject().put("eeg", u(i.eegPackets)).put("ppg", u(i.ppgPackets)).put("acc", u(i.accPackets)))
            .put("samples", JSONObject().put("eeg", u(i.eegSamples)).put("ppg", u(i.ppgSamples)).put("acc", u(i.accSamples)))
            .put("native_metric_windows", u(i.metricWindows)).put("native_heartbeat", u(i.nativeHeartbeat)).put("js_heartbeat_independent", true)
        return JSONObject()
            .put("bridge_version", BRIDGE_VERSION).put("managerGeneration", u(i.managerGeneration)).put("seq", u(i.seq))
            .put("sessionId", i.sessionId).put("state", i.state).put("blocked_reason", i.blockedReason ?: JSONObject.NULL)
            .put("streamId", i.streamId ?: JSONObject.NULL).put("ownerGeneration", i.ownerGeneration ?: JSONObject.NULL)
            .put("versions", JSONObject().put("native_runtime", i.nativeRuntime).put("core", i.core).put("algorithm", i.algorithm)
                .put("model", i.model).put("device_profile", i.deviceProfile))
            .put("metrics", metricsSnapshot(i.lastFrame, i.freshness))
            .put("collection", JSONObject().put("band_state", i.bandState)
                .put("last_committed_sample_sequence", i.lastCommittedSample?.let { u(it) } ?: JSONObject.NULL).put("counters", counters))
            .put("live", JSONObject().put("socket", i.socket)
                .put("last_ack_sequence", if (i.lastAckSequence >= 0) u(i.lastAckSequence) else JSONObject.NULL).put("snapshot_through", i.through))
            .put("archive", JSONObject().put("queue", queue(i)).put("last_verified_at_ms", i.lastVerifiedAtMs ?: JSONObject.NULL))
            .put("gaps", JSONArray(i.gaps))
    }

    fun event(name: String, managerGeneration: Long, seq: Long, nowMs: Long, payload: JSONObject) = JSONObject()
        .put("bridge_version", BRIDGE_VERSION).put("event", name).put("managerGeneration", u(managerGeneration)).put("seq", u(seq))
        .put("emitted_at_native_ms", nowMs).put("payload", payload)

    fun archiveStatusPayload(sessionId: String, q: JSONObject, blocked: String?, stage: String?, code: String?) = JSONObject()
        .put("sessionId", sessionId).put("queue", q).put("blocked_reason", blocked ?: JSONObject.NULL)
        .put("stage", stage ?: JSONObject.NULL).put("code", code ?: JSONObject.NULL)

    /** handoffCredentials 결과. 인계받은 토큰은 어떤 형태로도 되돌리지 않는다(계약 HandoffCredentialsResult = {handoff} 만). */
    fun handoffResult(saved: Boolean) = JSONObject().put("handoff", saved)

    fun liveStatePayload(sessionId: String, event: JSONObject) = JSONObject().put("sessionId", sessionId).put("event", event)
}

/** 이벤트 순서 번호: 관리자 세대 + 단조 seq. foreground 일 때만 batch emit 한다(plan §6.4). */
class BridgeSequencer(val managerGeneration: Long) {
    private var seq = 0L
    @Synchronized fun next(): Long = ++seq
    @Synchronized fun current(): Long = seq
}
