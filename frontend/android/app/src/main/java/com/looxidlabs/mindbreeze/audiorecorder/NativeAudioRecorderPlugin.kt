package com.looxidlabs.mindbreeze.audiorecorder

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.looxidlabs.mindbreeze.measurement.live.HttpTokenSource
import com.looxidlabs.mindbreeze.measurement.live.TokenStore

/**
 * 수업 녹음 네이티브 플러그인(SDD-247). 기존 호스트 FGS(microphone 타입, PR #125) 안에서 AudioRecord 로 캡처한다.
 * 토큰은 이벤트·getStatus 결과에 싣지 않는다. 앱 재시작 시 잔여 큐는 업로드 루프가 이어서 전송한다.
 */
@CapacitorPlugin(name = "NativeAudioRecorder")
class NativeAudioRecorderPlugin : Plugin(), EngineListener, UploadListener {
    private lateinit var queue: ChunkQueue
    private lateinit var store: TokenStore
    private lateinit var engine: RecorderEngine
    private lateinit var uploader: UploadLoop

    override fun load() {
        queue = ChunkQueue(AudioKeystore.queueDir(context))
        store = AudioKeystore.tokenStore(context)
        uploader = UploadLoop(queue, { base -> HttpTokenSource(base, store) }, this, currentSession = { engine.status().sessionId })
        engine = RecorderEngine(queue, AacChunkEncoder(), uploader, this)
        if (Build.VERSION.SDK_INT >= 24 && queue.sessionsWithPending().isNotEmpty()) {
            // 이전 실행의 잔여 큐 전송 + 재시작 알림(자동 재개 없음)
            uploader.ensureStarted(); uploader.wake()
            emitState(queue.sessionsWithPending().firstOrNull(), "stopped", "app_restart")
        }
    }

    override fun handleOnDestroy() { /* 캡처는 호스트 FGS 가 유지, 업로드 스레드는 데몬 */ }

    private fun statusJson(): JSObject {
        val s = engine.status()
        return JSObject().put("state", s.state).put("sessionId", s.sessionId ?: org.json.JSONObject.NULL)
            .put("nextChunkIndex", s.nextChunkIndex).put("uploadedCount", s.uploadedCount)
            .put("pendingCount", s.pendingCount).put("lastUploadedIndex", s.lastUploadedIndex)
    }

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val ok = Build.VERSION.SDK_INT >= 24 && context.packageManager.hasSystemFeature(PackageManager.FEATURE_MICROPHONE)
        call.resolve(JSObject().put("available", ok).also { if (!ok) it.put("reason", "unsupported") })
    }

    @PluginMethod
    fun start(call: PluginCall) {
        val sid = call.getString("sessionId"); val api = call.getString("apiBase")
        val at = call.getString("accessToken"); val rt = call.getString("refreshToken")
        if (sid.isNullOrEmpty() || api.isNullOrEmpty() || at.isNullOrEmpty() || rt.isNullOrEmpty()) { call.reject("invalid arguments", "unsupported"); return }
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            call.reject("microphone permission denied", "permission_denied"); return
        }
        if (sid.contains('/') || sid.contains("..")) { call.reject("invalid sessionId", "unsupported"); return }
        try {
            store.save(at, rt)
            val src = AudioRecordSource()
            engine.start(sid, api.trimEnd('/'), call.getInt("startChunkIndex", 0) ?: 0, src)
            uploader.ensureStarted()
            call.resolve(statusJson())
        } catch (e: IllegalStateException) {
            call.reject(e.message ?: "start failed", "audio_engine_failed")
        } catch (e: Exception) {
            call.reject("start failed", "audio_engine_failed")
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        Thread {
            val r = engine.stop()
            call.resolve(JSObject().put("pendingCount", r.pendingCount).put("uploadedCount", r.uploadedCount).put("lastChunkIndex", r.lastChunkIndex))
        }.start()
    }

    @PluginMethod fun pause(call: PluginCall) { engine.pause(); call.resolve(statusJson()) }
    @PluginMethod fun resume(call: PluginCall) { engine.resume(); call.resolve(statusJson()) }
    @PluginMethod fun setMicEnabled(call: PluginCall) { engine.setMicEnabled(call.getBoolean("enabled", true) == true); call.resolve(statusJson()) }
    @PluginMethod fun getStatus(call: PluginCall) { call.resolve(statusJson()) }

    @PluginMethod
    fun updateCredentials(call: PluginCall) {
        val at = call.getString("accessToken"); val rt = call.getString("refreshToken")
        if (at.isNullOrEmpty() || rt.isNullOrEmpty()) { call.reject("invalid arguments", "unsupported"); return }
        store.save(at, rt); uploader.wake(); call.resolve()
    }

    // --- 이벤트(토큰 없음) ---
    private fun emitState(sid: String?, state: String, reason: String?) {
        val o = JSObject().put("event", "stateChanged").put("sessionId", sid ?: org.json.JSONObject.NULL).put("state", state)
        if (reason != null) o.put("reason", reason)
        notifyListeners("stateChanged", o)
    }

    override fun onState(sessionId: String?, state: String, reason: String?) = emitState(sessionId, state, reason)

    override fun onError(sessionId: String?, code: String, message: String, recoverable: Boolean) {
        notifyListeners("error", JSObject().put("event", "error").put("sessionId", sessionId ?: org.json.JSONObject.NULL)
            .put("code", code).put("message", message).put("recoverable", recoverable))
    }

    override fun onUploaded(sessionId: String, index: Int, sizeBytes: Long) {
        engine.onUploaded(sessionId, index)
        val s = engine.status()
        notifyListeners("chunkUploaded", JSObject().put("event", "chunkUploaded").put("sessionId", sessionId).put("chunkIndex", index)
            .put("sizeBytes", sizeBytes).put("uploadedCount", s.uploadedCount).put("pendingCount", queue.pending(sessionId).size))
    }

    override fun onUploadError(sessionId: String, code: String, message: String, recoverable: Boolean) = onError(sessionId, code, message, recoverable)
}
