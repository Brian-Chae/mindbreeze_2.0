package com.looxidlabs.mindbreeze.measurement.live

import org.json.JSONObject

/** Socket.IO 연결 추상화. 실제 구현은 IoSocketTransport(socket.io-client), 시험은 가짜 서버. */
interface LiveTransport {
    interface Listener {
        fun onConnect()
        fun onDisconnect(reason: String)
        fun onConnectError(message: String)
        fun onEvent(name: String, data: JSONObject?)
    }

    var listener: Listener?

    /** 새 연결 시도. auth = {token}. 이전 연결은 호출 측이 disconnect 한 뒤 부른다. */
    fun connect(token: String)
    fun disconnect()
    /** ack 콜백은 서버 응답(없으면 호출되지 않음 — 타임아웃은 세션이 관리). */
    fun emit(event: String, data: JSONObject, ack: ((JSONObject?) -> Unit)?)
}

interface Cancelable { fun cancel() }

/** 타이머·비동기 작업 추상화(시험은 가상 시계). 모든 콜백은 직렬 실행을 가정한다. */
interface LiveScheduler {
    fun nowMs(): Long
    fun postDelayed(delayMs: Long, task: () -> Unit): Cancelable
    /** 블로킹 작업(토큰 갱신 등)을 소켓 처리와 분리해서 실행하고 결과를 직렬 컨텍스트로 돌려준다. */
    fun <T> async(work: () -> T, done: (Result<T>) -> Unit)
}

/** access 토큰 공급. refresh 는 single-flight(동시 호출을 하나로 병합)여야 한다. */
interface TokenSource {
    fun current(): String?
    /** 블로킹. 성공 시 새 access 토큰. */
    fun refresh(): RefreshOutcome
}

sealed class RefreshOutcome {
    data class Ok(val token: String) : RefreshOutcome()
    /** refresh 토큰이 무효(4xx) — 재로그인 필요. 재시도 금지. */
    object Invalid : RefreshOutcome()
    /** 네트워크/서버 일시 장애 — 세션 유지, 재시도. */
    object Transient : RefreshOutcome()
}
