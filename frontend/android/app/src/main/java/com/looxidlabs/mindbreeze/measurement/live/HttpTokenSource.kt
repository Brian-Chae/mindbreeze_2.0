package com.looxidlabs.mindbreeze.measurement.live

import com.looxidlabs.mindbreeze.auth.AccessResult
import com.looxidlabs.mindbreeze.auth.NativeAuthCoordinator
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/** 토큰 영속 저장소. 실제 구현은 Keystore 암호화 파일(SecureTokenStore), 시험은 메모리. */
interface TokenStore {
    fun accessToken(): String?
    fun refreshToken(): String?
    fun save(access: String?, refresh: String?)
    fun clear()
    /** 같은 키를 가진 저장소는 하나의 인증 조정자를 공유한다(SDD-305). 기본값은 객체 단위. */
    val scopeKey: String get() = "obj@" + System.identityHashCode(this)
}

/**
 * `/auth/refresh` 갱신 창구. 실제 갱신·저장·락은 저장소별 단일 [NativeAuthCoordinator] 가 소유한다(SDD-305):
 * Runtime·Sweeper·ArchiveWorker·오디오가 각자 이 클래스를 만들어도 같은 조정자를 거치므로 refresh HTTP 는 한 번만 나간다.
 * 4xx(400/401/403)=Invalid(재로그인), 408/429/5xx/네트워크=Transient. 토큰 값은 로그·bridge 어디에도 내보내지 않는다.
 */
class HttpTokenSource(
    private val apiBase: String,
    private val store: TokenStore,
    private val http: OkHttpClient = OkHttpClient.Builder().callTimeout(15, TimeUnit.SECONDS).build(),
) : TokenSource {
    private val coordinator = NativeAuthCoordinator.forStore(store)
    @Volatile private var seenGeneration: Long? = null
    val refreshCount: Int get() = coordinator.refreshCount

    override fun current(): String? {
        val (token, gen) = coordinator.currentWithGeneration()
        seenGeneration = gen
        return token
    }

    override fun refresh(): RefreshOutcome =
        when (val r = coordinator.ensureAccess(apiBase, http, null, true, seenGeneration)) {
            is AccessResult.Ok -> { seenGeneration = r.generation; RefreshOutcome.Ok(r.token) }
            AccessResult.Invalid, AccessResult.NoCredentials, AccessResult.AccountMismatch -> RefreshOutcome.Invalid
            AccessResult.Transient -> RefreshOutcome.Transient
        }
}
