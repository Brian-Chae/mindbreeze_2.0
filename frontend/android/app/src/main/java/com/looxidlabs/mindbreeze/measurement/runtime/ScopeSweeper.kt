package com.looxidlabs.mindbreeze.measurement.runtime

import com.looxidlabs.mindbreeze.measurement.archive.ArchiveQueue
import com.looxidlabs.mindbreeze.measurement.archive.ArchiveUploader
import com.looxidlabs.mindbreeze.measurement.archive.CloseIntentStore
import com.looxidlabs.mindbreeze.measurement.archive.RawReconcileResult
import com.looxidlabs.mindbreeze.measurement.archive.RawReconciler
import com.looxidlabs.mindbreeze.measurement.live.FeatureMeta
import com.looxidlabs.mindbreeze.measurement.live.FeatureReconciler
import com.looxidlabs.mindbreeze.measurement.live.FeatureUploader
import com.looxidlabs.mindbreeze.measurement.live.FlushResult
import com.looxidlabs.mindbreeze.measurement.live.MetricOutbox
import com.looxidlabs.mindbreeze.measurement.live.ReconcileResult
import com.looxidlabs.mindbreeze.measurement.live.RefreshOutcome
import com.looxidlabs.mindbreeze.measurement.live.StreamTag
import com.looxidlabs.mindbreeze.measurement.live.TokenSource
import okhttp3.OkHttpClient
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

/**
 * 세션 디렉터리(`filesDir/measurement/<sid>/`)마다 남기는 업로드 재개 정보. 비밀이 아니다(토큰 없음).
 * 앱이 죽었다 다시 열려도 이 파일만으로 어느 계정의 어떤 참가자·stream 의 데이터인지 알고 서버로 이어 올린다(SDD-260 N3).
 */
data class ScopeInfo(
    val sessionId: String, val apiBase: String, val account: String?, val participantId: String?, val streamId: String?,
    val deviceProfile: String, val algorithmVersion: String, val modelVersion: String, val clockUncertaintyMs: Double,
    val generation: String? = null,
) {
    fun meta() = FeatureMeta(deviceProfile, algorithmVersion, modelVersion, clockUncertaintyMs)

    companion object {
        const val FILE = "scope.json"

        fun load(f: File): ScopeInfo? = try {
            if (!f.exists()) null else JSONObject(f.readText()).let {
                ScopeInfo(it.getString("sessionId"), it.getString("apiBase"), it.optString("account").ifEmpty { null }, it.optString("participantId").ifEmpty { null },
                    it.optString("streamId").ifEmpty { null }, it.getString("deviceProfile"), it.getString("algorithmVersion"), it.getString("modelVersion"),
                    it.optDouble("clockUncertaintyMs", 300_000.0), it.optString("generation").ifEmpty { null })
            }
        } catch (_: Exception) { null }

        fun save(f: File, c: ScopeInfo) {
            val o = JSONObject().put("sessionId", c.sessionId).put("apiBase", c.apiBase).put("account", c.account ?: "").put("participantId", c.participantId ?: "")
                .put("streamId", c.streamId ?: "").put("deviceProfile", c.deviceProfile).put("algorithmVersion", c.algorithmVersion).put("modelVersion", c.modelVersion)
                .put("clockUncertaintyMs", c.clockUncertaintyMs).put("generation", c.generation ?: "")
            val tmp = File(f.path + ".tmp")
            f.parentFile?.mkdirs()
            FileOutputStream(tmp).use { it.write(o.toString().toByteArray()); it.flush(); it.fd.sync() }
            tmp.renameTo(f)
        }
    }
}

/** access 토큰(JWT)의 `sub` 만 읽는다(서명 검증 없음 — 어느 계정의 토큰인지 구분하는 용도이며 권한 판단은 서버가 한다). */
object JwtSub {
    fun of(token: String?): String? {
        val p = token?.split('.') ?: return null
        if (p.size < 2) return null
        return try {
            JSONObject(String(java.util.Base64.getUrlDecoder().decode(p[1]))).optString("sub").ifEmpty { null }
        } catch (_: Exception) { null }
    }
}

data class SweepReport(val completed: Int, val incomplete: Int, val preserved: Int, val active: Int, val authWait: Boolean)

/**
 * SDD-260 N3 — 끊긴 채 남은 **모든** 세션 scope 를 서버에 이어 올린다(앱 시작·포그라운드·네트워크 복귀·60초 주기·종료 직후).
 * 기존 ArchiveWorker 는 runtime.json 의 마지막 세션 하나만 보았다. 여기서는 각 세션 디렉터리 전부를 훑는다.
 *
 * scope 하나의 순서: ① outbox 의 feature 를 REST 로 전송 ② summary 대조(서버에 없는 창만 재전송) ③ archive 큐(원시·feature 산출물) 업로드
 * ④ 원시 summary 대조 → 전부 일치하면 완료 표식(sync-complete.json). 표식이 있어야만 보관 정책이 정리를 고려한다(여기서는 삭제 0).
 * 계정이 다른 scope 는 전송 없이 보존, 지금 측정 중인 scope(NativeRuntime 이 outbox 를 소유)는 건드리지 않는다.
 */
