package com.looxidlabs.mindbreeze.measurement.live

import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.IOException

/** 종료 후 대조 한 번의 결과. */
sealed class ReconcileResult {
    /** 전송 대기 창이 남아 있어 아직 대조하지 않았다(FeatureUploader 가 비운 뒤 다시 호출). */
    object Waiting : ReconcileResult()
    /** 서버가 로컬 창을 전부 보유한다(outbox 에 완료 표식을 남겼다). localMissing=서버에도 로컬에도 없는 구멍 수(gap(local_missing) 진단). */
    data class Complete(val localMissing: Int) : ReconcileResult()
    /** 서버에 없는 창 count 건을 전송 대기로 되돌렸다 — FeatureUploader 를 깨우고 다시 대조한다. */
    data class Resending(val count: Int, val localMissing: Int) : ReconcileResult()
    /** 조회 실패(네트워크·5xx·인증). 완료로 보지 않는다. */
    data class Failed(val reason: String, val authWait: Boolean) : ReconcileResult()
}

/**
 * SDD-260 N2: 종료 후 `GET /sessions/{sid}/features/summary` 로 서버 보유 집합을 받아 로컬 sequence 집합 − 서버 보유 집합 = ∅ 인지 확인한다.
 * contract §2: 서버는 min_index 이전·max_index 이후를 알 수 없으므로 "missing_ranges 가 비었다"만으로 완료를 판정하지 않는다.
 * 서버에 없는 창은 outbox.requeue 로 전송 대기로 되돌려(로컬 사본이 있는 창만) FeatureUploader 가 다시 보낸다.
 * 완료 표식(outbox.markReconciled)이 있어야만 보관 정책이 정리를 고려한다 — 이 클래스는 아무것도 삭제하지 않는다.
 */
class FeatureReconciler(
    private val apiBase: String,
    private val sessionId: String,
    private val outbox: MetricOutbox,
    private val participantId: () -> String?,
    private val token: () -> String?,
    private val http: OkHttpClient,
    private val entryCredential: (() -> String?)? = null,
) {
    @Synchronized
    fun run(): ReconcileResult {
        if (outbox.sendableCount() > 0) return ReconcileResult.Waiting
        val local = outbox.ackedEntries()
        if (local.isEmpty()) { outbox.markReconciled(); return ReconcileResult.Complete(0) }
        val tok = token() ?: return ReconcileResult.Failed("auth_missing", true)
        val pid = participantId() ?: local.first().tag.participantId
        val url = "$apiBase/sessions/${java.net.URLEncoder.encode(sessionId, "UTF-8")}/features/summary?participant_id=${java.net.URLEncoder.encode(pid, "UTF-8")}"
        val rb = Request.Builder().url(url).get().header("Authorization", "Bearer $tok").header("X-MB-Native", "capacitor")
        entryCredential?.invoke()?.let { rb.header("X-Entry-Credential", it) }
        val json = try {
            http.newCall(rb.build()).execute().use { r ->
                if (r.code == 401) return ReconcileResult.Failed("http_401", true)
                if (r.code !in 200..299) return ReconcileResult.Failed("http_${r.code}", false)
                JSONObject(r.body?.string().orEmpty())
            }
        } catch (_: IOException) { return ReconcileResult.Failed("network", false) }
          catch (_: org.json.JSONException) { return ReconcileResult.Failed("bad_response", false) }
        val miss = missing(local.map { it.tag.streamId to it.seq }, json)
        val localMissing = localGaps(local.map { it.tag.streamId to it.seq }, json)
        if (miss.isEmpty()) { outbox.markReconciled(); return ReconcileResult.Complete(localMissing) }
        val n = outbox.requeue(miss)
        // 되돌린 창이 없다 = 결측이 로컬 사본으로 설명되지 않는다 → 같은 상태를 반복하지 않도록 실패로 알린다.
        return if (n > 0) ReconcileResult.Resending(n, localMissing) else ReconcileResult.Failed("unexplained_missing", false)
    }

    /** 서버 gap 구간(보유 범위 안의 구멍) 중 로컬에도 없는 인덱스 수 — 복구할 수 없는 구멍(진단용). */
    private fun localGaps(local: List<Pair<String, Long>>, summary: JSONObject): Int {
        val have = local.groupBy({ it.first }, { it.second }).mapValues { it.value.toHashSet() }
        var n = 0L
        val streams = summary.optJSONArray("streams") ?: return 0
        for (i in 0 until streams.length()) {
            val s = streams.getJSONObject(i); val id = s.optString("stream_id"); val ranges = s.optJSONArray("missing_ranges") ?: continue
            val mine = have[id] ?: emptySet<Long>()
            for (j in 0 until ranges.length()) {
                val r = ranges.getJSONArray(j); val lo = r.getLong(0); val hi = r.getLong(1)
                n += (hi - lo + 1) - mine.count { it in lo..hi }
            }
        }
        return n.coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
    }

    companion object {
        /**
         * 순수 계산: 로컬 창 중 서버가 보유하지 않은 sequence(로컬 순서 유지).
         * 서버 보유 = stream 의 [min_index, max_index] − missing_ranges. 서버에 없는 stream·범위 밖은 결측.
         * truncated(구멍 목록이 잘림)이면 마지막 구멍 끝 이후는 알 수 없으므로 결측으로 보고 재전송한 뒤 다시 조회해 수렴시킨다.
         */
        fun missing(local: List<Pair<String, Long>>, summary: JSONObject): List<Long> {
            class Held(val lo: Long, val hi: Long, val gaps: List<LongRange>, val truncated: Boolean)
            val held = HashMap<String, Held>()
            val streams = summary.optJSONArray("streams")
            if (streams != null) for (i in 0 until streams.length()) {
                val s = streams.getJSONObject(i)
                val id = s.optString("stream_id").ifEmpty { continue }
                if (!s.has("min_index") || !s.has("max_index")) continue
                val gaps = ArrayList<LongRange>()
                s.optJSONArray("missing_ranges")?.let { a -> for (j in 0 until a.length()) { val r = a.getJSONArray(j); gaps += r.getLong(0)..r.getLong(1) } }
                held[id] = Held(s.getLong("min_index"), s.getLong("max_index"), gaps, s.optBoolean("truncated", false))
            }
            val out = ArrayList<Long>()
            for ((stream, seq) in local) {
                val h = held[stream]
                when {
                    h == null -> out += seq
                    seq < h.lo || seq > h.hi -> out += seq
                    h.gaps.any { seq in it } -> out += seq
                    h.truncated && h.gaps.isNotEmpty() && seq > h.gaps.maxOf { it.last } -> out += seq
                }
            }
            return out
        }
    }
}
