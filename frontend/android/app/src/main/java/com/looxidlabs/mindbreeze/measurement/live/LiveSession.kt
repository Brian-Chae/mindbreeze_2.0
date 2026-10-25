package com.looxidlabs.mindbreeze.measurement.live

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.LinkedBlockingQueue

enum class LiveState { IDLE, CONNECTING, RESYNCING, READY, DEGRADED, TERMINAL, REVOKED, BLOCKED }

data class LiveConfig(
    val sessionId: String,
    val instanceId: String,
    val appBuild: String,
    val coreVersion: String,
    val deviceProfile: String,
    val algorithmVersion: String,
    val modelVersion: String,
)

data class DispatchResult(val commandId: String, val acceptedForSend: Boolean, val queuedAtMs: Long)

/**
 * native Socket.IO v2 클라이언트 상태기계(plan §3). 모든 호출은 scheduler 의 직렬 컨텍스트에서만 일어난다고 가정한다
 * (실제 구현은 단일 HandlerThread). 네트워크/타이머/토큰은 인터페이스라 JVM 에서 가상 시계로 시험한다.
 *
 *  CONNECTING → RESYNCING(hello→join→snapshot→sync_complete) → READY(live:applied ACK 후) → DEGRADED → RESYNCING
 *  REVOKED/TERMINAL/BLOCKED 에서는 자동 재연결하지 않는다.
 */