class ScopeSweeper(
    private val root: File,
    private val tokens: () -> TokenSource,
    private val http: OkHttpClient,
    private val isActive: (String) -> Boolean,
    private val quietMs: Long = 0,
    private val nowMs: () -> Long = { System.currentTimeMillis() },
    private val board: SyncStatusBoard = SyncStatusBoard.global,
) {
    @Synchronized
    fun sweepOnce(): SweepReport {
        var completed = 0; var incomplete = 0; var preserved = 0; var active = 0; var authWait = false
        val dirs = root.listFiles { f -> f.isDirectory && File(f, ScopeInfo.FILE).exists() }?.sortedBy { it.name } ?: emptyList()
        for (dir in dirs) {
            if (File(dir, MARKER).exists()) continue
            val info = ScopeInfo.load(File(dir, ScopeInfo.FILE)) ?: continue
            if (isActive(info.sessionId) || recentlyWritten(dir)) { active++; continue }
            val ts = tokens()
            val tok = ts.current()
            if (tok == null) { incomplete++; authWait = true; continue }
            val sub = JwtSub.of(tok)
            if (info.account != null && sub != null && info.account != sub) { preserved++; continue } // 다른 계정 데이터는 보존만(V-C6)
            when (val r = drain(dir, info, ts)) {
                Outcome.Complete -> completed++
                Outcome.Incomplete -> incomplete++
                Outcome.AuthWait -> { incomplete++; authWait = true }
            }
        }
        return SweepReport(completed, incomplete, preserved, active, authWait)
    }

    private fun recentlyWritten(dir: File): Boolean {
        if (quietMs <= 0) return false
        val newest = listOf("outbox.log", "raw.journal").map { File(dir, it).lastModified() }.maxOrNull() ?: 0L
        return nowMs() - newest < quietMs
    }

    private enum class Outcome { Complete, Incomplete, AuthWait }

    private fun drain(dir: File, info: ScopeInfo, ts: TokenSource): Outcome {
        val refresh = { ts.refresh() is RefreshOutcome.Ok }
        val outbox = MetricOutbox(File(dir, "outbox.log"))
        try {
            // stream 이 확정되기 전에 쌓인 창은 scope 에 기록된 신원으로 귀속한다(없으면 보낼 수 없어 진단만).
            if (outbox.untaggedCount() > 0 && info.participantId != null && info.streamId != null && info.generation != null)
                outbox.bindUntagged(StreamTag(info.streamId, info.generation, UUID.nameUUIDFromBytes("sweep|${info.sessionId}|${info.streamId}".toByteArray()).toString(), info.participantId))
            val up = FeatureUploader(info.apiBase, info.sessionId, outbox, { info.meta() }, { ts.current() }, refresh, http)
            val rec = FeatureReconciler(info.apiBase, info.sessionId, outbox, { info.participantId }, { ts.current() }, http)
            var rounds = 0
            val sid = info.sessionId
            board.setFeature(sid, "syncing"); board.setRaw(sid, "syncing")
            publishFeatureCounts(sid, outbox)
            while (true) {
                if (!flushAll(up)) { board.setFeature(sid, "retrying"); publishFeatureCounts(sid, outbox); return if (ts.current() == null) Outcome.AuthWait else Outcome.Incomplete }
                publishFeatureCounts(sid, outbox)
                when (val r = rec.run()) {
                    is ReconcileResult.Complete -> { board.setFeature(sid, "complete"); break }
                    is ReconcileResult.Resending -> { board.setFeature(sid, "resending"); if (++rounds > MAX_ROUNDS) return Outcome.Incomplete }
                    is ReconcileResult.Waiting -> { board.setFeature(sid, "syncing"); if (++rounds > MAX_ROUNDS) return Outcome.Incomplete }
                    is ReconcileResult.Failed -> { board.setFeature(sid, "retrying"); return if (r.authWait) Outcome.AuthWait else Outcome.Incomplete }
                }
            }
            publishFeatureCounts(sid, outbox)
        } finally { outbox.close() }
        return drainArchive(dir, info, ts)
    }

    /** 대기 창이 없어질 때까지 REST 로 보낸다. 반환: 막힘 없이 비웠는지(Retry·미해결 거절은 false). */
    private fun flushAll(up: FeatureUploader): Boolean {
        repeat(MAX_FLUSHES) {
            when (val r = up.flushOnce()) {
                FlushResult.Idle -> return true
                is FlushResult.Done -> if (!r.more) return up.flushOnce() == FlushResult.Idle
                is FlushResult.Retry -> if (r.reason != "invalid_message_split") return false
            }
        }
        return false
    }

    private fun drainArchive(dir: File, info: ScopeInfo, ts: TokenSource): Outcome {
        val archiveDir = File(dir, "archive")
        if (!archiveDir.exists()) { board.setRaw(info.sessionId, "complete"); return markComplete(dir, info) }
        val q = ArchiveQueue(archiveDir)
        val sid = info.sessionId
        fun pub() { val prev = board.counts(sid); board.setCounts(sid, SyncCounts.of(prev.featurePending, prev.featureAcked, prev.featureRejected, q.counts(), q.signalCounts())) }
        pub()
        val up = ArchiveUploader(info.apiBase, q, { ts.current() }, http, { info.streamId })
        val intents = CloseIntentStore(File(dir, "close-intent.json"))
        val gaps = com.looxidlabs.mindbreeze.measurement.archive.GapEventStore(File(dir, "gap-events.json"), info.sessionId)
        val rec = RawReconciler(info.apiBase, info.sessionId, q, { info.participantId }, { ts.current() }, http)
        var rounds = 0
        while (true) {
            var progress = true
            while (q.counts().archivePending > 0 && progress) {
                val sum = up.drain()
                pub()
                if (sum.halted != null) { board.setRaw(sid, "retrying"); return if (ts.current() == null) Outcome.AuthWait else Outcome.Incomplete }
                progress = sum.acked > 0
            }
            if (q.counts().archivePending > 0) { board.setRaw(sid, "retrying"); return Outcome.Incomplete } // 백오프 중 → 다음 스윕에서
            // SDD-270: 구멍이 서버에 다 닿기 전에는 완료 표식을 쓰지 않는다(종료 기록보다 먼저 보낸다).
            if (!(try { up.sendGapEvents(info.participantId, gaps) } catch (_: Exception) { false })) { board.setRaw(sid, "retrying"); return Outcome.Incomplete }
            intents.pending()?.let { p ->
                val ok = try { up.sendCloseIntent(info.sessionId, info.participantId, p.intent) } catch (_: Exception) { false }
                if (ok) intents.markSent() else intents.markAttempt()
            }
            when (val r = rec.run()) {
                RawReconcileResult.Complete -> { board.setRaw(sid, "complete"); break }
                is RawReconcileResult.Resending -> { board.setRaw(sid, "resending"); pub(); if (++rounds > MAX_ROUNDS) return Outcome.Incomplete }
                RawReconcileResult.Waiting -> { board.setRaw(sid, "syncing"); if (++rounds > MAX_ROUNDS) return Outcome.Incomplete }
                RawReconcileResult.Unverifiable -> { board.setRaw(sid, "unverifiable"); return Outcome.Incomplete }
                is RawReconcileResult.Failed -> { board.setRaw(sid, "retrying"); return if (r.authWait) Outcome.AuthWait else Outcome.Incomplete }
            }
        }
        pub()
        return markComplete(dir, info)
    }

    private fun publishFeatureCounts(sid: String, outbox: MetricOutbox) {
        val prev = board.counts(sid)
        board.setCounts(sid, prev.copy(featurePending = outbox.size(), featureAcked = outbox.acked(), featureRejected = outbox.quarantined()))
    }

    private fun markComplete(dir: File, info: ScopeInfo): Outcome {
        val tmp = File(dir, "$MARKER.tmp")
        FileOutputStream(tmp).use { it.write(JSONObject().put("session_id", info.sessionId).put("completed_at_ms", nowMs()).toString().toByteArray()); it.flush(); it.fd.sync() }
        tmp.renameTo(File(dir, MARKER))
        board.markComplete(info.sessionId) // feature·원시 대조가 모두 끝난 뒤에만 complete=true
        return Outcome.Complete
    }

    companion object {
        const val MARKER = "sync-complete.json"

        /** 앱 컨텍스트용: 현재 로그인 토큰 저장소 + 실행 중 NativeRuntime 의 세션은 건너뜀. */
        fun forContext(ctx: android.content.Context): ScopeSweeper {
            val root = File(ctx.filesDir, "measurement")
            val cfg = RuntimeConfig.load(File(root, "runtime.json"))
            val store = KeystoreFactory.tokenStore(ctx)
            val tokens = com.looxidlabs.mindbreeze.measurement.live.HttpTokenSource(cfg?.apiBase ?: "", store)
            return ScopeSweeper(root, { tokens }, OkHttpClient(), { sid -> NativeRuntimeHolder.current()?.cfg?.sessionId == sid })
        }

        private const val MAX_FLUSHES = 2000
        private const val MAX_ROUNDS = 6
    }
}
