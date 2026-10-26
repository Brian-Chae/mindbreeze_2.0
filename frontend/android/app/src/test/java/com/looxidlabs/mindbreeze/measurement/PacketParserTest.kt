package com.looxidlabs.mindbreeze.measurement

import org.junit.Assert.*
import org.junit.Test

class PacketParserTest {
    private fun le32(v: Long) = byteArrayOf(v.toByte(), (v shr 8).toByte(), (v shr 16).toByte(), (v shr 24).toByte())

    @Test fun eegTwoSamplesDecodesSigned24AndLeadoff() {
        // 샘플1: leadoff=0x05(ch1,ch2 off), ch1=+1, ch2=-1(0xFFFFFF)
        val s1 = byteArrayOf(0x05, 0, 0, 1, 0xFF.toByte(), 0xFF.toByte(), 0xFF.toByte())
        val s2 = byteArrayOf(0x00, 0x7F, 0xFF.toByte(), 0xFF.toByte(), 0x80.toByte(), 0, 0)
        val p = PacketParser.parse(Sensor.EEG, le32(32768) + s1 + s2) as ParseResult.Ok
        assertEquals(2, p.packet.sampleCount)
        assertEquals(32768L, p.packet.rawTick)
        assertEquals(0, p.packet.trailingBytes)
        val e = p.packet.eeg!!
        assertTrue(e[0].leadoffCh1 && e[0].leadoffCh2)
        assertEquals(1.toDouble() * 4.033 / 12 / 8388607 * 1e6, e[0].ch1Uv, 1e-9)
        assertEquals(-1.toDouble() * 4.033 / 12 / 8388607 * 1e6, e[0].ch2Uv, 1e-9)
        assertFalse(e[1].leadoffCh1)
        assertTrue(e[1].ch1Uv > 0 && e[1].ch2Uv < 0)
    }

    @Test fun ppgHeaderIsLittleEndianAndSamplesBigEndian24() {
        val bytes = le32(0x01020304) + byteArrayOf(0x01, 0x02, 0x03, 0x04, 0x05, 0x06)
        val p = (PacketParser.parse(Sensor.PPG, bytes) as ParseResult.Ok).packet
        assertEquals(0x01020304L, p.rawTick)
        assertEquals(0x010203, p.ppg!![0].red)
        assertEquals(0x040506, p.ppg!![0].ir)
    }

    @Test fun accLittleEndianSigned16() {
        val bytes = le32(10) + byteArrayOf(0x00, 0x80.toByte(), 0xFF.toByte(), 0xFF.toByte(), 0x01, 0x00)
        val a = (PacketParser.parse(Sensor.ACC, bytes) as ParseResult.Ok).packet.acc!![0]
        assertEquals(-32768, a.x); assertEquals(-1, a.y); assertEquals(1, a.z)
        assertEquals(2.0 / 32768 * -32768, a.xG, 1e-12)
    }

    @Test fun shortPacketsAreRejectedPerSdkMinimums() {
        assertTrue(PacketParser.parse(Sensor.EEG, ByteArray(7)) is ParseResult.Invalid)
        assertTrue(PacketParser.parse(Sensor.PPG, ByteArray(7)) is ParseResult.Invalid)
        assertTrue(PacketParser.parse(Sensor.ACC, ByteArray(9)) is ParseResult.Invalid)
        assertTrue(PacketParser.parse(Sensor.EEG, ByteArray(0)) is ParseResult.Invalid)
    }

    @Test fun trailingBytesAreReportedNotSilentlyDropped() {
        val bytes = le32(1) + ByteArray(7) + byteArrayOf(9, 9, 9)
        val p = (PacketParser.parse(Sensor.EEG, bytes) as ParseResult.Ok).packet
        assertEquals(1, p.sampleCount)
        assertEquals(3, p.trailingBytes)
    }

    @Test fun tickUnwrapperExtends32bitWrapAndKeepsSensorsIndependent() {
        val u = TickUnwrapper()
        assertEquals(0xFFFFFFF0L, u.unwrap(Sensor.EEG, 0xFFFFFFF0L))
        assertEquals(0x100000005L, u.unwrap(Sensor.EEG, 5L))
        assertEquals(7L, u.unwrap(Sensor.PPG, 7L))          // PPG 원점은 EEG와 독립
        assertEquals(0x100000005L, u.unwrap(Sensor.EEG, 5L)) // 동일 tick 중복은 그대로
    }
}