class LiveSession(
    private val cfg: LiveConfig,
    private val transport: LiveTransport,
    private val sched: LiveScheduler,
    private val tokens: TokenSource,
    private val outbox: MetricOutbox,
) : LiveTransport.Listener {

    init { transport.listener = this }

    @Volatile var state = LiveState.IDLE
        private set
    @Volatile var blockedReason: String? = null
        private set
    @Volatile var participantId: String? = null
        private set
    @Volatile var streamId: String? = null
        private set
    @Volatile var ownerGeneration: String? = null
        private set
    @Volatile var endCutoff: String? = null
        private set
    @Volatile var lastHeartbeatAtMs: Long = 0
        private set
    @Volatile var visibility: String = "background"
    /** 밴드 tick 기준 (device_ticks, monotonic_us) 문자열. capture.reanchor 에 쓴다. */
    @Volatile var anchorProvider: (() -> Pair<String, String>?)? = null
    @Volatile var onStateChanged: ((LiveState) -> Unit)? = null
    @Volatile var onStreamSuperseded: ((String) -> Unit)? = null
    @Volatile var lastAckSequence: Long = -1
        private set

    /** 브리지로 전달할 서버 이벤트·명령 ACK(최종). 브리지 쪽이 소비한다. */
    val events = LinkedBlockingQueue<JSONObject>()
    val acks = LinkedBlockingQueue<JSONObject>()

    private var epoch = "0"
    private var connGen = 0L
    private var attempts = 0
    private var reconnectTimer: Cancelable? = null
    private var presenceTimer: Cancelable? = null
    private var watchdog: Cancelable? = null
    private var probeTimer: Cancelable? = null
    private var appliedTimer: Cancelable? = null
    private var pumpTimer: Cancelable? = null
    private var refreshing = false
    private var refreshAttempts = 0
    private var ackSnapshotId: String? = null
    private var gotSnapshotId: String? = null
    private val cursors = LinkedHashMap<String, Long>() // "audience|domain" -> seq (unsigned bits)
    private val buffered = ArrayList<JSONObject>()
    private var appliedDirty = false
    private var lastResyncAtMs = -100_000L
    private var hbMismatch = 0
    private var metricInflight = false
    private var anchorId: String = UUID.randomUUID().toString()
    private var clockUncertaintyMs = 300_000.0
    private var probeSentAtMs = 0L

    private class Pending(val cmd: JSONObject, val queuedAt: Long) {
        var attempts = 0; var inflightSince = -1L; var committedHint = false; var timer: Cancelable? = null; var lastSentAt = -1L
    }
    private val pending = LinkedHashMap<String, Pending>()

    // ------------------------------------------------------------------ 수명
    fun start() {
        if (state != LiveState.IDLE && state != LiveState.BLOCKED && state != LiveState.DEGRADED) return
        attempts = 0; blockedReason = null
        setState(LiveState.CONNECTING)
        connectNow()
    }

    fun stop() {
        cancelAll()
        transport.disconnect()
        setState(LiveState.IDLE)
    }

    private fun connectNow() {
        val t = tokens.current()
        if (t == null) { block("auth_expired"); return }
        transport.disconnect()
        transport.connect(t)
    }

    private fun setState(s: LiveState) { if (state != s) { state = s; onStateChanged?.invoke(s) } }

    private fun block(reason: String) {
        cancelAll(); transport.disconnect()
        blockedReason = reason; setState(LiveState.BLOCKED)
    }

    private fun cancelAll() {
        for (c in listOf(reconnectTimer, presenceTimer, watchdog, probeTimer, appliedTimer, pumpTimer)) c?.cancel()
        reconnectTimer = null; presenceTimer = null; watchdog = null; probeTimer = null; appliedTimer = null; pumpTimer = null
        for (p in pending.values) p.timer?.cancel()
    }

    private fun terminalLike() = state == LiveState.TERMINAL || state == LiveState.REVOKED || state == LiveState.BLOCKED || state == LiveState.IDLE

    // ------------------------------------------------------------------ 재연결
    private fun scheduleReconnect(minDelayMs: Long = 0) {
        if (terminalLike() || reconnectTimer != null) return
        if (state == LiveState.READY || state == LiveState.RESYNCING) setState(LiveState.DEGRADED)
        else if (state != LiveState.DEGRADED) setState(LiveState.CONNECTING)
        val base = minOf(30_000L, 500L shl minOf(attempts, 6))
        val jitter = (Math.random() * base * 0.2).toLong()
        val delay = maxOf(minDelayMs, minOf(30_000L, base + jitter))
        attempts++
        stopLiveTimers()
        reconnectTimer = sched.postDelayed(delay) { reconnectTimer = null; if (!terminalLike()) { setState(LiveState.CONNECTING); connectNow() } }
    }

    private fun stopLiveTimers() {
        presenceTimer?.cancel(); presenceTimer = null; watchdog?.cancel(); watchdog = null; probeTimer?.cancel(); probeTimer = null
        pumpTimer?.cancel(); pumpTimer = null
        metricInflight = false
        for (p in pending.values) { p.timer?.cancel(); p.timer = null; p.inflightSince = -1 }
    }

    private fun refreshThenReconnect() {
        if (refreshing || reconnectTimer != null || terminalLike()) return
        refreshing = true
        stopLiveTimers()
        sched.async({ tokens.refresh() }) { r ->
            refreshing = false
            when (val o = r.getOrNull() ?: RefreshOutcome.Transient) {
                is RefreshOutcome.Ok -> { refreshAttempts = 0; reconnectTimer = sched.postDelayed(0) { reconnectTimer = null; if (!terminalLike()) { setState(LiveState.CONNECTING); connectNow() } } }
                RefreshOutcome.Invalid -> block("auth_expired")
                RefreshOutcome.Transient -> {
                    val d = minOf(30_000L, 500L shl minOf(refreshAttempts++, 6))
                    setState(LiveState.DEGRADED)
                    reconnectTimer = sched.postDelayed(d) { reconnectTimer = null; refreshThenReconnect() }
                }
            }
        }
    }

    // ------------------------------------------------------------------ transport 콜백
    override fun onConnect() {
        if (terminalLike()) return
        connGen++
        resetSyncState()
        setState(LiveState.CONNECTING)
        transport.emit("live:hello", hello()) { res ->
            if (res == null) { scheduleReconnect(); return@emit }
            if (res.optBoolean("ok", false)) { join("connect") } else onProtocolError(res)
        }
    }

    override fun onDisconnect(reason: String) {
        if (terminalLike()) return
        stopLiveTimers()
        scheduleReconnect()
    }

    override fun onConnectError(message: String) {
        if (terminalLike()) return
        if (message.contains("token_expired")) refreshThenReconnect()
        else if (message.contains("token_mismatch")) block("account_mismatch")
        else scheduleReconnect()
    }

    private fun onProtocolError(res: JSONObject) {
        when (res.optString("code")) {
            "token_expired" -> refreshThenReconnect()
            "access_revoked" -> revoke()
            "upgrade_required", "protocol_v1_session", "v2_disabled" -> block(res.optString("code"))
            "join_denied" -> block("join_denied")
            else -> scheduleReconnect(res.optLong("retry_after_ms", 0))
        }
    }

    private fun revoke() { cancelAll(); transport.disconnect(); setState(LiveState.REVOKED) }

    private fun resetSyncState() {
        ackSnapshotId = null; gotSnapshotId = null; buffered.clear(); hbMismatch = 0
    }

    // ------------------------------------------------------------------ hello / join / snapshot
    private fun hello() = JSONObject()
        .put("protocol_version", 2).put("schema_version", 1)
        .put("supported_protocol_versions", JSONArray().put(2))
        .put("app_build", cfg.appBuild).put("client_instance_id", cfg.instanceId)
        .put("capabilities", JSONArray().put("native_background").put("paint_ack"))
        .put("core_version", cfg.coreVersion)

    private fun cursorList(): JSONArray {
        val a = JSONArray()
        for ((k, v) in cursors) { val (aud, dom) = k.split('|'); a.put(JSONObject().put("audience", aud).put("domain", dom).put("seq", java.lang.Long.toUnsignedString(v))) }
        return a
    }

    private fun join(reason: String) {
        setState(LiveState.RESYNCING)
        resetSyncState()
        val msg = JSONObject().put("protocol_version", 2).put("schema_version", 1).put("session_id", cfg.sessionId)
            .put("request_id", UUID.randomUUID().toString()).put("generation", connGen.toString())
            .put("last_cursors", cursorList()).put("entry_credential", JSONObject.NULL)
        transport.emit("live:join", msg) { res -> onJoinAck(res) }
    }

    private fun onJoinAck(res: JSONObject?) {
        if (res == null) { scheduleReconnect(); return }
        if (!res.optBoolean("ok", false)) { onProtocolError(res); return }
        ackSnapshotId = res.optString("snapshot_id").ifEmpty { null }
        epoch = res.optString("epoch", epoch)
    }

    /** 현재 연결 상태에서 완전 snapshot 을 다시 요청(속도 제한: 2초 1회). */
    fun resync(reason: String) {
        if (terminalLike() || state == LiveState.CONNECTING) return
        val now = sched.nowMs()
        if (now - lastResyncAtMs < 2_000) return
        lastResyncAtMs = now
        setState(LiveState.RESYNCING)
        resetSyncState()
        val msg = JSONObject().put("protocol_version", 2).put("schema_version", 1).put("session_id", cfg.sessionId)
            .put("reason", reason).put("request_id", UUID.randomUUID().toString()).put("last_cursors", cursorList())
        transport.emit("live:resync", msg) { res -> if (res != null) { if (res.optBoolean("ok", false)) onJoinAck(res) else onProtocolError(res) } }
    }

    private fun onSnapshot(s: JSONObject) {
        val id = s.optString("snapshot_id")
        if (ackSnapshotId != null && ackSnapshotId != id) return // 이전 join/resync 의 늦은 snapshot
        gotSnapshotId = id
        if (s.has("epoch")) epoch = s.optString("epoch", epoch)
        cursors.clear()
        val th = s.optJSONArray("through")
        if (th != null) for (i in 0 until th.length()) { val c = th.getJSONObject(i); cursors[c.getString("audience") + "|" + c.getString("domain")] = parseU64(c.getString("seq")) }
        // 본인 participant: member:<pid> audience
        val auds = s.optJSONArray("audiences")
        if (auds != null) for (i in 0 until auds.length()) { val a = auds.getString(i); if (a.startsWith("member:")) participantId = a.removePrefix("member:") }
        val devs = s.optJSONObject("devices")?.optJSONObject("entities")
        if (devs != null) for (k in devs.keys()) applyDeviceData(k, devs.getJSONObject(k).optJSONObject("data"))
        events.offer(JSONObject().put("kind", "snapshot").put("payload", s))
    }

    private fun onSyncComplete(d: JSONObject) {
        val id = d.optString("snapshot_id")
        if (id != gotSnapshotId || (ackSnapshotId != null && ackSnapshotId != id)) return
        val msg = appliedMsg().put("snapshot_id", id)
        transport.emit("live:applied", msg) { res ->
            if (res != null && res.optBoolean("ok", false)) onReady() else if (res != null) onProtocolError(res)
        }
    }

    private fun onReady() {
        if (state != LiveState.RESYNCING) return
        setState(LiveState.READY)
        attempts = 0
        lastHeartbeatAtMs = sched.nowMs()
        val buf = ArrayList(buffered); buffered.clear()
        for (e in buf) applyEvent(e)
        startPresence(); startWatchdog()
        flushCommands(); pump(); maybeScheduleProbe(1_000)
    }

    private fun appliedMsg() = JSONObject().put("protocol_version", 2).put("schema_version", 1)
        .put("session_id", cfg.sessionId).put("cursors", cursorList()).put("rendered_command_ids", JSONArray())

    // ------------------------------------------------------------------ 이벤트
    override fun onEvent(name: String, data: JSONObject?) {
        when (name) {
            "live:snapshot" -> if (data != null && !terminalLike()) onSnapshot(data)
            "live:sync_complete" -> if (data != null && !terminalLike()) onSyncComplete(data)
            "live:event" -> if (data != null && !terminalLike()) onLiveEvent(data)
            "live:heartbeat" -> onHeartbeat(data)
            "live:access_revoked" -> { events.offer(JSONObject().put("kind", "access_revoked").put("payload", data ?: JSONObject())); revoke() }
            "live:terminal" -> {
                endCutoff = data?.opt("end_cutoff_ms")?.toString()?.takeIf { it != "null" }
                events.offer(JSONObject().put("kind", "terminal").put("payload", data ?: JSONObject()))
                cancelAll(); transport.disconnect(); setState(LiveState.TERMINAL)
            }
            "live:resync_required" -> resync(data?.optString("reason", "server_request") ?: "server_request")
            "live:degraded" -> { if (state == LiveState.READY) setState(LiveState.DEGRADED) }
            "live:auth_expired" -> refreshAndReauth()
        }
    }

    private fun onLiveEvent(e: JSONObject) {
        if (state == LiveState.RESYNCING || state == LiveState.CONNECTING) {
            if (buffered.size >= 1000) { buffered.clear(); resync("buffer_overflow") } else buffered.add(e)
            return
        }
        applyEvent(e)
    }

    private fun applyEvent(e: JSONObject) {
        val ep = e.optString("epoch", epoch)
        if (ep != epoch && epoch != "0") { resync("epoch_changed"); return }
        val key = e.optString("audience") + "|" + e.optString("domain")
        val seq = parseU64(e.optString("seq", "0"))
        val last = cursors[key]
        if (last != null) {
            val cmp = java.lang.Long.compareUnsigned(seq, last)
            if (cmp <= 0) return // 중복
            if (seq != last + 1) { resync("seq_gap"); return }
        }
        cursors[key] = seq
        if (e.optString("domain") == "device") handleDevice(e)
        events.offer(e)
        appliedDirty = true
        if (appliedTimer == null) appliedTimer = sched.postDelayed(1_000) { appliedTimer = null; flushApplied() }
    }

    private fun flushApplied() {
        if (!appliedDirty || state != LiveState.READY) return
        appliedDirty = false
        transport.emit("live:applied", appliedMsg(), null)
    }

    private fun handleDevice(e: JSONObject) {
        val p = e.optJSONObject("payload") ?: return
        val sid = p.optString("stream_id").ifEmpty { return }
        val status = p.optString("status", "active")
        if (status == "active") {
            val pid = e.optString("entity_id")
            if (participantId == null || pid == participantId) {
                if (streamId != sid) { streamId = sid; anchorId = UUID.randomUUID().toString(); clockUncertaintyMs = 300_000.0 }
                ownerGeneration = p.optString("generation").ifEmpty { ownerGeneration }
                if (state == LiveState.READY) { maybeScheduleProbe(1_000); pump() }
            }
        } else if (sid == streamId) {
            onStreamSuperseded?.invoke(status) // fencing: 구 owner 는 live 갱신 금지
            streamId = null; ownerGeneration = null
        }
    }

    private fun applyDeviceData(entityId: String, data: JSONObject?) {
        if (data == null) return
        val sid = data.optString("stream_id").ifEmpty { return }
        if (data.optString("status", "active") == "active" && (participantId == null || entityId == participantId)) {
            streamId = sid; ownerGeneration = data.optString("generation").ifEmpty { ownerGeneration }
        }
    }

    private fun onHeartbeat(h: JSONObject?) {
        if (terminalLike()) return
        lastHeartbeatAtMs = sched.nowMs()
        if (h == null) return
        if (state == LiveState.DEGRADED) { resync("recovered"); return }
        if (h.has("epoch") && epoch != "0" && h.optString("epoch") != epoch) { resync("epoch_changed"); return }
        val th = h.optJSONArray("through") ?: return
        var behind = false
        for (i in 0 until th.length()) {
            val c = th.getJSONObject(i)
            val last = cursors[c.getString("audience") + "|" + c.getString("domain")] ?: continue
            if (java.lang.Long.compareUnsigned(parseU64(c.getString("seq")), last) > 0) behind = true
        }
        hbMismatch = if (behind) hbMismatch + 1 else 0
        if (hbMismatch >= 2) { hbMismatch = 0; resync("heartbeat_gap") }
    }

    // ------------------------------------------------------------------ presence / watchdog
    private fun startPresence() {
        presenceTimer?.cancel()
        presenceTimer = sched.postDelayed(5_000) { presenceTimer = null; if (state == LiveState.READY || state == LiveState.RESYNCING) { sendPresence(); startPresence() } }
    }

    private fun sendPresence() {
        val m = JSONObject().put("protocol_version", 2).put("schema_version", 1).put("session_id", cfg.sessionId)
            .put("instance_id", cfg.instanceId).put("lease_generation", connGen.toString()).put("visibility", visibility)
        streamId?.let { m.put("stream_id", it) }; ownerGeneration?.let { m.put("owner_generation", it) }
        transport.emit("live:presence", m, null)
    }

    private fun startWatchdog() {
        watchdog?.cancel()
        watchdog = sched.postDelayed(1_000) {
            watchdog = null
            if (state == LiveState.READY) {
                if (sched.nowMs() - lastHeartbeatAtMs >= 10_000) { stopLiveTimers(); transport.disconnect(); scheduleReconnect() }
                else startWatchdog()
            }
        }
    }

    // ------------------------------------------------------------------ 토큰 갱신(연결 중)
    private fun refreshAndReauth() {
        if (refreshing || terminalLike()) return
        refreshing = true
        sched.async({ tokens.refresh() }) { r ->
            refreshing = false
            when (val o = r.getOrNull() ?: RefreshOutcome.Transient) {
                is RefreshOutcome.Ok -> transport.emit("live:reauth", JSONObject().put("token", o.token)) { res ->
                    if (res != null && !res.optBoolean("ok", false)) onProtocolError(res)
                }
                RefreshOutcome.Invalid -> block("auth_expired")
                RefreshOutcome.Transient -> sched.postDelayed(1_000) { refreshAndReauth() }
            }
        }
    }

    // ------------------------------------------------------------------ 명령
    fun dispatch(cmd: JSONObject): DispatchResult {
        val c = JSONObject(cmd.toString())
        if (!c.has("command_id")) c.put("command_id", UUID.randomUUID().toString())
        if (!c.has("protocol_version")) c.put("protocol_version", 2)
        if (!c.has("schema_version")) c.put("schema_version", 1)
        if (!c.has("session_id")) c.put("session_id", cfg.sessionId)
        if (!c.has("expected_epoch")) c.put("expected_epoch", epoch)
        if (!c.has("client_generation")) c.put("client_generation", connGen.toString())
        val id = c.getString("command_id")
        if (pending.containsKey(id)) return DispatchResult(id, true, sched.nowMs())
        val p = Pending(c, sched.nowMs()); pending[id] = p
        // 30초 intent 유효기간: committed 로 확인된 명령은 제외
        sched.postDelayed(30_000) { expireIfStillPending(id) }
        if (state == LiveState.READY) sendCommand(id)
        return DispatchResult(id, true, p.queuedAt)
    }

    private fun expireIfStillPending(id: String) {
        val p = pending[id] ?: return
        if (p.committedHint) return
        p.timer?.cancel(); pending.remove(id)
        acks.offer(JSONObject().put("command_id", id).put("status", "rejected").put("epoch", epoch).put("cursors", JSONArray())
            .put("committed", false).put("code", "intent_expired"))
        resync("intent_expired") // 결과를 모르므로 snapshot 으로 정리
    }

    private fun flushCommands() { for (id in pending.keys.toList()) if (pending[id]?.inflightSince ?: 0 < 0) sendCommand(id) }

    private fun sendCommand(id: String) {
        val p = pending[id] ?: return
        if (state != LiveState.READY) return
        p.attempts++; p.inflightSince = sched.nowMs(); p.lastSentAt = p.inflightSince
        p.timer?.cancel()
        // 2초 ACK 타임아웃 → 같은 ID 로 0.5/1/2/4초(+지터) 뒤 재시도
        p.timer = sched.postDelayed(2_000) { onCommandTimeout(id) }
        transport.emit("live:command", p.cmd) { res -> onCommandAck(id, res) }
    }

    private fun onCommandTimeout(id: String) {
        val p = pending[id] ?: return
        p.timer = null; p.inflightSince = -1
        scheduleCommandRetry(id, 0)
    }

    private fun scheduleCommandRetry(id: String, retryAfterMs: Long) {
        val p = pending[id] ?: return
        val base = minOf(4_000L, 500L shl minOf(maxOf(p.attempts - 1, 0), 3))
        val delay = maxOf(retryAfterMs, base + (Math.random() * base * 0.1).toLong())
        p.timer?.cancel()
        p.timer = sched.postDelayed(delay) { p.timer = null; sendCommand(id) }
    }

    private fun onCommandAck(id: String, res: JSONObject?) {
        val p = pending[id] ?: return
        if (res == null) return
        p.inflightSince = -1; p.timer?.cancel(); p.timer = null
        if (!res.has("status")) { // 전송 오류 형태 {ok:false,...}
            scheduleCommandRetry(id, res.optLong("retry_after_ms", 0)); return
        }
        when (res.getString("status")) {
            "applied", "duplicate", "rejected" -> { pending.remove(id); acks.offer(res); lastAckSequence++ }
            else -> { // retryable
                if (res.optBoolean("committed", false)) p.committedHint = true // 새 ID 금지, ledger 결과 조회(같은 ID 재시도)
                scheduleCommandRetry(id, res.optLong("retry_after_ms", 0))
            }
        }
    }

    // ------------------------------------------------------------------ 지표 창
    fun onFrame(frame: JSONObject) {
        val seq = frame.optString("sequence").toLongOrNull() ?: return
        outbox.add(seq, frame)
        if (state == LiveState.READY) pump()
    }

    fun pump() {
        if (state != LiveState.READY || metricInflight) return
        val stream = streamId ?: return
        val pid = participantId ?: return
        val gen = ownerGeneration ?: return
        val batch = outbox.newestFirst(60).sortedBy { it.first } // 최신 배치 우선, 배치 안은 순번 오름차순
        if (batch.isEmpty()) return
        val windows = JSONArray()
        for ((_, f) in batch) windows.put(envelope(f, pid, stream, gen))
        val msg = JSONObject().put("protocol_version", 2).put("schema_version", 1).put("windows", windows)
        metricInflight = true
        pumpTimer?.cancel()
        pumpTimer = sched.postDelayed(2_000) { pumpTimer = null; metricInflight = false; pump() } // ACK 유실: 같은 순번 재전송(서버가 duplicate 처리)
        transport.emit("live:metric", msg) { res -> onMetricAck(res) }
    }

    private fun envelope(f: JSONObject, pid: String, stream: String, gen: String): JSONObject {
        val o = JSONObject()
        o.put("session_id", cfg.sessionId).put("participant_id", pid).put("stream_id", stream).put("stream_generation", gen)
        o.put("sequence", f.getString("sequence")).put("window_start_us", f.getString("window_start_us")).put("window_end_us", f.getString("window_end_us"))
        o.put("observed_at_ms", f.opt("observed_at_ms")).put("clock_anchor_id", anchorId).put("clock_uncertainty_ms", clockUncertaintyMs)
        o.put("device_profile_version", cfg.deviceProfile).put("algorithm_version", cfg.algorithmVersion).put("model_version", cfg.modelVersion)
        o.put("feature_hash", f.getString("feature_hash")).put("contact", f.opt("contact")).put("sqi", f.opt("sqi") ?: JSONObject.NULL).put("metrics", f.opt("metrics"))
        return o
    }

    private fun onMetricAck(res: JSONObject?) {
        pumpTimer?.cancel(); pumpTimer = null; metricInflight = false
        if (res == null) return
        val acks = res.optJSONArray("acks")
        var retry = !res.optBoolean("ok", true)
        if (acks != null) for (i in 0 until acks.length()) {
            val a = acks.getJSONObject(i)
            val seq = a.optString("sequence").toLongOrNull() ?: continue
            when (a.optString("status")) {
                "accepted", "duplicate" -> { outbox.ack(seq); lastAckSequence = maxOf(lastAckSequence, seq) }
                "rejected" -> { outbox.ack(seq) /* 영구 거절은 live 에서 제외, archive 가 보존 */ }
                else -> retry = true
            }
        }
        if (retry) pumpTimer = sched.postDelayed(1_000) { pumpTimer = null; pump() }
        else pump()
    }

    // ------------------------------------------------------------------ clock probe / reanchor / capture
    private fun maybeScheduleProbe(delayMs: Long) {
        if (probeTimer != null || state != LiveState.READY || streamId == null) return
        probeTimer = sched.postDelayed(delayMs) { probeTimer = null; sendProbe() }
    }

    private fun sendProbe() {
        if (state != LiveState.READY) return
        val sid = streamId ?: return
        val probeId = UUID.randomUUID().toString()
        val sentAt = sched.nowMs()
        val m = JSONObject().put("protocol_version", 2).put("schema_version", 1).put("probe_id", probeId)
            .put("client_monotonic_us", (sentAt * 1000).toString()).put("server_receive_ms", JSONObject.NULL).put("server_send_ms", JSONObject.NULL)
        transport.emit("live:clock_probe", m) { res ->
            if (res != null && res.optBoolean("ok", false)) {
                val rtt = (sched.nowMs() - sentAt).coerceAtLeast(0)
                clockUncertaintyMs = (rtt / 2.0 + 5.0).coerceAtMost(300_000.0)
                val a = anchorProvider?.invoke()
                if (a != null) {
                    anchorId = UUID.randomUUID().toString()
                    dispatch(JSONObject().put("kind", "capture.reanchor").put("payload", JSONObject()
                        .put("stream_id", sid).put("clock_probe_id", probeId).put("device_ticks", a.first).put("monotonic_us", a.second)))
                }
            }
        }
        probeTimer = sched.postDelayed(5 * 60_000L) { probeTimer = null; sendProbe() } // 5분마다 재앵커
    }

    /** capture.start 명령(EEG 동의·본인). stream_id 는 이후 device.changed 이벤트로 도착한다. */
    fun startCapture(): DispatchResult = dispatch(JSONObject().put("kind", "capture.start").put("payload", JSONObject()
        .put("device_profile", cfg.deviceProfile).put("algorithm_version", cfg.algorithmVersion).put("model_version", cfg.modelVersion)))

    fun closeCapture(finalSequences: JSONObject, reason: String): DispatchResult? {
        val sid = streamId ?: return null
        return dispatch(JSONObject().put("kind", "capture.close").put("payload", JSONObject()
            .put("stream_id", sid).put("final_sequences", finalSequences).put("reason", reason)))
    }

    /** device 상태(밴드/접촉/SQI/배터리) 전송. READY 아닐 때는 버린다(상태는 최신값만 의미). */
    fun sendDevice(deviceSeq: Long, bandState: String, contact: JSONObject, sqi: Double?, batteryPct: Int?, reason: String?) {
        val sid = streamId ?: return
        if (state != LiveState.READY) return
        val m = JSONObject().put("protocol_version", 2).put("schema_version", 1).put("session_id", cfg.sessionId).put("stream_id", sid)
            .put("device_seq", deviceSeq.toString()).put("band_state", bandState).put("contact", contact)
            .put("sqi", sqi ?: JSONObject.NULL).put("battery_pct", batteryPct ?: JSONObject.NULL).put("state_reason", reason ?: JSONObject.NULL)
        transport.emit("live:device", m, null)
    }

    // ------------------------------------------------------------------ 진단
    fun socketStatus(): String = when (state) {
        LiveState.READY -> "ready"; LiveState.DEGRADED -> "degraded"
        LiveState.CONNECTING, LiveState.RESYNCING -> "connecting"; else -> "disconnected"
    }
    fun cursorsSnapshot(): JSONArray = cursorList()
    fun pendingCommands(): Int = pending.size

    private fun parseU64(s: String): Long = try { java.lang.Long.parseUnsignedLong(s) } catch (_: Exception) { 0L }
}
