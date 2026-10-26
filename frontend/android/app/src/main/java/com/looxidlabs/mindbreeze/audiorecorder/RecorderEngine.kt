package com.looxidlabs.mindbreeze.audiorecorder

import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** PCM 입력원(실제=AudioRecord, 시험=가짜) */
interface AudioSource {
    fun start()
    /** 블로킹 읽기. 읽은 샘플 수, 오류면 음수 */
    fun read(buf: ShortArray): Int
    fun stop()
    fun release()
}

/** PCM → 독립 재생 가능한 m4a 파일 */
interface ChunkEncoder { fun encode(pcm: ShortArray, out: java.io.File) }

interface EngineListener {
    fun onState(sessionId: String?, state: String, reason: String?)
    fun onError(sessionId: String?, code: String, message: String, recoverable: Boolean)
}

interface UploadSink { fun wake() }

data class EngineStatus(val state: String, val sessionId: String?, val nextChunkIndex: Int, val uploadedCount: Int, val pendingCount: Int, val lastUploadedIndex: Int)
data class EngineStopResult(val pendingCount: Int, val uploadedCount: Int, val lastChunkIndex: Int)

/**
 * 연속 PCM 캡처 → 5초 청크 → 인코드 → 디스크 큐. 청크 인덱스는 인코드 성공 순서대로 부여(실패·디스크 부족 시 구멍 없음).
 * 일시정지/마이크 오프는 캡처를 멈추고 해당 구간을 제외하며 인덱스는 진행하지 않는다.
 */
