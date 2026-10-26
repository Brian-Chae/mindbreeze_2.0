package com.looxidlabs.mindbreeze.measurement.live

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** 토큰 영속 저장소. 실제 구현은 Keystore 암호화 파일(SecureTokenStore), 시험은 메모리. */
interface TokenStore {
    fun accessToken(): String?
    fun refreshToken(): String?
    fun save(access: String?, refresh: String?)
    fun clear()
}

/**
 * `/auth/refresh` single-flight 갱신. 동시 호출은 하나로 병합(백엔드 refresh 회전·재사용 감지가 탈취로 오판하지 않게).
 * refresh 토큰 회전: 응답 헤더 X-MB-Refresh-Token 을 저장소에 반영. 4xx=Invalid(재로그인), 5xx/네트워크=Transient.
 * 토큰 값은 로그·bridge 어디에도 내보내지 않는다.
 */
class HttpTokenSource(
    private val apiBase: String,
    private val store: TokenStore,
    private val http: OkHttpClient = OkHttpClient.Builder().callTimeout(15, TimeUnit.SECONDS).build(),
) : TokenSource {
    private val lock = Object()
    private var inflight: RefreshOutcome? = null
    private var refreshing = false
    @Volatile var refreshCount = 0
        private set

    override fun current(): String? = store.accessToken()

    override fun refresh(): RefreshOutcome {
        synchronized(lock) {
            if (refreshing) { // 이미 진행 중이면 그 결과를 기다려 공유
                while (refreshing) lock.wait()
                return inflight ?: RefreshOutcome.Transient
            }
            refreshing = true; inflight = null
        }
        val result = try { doRefresh() } catch (_: Exception) { RefreshOutcome.Transient }
        synchronized(lock) { inflight = result; refreshing = false; lock.notifyAll() }
        return result
    }

    private fun doRefresh(): RefreshOutcome {
        val rt = store.refreshToken() ?: return RefreshOutcome.Invalid
        refreshCount++
        val body = JSONObject().put("refresh_token", rt).toString().toRequestBody("application/json".toMediaType())
        val req = Request.Builder().url(apiBase.trimEnd('/') + "/auth/refresh").post(body)
            .header("X-MB-Native", "capacitor").build()
        http.newCall(req).execute().use { res ->
            val code = res.code
            if (code in 200..299) {
                val at = try { JSONObject(res.body?.string() ?: "").optString("access_token") } catch (_: Exception) { "" }
                if (at.isEmpty()) return RefreshOutcome.Transient // 200 이지만 토큰 없음 → 세션 폐기 대상 아님
                val next = res.header("X-MB-Refresh-Token")
                store.save(at, next ?: rt)
                return RefreshOutcome.Ok(at)
            }
            if (code in 400..499) { store.clear(); return RefreshOutcome.Invalid }
            return RefreshOutcome.Transient
        }
    }
}
