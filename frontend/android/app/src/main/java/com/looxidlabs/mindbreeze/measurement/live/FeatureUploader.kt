package com.looxidlabs.mindbreeze.measurement.live

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/** 창 envelope 에 싣는 세션 공통 값(기기 프로필·알고리즘·모델·시계 불확실도). */
data class FeatureMeta(val deviceProfile: String, val algorithmVersion: String, val modelVersion: String, val clockUncertaintyMs: Double)

/** 한 번의 REST 배치 시도 결과. */
sealed class FlushResult {
    /** 보낼 창이 없다. */
    object Idle : FlushResult()
    /** 응답을 받았다. more=처리하지 못한 창 없이 아직 대기 창이 남아 즉시 다음 배치를 보내야 한다. */
    data class Done(val accepted: Int, val duplicate: Int, val quarantined: Int, val more: Boolean) : FlushResult()
    /** 전송 실패(네트워크·5xx·401…). 창은 그대로 남아 있다. authWait=토큰이 없거나 갱신 대기. */
    data class Retry(val reason: String, val retryAfterMs: Long? = null, val authWait: Boolean = false) : FlushResult()
}

/**
 * SDD-260 N1: feature 창을 `POST /sessions/{sid}/features/batch` 로 보낸다 — DB 에 feature 를 기록하는 **유일한** 경로.
 * outbox 의 가장 오래된 창부터 ≤60개(한 참가자), 동시 요청 1(synchronized). 소켓(READY·방송·투영)과 무관하게 동작한다.
 *
 * 결과 처리(계약 contract.md §1):
 *  - accepted/duplicate → outbox.ack (사본은 종료 대조까지 보관)
 *  - rejected 4종(consent_withdrawn·participant_mismatch·stream_not_owned·hash_conflict) → 격리(재전송 안 함)
 *  - 그 밖의 rejected 코드·네트워크·5xx·408·429 → 창을 남기고 재시도(full jitter 는 FeatureSyncLoop)
 *  - 422 invalid_message(앱 버그, 재시도해도 같은 결과) → 배치를 절반씩 줄여 독이 든 창 하나를 찾아 격리
 *  - 401 → 토큰 갱신 후 한 번 더, 안 되면 인증 대기
 */
class FeatureUploader(
    private val apiBase: String,
    private val sessionId: String,
    private val outbox: MetricOutbox,
    private val meta: () -> FeatureMeta,
    private val token: () -> String?,
    private val refresh: (() -> Boolean)?,
    private val http: OkHttpClient,
    private val entryCredential: (() -> String?)? = null,
) {
    private var batchLimit = MAX_BATCH

    @Synchronized
    fun flushOnce(): FlushResult {
        val batch = outbox.pendingBatch(batchLimit)
        if (batch.isEmpty()) return FlushResult.Idle
        var tok = token() ?: return FlushResult.Retry("auth_missing", authWait = true)
        var refreshedOnce = false
        while (true) {
            val res = try { post(batch, tok) } catch (e: IOException) { return FlushResult.Retry("network") }
            when {
                res.code in 200..299 -> return applyResults(batch, res.json)
                res.code == 401 -> {
                    // 다른 경로가 이미 갱신했으면 새 토큰으로, 아니면 갱신을 시도한다(실패하면 인증 대기).
                    val cur = token()
                    if (cur != null && cur != tok && !refreshedOnce) { tok = cur; refreshedOnce = true; continue }
                    val ok = !refreshedOnce && (refresh?.invoke() ?: false)
                    val next = token()
                    if (ok && next != null && next != tok) { tok = next; refreshedOnce = true; continue }
                    return FlushResult.Retry("http_401", authWait = true)
                }
                res.code == 422 -> return onInvalid(batch, res.json)
                else -> return FlushResult.Retry("http_${res.code}", retryAfterMs = res.retryAfterMs)
            }
        }
    }

    private class Res(val code: Int, val json: JSONObject?, val retryAfterMs: Long?)

    private fun post(batch: List<OutboxEntry>, token: String): Res {
        val pid = batch.first().tag.participantId
        val m = meta()
        val windows = JSONArray()
        for (e in batch) windows.put(envelope(sessionId, e, m))
        val body = JSONObject().put("participant_id", pid).put("windows", windows)
        val rb = Request.Builder().url("$apiBase/sessions/${java.net.URLEncoder.encode(sessionId, "UTF-8")}/features/batch")
            .post(body.toString().toRequestBody(JSON))
            .header("Authorization", "Bearer $token").header("X-MB-Native", "capacitor")
        entryCredential?.invoke()?.let { rb.header("X-Entry-Credential", it) }
        http.newCall(rb.build()).execute().use { r ->
            val text = r.body?.string().orEmpty()
            val json = try { JSONObject(text) } catch (_: Exception) { null }
            val ra = r.header("Retry-After")?.toDoubleOrNull()?.takeIf { it > 0 }?.let { (it * 1000).toLong() }
            return Res(r.code, json, ra)
        }
    }

    private fun applyResults(batch: List<OutboxEntry>, json: JSONObject?): FlushResult {
        val results = json?.optJSONArray("results")
        if (results == null || results.length() != batch.size) return FlushResult.Retry("response_mismatch")
        // 결과는 요청 순서와 같아야 한다 — 순번이 어긋나면 어느 창의 결과인지 알 수 없으므로 하나도 확정하지 않는다.
        for (i in batch.indices) if (results.optJSONObject(i)?.optString("sequence") != batch[i].seq.toString()) return FlushResult.Retry("response_mismatch")
        var accepted = 0; var duplicate = 0; var quarantined = 0; var unresolved = 0
        for (i in batch.indices) {
            val r = results.getJSONObject(i); val seq = batch[i].seq
            when (r.optString("status")) {
                "accepted" -> { outbox.ack(seq); accepted++ }
                "duplicate" -> { outbox.ack(seq); duplicate++ }
                "rejected" -> {
                    val code = r.optString("code")
                    if (code in QUARANTINE_CODES) { outbox.quarantine(seq, code); quarantined++ } else unresolved++
                }
                else -> unresolved++
            }
        }
        return FlushResult.Done(accepted, duplicate, quarantined, more = unresolved == 0 && outbox.pendingBatch(1).isNotEmpty())
    }

    /** 요청 전체가 스키마 위반: 재시도해도 같으므로 반으로 나눠 독이 든 창만 격리한다. */
    private fun onInvalid(batch: List<OutboxEntry>, json: JSONObject?): FlushResult {
        if (batch.size > 1) { batchLimit = maxOf(1, batch.size / 2); return FlushResult.Retry("invalid_message_split", retryAfterMs = 0) }
        outbox.quarantine(batch.first().seq, "invalid_message")
        batchLimit = MAX_BATCH
        return FlushResult.Done(0, 0, 1, more = outbox.pendingBatch(1).isNotEmpty())
    }

    companion object {
        const val MAX_BATCH = 60
        val QUARANTINE_CODES = setOf("consent_withdrawn", "participant_mismatch", "stream_not_owned", "hash_conflict")
        private val JSON = "application/json".toMediaType()

        /** outbox 프레임 → 서버 MetricEnvelope(소켓 live:metric 창과 같은 필드). 창이 만들어진 시점의 stream 신원·앵커로 보낸다. */
        fun envelope(sessionId: String, e: OutboxEntry, m: FeatureMeta): JSONObject {
            val f = e.json
            return JSONObject()
                .put("session_id", sessionId).put("participant_id", e.tag.participantId).put("stream_id", e.tag.streamId).put("stream_generation", e.tag.generation)
                .put("sequence", f.getString("sequence")).put("window_start_us", f.getString("window_start_us")).put("window_end_us", f.getString("window_end_us"))
                .put("observed_at_ms", f.opt("observed_at_ms")).put("clock_anchor_id", e.tag.anchorId).put("clock_uncertainty_ms", m.clockUncertaintyMs)
                .put("device_profile_version", m.deviceProfile).put("algorithm_version", m.algorithmVersion).put("model_version", m.modelVersion)
                .put("feature_hash", f.getString("feature_hash")).put("contact", f.opt("contact")).put("sqi", f.opt("sqi") ?: JSONObject.NULL).put("metrics", f.opt("metrics"))
        }
    }
}

