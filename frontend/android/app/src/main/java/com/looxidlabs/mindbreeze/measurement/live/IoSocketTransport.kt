package com.looxidlabs.mindbreeze.measurement.live

import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import io.socket.client.IO
import io.socket.client.Socket
import io.socket.engineio.client.transports.WebSocket
import okhttp3.OkHttpClient
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** 단일 HandlerThread 위에서 LiveSession 호출을 직렬화하는 스케줄러. */
class HandlerLiveScheduler(name: String = "live-session") : LiveScheduler {
    private val thread = HandlerThread(name).apply { start() }
    val handler = Handler(thread.looper)
    private val worker = HandlerThread("$name-io").apply { start() }
    private val workHandler = Handler(worker.looper)

    override fun nowMs(): Long = android.os.SystemClock.elapsedRealtime()

    override fun postDelayed(delayMs: Long, task: () -> Unit): Cancelable {
        val r = Runnable { task() }
        handler.postDelayed(r, delayMs)
        return object : Cancelable { override fun cancel() { handler.removeCallbacks(r) } }
    }

    fun post(task: () -> Unit) { handler.post(task) }

    override fun <T> async(work: () -> T, done: (Result<T>) -> Unit) {
        workHandler.post {
            val r = runCatching(work)
            handler.post { done(r) }
        }
    }

    fun quit() { thread.quitSafely(); worker.quitSafely() }
    val looper: Looper get() = thread.looper
}

/**
 * socket.io-client-java(Socket.IO v4 wire, Engine.IO 4) 어댑터. websocket-only(long-polling 비활성),
 * 자동 재연결은 끈다(LiveSession 이 backoff·토큰 갱신을 소유). 모든 콜백은 scheduler 스레드로 옮겨 직렬화한다.
 */
class IoSocketTransport(
    private val baseUrl: String,
    private val sched: HandlerLiveScheduler,
    private val ackTimeoutMs: Long = 2_000,
) : LiveTransport {
    override var listener: LiveTransport.Listener? = null
    private var socket: Socket? = null
    private var gen = 0L // 이전 소켓의 늦은 콜백 폐기

    private val http: OkHttpClient = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS) // websocket 은 무기한 read
        .pingInterval(0, TimeUnit.MILLISECONDS) // Engine.IO ping 이 담당
        .build()

    @Synchronized
    override fun connect(token: String) {
        val g = ++gen
        val opts = IO.Options().apply {
            path = "/socket.io"
            transports = arrayOf(WebSocket.NAME)
            upgrade = false
            reconnection = false
            forceNew = true
            auth = mapOf("token" to token)
            callFactory = http
            webSocketFactory = http
            timeout = 10_000
        }
        val s = IO.socket(java.net.URI.create(baseUrl.trimEnd('/') + "/session-live"), opts)
        socket = s
        fun post(block: () -> Unit) = sched.post { if (g == gen) block() }
        s.on(Socket.EVENT_CONNECT) { post { listener?.onConnect() } }
        s.on(Socket.EVENT_DISCONNECT) { a -> post { listener?.onDisconnect(a.firstOrNull()?.toString() ?: "disconnect") } }
        s.on(Socket.EVENT_CONNECT_ERROR) { a ->
            val m = a.firstOrNull()?.let { if (it is Exception) (it.message ?: it.toString()) else it.toString() } ?: "connect_error"
            post { listener?.onConnectError(m) }
        }
        for (ev in SERVER_EVENTS) s.on(ev) { a -> val d = a.firstOrNull() as? JSONObject; post { listener?.onEvent(ev, d) } }
        s.connect()
    }

    @Synchronized
    override fun disconnect() {
        gen++ // 진행 중 콜백 모두 무효화
        socket?.let { it.off(); it.disconnect(); it.close() }
        socket = null
    }

    override fun emit(event: String, data: JSONObject, ack: ((JSONObject?) -> Unit)?) {
        val s = synchronized(this) { socket } ?: return
        val g = gen
        if (ack == null) { s.emit(event, data); return }
        // 서버 ack 가 없으면 호출되지 않는다 — 상위(LiveSession)가 타임아웃을 관리한다.
        s.emit(event, arrayOf<Any>(data), io.socket.client.Ack { a ->
            val r = a.firstOrNull() as? JSONObject
            sched.post { if (g == gen) ack(r) }
        })
    }

    companion object {
        val SERVER_EVENTS = listOf(
            "live:snapshot", "live:event", "live:sync_complete", "live:heartbeat", "live:access_revoked",
            "live:terminal", "live:resync_required", "live:degraded", "live:auth_expired",
        )
    }
}
