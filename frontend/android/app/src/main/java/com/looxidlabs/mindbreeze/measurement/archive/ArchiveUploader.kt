package com.looxidlabs.mindbreeze.measurement.archive

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.security.MessageDigest

data class ArchiveSummary(var acked: Int = 0, var failed: Int = 0, var blocked: Int = 0, var halted: String? = null, var timeReview: Int = 0)

/**
 * presign → 서명 헤더 그대로 PUT → 항목별 검증 ACK → 영수증 영속. T09 서버 게이트 계약:
 * presign 본문에 `capture_stream_id`, 산출물 메타에 `monotonic_range{from_us,to_us}`.
 * live 1Hz 경로와 무관한 지연 재시도 경로다(WorkManager/네트워크 복구가 drain() 을 호출).
 */
class ArchiveUploader(
    private val apiBase: String,
    private val queue: ArchiveQueue,
    private val tokenProvider: () -> String?,
    private val http: OkHttpClient,
    private val captureStreamId: () -> String?,
    private val nowMs: () -> Long = { System.currentTimeMillis() },
    private val entryCredential: (() -> String?)? = null,
) {
    private class StageError(val stage: ArchiveStage, val status: Int, val body: JSONObject?, val retryAfterHeader: String?, val msg: String? = null) : Exception(msg)

    fun drain(maxItems: Int = 50): ArchiveSummary {
        val sum = ArchiveSummary()
        var n = 0
        for (item in queue.pending()) {
            if (n >= maxItems) break
            if (item.nextAttemptAtMs > nowMs()) continue
            n++
            val token = tokenProvider()
            if (token == null) { sum.halted = "auth_missing"; break } // 권한이 없으면 로컬 보관만으로 업로드 권한을 만들지 않는다
            item.attempts++
            try {
                uploadOne(item, token)
                item.status = ArchiveStatus.VERIFIED; item.lastReason = null; item.lastStage = null
                queue.update(item); sum.acked++
            } catch (e: StageError) {
                if (!handle(item, e, sum)) break
            }
        }
        return sum
    }

    /**
     * 종료 기록(close intent) 전송: `POST /sessions/{sid}/biosignal-events`. 서버는 intent_id 기준 멱등(recorded/duplicate)이라 재전송이 안전하다.
     * 반환: 서버가 받았으면(recorded·duplicate·conflict) true — conflict 는 같은 id 다른 내용이라 다시 보내도 같아서 닫는다. 네트워크/5xx/인증은 false(재시도).
     */
    fun sendCloseIntent(sessionId: String, participantId: String?, intent: JSONObject): Boolean {
        val token = tokenProvider() ?: return false
        val body = JSONObject().put("participant_id", participantId ?: JSONObject.NULL).put("events", JSONArray().put(intent))
        return try {
            val res = postJson(ArchiveStage.VERIFY, "$apiBase/sessions/${java.net.URLEncoder.encode(sessionId, "UTF-8")}/biosignal-events", body, token)
            val st = res.optJSONArray("events")?.optJSONObject(0)?.optString("status")
            st == "recorded" || st == "duplicate" || st == "conflict"
        } catch (e: StageError) {
            // 4xx(검증 거절 등)는 같은 본문으로 영영 통과 못 하므로 닫는다. 401/408/429/5xx/네트워크는 재시도.
            e.status in 400..499 && e.status != 401 && e.status != 408 && e.status != 429
        }
    }

    /** 반환: 다음 항목을 계속 처리할지(halt 면 false). */
    private fun handle(item: ArchiveItem, e: StageError, sum: ArchiveSummary): Boolean {
        val d = ArchiveClassifier.classify(e.stage, e.status, e.body, e.retryAfterHeader)
        item.lastStage = e.stage.name.lowercase()
        when (d.action) {
            ArchiveAction.HALT -> { item.status = ArchiveStatus.HALTED; item.lastReason = d.code; queue.update(item); sum.halted = d.code; return false }
            ArchiveAction.TIME_REVIEW -> { item.status = ArchiveStatus.TIME_REVIEW; item.lastReason = d.code; queue.update(item); sum.timeReview++ }
            ArchiveAction.QUARANTINE -> { item.status = ArchiveStatus.DEAD_LETTER; item.lastReason = if (e.body != null && e.msg != null && e.msg != d.code) "${d.code}: ${e.msg}".take(200) else (e.msg ?: d.code); queue.update(item); sum.blocked++ }
            ArchiveAction.REPRESIGN, ArchiveAction.BACKOFF -> {
                // 횟수가 많아도 영구 실패로 만들지 않는다 — 유한 backoff 만 적용
                item.lastReason = d.code
                item.nextAttemptAtMs = nowMs() + ArchiveClassifier.backoffMs(item.attempts, d.retryAfterMs)
                queue.update(item); sum.failed++
            }
        }
        return true
    }

    /** 서버 오류 본문의 detail 을 진단용 짧은 문자열로(고정 문구뿐이라 개인정보·토큰 없음). */
    private fun detailOf(body: JSONObject?): String? {
        val d = body?.opt("detail") ?: return null
        val text = when (d) { is String -> d; is JSONObject -> d.optString("code").ifEmpty { d.toString() }; else -> d.toString() }
        return text.take(160).ifEmpty { null }
    }

    private fun sha256(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }

    private fun uploadOne(item: ArchiveItem, token: String) {
        val raw = item.kind == "raw"
        val payload = try { item.payloadFile.readBytes() } catch (_: IOException) { throw StageError(ArchiveStage.PRESIGN, 0, null, null, "payload_unreadable") }
        val checksum = item.meta.getString("checksum"); val size = item.meta.getLong("size_bytes")
        // 로컬 봉인 hash 재검증 — 변조·손상 항목은 올리지 않고 격리
        if (sha256(payload) != checksum || payload.size.toLong() != size) throw StageError(ArchiveStage.PRESIGN, 422, null, null, "local_seal_mismatch")
        var represign = 0
        while (true) {
            val ticket = presign(item, raw, token)
            val aliasKey = if (raw) "chunk_alias" else "artifact_alias"; val idKey = if (raw) "chunk_id" else "artifact_id"
            val serverId = ticket.optString(idKey).ifEmpty { null }
            if (ticket.optString(aliasKey) != item.alias || ticket.optString("checksum") != checksum || ticket.optLong("size_bytes") != size || serverId == null)
                throw StageError(ArchiveStage.PRESIGN, 0, null, null, "presign_mismatch")
            item.serverId = serverId
            if (ticket.optString("upload_status") != "uploaded") {
                val url = ticket.optString("upload_url")
                if (url.isEmpty()) throw StageError(ArchiveStage.PUT, 0, null, null, "upload_url_missing")
                try { put(url, ticket.optJSONObject("upload_headers"), payload) }
                catch (e: StageError) {
                    if (ArchiveClassifier.classify(e.stage, e.status, e.body, e.retryAfterHeader).action == ArchiveAction.REPRESIGN && represign < REPRESIGN_MAX) { represign++; continue }
                    throw e
                }
            }
            val ack = verify(item, raw, token, serverId, checksum, size)
            val ok = ack != null && ack.optString("upload_status") == "uploaded" && ack.optString("verified_at_us").isNotEmpty() && ack.optString("verified_at_us") != "null" &&
                ack.optString(aliasKey) == item.alias && ack.optString("checksum") == checksum && ack.optLong("size_bytes") == size
            if (ok) { item.verifiedAtUs = ack!!.optString("verified_at_us"); return }
            val reason = ack?.optString("failure_reason")?.takeIf { it.isNotEmpty() && it != "null" } ?: "ack_unconfirmed"
            if (reason == "object_verification_failed" && represign < REPRESIGN_MAX) { represign++; continue } // 저장소가 객체를 못 찾음 → 새 presign+PUT
            if (reason in PERMANENT_ACK_REASONS) throw StageError(ArchiveStage.VERIFY, 422, null, null, reason)
            throw StageError(ArchiveStage.VERIFY, 503, null, null, reason) // 그 외는 backoff
        }
    }

    private fun basePath(item: ArchiveItem, suffix: String) =
        "$apiBase/sessions/${java.net.URLEncoder.encode(item.sessionId, "UTF-8")}/$suffix"

    private fun authed(rb: Request.Builder, token: String): Request.Builder {
        rb.header("Authorization", "Bearer $token").header("X-MB-Native", "capacitor")
        entryCredential?.invoke()?.let { rb.header("X-Entry-Credential", it) }
        return rb
    }

    private fun postJson(stage: ArchiveStage, url: String, body: JSONObject, token: String): JSONObject {
        val req = authed(Request.Builder().url(url).post(body.toString().toRequestBody(JSON)), token).build()
        try {
            http.newCall(req).execute().use { res ->
                val text = res.body?.string().orEmpty()
                val json = try { JSONObject(text) } catch (_: Exception) { null }
                if (res.code !in 200..299) throw StageError(stage, res.code, json, res.header("Retry-After"), detailOf(json))
                return json ?: throw StageError(stage, 0, null, null, "response_not_json")
            }
        } catch (e: IOException) { throw StageError(stage, 0, null, null, e.javaClass.simpleName) }
    }

    private fun presign(item: ArchiveItem, raw: Boolean, token: String): JSONObject {
        val body = JSONObject().put("participant_id", item.participantId ?: JSONObject.NULL).put("play_group_id", JSONObject.NULL)
            .put("chunks", JSONArray().put(JSONObject(item.meta.toString())))
        captureStreamId()?.let { body.put("capture_stream_id", it) } // 미지정이면 v1/v2 와 동일한 본문
        val res = postJson(ArchiveStage.PRESIGN, basePath(item, if (raw) "biosignal-raw/presign" else "biosignal-artifacts/presign"), body, token)
        return res.optJSONArray("chunks")?.optJSONObject(0) ?: throw StageError(ArchiveStage.PRESIGN, 0, null, null, "presign_empty")
    }

    private fun verify(item: ArchiveItem, raw: Boolean, token: String, serverId: String, checksum: String, size: Long): JSONObject? {
        val idKey = if (raw) "chunk_id" else "artifact_id"
        val body = JSONObject().put("participant_id", item.participantId ?: JSONObject.NULL)
            .put("chunks", JSONArray().put(JSONObject().put(idKey, serverId).put("checksum", checksum).put("size_bytes", size)))
        val res = postJson(ArchiveStage.VERIFY, basePath(item, if (raw) "biosignal-raw/ack" else "biosignal-artifacts/ack"), body, token)
        val arr = res.optJSONArray("chunks") ?: return null
        for (i in 0 until arr.length()) { val o = arr.getJSONObject(i); if (o.optString(idKey) == serverId) return o }
        return null
    }

    /** 서명 URL 로 PUT. 서명 헤더는 presign 이 준 것 그대로(Authorization 을 붙이지 않는다). */
    private fun put(url: String, headers: JSONObject?, payload: ByteArray) {
        val rb = Request.Builder().url(url).put(payload.toRequestBody(null))
        headers?.keys()?.forEach { k -> rb.header(k, headers.getString(k)) }
        try {
            http.newCall(rb.build()).execute().use { res ->
                if (res.code !in 200..299) throw StageError(ArchiveStage.PUT, res.code, null, res.header("Retry-After"))
            }
        } catch (e: IOException) { throw StageError(ArchiveStage.PUT, 0, null, null, e.javaClass.simpleName) }
    }

    companion object {
        private val JSON = "application/json".toMediaType()
        const val REPRESIGN_MAX = 2
        /** 같은 바이트로는 영영 통과 못 하는 ACK 사유 → 격리 */
        val PERMANENT_ACK_REASONS = setOf("ack_metadata_mismatch", "content_schema_invalid", "row_count_mismatch", "uncompressed_hash_mismatch")
    }
}
