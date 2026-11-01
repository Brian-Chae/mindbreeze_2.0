package com.looxidlabs.mindbreeze.measurement.archive

import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.IOException

/** 원시 종료 대조 한 번의 결과. */
sealed class RawReconcileResult {
    /** 업로드 대기 항목이 남아 있어 아직 대조하지 않았다. */
    object Waiting : RawReconcileResult()
    /** 서버가 로컬 원시 항목을 전부 보유한다. */
    object Complete : RawReconcileResult()
    /** 서버에 없는 alias count 건을 업로드 대기로 되돌렸다. lost=되돌릴 payload 가 없는 항목(복구 불가 진단). */
    data class Resending(val count: Int, val lost: Int) : RawReconcileResult()
    /** 서버 alias 목록이 상한에서 잘려 "없음"을 "누락"으로 단정할 수 없다. */
    object Unverifiable : RawReconcileResult()
    data class Failed(val reason: String, val authWait: Boolean) : RawReconcileResult()
}

/**
 * SDD-260 N5: archive 큐가 비면 `GET /biosignal-raw/summary` 의 `aliases_uploaded` 와 로컬 raw 항목(VERIFIED)을 비교해
 * 서버에 없는 alias 를 PENDING 으로 되돌린다. 아무것도 삭제하지 않는다.
 */
class RawReconciler(
    private val apiBase: String,
    private val sessionId: String,
    private val queue: ArchiveQueue,
    private val participantId: () -> String?,
    private val token: () -> String?,
    private val http: OkHttpClient,
) {
    @Synchronized
    fun run(): RawReconcileResult {
        if (queue.counts().archivePending > 0) return RawReconcileResult.Waiting
        val local = queue.all().filter { it.kind == "raw" && it.status == ArchiveStatus.VERIFIED }
        if (local.isEmpty()) return RawReconcileResult.Complete
        val tok = token() ?: return RawReconcileResult.Failed("auth_missing", true)
        val pid = participantId() ?: local.first().participantId
        val q = if (pid != null) "?participant_id=${java.net.URLEncoder.encode(pid, "UTF-8")}" else ""
        val rb = Request.Builder().url("$apiBase/sessions/${java.net.URLEncoder.encode(sessionId, "UTF-8")}/biosignal-raw/summary$q")
            .get().header("Authorization", "Bearer $tok").header("X-MB-Native", "capacitor")
        val json = try {
            http.newCall(rb.build()).execute().use { r ->
                if (r.code == 401) return RawReconcileResult.Failed("http_401", true)
                if (r.code !in 200..299) return RawReconcileResult.Failed("http_${r.code}", false)
                JSONObject(r.body?.string().orEmpty())
            }
        } catch (_: IOException) { return RawReconcileResult.Failed("network", false) }
          catch (_: org.json.JSONException) { return RawReconcileResult.Failed("bad_response", false) }
        val arr = json.optJSONArray("aliases_uploaded") ?: return RawReconcileResult.Failed("bad_response", false)
        val have = HashSet<String>().also { for (i in 0 until arr.length()) it += arr.getString(i) }
        val miss = local.filter { it.alias !in have }
        if (miss.isEmpty()) return RawReconcileResult.Complete
        if (json.optBoolean("aliases_truncated", false)) return RawReconcileResult.Unverifiable
        var n = 0; var lost = 0
        for (m in miss) if (queue.requeue(m.alias)) n++ else lost++
        return if (n > 0) RawReconcileResult.Resending(n, lost) else RawReconcileResult.Failed("unexplained_missing", false)
    }
}
