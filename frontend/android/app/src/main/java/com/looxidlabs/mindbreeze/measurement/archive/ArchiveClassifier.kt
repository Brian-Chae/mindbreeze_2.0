package com.looxidlabs.mindbreeze.measurement.archive

import org.json.JSONObject

enum class ArchiveStage { PRESIGN, PUT, VERIFY }

/** represign=새 presign 후 재시도 / backoff=자동 재시도 / halt=권한·동의 거절(보존 중단) / quarantine=충돌·스키마·크기 격리 / time_review=시간 미확정 */
enum class ArchiveAction { REPRESIGN, BACKOFF, HALT, QUARANTINE, TIME_REVIEW }

data class ArchiveDecision(
    val stage: ArchiveStage, val action: ArchiveAction, val code: String,
    val retryAfterMs: Long? = null, val splitCandidate: Boolean = false,
)

/** T09 `archive-errors.ts` 의 Kotlin 이식. 같은 403 이라도 PUT(저장소 서명 만료)과 API(동의·권한)는 다르다. 횟수만으로 영구 실패를 만들지 않는다. */
object ArchiveClassifier {
    const val BACKOFF_BASE_MS = 1000L
    const val BACKOFF_MAX_MS = 60_000L

    /** attempts 가 아무리 커도 유한 대기. retryAfter 가 더 크면 그 값. */
    fun backoffMs(attempts: Int, retryAfterMs: Long?): Long {
        val exp = minOf(BACKOFF_MAX_MS, BACKOFF_BASE_MS * (1L shl minOf(maxOf(0, attempts), 20)))
        return maxOf(exp, retryAfterMs ?: 0L)
    }

    /** body 는 파싱된 오류 본문(없으면 빈 객체), status<=0 은 네트워크 오류. */
    @Suppress("UNUSED_PARAMETER")
    fun classify(stage: ArchiveStage, status: Int, body: JSONObject?, headerRetryAfterSec: String?): ArchiveDecision {
        if (status <= 0) return ArchiveDecision(stage, ArchiveAction.BACKOFF, "network")
        val detail = body?.optJSONObject("detail")
        val code = detail?.optString("code").orEmpty()
        val reason = detail?.optString("reason").orEmpty()
        val retryAfter = retryAfterOf(body, headerRetryAfterSec)
        return when {
            status >= 500 || status == 408 || status == 429 -> ArchiveDecision(stage, ArchiveAction.BACKOFF, "http_$status", retryAfter)
            status == 401 -> ArchiveDecision(stage, ArchiveAction.BACKOFF, "auth_refresh")
            status == 403 ->
                if (stage == ArchiveStage.PUT) ArchiveDecision(stage, ArchiveAction.REPRESIGN, "put_signature_expired")
                else ArchiveDecision(stage, ArchiveAction.HALT, reason.ifEmpty { code.ifEmpty { "forbidden" } })
            status == 404 ->
                if (stage == ArchiveStage.VERIFY) ArchiveDecision(stage, ArchiveAction.REPRESIGN, "chunk_unknown")
                else ArchiveDecision(stage, ArchiveAction.QUARANTINE, code.ifEmpty { "not_found" })
            status == 409 ->
                if (code == "pending_time_review") ArchiveDecision(stage, ArchiveAction.TIME_REVIEW, reason.ifEmpty { "pending_time_review" })
                else ArchiveDecision(stage, ArchiveAction.QUARANTINE, code.ifEmpty { "conflict" })
            status == 413 -> ArchiveDecision(stage, ArchiveAction.QUARANTINE, "payload_too_large", splitCandidate = true)
            status == 400 || status == 422 -> ArchiveDecision(stage, ArchiveAction.QUARANTINE, code.ifEmpty { "http_$status" })
            else -> ArchiveDecision(stage, ArchiveAction.BACKOFF, "http_$status")
        }
    }

    private fun retryAfterOf(body: JSONObject?, header: String?): Long? {
        val v = body?.let { if (it.has("retry_after")) it.optDouble("retry_after") else it.optJSONObject("detail")?.optDouble("retry_after") }
        if (v != null && !v.isNaN() && v > 0) return (v * 1000).toLong()
        val h = header?.toDoubleOrNull()
        return if (h != null && h > 0) (h * 1000).toLong() else null
    }
}
