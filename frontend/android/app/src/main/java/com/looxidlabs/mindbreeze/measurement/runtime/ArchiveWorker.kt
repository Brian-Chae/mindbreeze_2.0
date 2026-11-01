package com.looxidlabs.mindbreeze.measurement.runtime

import android.content.Context
import androidx.work.*
import java.util.concurrent.TimeUnit

/**
 * 지연 archive 재시도 전용(live 1Hz clock 아님). 네트워크가 있을 때만 실행되고, 앱 프로세스가 죽었다 다시 떠도
 * 디스크 큐(ArchiveQueue)에서 이어서 올린다. 로그아웃/토큰 없음이면 올리지 않고 종료한다.
 */
class ArchiveWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result {
        val rt = NativeRuntimeHolder.current()
        rt?.drainArchive()
        // SDD-260 N3: runtime.json 의 마지막 세션 하나가 아니라 남아 있는 모든 세션 scope 를 이어 올린다(측정 중인 scope 는 건드리지 않음).
        val rep = ScopeSweeper.forContext(applicationContext).sweepOnce()
        return if (rep.incomplete > 0) Result.retry() else Result.success()
    }

    companion object {
        const val NAME = "mb-archive-drain"
        /** 앱 시작·포그라운드·네트워크 복귀·종료 직후에 부른다. 동시에 40대가 몰리지 않도록 jitterSec 안에서 무작위 지연. */
        fun scheduleWithJitter(ctx: Context, baseSec: Long = 0, jitterSec: Long = 60) =
            schedule(ctx, baseSec + (Math.random() * jitterSec).toLong())

        fun schedule(ctx: Context, delaySec: Long) {
            val req = OneTimeWorkRequestBuilder<ArchiveWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setInitialDelay(delaySec, TimeUnit.SECONDS)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
            WorkManager.getInstance(ctx).enqueueUniqueWork(NAME, ExistingWorkPolicy.KEEP, req)
        }
    }
}

object NativeRuntimeHolder {
    @Volatile private var rt: NativeRuntime? = null
    fun set(r: NativeRuntime?) { rt = r }
    fun current(): NativeRuntime? = rt
}

/** 서비스 없이 디스크 큐만 올린다(WorkManager 가 프로세스 재생성 후 실행될 때). */
object NativeArchiveOnly {
    fun drain(ctx: Context, cfg: RuntimeConfig): Boolean {
        val store = KeystoreFactory.tokenStore(ctx)
        val tokens = com.looxidlabs.mindbreeze.measurement.live.HttpTokenSource(cfg.apiBase, store)
        val q = com.looxidlabs.mindbreeze.measurement.archive.ArchiveQueue(java.io.File(ctx.filesDir, "measurement/${cfg.sessionId}/archive"))
        q.repairLegacyFeatures({ com.looxidlabs.mindbreeze.measurement.archive.RawIds.streamId(it, com.looxidlabs.mindbreeze.measurement.Sensor.EEG) },
            { com.looxidlabs.mindbreeze.measurement.archive.RawIds.segmentId(it, com.looxidlabs.mindbreeze.measurement.Sensor.EEG, 0) })
        val intents = com.looxidlabs.mindbreeze.measurement.archive.CloseIntentStore(java.io.File(ctx.filesDir, "measurement/${cfg.sessionId}/close-intent.json"))
        val gaps = com.looxidlabs.mindbreeze.measurement.archive.GapEventStore(java.io.File(ctx.filesDir, "measurement/${cfg.sessionId}/gap-events.json"), cfg.sessionId)
        if (q.counts().archivePending == 0 && intents.pending() == null && !gaps.hasPending()) return true
        if (tokens.current() == null) return true // 권한 없으면 올리지 않는다
        val up = com.looxidlabs.mindbreeze.measurement.archive.ArchiveUploader(cfg.apiBase, q, { tokens.current() }, okhttp3.OkHttpClient(), { cfg.streamId })
        var sum = up.drain()
        val gapsOk = try { up.sendGapEvents(cfg.participantId, gaps) } catch (_: Exception) { false } // SDD-270: 구멍을 종료 기록보다 먼저
        // 프로세스가 죽어 서비스 없이 올리는 경로도 종료 기록을 보낸다.
        var intentOk = true
        intents.pending()?.let { p ->
            intentOk = try { up.sendCloseIntent(cfg.sessionId, cfg.participantId, p.intent) } catch (_: Exception) { false }
            if (intentOk) intents.markSent() else intents.markAttempt()
        }
        if (sum.halted == null && sum.failed == 0 && intentOk && gapsOk) return true
        return sum.halted != null // halt 은 재시도해도 같은 결과 → 종료, 그 외 실패는 WorkManager backoff
    }
}
