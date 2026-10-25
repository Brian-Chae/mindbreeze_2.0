package com.looxidlabs.mindbreeze.measurement

/** LINK BAND 센서 종류. 바이트 정본: 공식 SDK python_core/app/core/device.py */
enum class Sensor(val id: Int, val sampleRateHz: Int, val minPacketBytes: Int, val sampleBytes: Int) {
    EEG(1, 250, 8, 7),
    PPG(2, 50, 8, 6),
    ACC(3, 30, 10, 6);

    companion object {
        fun fromId(id: Int): Sensor? = values().firstOrNull { it.id == id }
    }
}

const val DEVICE_TICK_HZ = 32768L

/** GATT UUID — frontend/src/lib/eeg/bluetoothService.ts 및 SDK device.py 와 동일. */
object BandUuids {
    const val EEG_SERVICE = "df7b5d95-3afe-00a1-084c-b50895ef4f95"
    const val EEG_CHAR = "00ab4d15-66b4-0d8a-824f-8d6f8966c6e5"
    const val PPG_SERVICE = "1cc50ec0-6967-9d84-a243-c2267f924d1f"
    const val PPG_CHAR = "6c739642-23ba-818b-2045-bfe8970263f6"
    const val ACC_SERVICE = "75c276c3-8f97-20bc-a143-b354244886d4"
    const val ACC_CHAR = "d3d46a35-4394-e9aa-5a43-e7921120aaed"
    const val CCCD = "00002902-0000-1000-8000-00805f9b34fb"
}

data class EegSample(val leadoffCh1: Boolean, val leadoffCh2: Boolean, val ch1Uv: Double, val ch2Uv: Double)
data class PpgSample(val red: Int, val ir: Int)
data class AccSample(val x: Int, val y: Int, val z: Int) {
    val xG get() = x * 2.0 / 32768
    val yG get() = y * 2.0 / 32768
    val zG get() = z * 2.0 / 32768
}

data class Packet(
    val sensor: Sensor,
    val rawTick: Long,
    val sampleCount: Int,
    val trailingBytes: Int,
    val eeg: List<EegSample>? = null,
    val ppg: List<PpgSample>? = null,
    val acc: List<AccSample>? = null,
)

sealed class ParseResult {
    data class Ok(val packet: Packet) : ParseResult()
    data class Invalid(val reason: String) : ParseResult()
}

object PacketParser {
    private const val EEG_UV_SCALE = 4.033 / 12 / 8388607 * 1e6

    fun parse(sensor: Sensor, d: ByteArray): ParseResult {
        if (d.size < sensor.minPacketBytes) return ParseResult.Invalid("too_short:${d.size}")
        // 헤더는 세 센서 모두 uint32 little endian (PPG 포함).
        val tick = (d[0].toLong() and 0xFF) or ((d[1].toLong() and 0xFF) shl 8) or
            ((d[2].toLong() and 0xFF) shl 16) or ((d[3].toLong() and 0xFF) shl 24)
        val n = (d.size - 4) / sensor.sampleBytes
        val trailing = (d.size - 4) % sensor.sampleBytes
        return when (sensor) {
            Sensor.EEG -> ParseResult.Ok(Packet(sensor, tick, n, trailing, eeg = List(n) { i ->
                val o = 4 + i * 7
                val lo = d[o].toInt()
                EegSample((lo and 0x01) != 0, (lo and 0x04) != 0, s24(d, o + 1) * EEG_UV_SCALE, s24(d, o + 4) * EEG_UV_SCALE)
            }))
            Sensor.PPG -> ParseResult.Ok(Packet(sensor, tick, n, trailing, ppg = List(n) { i ->
                val o = 4 + i * 6
                PpgSample(u24(d, o), u24(d, o + 3))
            }))
            Sensor.ACC -> ParseResult.Ok(Packet(sensor, tick, n, trailing, acc = List(n) { i ->
                val o = 4 + i * 6
                AccSample(s16le(d, o), s16le(d, o + 2), s16le(d, o + 4))
            }))
        }
    }

    private fun u24(d: ByteArray, o: Int) =
        ((d[o].toInt() and 0xFF) shl 16) or ((d[o + 1].toInt() and 0xFF) shl 8) or (d[o + 2].toInt() and 0xFF)

    private fun s24(d: ByteArray, o: Int): Int {
        val v = u24(d, o)
        return if (v and 0x800000 != 0) v - 0x1000000 else v
    }

    private fun s16le(d: ByteArray, o: Int): Int =
        ((d[o].toInt() and 0xFF) or (d[o + 1].toInt() shl 8)).toShort().toInt()
}

/** 32bit tick wrap 확장. 센서별 독립 원점. */
class TickUnwrapper {
    private val lastRaw = LongArray(4) { -1 }
    private val epoch = LongArray(4)

    @Synchronized
    fun unwrap(sensor: Sensor, raw: Long): Long {
        val i = sensor.id
        val last = lastRaw[i]
        if (last >= 0 && raw < last && last - raw > 0x80000000L) epoch[i] += 1L shl 32
        lastRaw[i] = raw
        return epoch[i] + raw
    }
}
