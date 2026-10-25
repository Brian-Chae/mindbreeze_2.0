package com.looxidlabs.mindbreeze.measurement

import android.os.SystemClock
import org.json.JSONObject
import java.io.File

enum class MeasurementState { IDLE, ARMING, CAPTURING, RECONNECTING, SEALING, CLOSED, BLOCKED }

/**
 * 패킷 수신 → journal(fsync) → (Rust 코어 | 간이 프레임) → 카운터. BLE/Android 에 의존하지 않아 JVM 단위 시험이 가능하다.
 * core 가 주어지면 실제 MetricFrame(JSON)을 frameSink 로 내보내고, 없으면 SPIKE 간이 프레임을 쓴다(기능 플래그 off 경로).
 */
class MeasurementEngine(
    private val journalFile: File,
    private val clockMs: () -> Long = { SystemClock.elapsedRealtime() },
    private val syncEach: Boolean = true,
    core: MeasurementCore? = null,
    /** 체크포인트 파일(없으면 비활성). 프로세스 재생성 시 journal 전체 대신 꼬리만 재생한다. */
    private val checkpointFile: File? = null,
    private val checkpointEveryPackets: Int = 0,
    /** 코어에 넘기는 (벽시계 ms, 그 순간의 단조 µs) 앵커. 단조 시각은 clockMs 와 같은 시계여야 한다. */
    private val wallAnchorMs: Long = System.currentTimeMillis(),
    private val anchorMonoUs: Long = clockMs() * 1000,
) {
    private val core: MeasurementCore? = core
    private val wallAnchor = wallAnchorMs
    private val anchorMono = anchorMonoUs
    private var packetsSinceCheckpoint = 0
    /** 복구 중 재생해서 만들어진 프레임(아직 sink 로 전달되지 않음). replayPending() 이 전달한다. */
    private var replayBuffer: List<JSONObject> = emptyList()
    val counters = MeasurementCounters()
    val fence = InstanceFence()
    private val unwrap = TickUnwrapper()
    private val tickUnwrapForAnchor = TickUnwrapper()
    private val framer = MetricFramer()
    private var journal: AppendOnlyJournal? = null
    @Volatile var lastFrame: MetricFrame? = null
        private set
    /** 코어가 낸 최신 프레임(JSON). */
    @Volatile var lastCoreFrame: JSONObject? = null
        private set
    /** 프레임이 생길 때마다 호출(같은 스레드). 업로더·소켓 큐가 구독한다. */
    @Volatile var frameSink: ((JSONObject) -> Unit)? = null
    @Volatile var coreError: String? = null
        private set
    /** 마지막 EEG 패킷의 (wrap 확장 device tick, 도착 단조 µs) — capture.reanchor 의 장치 시각 쌍. */
    @Volatile var lastEegAnchor: Pair<Long, Long>? = null
        private set

    /** 열면서 기존 journal 레코드 수를 돌려준다(프로세스 재생성 후 이어쓰기에서 사용). */
    fun open(): Long { val j = AppendOnlyJournal.open(journalFile, syncEach); journal = j; return j.count }

    /** 세대(gen)가 현재가 아니면 폐기. 반환: 처리됐는지. */
    @Synchronized
    fun onNotification(gen: Long, sensor: Sensor, bytes: ByteArray): Boolean {
        val now = clockMs()
        if (!counters.acceptNotification(fence, gen, sensor, bytes.size, now)) return false
        val j = journal ?: return false
        // 원문 먼저 영속화 후 파싱(파싱 실패 원문도 보관)
        j.append(JournalRecord(sensor, now, bytes)); counters.journaled()
        when (val r = PacketParser.parse(sensor, bytes)) {
            is ParseResult.Invalid -> counters.invalid()
            is ParseResult.Ok -> {
                counters.samples(sensor, r.packet.sampleCount)
                if (sensor == Sensor.EEG) lastEegAnchor = tickUnwrapForAnchor.unwrap(sensor, r.packet.rawTick) to now * 1000
            }
        }
        if (core != null) pushCore(sensor, bytes, now) else legacyFrame(sensor, bytes)
        return true
    }

    private fun pushCore(sensor: Sensor, bytes: ByteArray, nowMs: Long) {
        try {
            val out = core!!.pushRaw(sensor, bytes, nowMs * 1000, wallAnchor, anchorMono)
            emit(out.frames)
            maybeCheckpoint()
        } catch (e: CoreException) {
            coreError = e.message // 원문은 이미 journal 에 있다 — 코어 실패가 수집을 멈추지 않는다.
            counters.invalid()
        }
    }

    private fun maybeCheckpoint() {
        val f = checkpointFile ?: return
        if (checkpointEveryPackets <= 0 || ++packetsSinceCheckpoint < checkpointEveryPackets) return
        packetsSinceCheckpoint = 0
        writeCheckpoint(f)
    }

    /** [journal 레코드 수 u64][코어 체크포인트] 를 원자적으로 기록. 이 시점까지의 journal 은 코어 상태에 반영돼 있다. */
    @Synchronized
    fun writeCheckpoint(target: File? = null) {
        val f = target ?: checkpointFile ?: return
        val ck = try { core?.checkpoint() } catch (e: CoreException) { coreError = e.message; null } ?: return
        val tmp = File(f.path + ".tmp")
        java.io.FileOutputStream(tmp).use {
            it.write(java.nio.ByteBuffer.allocate(8).putLong(journalCount).array()); it.write(ck); it.flush(); it.fd.sync()
        }
        tmp.renameTo(f)
    }

    /** 복구 재생으로 만들어진 프레임을 sink 로 전달(중복은 수신 측 outbox 가 순번으로 거른다). */
    @Synchronized
    fun replayPending() { val b = replayBuffer; replayBuffer = emptyList(); emit(b) }

    private fun emit(frames: List<JSONObject>) {
        for (f in frames) {
            lastCoreFrame = f
            counters.frame(f.optString("sequence", "0").toLongOrNull() ?: 0L)
            frameSink?.invoke(f)
        }
    }

    private fun legacyFrame(sensor: Sensor, bytes: ByteArray) {
        val p = (PacketParser.parse(sensor, bytes) as? ParseResult.Ok)?.packet ?: return
        if (sensor == Sensor.EEG) {
            val ext = p.copy(rawTick = unwrap.unwrap(sensor, p.rawTick))
            for (f in framer.onPacket(ext)) { lastFrame = f; counters.frame(f.windowIndex) }
        }
    }

    /** 데이터가 끊긴 동안 gap 프레임을 만든다(주기 호출). */
    @Synchronized
    fun advance(): List<JSONObject> {
        val c = core ?: return emptyList()
        return try { val fr = c.advance(clockMs() * 1000); emit(fr); fr } catch (e: CoreException) { coreError = e.message; emptyList() }
    }

    /** 종료 시 서버에 알릴 최종 순번(코어가 센 값). 핸들은 닫지 않는다. */
    @Synchronized
    fun finalSequences(): JSONObject? = try {
        val c = counters.snapshot()
        JSONObject().put("eeg", c.eegSamples.toString()).put("ppg", c.ppgSamples.toString()).put("acc", c.accSamples.toString()).put("metric", c.frames.toString())
    } catch (_: Exception) { null }

    @Synchronized fun checkpoint(): ByteArray? = try { core?.checkpoint() } catch (_: CoreException) { null }

    @Synchronized fun close() { journal?.close(); journal = null }
    val journalCount get() = journal?.count ?: 0L
    val journalBytes get() = journal?.bytesWritten ?: 0L

    companion object {
        /**
         * 프로세스 재생성 후 복구: journal 의 찢긴 꼬리를 절단하고, 유효한 체크포인트가 있으면 복원 후 그 뒤 꼬리만, 없거나 손상됐으면 처음부터 재생한다.
         * 재생 결과 프레임은 replayPending() 이 부를 때까지 보관한다. 이어쓰기는 같은 journal 파일에 한다.
         */
        fun openOrResume(
            journalFile: File, checkpointFile: File,
            clockMs: () -> Long = { SystemClock.elapsedRealtime() }, syncEach: Boolean = true,
            wallAnchorMs: Long = System.currentTimeMillis(), anchorMonoUs: Long = clockMs() * 1000,
            checkpointEveryPackets: Int = 300, configJson: String = MeasurementCore.DEFAULT_CONFIG,
        ): MeasurementEngine {
            val rec = AppendOnlyJournal.recover(journalFile) // 꼬리 절단 포함
            var core: MeasurementCore? = null
            var start = 0
            if (checkpointFile.exists() && checkpointFile.length() > 8) {
                try {
                    val raw = checkpointFile.readBytes()
                    val idx = java.nio.ByteBuffer.wrap(raw, 0, 8).long
                    if (idx in 0..rec.records.size.toLong()) {
                        core = MeasurementCore.restore(configJson, raw.copyOfRange(8, raw.size)); start = idx.toInt()
                    }
                } catch (_: CoreException) { core = null; start = 0 }
            }
            val c = core ?: MeasurementCore.create(configJson)
            val buf = ArrayList<JSONObject>()
            for (i in start until rec.records.size) {
                val r = rec.records[i]
                try { buf += c.pushRaw(r.sensor, r.payload, r.arrivalMonoMs * 1000, wallAnchorMs, anchorMonoUs).frames } catch (_: CoreException) { /* 원문은 보존됨 */ }
            }
            val e = MeasurementEngine(journalFile, clockMs, syncEach, c, checkpointFile, checkpointEveryPackets, wallAnchorMs, anchorMonoUs)
            e.replayBuffer = buf
            e.open()
            return e
        }
    }
}
