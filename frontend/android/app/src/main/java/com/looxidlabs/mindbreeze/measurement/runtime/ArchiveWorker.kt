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
        if (rt != null) { rt.drainArchive(); return Result.success() }
        // 서비스가 없는 상태(프로세스 재생성) — 마지막 설정으로 큐만 열어 올린다
        val cfg = RuntimeConfig.load(java.io.File(applicationContext.filesDir, "measurement/runtime.json")) ?: return Result.success()
        val ok = NativeArchiveOnly.drain(applicationContext, cfg)
        return if (ok) Result.success() else Result.retry()
    }

    companion object {
        const val NAME = "mb-archive-drain"
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
        if (q.counts().archivePending == 0) return true
        if (tokens.current() == null) return true // 권한 없으면 올리지 않는다
        var sum = com.looxidlabs.mindbreeze.measurement.archive.ArchiveUploader(cfg.apiBase, q, { tokens.current() }, okhttp3.OkHttpClient(), { cfg.streamId }).drain()
        if (sum.halted == null && sum.failed == 0) return true
        return sum.halted != null // halt 은 재시도해도 같은 결과 → 종료, 그 외 실패는 WorkManager backoff
    }
}
