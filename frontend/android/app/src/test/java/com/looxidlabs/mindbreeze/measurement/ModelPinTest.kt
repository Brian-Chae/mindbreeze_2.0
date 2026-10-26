package com.looxidlabs.mindbreeze.measurement

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/** 활성 표준 모델 pin: 검증·정규화·해시·1회 고정. */
class ModelPinTest {
    @get:Rule val tmp = TemporaryFolder()
    private val versionRe = Regex("^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$")

    private fun params(m: Double = 0.1, s: Double = 0.5) =
        """{"focusIndex":{"m":$m,"s":$s,"direction":1},"relaxationIndex":{"m":-1.2,"s":0.6,"direction":1},"emotionalStability":{"m":3.0,"s":0.9,"direction":1}}"""

    @Test fun buildsConfigWithActiveSigmoidAndValidHashAndVersion() {
        val p = ModelPin.build(params(), "7")!!
        assertTrue(p.modelHash.matches(Regex("^[0-9a-f]{64}$")))
        assertTrue(versionRe.matches(p.modelVersion)); assertEquals("sigmoid-7", p.modelVersion)
        val cfg = JSONObject(ModelPin.configJson(p))
        assertEquals("active_sigmoid", cfg.getString("model_mode"))
        assertEquals(p.modelHash, cfg.getString("model_hash")); assertEquals(p.modelVersion, cfg.getString("model_version"))
        assertEquals("web-ts-1", cfg.getString("algorithm_version"))
    }

    @Test fun defaultConfigWhenNoModel() {
        assertEquals(MeasurementCore.DEFAULT_CONFIG, ModelPin.configJson(null))
        assertNull(ModelPin.build(null, "1")); assertNull(ModelPin.build("", "1")); assertNull(ModelPin.build("{}", "1"))
    }

    @Test fun hashIsKeyOrderIndependentAndValueSensitive() {
        val a = ModelPin.build("""{"focusIndex":{"m":0.1,"s":0.5,"direction":1},"stressIndex":{"m":0.2,"s":0.4,"direction":-1}}""", "1")!!
        val b = ModelPin.build("""{"stressIndex":{"direction":-1,"s":0.4,"m":0.2},"focusIndex":{"direction":1,"s":0.5,"m":0.1}}""", "1")!!
        assertEquals(a.modelHash, b.modelHash); assertEquals(a.paramsJson, b.paramsJson)
        assertNotEquals(a.modelHash, ModelPin.build(params(0.1, 0.5), "1")!!.modelHash)
    }

    @Test fun dropsInvalidMetricsAndNormalizesDirection() {
        val p = ModelPin.build("""{"focusIndex":{"m":0.1,"s":0.5,"direction":"1"},"relaxationIndex":{"m":0.1,"s":0,"direction":1},
            "stressIndex":{"m":0.1,"s":0.5,"direction":2},"faa":{"m":0,"s":0.3,"direction":-1},"bogus":5,"x":{"m":"a","s":1,"direction":1}}""", "1")!!
        val o = JSONObject(p.paramsJson)
        assertEquals(setOf("focusIndex", "faa"), o.keys().asSequence().toSet())
        assertEquals(1, o.getJSONObject("focusIndex").getInt("direction"))
        assertNull(ModelPin.build("""{"focusIndex":{"m":0.1,"s":-1,"direction":1}}""", "1"))
        assertNull(ModelPin.build("not json", "1"))
    }

    @Test fun sanitizesVersion() {
        assertEquals("sigmoid-v2.1", ModelPin.build(params(), "v2.1")!!.modelVersion)
        assertTrue(versionRe.matches(ModelPin.build(params(), "a b/c!")!!.modelVersion))
        assertTrue(versionRe.matches(ModelPin.build(params(), null)!!.modelVersion))
        assertTrue(versionRe.matches(ModelPin.build(params(), "x".repeat(200))!!.modelVersion))
    }

    @Test fun pinsOnceAndIgnoresLaterModels() {
        val f = File(tmp.root, "sess/model-pin.json")
        val first = ModelPin.loadOrCreate(f, params(0.1, 0.5), "1")!!
        val second = ModelPin.loadOrCreate(f, params(9.0, 9.0), "2")!!   // 도중 교체 금지
        assertEquals(first, second)
        assertEquals(first, ModelPin.loadOrCreate(f, null, null))         // 복구(입력 없음)도 같은 pin
    }

    @Test fun noModelAndNoFileMeansNullAndCorruptFileIsReplaced() {
        val f = File(tmp.root, "none.json")
        assertNull(ModelPin.loadOrCreate(f, null, null)); assertFalse(f.exists())
        f.writeText("garbage")
        val p = ModelPin.loadOrCreate(f, params(), "3")!!
        assertEquals("sigmoid-3", p.modelVersion)
    }
}
