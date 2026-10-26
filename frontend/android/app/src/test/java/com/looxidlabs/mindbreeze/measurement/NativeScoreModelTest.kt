package com.looxidlabs.mindbreeze.measurement

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/** 앱 네이티브 측정이 활성 표준 모델(sigmoid)을 쓰는지 — 모델 없으면 코호트 그대로(회귀 0). */
class NativeScoreModelTest {
    @get:Rule val tmp = TemporaryFolder()
    private val synth = File(System.getProperty("mb.contract.dir") ?: "../../contracts", "biosignal-golden/v1/synth")
    private val model = """{"focusIndex":{"m":-1.2,"s":0.5,"direction":1},"relaxationIndex":{"m":-0.3,"s":0.4,"direction":1},"emotionalStability":{"m":3.5,"s":0.8,"direction":1},"totalNeuralActivity":{"m":2.3252,"s":2.3342,"direction":1}}"""

    private fun run(pin: ModelPin?, name: String): List<JSONObject> {
        val blob = File(synth, "stream.bin").readBytes()
        val a = JSONArray(File(synth, "schedule.json").readText())
        val clock = LongArray(1)
        val e = MeasurementEngine.openOrResume(File(tmp.root, "$name.journal"), File(tmp.root, "$name.ck"), clockMs = { clock[0] }, syncEach = false,
            wallAnchorMs = 1_760_000_000_000L, anchorMonoUs = 0L, checkpointEveryPackets = 100000,
            configJson = ModelPin.configJson(pin), modelParamsJson = pin?.paramsJson)
        val out = ArrayList<JSONObject>(); e.frameSink = { out += it }
        val gen = e.fence.acquire()
        for (i in 0 until a.length()) {
            val r = a.getJSONArray(i); clock[0] = r.getLong(0) / 1000
            val s = when (r.getString(1)) { "eeg" -> Sensor.EEG; "ppg" -> Sensor.PPG; else -> Sensor.ACC }
            e.onNotification(gen, s, blob.copyOfRange(r.getInt(2), r.getInt(2) + r.getInt(3)))
        }
        e.close(); return out
    }

    private fun disp(f: JSONObject, k: String): Double? =
        f.getJSONObject("metrics").getJSONObject(k).let { if (it.optString("validity") == "valid") it.getDouble("value") else null }

    @Test fun pinnedModelChangesDisplayScoresAndStaysValid() {
        assumeTrue(MeasurementCore.available())
        val cohort = run(null, "c")
        val pinned = run(ModelPin.build(model, "t1"), "m")
        val c = cohort.mapNotNull { disp(it, "relaxation_display") }; val m = pinned.mapNotNull { disp(it, "relaxation_display") }
        // 이완도 = 두뇌 휴식: 모델 없으면 pending(valid 없음), 모델 적용 시에만 valid
        assertTrue("코호트에서는 이완도 display 가 pending 이어야 함", c.isEmpty()); assertTrue("모델 적용 시 display 가 valid 여야 함", m.isNotEmpty())
        // raw 는 모델과 무관(이중 정규화 금지)
        assertEquals(cohort.mapNotNull { disp(it, "focus_raw") }, pinned.mapNotNull { disp(it, "focus_raw") })
    }

    @Test fun noModelKeepsLegacyCohortBehaviour() {
        assumeTrue(MeasurementCore.available())
        val a = run(null, "a"); val b = run(null, "b")
        assertEquals(a.map { it.getString("feature_hash") }, b.map { it.getString("feature_hash") })
    }
}
