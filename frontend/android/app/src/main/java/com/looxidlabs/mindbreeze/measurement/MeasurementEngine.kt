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
    private val core: MeasurementCore? = null,
    /** 코어에 넘기는 (벽시계 ms, 그 순간의 단조 µs) 앵커. 단조 시각은 clockMs 와 같은 시계여야 한다. */
    private val wallAnchorMs: Long = System.currentTimeMillis(),
    private val anchorMonoUs: Long = clockMs() * 1000,
) {
    val counters = MeasurementCounters()
    val fence = InstanceFence()
    private val unwrap = TickUnwrapper()
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
            is ParseResult.Ok -> counters.samples(sensor, r.packet.sampleCount)
        }
        if (core != null) pushCore(sensor, bytes, now) else legacyFrame(sensor, bytes)
        return true
    }

    private fun pushCore(sensor: Sensor, bytes: ByteArray, nowMs: Long) {
        try {
            val out = core!!.pushRaw(sensor, bytes, nowMs * 1000, wallAnchorMs, anchorMonoUs)
            emit(out.frames)
        } catch (e: CoreException) {
            coreError = e.message // 원문은 이미 journal 에 있다 — 코어 실패가 수집을 멈추지 않는다.
            counters.invalid()
        }
    }

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

    @Synchronized fun checkpoint(): ByteArray? = try { core?.checkpoint() } catch (_: CoreException) { null }

    @Synchronized fun close() { journal?.close(); journal = null }
    val journalCount get() = journal?.count ?: 0L
    val journalBytes get() = journal?.bytesWritten ?: 0L
}
