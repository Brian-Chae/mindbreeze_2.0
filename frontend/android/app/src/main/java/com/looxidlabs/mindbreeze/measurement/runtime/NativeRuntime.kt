package com.looxidlabs.mindbreeze.measurement.runtime

import android.content.Context
import android.os.SystemClock
import com.looxidlabs.mindbreeze.measurement.MeasurementCore
import com.looxidlabs.mindbreeze.measurement.MeasurementEngine
import com.looxidlabs.mindbreeze.measurement.ModelPin
import com.looxidlabs.mindbreeze.measurement.Sensor
import com.looxidlabs.mindbreeze.measurement.archive.ArchiveFeeder
import com.looxidlabs.mindbreeze.measurement.archive.CloseIntentStore
import com.looxidlabs.mindbreeze.measurement.archive.RawArchiver
import com.looxidlabs.mindbreeze.measurement.archive.RawIds
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
    val rawArchiver: RawArchiver,
    /** pin 된 모델 버전(없으면 코호트 b0-cohort-2). capture.start·bridge snapshot 에 같은 값을 쓴다. */
    val modelVersion: String = "b0-cohort-2",
    /** SDD-270: 측정 구멍 내구 저장소. RawArchiver 와 같은 인스턴스를 공유한다(읽기-수정-쓰기 경합 방지). */
    val gapStore: com.looxidlabs.mindbreeze.measurement.archive.GapEventStore = com.looxidlabs.mindbreeze.measurement.archive.GapEventStore(File(dir, "gap-events.json"), cfg.sessionId),
) {
    private val archiveExec = Executors.newSingleThreadExecutor()
    /** SDD-260 N1: feature 정본 저장 = REST 배치. 소켓(READY·방송)과 무관하게 5초 주기로 돈다. */
    private val syncExec = Executors.newSingleThreadScheduledExecutor()
    private val uploader = FeatureUploader(cfg.apiBase, cfg.sessionId, box, { live.featureMeta() }, { tokens.current() }, { tokens.refresh() is RefreshOutcome.Ok }, HTTP)
    private val syncRunner = FeatureSyncRunner(FeatureSyncLoop({ uploader.flushOnce() }), syncExec)
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
    private val closeIntents = CloseIntentStore(File(dir, "close-intent.json"))

    fun start() {
        engine.rawSink = { sensor, us, bytes -> rawArchiver.onPacket(sensor, us, bytes); kickArchive() }
        engine.frameSink = { f ->
            sched.post { live.onFrame(f) }
            feeder.onFrame(f)
            kickArchive()
        }
        live.anchorProvider = { engine.lastEegAnchor?.let { it.first.toString() to it.second.toString() } }
        engine.onFirstEegAnchor = { sched.post { live.onAnchorAvailable() } } // SDD-272: 앵커가 처음 생기면 즉시 시각 보정 시도
        live.onStateChanged = { s ->
            // 서버가 끝낸 stream(추방·동의철회·종료·교체) 뒤에는 자동으로 새 capture.start 를 보내지 않는다
            if (s == LiveState.READY && live.streamId == null && !captureRequested) { captureRequested = live.startCaptureIfAllowed() != null }
            if (s != LiveState.READY) captureRequested = live.streamId != null
        }
        live.onStreamEnded = { status, cutoff -> onCaptureEnded?.invoke(status, cutoff) }
        live.onStreamBound = { syncRunner.trigger() } // stream 확정 즉시 쌓인 창을 REST 로 보낸다
        syncRunner.start(0)
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
            writeScope()
            scheduleTick()
        }
    }

    /** 세션 디렉터리에 재개 정보(scope.json)를 남긴다 — 앱이 죽어도 계정·참가자·stream 을 알고 이어 올린다(N3). 값이 바뀔 때만 기록. */
    private var lastScope: ScopeInfo? = null
    private fun writeScope() {
        val prev = lastScope
        val info = ScopeInfo(cfg.sessionId, cfg.apiBase, JwtSub.of(tokens.current()) ?: prev?.account, live.participantId ?: prev?.participantId ?: cfg.participantId,
            live.streamId ?: prev?.streamId ?: cfg.streamId, "linkband2-v1", ALGORITHM, modelVersion, live.featureMeta().clockUncertaintyMs, live.ownerGeneration ?: prev?.generation)
        if (info != lastScope) { ScopeInfo.save(File(dir, ScopeInfo.FILE), info); lastScope = info }
    }

    /** N6 복귀 재개(포그라운드·네트워크 복귀): REST 즉시 1회 + archive drain. 측정은 계속된다. */
    fun resumeUploads() { syncRunner.trigger(); kickArchive() }

    /** feature·원시 업로드 진행(UI "업로드 중 feature N창 · 원시 M건"). */
    fun uploadCounts(): JSONObject = JSONObject()
        .put("feature_pending", box.size()).put("feature_acked", box.acked()).put("feature_quarantined", box.quarantined())
        .put("archive_pending", queue.counts().archivePending).put("archive_verified", queue.counts().archiveVerified)
        .put("archive_signals", SyncEvents.signalsJson(queue.signalCounts()))

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
            sendPendingGaps(up) // 구멍이 종료 기록보다 먼저 — 서버가 last_gap_sequence 까지 도착을 대조한다
            sendPendingCloseIntent(up)
            if (sum.acked > 0) lastVerifiedAtMs = System.currentTimeMillis()
            queue.all().lastOrNull { it.lastReason != null }?.let { lastArchiveStage = it.lastStage; lastArchiveCode = it.lastReason?.lowercase()?.replace(Regex("[^a-z0-9_]"), "_")?.take(64) }
            if (sum.acked > 0) queue.gcVerified()
            if (sum.failed > 0 || queue.counts().archivePending > 0) ArchiveWorker.scheduleWithJitter(ctx, 15, 30)
            onArchiveDrained?.invoke(sum.acked)
            return sum.acked
        } finally { draining = false }
    }

    /** SDD-270: 대기 중인 측정 구멍 전송. 실패(네트워크·인증)는 디스크에 남아 다음 drain/WorkManager/ScopeSweeper 가 다시 올린다. */
    private fun sendPendingGaps(up: ArchiveUploader) {
        if (!gapStore.hasPending()) return
        val ok = try { up.sendGapEvents(live.participantId ?: cfg.participantId, gapStore) } catch (_: Exception) { false }
        if (!ok) ArchiveWorker.schedule(ctx, 30)
    }

    /** 종료 기록이 있고 아직 못 보냈으면 보낸다. 실패(네트워크 등)는 다음 drain/WorkManager 가 다시 시도한다. */
    private fun sendPendingCloseIntent(up: ArchiveUploader) {
        val p = closeIntents.pending() ?: return
        val ok = try { up.sendCloseIntent(cfg.sessionId, live.participantId ?: cfg.participantId, p.intent) } catch (_: Exception) { false }
        if (ok) closeIntents.markSent() else {
            closeIntents.markAttempt()
            ArchiveWorker.schedule(ctx, 30)
        }
    }

    /** 정지: 남은 창 봉인 → capture.close → 체크포인트 → 엔진 정리. archive 는 계속(DRAINING). */
    fun stop(reason: String) {
        stopping = true
        tick?.cancel()
        val finals = try { engine.writeCheckpoint(); engine.finalSequences() } catch (_: Exception) { null }
        feeder.flush()
        rawArchiver.flush() // 남은 원시 샘플도 부분 청크로 봉인
        // 종료 기록(close intent)을 서버 응답 이전에 디스크에 먼저 남긴다 — 앱이 죽어도 WorkManager 가 이어서 보낸다.
        try { closeIntents.record(queue, cfg.sessionId, reason, System.currentTimeMillis() * 1000L, gapStore.lastSequence()) } catch (_: Exception) { /* 종료 기록 실패가 정지를 막지 않는다 */ }
        if (finals != null) sched.post { live.closeCapture(finals, reason) }
        RuntimeConfig.save(File(dir, "runtime.json"), cfg.copy(active = false, streamId = live.streamId, participantId = live.participantId))
        kickArchive()
        syncRunner.trigger() // 마지막 배치 전송 시도(종료 후 잔여는 ScopeSweeper 가 이어받는다)
        try { writeScope() } catch (_: Exception) { }
        ArchiveWorker.scheduleWithJitter(ctx, 5, 55) // N4 종료 비차단: 40대 동시 종료도 5~60초에 분산해 대조·업로드 시작
        sched.postDelayed(5_000) { live.stop(); syncRunner.stop(); syncExec.shutdown(); box.close(); sched.quit() }
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
            val gapStore = com.looxidlabs.mindbreeze.measurement.archive.GapEventStore(File(dir, "gap-events.json"), cfg.sessionId)
            val rawArchiver = RawArchiver(queue, cfg.sessionId, { live.participantId ?: cfg.participantId }, File(dir, "raw-archive.json"), gapStore, { engine.counters.snapshot().reconnects })
            val feeder = ArchiveFeeder(queue, cfg.sessionId, { live.participantId ?: cfg.participantId }, { live.streamId ?: cfg.streamId },
                scope = { rawArchiver.streamId(Sensor.EEG) to rawArchiver.segmentId(Sensor.EEG) })
            // 구 앱이 남긴 scope 없는 feature 항목 보정 + 아직 청크에 못 든 원문(journal) 재생
            queue.repairLegacyFeatures({ RawIds.streamId(it, Sensor.EEG) }, { RawIds.segmentId(it, Sensor.EEG, 0) })
            try { rawArchiver.replay(com.looxidlabs.mindbreeze.measurement.AppendOnlyJournal.recover(File(dir, "raw.journal")).records) { ms -> engine.windowTimelineUs(ms * 1000) } } catch (_: Exception) { /* 원문은 journal 에 남아 다음 기회에 재생 */ }
            return NativeRuntime(ctx.applicationContext, cfg, dir, engine, sched, live, box, queue, feeder, tokens, transport, BridgeSequencer(System.currentTimeMillis() / 1000), rawArchiver, modelVersion, gapStore)
        }
    }
}
