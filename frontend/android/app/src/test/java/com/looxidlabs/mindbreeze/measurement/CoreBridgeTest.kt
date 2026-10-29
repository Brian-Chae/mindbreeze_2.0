package com.looxidlabs.mindbreeze.measurement

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/** 실제 Rust 코어(호스트 dylib)를 JNA 로 호출해 T01 골든 합성 스트림과 패리티를 확인한다. */
class CoreBridgeTest {
    @get:Rule val tmp = TemporaryFolder()

    private val contractDir = File(System.getProperty("mb.contract.dir") ?: "../../contracts")
    private val synth = File(contractDir, "biosignal-golden/v1/synth")

    private fun requireCore() = assumeTrue("host core dylib 없음(-PskipMeasurementCore?)", MeasurementCore.available())

    /** (arrival_us, sensor, offset, len) 스케줄 */
    private fun schedule(): List<Array<Any>> {
        val a = JSONArray(File(synth, "schedule.json").readText())
        return List(a.length()) { i -> val r = a.getJSONArray(i); arrayOf(r.getLong(0), r.getString(1), r.getInt(2), r.getInt(3)) }
    }

    private fun sensorOf(s: String) = when (s) { "eeg" -> Sensor.EEG; "ppg" -> Sensor.PPG; else -> Sensor.ACC }

    @Test fun goldenSynthStreamMatchesRustReplayBaseline() {
        requireCore()
        val blob = File(synth, "stream.bin").readBytes()
        val core = MeasurementCore.create(MeasurementCore.DEFAULT_CONFIG)
        val frames = ArrayList<JSONObject>()
        for (r in schedule()) {
            val off = r[2] as Int; val len = r[3] as Int
            val out = core.pushRaw(sensorOf(r[1] as String), blob.copyOfRange(off, off + len), r[0] as Long, 1_760_000_000_000L, 0L)
            assertEquals("accepted", out.status)
            frames += out.frames
        }
        // cargo run --example replay 로 얻은 기준값(T02 패리티): 149 프레임, 첫/마지막 feature_hash (fix-hrv-sdnn-scale: RR 필터 변경으로 마지막 hash 갱신; fix-live-v2-feature-fields: 확장 15종 추가로 hash 갱신)
        assertEquals(149, frames.size)
        assertEquals("727049b5c4876f68de7759ba767af07981f64b6ccce33b9ba651cb2dc6c23119", frames.first().getString("feature_hash"))
        assertEquals("9ff5803c7b447ae373d0e31bf03c9731b351c4a159fcd2ca7ab3c237022bc39f", frames.last().getString("feature_hash"))
        val fin = core.close()
        assertEquals("149", fin.getJSONObject("final_sequences").getString("metric"))
        assertEquals("7eabba3da72b3796b608557ed08d89991e1d212f3d4dedf926cf107ce643d145", fin.getString("raw_sha256"))
    }

    @Test fun invalidConfigIsRejectedWithoutCrash() {
        requireCore()
        val ex = runCatching { MeasurementCore.create("{\"abi_version\":99}") }.exceptionOrNull()
        assertTrue(ex is CoreException)
        assertEquals(3, (ex as CoreException).status)
    }

    @Test fun closedHandleCannotBeReused() {
        requireCore()
        val core = MeasurementCore.create(MeasurementCore.DEFAULT_CONFIG)
        core.close()
        val ex = runCatching { core.advance(1_000_000) }.exceptionOrNull()
        assertTrue(ex is CoreException)
    }

    @Test fun checkpointRestoreContinuesIdentically() {
        requireCore()
        val blob = File(synth, "stream.bin").readBytes()
        val sched = schedule()
        fun run(core: MeasurementCore, from: Int, to: Int, into: MutableList<String>) {
            for (i in from until to) {
                val r = sched[i]; val off = r[2] as Int; val len = r[3] as Int
                core.pushRaw(sensorOf(r[1] as String), blob.copyOfRange(off, off + len), r[0] as Long, 1_760_000_000_000L, 0L)
                    .frames.forEach { into += it.getString("feature_hash") }
            }
        }
        val whole = ArrayList<String>()
        run(MeasurementCore.create(MeasurementCore.DEFAULT_CONFIG), 0, 2500, whole)
        val first = ArrayList<String>()
        val c1 = MeasurementCore.create(MeasurementCore.DEFAULT_CONFIG)
        run(c1, 0, 1200, first)
        val ck = c1.checkpoint(); c1.destroy()
        val c2 = MeasurementCore.restore(MeasurementCore.DEFAULT_CONFIG, ck)
        run(c2, 1200, 2500, first)
        assertEquals(whole, first)
        assertTrue(whole.size > 30)
    }

    @Test fun engineWithCoreEmitsRealFramesAndDeduplicatesJournal() {
        requireCore()
        val blob = File(synth, "stream.bin").readBytes()
        var nowMs = 0L
        val core = MeasurementCore.create(MeasurementCore.DEFAULT_CONFIG)
        val e = MeasurementEngine(File(tmp.root, "e.journal"), clockMs = { nowMs }, syncEach = false, core = core, wallAnchorMs = 1_760_000_000_000L, anchorMonoUs = 0L)
        e.open()
        val got = ArrayList<JSONObject>()
        e.frameSink = { got += it }
        val gen = e.fence.acquire()
        for (r in schedule().take(1500)) {
            nowMs = (r[0] as Long) / 1000
            val off = r[2] as Int; val len = r[3] as Int
            e.onNotification(gen, sensorOf(r[1] as String), blob.copyOfRange(off, off + len))
        }
        assertTrue("frames=${got.size}", got.size > 20)
        assertEquals(got.size.toLong(), e.counters.snapshot().frames)
        assertTrue(got.all { it.has("metrics") && it.has("feature_hash") })
        assertEquals(1500L, e.counters.snapshot().journalRecords)
    }
}
