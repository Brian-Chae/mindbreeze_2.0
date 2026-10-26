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
    private val wallMs: () -> Long = { System.currentTimeMillis() },
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
    @Volatile var lastAckSequence: Long = -1
        private set
    /** capture.start/renew ACK result.lease.expires_at_ms. */
    @Volatile var leaseExpiresAtMs: Long? = null
        private set
    /** 서버가 우리 stream 을 끝낸 상태(closed/superseded/ended/revoked). null 이면 진행 중이거나 아직 없음. 끝난 뒤에는 자동 재캡처하지 않는다. */
    @Volatile var streamEnded: String? = null
        private set
    /** (status, cutoff_code) — 측정 정지·봉인 신호. 직렬 컨텍스트에서 호출된다. */
    @Volatile var onStreamEnded: ((String, String?) -> Unit)? = null

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
    // live:device 보고(최신값만 의미). device_seq 는 같은 stream 안에서 단조(서버가 작거나 같으면 duplicate).
    private var lastDeviceSeq = 0L
    private var pendingDevice: JSONObject? = null
    private var deviceInflight = false
    private var deviceTimer: Cancelable? = null
    private var deviceStoppedFor: String? = null
    private var renewTimer: Cancelable? = null

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
        for (c in listOf(reconnectTimer, presenceTimer, watchdog, probeTimer, appliedTimer, pumpTimer, deviceTimer, renewTimer)) c?.cancel()
        reconnectTimer = null; presenceTimer = null; watchdog = null; probeTimer = null; appliedTimer = null; pumpTimer = null; deviceTimer = null; renewTimer = null
        deviceInflight = false
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
        deviceTimer?.cancel(); deviceTimer = null; deviceInflight = false
        renewTimer?.cancel(); renewTimer = null
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
        // participant_id 는 capture.start ACK result 에서만 얻는다(T05b: snapshot audiences 추출 금지).
        // devices 는 재연결 사이에 놓친 우리 stream 의 종료/교체만 반영한다(새 stream 채택은 ACK 로만).
        val devs = s.optJSONObject("devices")?.optJSONObject("entities")
        if (devs != null) for (k in devs.keys()) devs.getJSONObject(k).optJSONObject("data")?.let { applyDeviceState(k, it) }
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
        flushCommands(); pump(); maybeScheduleProbe(1_000); flushDevice(); scheduleRenew()
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
            "live:access_revoked" -> {
                events.offer(JSONObject().put("kind", "access_revoked").put("payload", data ?: JSONObject()))
                // 추방·권한 회수: 이 회차의 capture 도 끝났다(이후 창은 서버가 거절). device.changed 를 기다리지 않고 정지·봉인.
                if (streamId != null) endStream("revoked", data?.optString("code")?.ifEmpty { null })
                revoke()
            }
            "live:terminal" -> {
                endCutoff = data?.opt("end_cutoff_ms")?.toString()?.takeIf { it != "null" }
                events.offer(JSONObject().put("kind", "terminal").put("payload", data ?: JSONObject()))
                // 회차 종료: live:terminal 이 device.changed 보다 먼저 오면 이후 이벤트는 버려지므로 여기서 정지·봉인한다(실측 결함).
                if (streamId != null) endStream("ended", data?.optString("code")?.ifEmpty { null })
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
        applyDeviceState(e.optString("entity_id"), p)
    }

    /**
     * device.changed(합집합 스키마) 소비. stream 수명 필드(generation·status·cutoff_code)만 본다 — 밴드 필드는 상태 표시용이며 부재 = 미보고.
     *  - 우리 stream 의 status≠active 또는 cutoff_code 가 있으면 측정 정지·봉인(onStreamEnded).
     *  - 같은 participant 의 다른 stream 이 더 큰 generation(u64 비교)으로 active 면 우리 stream 은 superseded.
     *  - 다른 participant·형식 위반 generation(숫자·선행 0·범위 초과)은 무시한다.
     */
    private fun applyDeviceState(entityId: String, p: JSONObject) {
        val mine = streamId ?: return
        val pid = participantId ?: return
        if (entityId != pid) return
        val sid = p.optString("stream_id").ifEmpty { return }
        val status = p.optString("status").ifEmpty { null }
        val cutoff = if (p.isNull("cutoff_code")) null else p.optString("cutoff_code").ifEmpty { null }
        if (sid == mine) {
            when {
                status != null && status != "active" -> endStream(status, cutoff)
                cutoff != null -> endStream(status ?: "ended", cutoff)
            }
            return
        }
        if (status != "active") return
        val theirs = parseU64Strict(p.opt("generation")) ?: return
        val ours = ownerGeneration ?: return
        if (java.lang.Long.compareUnsigned(java.lang.Long.parseUnsignedLong(theirs), java.lang.Long.parseUnsignedLong(ours)) > 0) endStream("superseded", cutoff)
    }

    private fun endStream(status: String, cutoff: String?) {
        streamEnded = status
        streamId = null; ownerGeneration = null; leaseExpiresAtMs = null
        probeTimer?.cancel(); probeTimer = null
        renewTimer?.cancel(); renewTimer = null
        pendingDevice = null; deviceTimer?.cancel(); deviceTimer = null; deviceInflight = false
        onStreamEnded?.invoke(status, cutoff) // fencing: 구 owner 는 live 갱신 금지, 수집분은 봉인해 archive 로
    }

    /** capture.start/renew ACK result 채택(T05b). 형식이 틀리면(u64 문자열 아님) 채택하지 않는다. */
    private fun adoptCaptureResult(kind: String, r: JSONObject) {
        val sid = r.optString("stream_id").ifEmpty { return }
        if (r.has("generation") && parseU64Strict(r.opt("generation")) == null) return
        val gen = parseU64Strict(r.opt("owner_generation") ?: r.opt("generation")) ?: return
        if (kind == "capture.renew" && sid != streamId) return
        if (kind == "capture.start") {
            val pid = r.optString("participant_id").ifEmpty { return }
            val cur = ownerGeneration
            if (streamId != null && streamId != sid && cur != null &&
                java.lang.Long.compareUnsigned(java.lang.Long.parseUnsignedLong(gen), java.lang.Long.parseUnsignedLong(cur)) < 0) return
            if (streamId != sid) { anchorId = UUID.randomUUID().toString(); clockUncertaintyMs = 300_000.0; lastDeviceSeq = 0; deviceStoppedFor = null }
            streamId = sid; participantId = pid; streamEnded = null
        }
        ownerGeneration = gen
        r.optJSONObject("lease")?.let { l -> if (l.has("expires_at_ms")) leaseExpiresAtMs = l.optLong("expires_at_ms") }
        if (state == LiveState.READY) { maybeScheduleProbe(1_000); pump(); flushDevice(); scheduleRenew() }
    }

    /**
     * capture lease 갱신(서버 CAPTURE_LEASE_SECONDS=30). 실측 결함: 갱신이 없으면 30초 뒤 lease 가 끝나 live 투영이 멈추고
     * offline bound 판정으로 넘어간다. READY 동안 10초마다 capture.renew(같은 ID 재시도는 dispatch 가 맡는다), 이전 갱신이 미확정이면 쌓지 않는다.
     */
    private fun scheduleRenew() {
        if (renewTimer != null || state != LiveState.READY || streamId == null) return
        renewTimer = sched.postDelayed(RENEW_INTERVAL_MS) {
            renewTimer = null
            val sid = streamId; val gen = ownerGeneration
            if (state == LiveState.READY && sid != null && gen != null) {
                if (pending.values.none { it.cmd.optString("kind") == "capture.renew" })
                    dispatch(JSONObject().put("kind", "capture.renew").put("payload", JSONObject()
                        .put("stream_id", sid).put("owner_generation", gen).put("clock_anchor_id", anchorId)))
                scheduleRenew()
            }
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
            "applied", "duplicate", "rejected" -> {
                pending.remove(id)
                val kind = p.cmd.optString("kind")
                if (res.getString("status") != "rejected" && (kind == "capture.start" || kind == "capture.renew")) res.optJSONObject("result")?.let { adoptCaptureResult(kind, it) }
                acks.offer(res); lastAckSequence++
            }
            else -> { // retryable
                if (res.optBoolean("committed", false)) p.committedHint = true // 새 ID 금지, ledger 결과 조회(같은 ID 재시도)
                scheduleCommandRetry(id, res.optLong("retry_after_ms", 0))
            }
        }
    }

    // ------------------------------------------------------------------ 지표 창
    fun onFrame(frame: JSONObject) {
        val seq = frame.optString("sequence").toLongOrNull() ?: return
        // T05b: sequence ≤ 2^31−1 (서버 entity_version = generation<<31 | sequence). 범위 밖은 live 에서 격리.
        if (seq < 0 || seq > MAX_SEQUENCE) { outbox.quarantine(seq, "sequence_out_of_range"); return }
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
        val sentSeqs = batch.map { it.first }
        val msg = JSONObject().put("protocol_version", 2).put("schema_version", 1).put("windows", windows)
        metricInflight = true
        pumpTimer?.cancel()
        pumpTimer = sched.postDelayed(2_000) { pumpTimer = null; metricInflight = false; pump() } // ACK 유실: 같은 순번 재전송(서버가 duplicate 처리)
        transport.emit("live:metric", msg) { res -> onMetricAck(sentSeqs, res) }
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

    /**
     * live:metric 응답(T05b). 창별: accepted/duplicate(durable) 만 제거, rejected 는 재전송해도 같은 결과라 격리(코드별 카운터),
     * retryable 은 유지·재전송. 배치 오류 {ok:false}: not_ready·*_ingest_unavailable(또는 서버가 retryable=true 로 표시한 일시 장애)만
     * 재시도하고, 그 밖의 배치 거절(검증 실패·forbidden)은 보낸 창 전부를 격리해 재전송 루프를 막는다.
     */
    private fun onMetricAck(sent: List<Long>, res: JSONObject?) {
        pumpTimer?.cancel(); pumpTimer = null; metricInflight = false
        if (res == null) return
        var retry = false
        var retryAfter = 1_000L
        val acks = res.optJSONArray("acks")
        if (acks == null) {
            val code = res.optString("code").ifEmpty { "unknown" }
            if (isRetryableError(res)) { retry = true; retryAfter = res.optLong("retry_after_ms", 1_000L).coerceIn(100L, 60_000L) }
            else for (seq in sent) outbox.quarantine(seq, code)
        } else for (i in 0 until acks.length()) {
            val a = acks.getJSONObject(i)
            val seq = a.optString("sequence").toLongOrNull() ?: continue
            when (a.optString("status")) {
                "accepted", "duplicate" ->
                    if (a.optBoolean("durable", false)) { outbox.ack(seq); lastAckSequence = maxOf(lastAckSequence, seq) } else retry = true
                "rejected" -> outbox.quarantine(seq, a.optString("code").ifEmpty { "rejected" })
                else -> retry = true
            }
        }
        if (retry) pumpTimer = sched.postDelayed(retryAfter) { pumpTimer = null; pump() }
        else pump()
    }

    private fun isRetryableError(res: JSONObject): Boolean {
        val code = res.optString("code")
        return code == "not_ready" || code.endsWith("_ingest_unavailable") || res.optBoolean("retryable", false)
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

    /** capture.start 명령(EEG 동의·본인). stream_id·participant_id·owner_generation·lease 는 ACK result 로 바로 온다(T05b). */
    fun startCapture(): DispatchResult = dispatch(JSONObject().put("kind", "capture.start").put("payload", JSONObject()
        .put("device_profile", cfg.deviceProfile).put("algorithm_version", cfg.algorithmVersion).put("model_version", cfg.modelVersion)))

    fun closeCapture(finalSequences: JSONObject, reason: String): DispatchResult? {
        val sid = streamId ?: return null
        return dispatch(JSONObject().put("kind", "capture.close").put("payload", JSONObject()
            .put("stream_id", sid).put("final_sequences", finalSequences).put("reason", reason)))
    }

    /** 서버가 끝낸 stream 이 있거나 이미 진행 중이면 새 capture.start 를 보내지 않는다(추방·동의철회·종료 후 자동 재캡처 금지). */
    fun startCaptureIfAllowed(): DispatchResult? = if (streamEnded != null || streamId != null) null else startCapture()

    /**
     * live:device 보고(Device wire 스키마). 최신값만 의미가 있어 마지막 보고 하나만 보관·재시도한다.
     * device_seq 는 같은 stream 안에서 단조: max(직전+1, 벽시계 ms) — 재시작 후에도 이전 값보다 커진다.
     * 서버가 stream_not_active(superseded 등)/stream_not_found 로 답하면 그 stream 에 대한 보고를 멈춘다.
     */
    fun reportDevice(bandState: String, contact: JSONObject, sqi: Double?, batteryPct: Int?, reason: String?) {
        val sid = streamId ?: return
        if (deviceStoppedFor == sid) return
        lastDeviceSeq = maxOf(lastDeviceSeq + 1, wallMs())
        pendingDevice = JSONObject().put("protocol_version", 2).put("schema_version", 1).put("session_id", cfg.sessionId).put("stream_id", sid)
            .put("device_seq", java.lang.Long.toUnsignedString(lastDeviceSeq)).put("band_state", bandState).put("contact", contact)
            .put("sqi", sqi ?: JSONObject.NULL).put("battery_pct", batteryPct ?: JSONObject.NULL).put("state_reason", reason ?: JSONObject.NULL)
        flushDevice()
    }

    private fun flushDevice() {
        if (state != LiveState.READY || deviceInflight || deviceTimer != null) return
        val m = pendingDevice ?: return
        if (m.getString("stream_id") != streamId) { pendingDevice = null; return }
        deviceInflight = true
        deviceTimer = sched.postDelayed(2_000) { deviceTimer = null; deviceInflight = false; flushDevice() } // ACK 유실: 같은 device_seq 재전송(서버 duplicate)
        transport.emit("live:device", m) { res -> onDeviceAck(m, res) }
    }

    private fun onDeviceAck(sent: JSONObject, res: JSONObject?) {
        if (res == null) return
        deviceTimer?.cancel(); deviceTimer = null; deviceInflight = false
        val status = res.optString("status")
        if (status == "accepted" || status == "duplicate") {
            if (pendingDevice === sent) pendingDevice = null
            flushDevice(); return
        }
        val code = res.optString("code")
        when {
            code == "stream_not_active" || code == "stream_not_found" -> { deviceStoppedFor = sent.getString("stream_id"); pendingDevice = null }
            isRetryableError(res) ->
                deviceTimer = sched.postDelayed(res.optLong("retry_after_ms", 1_000L).coerceIn(100L, 60_000L)) { deviceTimer = null; flushDevice() }
            else -> if (pendingDevice === sent) pendingDevice = null // 검증 실패 등: 같은 값 재전송 금지
        }
    }

    // ------------------------------------------------------------------ 진단
    fun socketStatus(): String = when (state) {
        LiveState.READY -> "ready"; LiveState.DEGRADED -> "degraded"
        LiveState.CONNECTING, LiveState.RESYNCING -> "connecting"; else -> "disconnected"
    }
    fun cursorsSnapshot(): JSONArray = cursorList()
    fun pendingCommands(): Int = pending.size

    private fun parseU64(s: String): Long = try { java.lang.Long.parseUnsignedLong(s) } catch (_: Exception) { 0L }

    companion object {
        const val MAX_SEQUENCE = 2_147_483_647L
        const val RENEW_INTERVAL_MS = 10_000L
        private val U64 = Regex("^(0|[1-9][0-9]{0,19})$")

        /** 계약 U64(십진 문자열, 선행 0 금지, ≤ 2^64−1). JSON 숫자는 거부(정수 가정 금지). 정상값은 그대로 문자열로 돌려준다. */
        fun parseU64Strict(v: Any?): String? {
            if (v !is String || !U64.matches(v)) return null
            return try { java.lang.Long.parseUnsignedLong(v); v } catch (_: NumberFormatException) { null }
        }
    }
}
