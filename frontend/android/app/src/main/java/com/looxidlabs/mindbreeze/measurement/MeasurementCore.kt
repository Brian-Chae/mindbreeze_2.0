package com.looxidlabs.mindbreeze.measurement

import com.sun.jna.Library
import com.sun.jna.Native
import com.sun.jna.Pointer
import com.sun.jna.Structure
import com.sun.jna.ptr.LongByReference
import org.json.JSONArray
import org.json.JSONObject

/** Rust 코어 오류. status = McStatus(0 ok · 1 invalid_handle · 3 invalid_config · 4 checkpoint_corrupt · 5 panic_contained · 7 invalid_argument). */
class CoreException(val status: Int, val code: String, message: String) : RuntimeException("core[$status/$code]: $message")

/** `include/measurement_core.h` 의 McBuffer. 코어 소유 — 반드시 mc_buffer_free 로 해제. */
@Structure.FieldOrder("data", "len")
open class McBuffer : Structure() {
    @JvmField var data: Pointer? = null
    @JvmField var len: Long = 0
}

/** C ABI 선언(size_t/uint64 는 arm64 전용이므로 Long). */
internal interface CoreLib : Library {
    fun mc_abi_version(): Int
    fun mc_create(cfg: ByteArray, len: Long, outHandle: LongByReference, outErr: McBuffer): Int
    fun mc_restore(cfg: ByteArray, len: Long, ck: ByteArray, ckLen: Long, outHandle: LongByReference, outErr: McBuffer): Int
    fun mc_set_model(handle: Long, model: ByteArray, len: Long, out: McBuffer): Int
    fun mc_push_packet_raw(handle: Long, sensor: Byte, bytes: ByteArray, len: Long, arrivalUs: Long, wallMs: Long, anchorMonoUs: Long, out: McBuffer): Int
    fun mc_advance(handle: Long, monoUs: Long, out: McBuffer): Int
    fun mc_checkpoint(handle: Long, out: McBuffer): Int
    fun mc_close(handle: Long, out: McBuffer): Int
    fun mc_destroy(handle: Long): Int
    fun mc_buffer_free(buf: McBuffer)
}

/** push 결과: 패킷 상태 + 1Hz 격자 프레임(0..n). */
data class CoreOutput(val status: String, val segment: Int, val extendedTicks: String?, val samples: Int, val frames: List<JSONObject>, val errorCode: String)

/**
 * 공유 Rust 측정 코어 JNI(JNA) 래퍼. 핸들 하나 = 코어 상태기계 하나.
 * 모든 호출은 직렬화되며(코어는 &mut), 닫힌 핸들 재사용은 CoreException.
 */
class MeasurementCore private constructor(private var handle: Long) {
    @Synchronized
    private fun live(): Long = if (handle == 0L) throw CoreException(1, "invalid_handle", "closed") else handle

    @Synchronized
    fun setModel(paramsJson: String) { call { buf -> lib().mc_set_model(live(), paramsJson.toByteArray(), paramsJson.toByteArray().size.toLong(), buf) } }

    @Synchronized
    fun pushRaw(sensor: Sensor, bytes: ByteArray, arrivalUs: Long, wallMs: Long, anchorMonoUs: Long): CoreOutput {
        val code = (sensor.id - 1).toByte() // 코어: 0=eeg 1=ppg 2=acc
        val json = call { buf -> lib().mc_push_packet_raw(live(), code, bytes, bytes.size.toLong(), arrivalUs, wallMs, anchorMonoUs, buf) }
        val o = JSONObject(json)
        val p = o.getJSONObject("packet")
        return CoreOutput(
            p.getString("status"), p.getInt("segment"), if (p.isNull("extended_ticks")) null else p.getString("extended_ticks"),
            p.getInt("samples"), jsonList(o.getJSONArray("frames")), o.getJSONObject("error").getString("code"),
        )
    }

