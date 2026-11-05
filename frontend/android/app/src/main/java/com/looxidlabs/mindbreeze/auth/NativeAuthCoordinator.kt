package com.looxidlabs.mindbreeze.auth

import com.looxidlabs.mindbreeze.measurement.live.TokenStore
import com.looxidlabs.mindbreeze.measurement.runtime.JwtSub
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/** access JWT 의 `exp`(초)만 읽는다. 서명 검증 없음 — "더 새로운 토큰인가" 비교용. */
object JwtExp {
    fun of(token: String?): Long? {
        val p = token?.split('.') ?: return null
        if (p.size < 2) return null
        return try {
            JSONObject(String(java.util.Base64.getUrlDecoder().decode(p[1]))).optLong("exp", -1L).takeIf { it > 0 }
        } catch (_: Exception) { null }
    }
}

sealed class AccessResult {
    /** [generation]: 이 access 가 만들어진 세대. 소비자는 401 을 받으면 이 값을 observedGeneration 으로 넘긴다. */
    data class Ok(val token: String, val generation: Long) : AccessResult()
    /** 저장된 자격증명이 없다(로그인/인계 전). */
    object NoCredentials : AccessResult()
    /** refresh 토큰이 무효(서버 4xx) — 재로그인 필요. */
    object Invalid : AccessResult()
    /** 네트워크/서버 일시 장애 — 자격증명 유지, 재시도. */
    object Transient : AccessResult()
    /** 요청한 계정과 저장된 계정이 다르다 — 다른 계정으로 전송하지 않는다. */
    object AccountMismatch : AccessResult()
}

data class AdoptResult(val adopted: Boolean, val generation: Long)

/**
 * SDD-305 B — 계정별(=저장소별) **단일 인증 조정자**. 프로세스에 하나뿐인 refresh 토큰의 소유자다.
 * - 측정 Runtime·ScopeSweeper·ArchiveWorker·오디오 업로드·WebView(브리지)가 모두 이 객체로 갱신한다.
 * - 갱신은 직렬 single-flight: 진행 중이면 기다렸다가 같은 결과를 받는다.
 * - generation: access 가 바뀔 때마다 증가. 401 을 받은 소비자가 observedGeneration 을 넘기면, 그사이 다른 소비자가
 *   이미 갱신했을 때 HTTP 없이 최신 access 를 돌려준다(중복 회전 금지).
 * - epoch: 로그아웃·계정 전환·인계마다 증가. 진행 중이던 갱신의 응답은 epoch 가 바뀌었으면 버린다(늦은 응답 덮어쓰기 금지).
 * - refresh 토큰 값은 이 객체 밖(JS·로그·이벤트)으로 나가지 않는다.
 */
class NativeAuthCoordinator private constructor(private val store: TokenStore) {
    private val lock = Object()
    private var refreshing = false
    private var epoch = 0L
    private var lastResult: AccessResult? = null
    /** 키 저장소 쓰기 실패 시 서버가 이미 회전한 새 쌍을 잃지 않도록 메모리에 보관 → 다음 호출에서 재저장. */
    private var unsaved: Pair<String?, String?>? = null

    @Volatile var generation = 0L
        private set
    @Volatile var refreshCount = 0
        private set

    private fun at(): String? = unsaved?.first ?: store.accessToken()
    private fun rt(): String? = unsaved?.second ?: store.refreshToken()

    private fun persist(access: String?, refresh: String?) {
        try { store.save(access, refresh); unsaved = null } catch (_: Exception) { unsaved = access to refresh }
    }

    private fun flushUnsaved() { unsaved?.let { persist(it.first, it.second) } }

    /** 현재 access 와 그 세대(원자적으로). */
    fun currentWithGeneration(): Pair<String?, Long> = synchronized(lock) { flushUnsaved(); at() to generation }

    fun ensureAccess(
        apiBase: String, http: OkHttpClient, expectedAccount: String?, forceRefresh: Boolean, observedGeneration: Long?,
    ): AccessResult {
        val startEpoch: Long
        val usedRt: String
        synchronized(lock) {
            if (refreshing) { // 이미 진행 중이면 그 결과를 기다려 공유(추가 회전 없음)
                while (refreshing) lock.wait()
                return lastResult ?: AccessResult.Transient
            }
            flushUnsaved()
            val access = at(); val refresh = rt()
            if (access == null && refresh == null) return AccessResult.NoCredentials
            if (expectedAccount != null) {
                val sub = JwtSub.of(access)
                if (sub != null && sub != expectedAccount) return AccessResult.AccountMismatch
            }
            if (!forceRefresh && access != null) return AccessResult.Ok(access, generation)
            if (forceRefresh && access != null && observedGeneration != null && observedGeneration < generation)
                return AccessResult.Ok(access, generation) // 그사이 다른 소비자가 이미 갱신했다
            if (refresh == null) return AccessResult.Invalid
            refreshing = true; lastResult = null
            startEpoch = epoch; usedRt = refresh
        }
        val raw = try { httpRefresh(apiBase, http, usedRt) } catch (_: Exception) { Raw.Transient }
        synchronized(lock) {
            val result: AccessResult = if (epoch != startEpoch) {
                // 로그아웃·계정 전환·인계가 이 갱신보다 나중이다 → 응답을 적용하지 않는다.
                at()?.let { AccessResult.Ok(it, generation) } ?: AccessResult.Invalid
            } else when (raw) {
                is Raw.Ok -> { persist(raw.access, raw.refresh ?: usedRt); generation++; AccessResult.Ok(raw.access, generation) }
                Raw.Invalid -> { epoch++; generation++; unsaved = null; store.clear(); AccessResult.Invalid }
                Raw.Transient -> AccessResult.Transient
            }
            lastResult = result; refreshing = false; lock.notifyAll()
            return result
        }
    }

