package com.looxidlabs.mindbreeze.measurement.runtime

import android.content.Context
import android.os.SystemClock
import com.looxidlabs.mindbreeze.measurement.MeasurementCore
import com.looxidlabs.mindbreeze.measurement.MeasurementEngine
import com.looxidlabs.mindbreeze.measurement.ModelPin
import com.looxidlabs.mindbreeze.measurement.Sensor
import com.looxidlabs.mindbreeze.measurement.archive.ArchiveFeeder
import com.looxidlabs.mindbreeze.measurement.archive.ArchiveQueue
import com.looxidlabs.mindbreeze.measurement.archive.ArchiveUploader
import com.looxidlabs.mindbreeze.measurement.bridge.BridgeInputs
import com.looxidlabs.mindbreeze.measurement.bridge.BridgeModel
import com.looxidlabs.mindbreeze.measurement.bridge.BridgeSequencer
import com.looxidlabs.mindbreeze.measurement.live.*
import okhttp3.OkHttpClient
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

/**
 * 한 회차의 native 파이프라인: BLE → journal → Rust 코어 → (live: LiveSession / archive: ArchiveFeeder → WorkManager).
 * UI/WebView 와 무관하게 서비스가 소유한다. 모든 live 호출은 HandlerLiveScheduler 스레드로 직렬화한다.
 */