    /** 시간 경과 처리(데이터가 없을 때 gap 프레임). */
    @Synchronized
    fun advance(monoUs: Long): List<JSONObject> = jsonList(JSONArray(call { buf -> lib().mc_advance(live(), monoUs, buf) }))

    @Synchronized
    fun checkpoint(): ByteArray = callBytes { buf -> lib().mc_checkpoint(live(), buf) }

    /** 세션 종료 FinalManifest. 핸들은 해제된다. */
    @Synchronized
    fun close(): JSONObject {
        val h = live()
        val json = call { buf -> lib().mc_close(h, buf) }
        handle = 0
        return JSONObject(json)
    }

    @Synchronized
    fun destroy() { if (handle != 0L) { lib().mc_destroy(handle); handle = 0 } }

    companion object {
        /** 계약 CoreConfig 기본값(legacy_cohort · 웹 TS 동등 · 마지막 샘플 anchor). */
        const val DEFAULT_CONFIG = "{\"abi_version\":1,\"device_profile_version\":\"linkband2-v1\",\"algorithm_version\":\"web-ts-1\"," +
            "\"model_version\":\"b0-cohort-2\",\"model_hash\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"," +
            "\"model_mode\":\"legacy_cohort\",\"rates_hz\":{\"eeg\":250,\"ppg\":50,\"acc\":30},\"anchor\":\"last_sample_web_v1\"," +
            "\"acc_interval_profile\":\"rounded_33333us_v1\"}"
        const val ABI_VERSION = 1

        @Volatile private var cached: CoreLib? = null
        @Volatile private var loadError: String? = null

        internal fun lib(): CoreLib {
            cached?.let { return it }
            synchronized(this) {
                cached?.let { return it }
                return try {
                    val l = Native.load("measurement_core", CoreLib::class.java)
                    check(l.mc_abi_version() == ABI_VERSION) { "abi mismatch: ${l.mc_abi_version()}" }
                    cached = l; l
                } catch (t: Throwable) {
                    loadError = t.message ?: t.javaClass.simpleName
                    throw CoreException(1, "core_unavailable", loadError!!)
                }
            }
        }

        fun available(): Boolean = try { lib(); true } catch (_: Throwable) { false }
        fun unavailableReason(): String? = loadError

        fun create(configJson: String): MeasurementCore {
            val h = LongByReference(); val err = McBuffer()
            val b = configJson.toByteArray()
            val st = lib().mc_create(b, b.size.toLong(), h, err)
            if (st != 0) throw errorOf(st, err)
            return MeasurementCore(h.value)
        }

        fun restore(configJson: String, checkpoint: ByteArray): MeasurementCore {
            val h = LongByReference(); val err = McBuffer()
            val b = configJson.toByteArray()
            val st = lib().mc_restore(b, b.size.toLong(), checkpoint, checkpoint.size.toLong(), h, err)
            if (st != 0) throw errorOf(st, err)
            return MeasurementCore(h.value)
        }

        private fun take(buf: McBuffer): ByteArray {
            val p = buf.data
            val out = if (p == null || buf.len <= 0) ByteArray(0) else p.getByteArray(0, buf.len.toInt())
            lib().mc_buffer_free(buf)
            return out
        }

        private fun errorOf(st: Int, buf: McBuffer): CoreException {
            val raw = String(take(buf))
            val o = runCatching { JSONObject(raw) }.getOrNull()
            return CoreException(st, o?.optString("code") ?: "unknown", o?.optString("message") ?: raw)
        }

        private fun callBytes(f: (McBuffer) -> Int): ByteArray {
            val buf = McBuffer()
            val st = f(buf)
            if (st != 0) throw errorOf(st, buf)
            return take(buf)
        }

        private fun call(f: (McBuffer) -> Int): String = String(callBytes(f))

        private fun jsonList(a: JSONArray): List<JSONObject> = List(a.length()) { a.getJSONObject(it) }
    }
}
