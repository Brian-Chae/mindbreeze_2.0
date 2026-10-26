package com.looxidlabs.mindbreeze.audiorecorder

import com.looxidlabs.mindbreeze.measurement.live.RefreshOutcome
import com.looxidlabs.mindbreeze.measurement.live.TokenSource
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody

enum class UploadOutcome { Ok, Retry, AuthExpired }

/** 기존 `POST {apiBase}/sessions/{id}/audio/chunk` 로 청크 1건 업로드. 401 → 토큰 갱신 후 1회 재시도. 토큰 값은 로그하지 않는다. */
class ChunkUploader(
    private val apiBase: String,
    private val tokens: TokenSource,
    private val http: OkHttpClient,
) {
    fun upload(c: QueuedChunk): UploadOutcome {
        val first = try { post(c, tokens.current()) } catch (_: Exception) { return UploadOutcome.Retry }
        if (first in 200..299) return UploadOutcome.Ok
        if (first != 401) return UploadOutcome.Retry
        return when (val r = tokens.refresh()) {
            is RefreshOutcome.Ok -> {
                val code = try { post(c, r.token) } catch (_: Exception) { return UploadOutcome.Retry }
                if (code in 200..299) UploadOutcome.Ok else UploadOutcome.Retry
            }
            RefreshOutcome.Invalid -> UploadOutcome.AuthExpired
            RefreshOutcome.Transient -> UploadOutcome.Retry
        }
    }

    private fun post(c: QueuedChunk, token: String?): Int {
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("chunk_index", c.index.toString())
            .addFormDataPart("file", "chunk-${c.index}.m4a", c.file.asRequestBody("audio/mp4".toMediaType()))
            .build()
        val rb = Request.Builder().url("${apiBase.trimEnd('/')}/sessions/${c.sessionId}/audio/chunk").post(body)
        if (token != null) rb.header("Authorization", "Bearer $token")
        return http.newCall(rb.build()).execute().use { it.code }
    }
}