class NativeRuntime private constructor(
    val ctx: Context, val cfg: RuntimeConfig, val dir: File,
    val engine: MeasurementEngine, val sched: HandlerLiveScheduler, val live: LiveSession, val box: MetricOutbox,
    val queue: ArchiveQueue, val feeder: ArchiveFeeder, val tokens: HttpTokenSource, val transport: IoSocketTransport,
    val sequencer: BridgeSequencer,
    /** pin 된 모델 버전(없으면 코호트 b0-cohort-2). capture.start·bridge snapshot 에 같은 값을 쓴다. */
    val modelVersion: String = "b0-cohort-2",
) {
    private val archiveExec = Executors.newSingleThreadExecutor()
    private val nativeHeartbeat = AtomicLong()
    @Volatile var lastVerifiedAtMs: Long? = null
        private set
    @Volatile var lastArchiveStage: String? = null
    @Volatile var lastArchiveCode: String? = null
    @Volatile var bandState: String = "connecting"
    @Volatile private var draining = false
    @Volatile private var stopping = false
    private var tick: Cancelable? = null
    private var captureRequested = false
    var onArchiveDrained: ((Int) -> Unit)? = null
    /** 서버가 stream 을 끝냄(status, cutoff_code) → 서비스가 측정 정지·봉인(archive 는 계속). */
    var onCaptureEnded: ((String, String?) -> Unit)? = null
    private val devicePolicy = DeviceReportPolicy()

    fun start() {
        engine.frameSink = { f ->
            sched.post { live.onFrame(f) }
            feeder.onFrame(f)
            kickArchive()
        }
        live.anchorProvider = { engine.lastEegAnchor?.let { it.first.toString() to it.second.toString() } }
        live.onStateChanged = { s ->
            // 서버가 끝낸 stream(추방·동의철회·종료·교체) 뒤에는 자동으로 새 capture.start 를 보내지 않는다
            if (s == LiveState.READY && live.streamId == null && !captureRequested) { captureRequested = live.startCaptureIfAllowed() != null }
            if (s != LiveState.READY) captureRequested = live.streamId != null
        }
        live.onStreamEnded = { status, cutoff -> onCaptureEnded?.invoke(status, cutoff) }
        sched.post {
            live.start()
            engine.replayPending() // 복구 재생 프레임 → outbox(순번 중복 거름)
            scheduleTick()
        }
    }

    private fun scheduleTick() {
        tick = sched.postDelayed(1_000) {
            nativeHeartbeat.incrementAndGet()
            if (!stopping) { engine.advance(); maybeReportDevice() }
            RuntimeConfig.save(File(dir, "runtime.json"), cfg.copy(active = !stopping, streamId = live.streamId, participantId = live.participantId, ownerGeneration = live.ownerGeneration))
            scheduleTick()
        }
    }

    /** live:device: 밴드 상태·접촉이 바뀌거나 30초마다(직렬 컨텍스트). 배터리 잔량은 밴드에서 아직 읽지 않아 null. */
    private fun maybeReportDevice() {
        if (live.streamId == null) return
        val frame = engine.lastCoreFrame
        val contact = StreamLifecycle.contactOf(frame)
        if (!devicePolicy.shouldReport(System.currentTimeMillis(), bandState, contact)) return
        val sqi = frame?.opt("sqi")?.let { (it as? Number)?.toDouble() }?.takeIf { it in 0.0..1.0 }
        live.reportDevice(bandState, contact, sqi, null, if (bandState == "reconnecting") "ble_disconnect" else null)
    }

    /** feeder 가 봉인한 항목을 즉시 올려 본다(실패하면 backoff 는 큐가, 재시도는 WorkManager 가 맡는다). */
    fun kickArchive() {
        if (draining) return
        archiveExec.execute { drainArchive() }
    }

    @Synchronized
    fun drainArchive(): Int {
        if (draining) return 0
        draining = true
        try {
            val up = ArchiveUploader(cfg.apiBase, queue, tokenProvider = { tokens.current() }, http = HTTP, captureStreamId = { live.streamId ?: cfg.streamId })
            val sum = up.drain()
            if (sum.acked > 0) lastVerifiedAtMs = System.currentTimeMillis()
            queue.all().lastOrNull { it.lastReason != null }?.let { lastArchiveStage = it.lastStage; lastArchiveCode = it.lastReason?.lowercase()?.replace(Regex("[^a-z0-9_]"), "_")?.take(64) }
            if (sum.acked > 0) queue.gcVerified()
            if (sum.failed > 0 || queue.counts().archivePending > 0) ArchiveWorker.schedule(ctx, 30)
            onArchiveDrained?.invoke(sum.acked)
            return sum.acked
        } finally { draining = false }
    }

    /** 정지: 남은 창 봉인 → capture.close → 체크포인트 → 엔진 정리. archive 는 계속(DRAINING). */
    fun stop(reason: String) {
        stopping = true
        tick?.cancel()
        val finals = try { engine.writeCheckpoint(); engine.finalSequences() } catch (_: Exception) { null }
        feeder.flush()
        if (finals != null) sched.post { live.closeCapture(finals, reason) }
        RuntimeConfig.save(File(dir, "runtime.json"), cfg.copy(active = false, streamId = live.streamId, participantId = live.participantId))
        kickArchive()
        sched.postDelayed(5_000) { live.stop(); box.close(); sched.quit() }
        engine.close()
    }

    fun inputs(state: String, blocked: String?): BridgeInputs {
        val c = engine.counters.snapshot()
        val last = engine.lastCoreFrame
        val age = last?.let { System.currentTimeMillis() - it.optLong("observed_at_ms") }
        val fresh = when { age == null -> "stale"; age < 3_000 -> "fresh"; age < 10_000 -> "delayed"; else -> "stale" }
        return BridgeInputs(
            sequencer.managerGeneration, sequencer.current(), cfg.sessionId, state, blocked, live.streamId, live.ownerGeneration,
            "native-1.0.0", "core-1.0.0", "web-ts-1", modelVersion, "linkband2-v1", last, fresh, bandState,
            if (c.eegSamples > 0) c.eegSamples else null,
            c.eegPackets, c.ppgPackets, c.accPackets, c.eegSamples, c.ppgSamples, c.accSamples, c.frames, nativeHeartbeat.get(),
            live.socketStatus(), live.lastAckSequence, live.cursorsSnapshot(), box.acked(), box.size(), queue.counts(), lastVerifiedAtMs, emptyList(),
        )
    }

    companion object {
        private val HTTP = OkHttpClient()
        const val ALGORITHM = "web-ts-1"

        /** 서비스 생성/재생성에서 호출. 이전 journal·체크포인트·outbox·archive 큐를 이어받는다. */
        fun open(ctx: Context, cfg: RuntimeConfig, store: TokenStore, nowMono: () -> Long = { SystemClock.elapsedRealtime() }): NativeRuntime {
            val dir = File(ctx.filesDir, "measurement/${cfg.sessionId}").apply { mkdirs() }
            // 활성 표준 모델 1회 pin(웹 scoreIndices 와 같은 규칙: 활성 모델 > 코호트). 파일이 있으면 도중 교체하지 않는다.
            val pin = ModelPin.loadOrCreate(File(dir, "model-pin.json"), cfg.modelParams, cfg.modelVersion)
            val engine = MeasurementEngine.openOrResume(File(dir, "raw.journal"), File(dir, "raw.ck"), clockMs = nowMono, syncEach = true,
                configJson = ModelPin.configJson(pin), modelParamsJson = pin?.paramsJson)
            val sched = HandlerLiveScheduler()
            val box = MetricOutbox(File(dir, "outbox.log"))
            val tokens = HttpTokenSource(cfg.apiBase, store)
            val transport = IoSocketTransport(cfg.socketBase, sched)
            val modelVersion = pin?.modelVersion ?: "b0-cohort-2"
            val lc = LiveConfig(cfg.sessionId, cfg.instanceId, "android-native-1", "core-1.0.0", "linkband2-v1", ALGORITHM, modelVersion)
            val live = LiveSession(lc, transport, sched, tokens, box)
            val queue = ArchiveQueue(File(dir, "archive"))
            val feeder = ArchiveFeeder(queue, cfg.sessionId, { live.participantId ?: cfg.participantId }, { live.streamId ?: cfg.streamId })
            return NativeRuntime(ctx.applicationContext, cfg, dir, engine, sched, live, box, queue, feeder, tokens, transport, BridgeSequencer(System.currentTimeMillis() / 1000), modelVersion)
        }
    }
}