class RecorderEngine(
    private val queue: ChunkQueue,
    private val encoder: ChunkEncoder,
    private val sink: UploadSink,
    private val listener: EngineListener,
    private val samplesPerChunk: Int = ChunkSplitter.DEFAULT_SAMPLES_PER_CHUNK,
    private val maxQueueBytes: Long = 200L * 1024 * 1024,
    private val stopWaitMs: Long = 10_000,
) {
    private val lock = Any()
    private val exec = Executors.newSingleThreadExecutor { r -> Thread(r, "NativeAudioRecorder-encode").apply { isDaemon = true } }
    private var machine = RecorderStateMachine()
    private val splitter = ChunkSplitter(samplesPerChunk) { pcm -> val sid = sessionId; if (sid != null) exec.execute { encodeTask(sid, pcm) } }

    @Volatile private var sessionId: String? = null
    @Volatile private var apiBase = ""
    @Volatile private var nextIndex = 0
    @Volatile private var uploaded = 0
    @Volatile private var lastUploaded = -1
    private var source: AudioSource? = null
    private var sourceRunning = false
    @Volatile private var running = false
    private var thread: Thread? = null

    fun start(sid: String, apiBase: String, startIndex: Int, src: AudioSource) {
        synchronized(lock) {
            if (machine.active) throw IllegalStateException("already recording")
            teardownLocked()
            machine = RecorderStateMachine()
            splitter.clear()
            sessionId = sid; this.apiBase = apiBase; nextIndex = startIndex; uploaded = 0; lastUploaded = -1
            queue.saveMeta(sid, ChunkQueue.Meta(apiBase, startIndex))
            source = src; src.start(); sourceRunning = true
            machine.start(); running = true
            thread = Thread({ captureLoop(src) }, "NativeAudioRecorder-capture").also { it.isDaemon = true; it.start() }
            listener.onState(sid, machine.state, "user")
        }
    }

    private fun captureLoop(src: AudioSource) {
        val buf = ShortArray(4096)
        while (running) {
            val cap = synchronized(lock) { machine.capturing && sourceRunning }
            if (!cap) { try { Thread.sleep(20) } catch (_: InterruptedException) { return }; continue }
            val n = try { src.read(buf) } catch (_: Exception) { -1 }
            if (n > 0) onPcm(buf, n)
            else if (n < 0) {
                synchronized(lock) {
                    if (machine.capturing) {
                        machine.fail(); splitter.clear(); running = false
                        listener.onError(sessionId, "audio_engine_failed", "audio read failed ($n)", false)
                        listener.onState(sessionId, machine.state, "system")
                    }
                }
            }
        }
    }

    fun onPcm(buf: ShortArray, len: Int) { synchronized(lock) { if (machine.capturing) splitter.write(buf, len) } }

    private fun encodeTask(sid: String, pcm: ShortArray) {
        if (queue.totalBytes() >= maxQueueBytes) { autoPauseDiskFull(sid); return }
        val idx = nextIndex
        val tmp = queue.tempFile(sid, idx)
        try {
            encoder.encode(pcm, tmp)
            queue.commit(sid, idx, tmp)
            nextIndex = idx + 1
            queue.saveMeta(sid, ChunkQueue.Meta(apiBase, nextIndex))
            sink.wake()
        } catch (e: Exception) {
            tmp.delete()
            listener.onError(sid, "audio_engine_failed", "encode failed: ${e.javaClass.simpleName}", true)
        }
    }

    private fun autoPauseDiskFull(sid: String) {
        synchronized(lock) {
            if (!machine.capturing) return
            machine.pause(); splitter.clear(); syncSourceLocked()
            listener.onError(sid, "disk_full", "local queue limit reached", true)
            listener.onState(sid, machine.state, "system")
        }
    }

    private fun syncSourceLocked() {
        val src = source ?: return
        val want = machine.capturing
        if (want && !sourceRunning) { try { src.start(); sourceRunning = true } catch (_: Exception) { listener.onError(sessionId, "audio_engine_failed", "mic start failed", true) } }
        else if (!want && sourceRunning) { try { src.stop() } catch (_: Exception) {}; sourceRunning = false }
    }

    private fun transition(reason: String, change: () -> Unit) {
        synchronized(lock) {
            if (!machine.active) return
            val before = machine.state
            val wasCapturing = machine.capturing
            change()
            if (wasCapturing && !machine.capturing) splitter.flush() // 경계 전 구간 확정
            syncSourceLocked()
            if (machine.state != before) listener.onState(sessionId, machine.state, reason)
        }
    }

    fun pause(): EngineStatus { transition("user") { machine.pause() }; return status() }
    fun resume(): EngineStatus { transition("user") { machine.resume() }; return status() }
    fun setMicEnabled(enabled: Boolean): EngineStatus { transition("user") { machine.setMic(enabled) }; return status() }

    fun onUploaded(sid: String, index: Int) { if (sid == sessionId) { uploaded++; lastUploaded = index } }

    fun waitEncoded() { try { exec.submit {}.get(5, TimeUnit.SECONDS) } catch (_: Exception) {} }

    fun status(): EngineStatus {
        val sid = sessionId
        return EngineStatus(machine.state, if (machine.state == "idle") null else sid, nextIndex, uploaded,
            if (sid == null) 0 else queue.pending(sid).size, lastUploaded)
    }

    fun stop(): EngineStopResult {
        val sid = sessionId
        synchronized(lock) {
            if (sid == null || !machine.active) return EngineStopResult(if (sid == null) 0 else queue.pending(sid).size, uploaded, nextIndex - 1)
            machine.beginStop(); splitter.flush(); running = false
            val src = source
            if (src != null && sourceRunning) { try { src.stop() } catch (_: Exception) {}; sourceRunning = false }
            listener.onState(sid, machine.state, "user")
        }
        thread?.let { try { it.join(1000) } catch (_: InterruptedException) {} }
        waitEncoded()
        sink.wake()
        val deadline = System.currentTimeMillis() + stopWaitMs
        while (queue.pending(sid!!).isNotEmpty() && System.currentTimeMillis() < deadline) {
            try { Thread.sleep(20) } catch (_: InterruptedException) { break }
        }
        synchronized(lock) {
            machine.finishStop(); teardownLocked()
            listener.onState(sid, machine.state, "user")
        }
        return EngineStopResult(queue.pending(sid).size, uploaded, nextIndex - 1)
    }

    private fun teardownLocked() {
        running = false
        thread = null
        source?.let { try { if (sourceRunning) it.stop() } catch (_: Exception) {}; try { it.release() } catch (_: Exception) {} }
        source = null; sourceRunning = false
    }
}