/**
 * 다음 시도까지의 대기 시간을 정한다(시계·스레드 없음 → JVM 시험). 성공 5초 주기, 대기 창이 남았으면 즉시,
 * 실패는 full jitter `rnd × min(60s, 1s×2^n)` — 서버가 준 Retry-After 는 하한으로 지킨다.
 */
class FeatureSyncLoop(private val flush: () -> FlushResult, private val rnd: () -> Double = { Math.random() }) {
    private var failures = 0

    /** 한 번 시도하고 다음 시도까지 대기 ms 를 돌려준다. */
    fun step(): Long = when (val r = flush()) {
        FlushResult.Idle -> { failures = 0; PERIOD_MS }
        is FlushResult.Done -> { failures = 0; if (r.more) 0L else PERIOD_MS }
        is FlushResult.Retry -> {
            val cap = minOf(MAX_BACKOFF_MS, BASE_BACKOFF_MS shl minOf(failures, 10))
            failures++
            maxOf((rnd() * cap).toLong(), r.retryAfterMs ?: 0L)
        }
    }

    companion object {
        const val PERIOD_MS = 5_000L
        const val BASE_BACKOFF_MS = 1_000L
        const val MAX_BACKOFF_MS = 60_000L
    }
}

/** FeatureSyncLoop 를 단일 스레드에서 돌린다. trigger() 는 대기 중인 타이머를 건너뛰고 지금 한 번 실행한다(앱 시작·포그라운드·네트워크 복귀·종료). */
class FeatureSyncRunner(private val loop: FeatureSyncLoop, private val exec: ScheduledExecutorService, private val onStep: (() -> Unit)? = null) {
    private var future: ScheduledFuture<*>? = null
    @Volatile private var running = false

    @Synchronized fun start(initialDelayMs: Long = 0) { if (running) return; running = true; schedule(initialDelayMs) }
    @Synchronized fun trigger() { if (!running) return; future?.cancel(false); schedule(0) }
    @Synchronized fun stop() { running = false; future?.cancel(false) }

    @Synchronized private fun schedule(delayMs: Long) {
        if (!running) return
        future = exec.schedule({
            val next = try { loop.step() } catch (_: Exception) { FeatureSyncLoop.PERIOD_MS }
            try { onStep?.invoke() } catch (_: Exception) { /* 보고 실패가 전송을 막지 않는다 */ }
            schedule(next)
        }, delayMs, TimeUnit.MILLISECONDS)
    }
}
