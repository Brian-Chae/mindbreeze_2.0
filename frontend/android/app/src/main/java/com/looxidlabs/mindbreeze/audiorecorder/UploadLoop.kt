package com.looxidlabs.mindbreeze.audiorecorder

import com.looxidlabs.mindbreeze.measurement.live.TokenSource
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

interface UploadListener {
    fun onUploaded(sessionId: String, index: Int, sizeBytes: Long)
    fun onUploadError(sessionId: String, code: String, message: String, recoverable: Boolean)
}

/**
 * 큐를 인덱스 오름차순으로 비우는 백그라운드 스레드. 실패 시 지수 백오프(wake 로 즉시 재시도 가능), 파일은 성공 시에만 삭제.
 * 인증 만료(AuthExpired)는 auth_expired 로 알리고 wake(updateCredentials 등)까지 대기한다. 오류 알림은 연속 실패당 1회.
 */
class UploadLoop(
    private val queue: ChunkQueue,
    private val tokensFor: (String) -> TokenSource,
    private val listener: UploadListener,
    private val http: OkHttpClient = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).callTimeout(60, TimeUnit.SECONDS).build(),
    private val backoffMs: (Int) -> Long = Backoff::delayMs,
    private val currentSession: () -> String? = { null },
) : UploadSink {
    private val mon = Object()
    private var kicked = false
    @Volatile private var started = false
    private var thread: Thread? = null
    private val uploaders = HashMap<String, ChunkUploader>()

    @Synchronized fun ensureStarted() {
        if (started) return
        started = true
        thread = Thread({ loop() }, "NativeAudioRecorder-upload").also { it.isDaemon = true; it.start() }
    }

    fun shutdown() { started = false; wake() }

    override fun wake() { synchronized(mon) { kicked = true; mon.notifyAll() } }

    private fun waitFor(ms: Long) {
        synchronized(mon) {
            val end = System.currentTimeMillis() + ms
            while (!kicked && started) { val left = end - System.currentTimeMillis(); if (left <= 0) break; mon.wait(left) }
            kicked = false
        }
    }

    private fun loop() {
        var attempt = 0; var notified = false
        while (started) {
            val item = queue.nextAny()
            if (item == null) {
                attempt = 0; notified = false
                queue.sweepEmpty(currentSession())
                waitFor(60_000); continue
            }
            val base = queue.loadMeta(item.sessionId)?.apiBase ?: run { waitFor(5_000); null } ?: continue
            val up = uploaders.getOrPut(base) { ChunkUploader(base, tokensFor(base), http) }
            val size = item.file.length()
            when (up.upload(item)) {
                UploadOutcome.Ok -> {
                    queue.remove(item); attempt = 0; notified = false
                    listener.onUploaded(item.sessionId, item.index, size)
                }
                UploadOutcome.AuthExpired -> {
                    if (!notified) { notified = true; listener.onUploadError(item.sessionId, "auth_expired", "refresh token rejected", true) }
                    waitFor(30_000)
                }
                UploadOutcome.Retry -> {
                    if (!notified && attempt >= 2) { notified = true; listener.onUploadError(item.sessionId, "upload_failed", "upload retrying", true) }
                    waitFor(backoffMs(attempt)); attempt++
                }
            }
        }
    }
}