    /**
     * 웹이 가진 자격증명 인계. **뒤로 가지 않는다**: 같은 계정이고 저장된 쪽이 같거나 더 새로우면 무시한다
     * (오래된 JS 복사본이 native 가 회전한 최신 refresh 를 덮어쓰지 못하게). 계정이 다르거나 저장된 게 없으면 교체.
     */
    fun adoptIfNewer(access: String?, refresh: String?): AdoptResult = synchronized(lock) {
        flushUnsaved()
        val curAt = at(); val curRt = rt()
        val curSub = JwtSub.of(curAt); val newSub = JwtSub.of(access)
        val sameAccount = curSub != null && newSub != null && curSub == newSub
        if (curRt != null && sameAccount) {
            val inExp = JwtExp.of(access); val curExp = JwtExp.of(curAt)
            if (inExp == null || curExp == null || inExp <= curExp) return AdoptResult(false, generation)
        }
        val nextRt = if (!refresh.isNullOrEmpty()) refresh else if (sameAccount) curRt else null
        epoch++; generation++
        persist(access, nextRt)
        AdoptResult(true, generation)
    }

    /** 로그아웃·계정 전환: 진행 중 응답을 무효화하고 저장소를 비운다. 반환: 서버 폐기용으로 쓸 이전 refresh(호출 측 내부에서만 사용). */
    fun signOut(): String? = synchronized(lock) {
        val prev = rt()
        epoch++; generation++; unsaved = null
        store.clear()
        prev
    }

    /** 서버 로그아웃(best-effort). refresh 토큰은 이 함수 안에서만 쓰고 밖으로 내보내지 않는다. */
    fun signOutAndRevoke(apiBase: String, http: OkHttpClient) {
        val prev = signOut() ?: return
        Thread {
            try {
                val body = JSONObject().put("refresh_token", prev).toString().toRequestBody("application/json".toMediaType())
                http.newCall(Request.Builder().url(apiBase.trimEnd('/') + "/auth/logout").post(body).header("X-MB-Native", "capacitor").build())
                    .execute().close()
            } catch (_: Exception) { /* 서버 폐기는 best-effort — 로컬 자격증명은 이미 비웠다 */ }
        }.apply { isDaemon = true }.start()
    }

    private sealed class Raw {
        data class Ok(val access: String, val refresh: String?) : Raw()
        object Invalid : Raw()
        object Transient : Raw()
    }

    private fun httpRefresh(apiBase: String, http: OkHttpClient, rt: String): Raw {
        refreshCount++
        val body = JSONObject().put("refresh_token", rt).toString().toRequestBody("application/json".toMediaType())
        val req = Request.Builder().url(apiBase.trimEnd('/') + "/auth/refresh").post(body)
            .header("X-MB-Native", "capacitor").header("X-MB-Refresh-Source", "native").build()
        http.newCall(req).execute().use { res ->
            val code = res.code
            if (code in 200..299) {
                val at = try { JSONObject(res.body?.string() ?: "").optString("access_token") } catch (_: Exception) { "" }
                if (at.isEmpty()) return Raw.Transient // 200 이지만 토큰 없음 → 세션 폐기 대상 아님
                return Raw.Ok(at, res.header("X-MB-Refresh-Token"))
            }
            // 토큰이 실제로 무효인 경우만 자격증명을 비운다. 408/425/429 는 일시 장애.
            if (code == 400 || code == 401 || code == 403) return Raw.Invalid
            return Raw.Transient
        }
    }

    companion object {
        private val registry = ConcurrentHashMap<String, NativeAuthCoordinator>()

        /** 같은 저장소(파일 경로)를 쓰는 모든 소비자는 같은 조정자를 받는다. */
        fun forStore(store: TokenStore): NativeAuthCoordinator = registry.getOrPut(store.scopeKey) { NativeAuthCoordinator(store) }

        internal fun resetForTests() = registry.clear()
    }
}
