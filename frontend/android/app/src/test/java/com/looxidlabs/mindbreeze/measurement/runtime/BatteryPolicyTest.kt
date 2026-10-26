package com.looxidlabs.mindbreeze.measurement.runtime

import org.junit.Assert.*
import org.junit.Test
import java.io.File

/** 배터리 최적화 상태 읽기·설정 안내(자동 예외 금지) 시험. */
class BatteryPolicyTest {
    @Test fun classifyReadsStateWithoutGuessing() {
        assertEquals("exempt", BatteryPolicy.classify(31, true, false))
        assertEquals("optimized", BatteryPolicy.classify(31, false, false))
        assertEquals("restricted", BatteryPolicy.classify(31, true, true))
        assertEquals("unknown", BatteryPolicy.classify(31, null, null))
        assertEquals("restricted 가 우선", "restricted", BatteryPolicy.classify(31, null, true))
    }

    @Test fun settingsTargetsNeverUseDirectExemptionDialog() {
        val d = BatteryPolicy.settingsTargets()
        assertEquals("app_details", d.first().id)
        assertEquals("battery_optimization_list", BatteryPolicy.settingsTargets("battery_optimization_list").first().id)
        assertTrue(d.none { it.action.contains("REQUEST_IGNORE_BATTERY_OPTIMIZATIONS") })
    }

    @Test fun manifestDoesNotDeclareExemptionRequestPermission() {
        val m = File("src/main/AndroidManifest.xml").readText()
        assertFalse(m.contains("REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"))
    }

    @Test fun statusJsonShapeAndSamsungHint() {
        val s = BatteryPolicy.statusJson(31, "samsung", false, false)
        assertEquals("optimized", s.getString("batteryOptimization"))
        assertEquals(false, s.getBoolean("backgroundRestricted"))
        assertEquals("samsung_sleeping_apps", s.getString("vendorPolicy"))
        assertTrue(BatteryPolicy.statusJson(31, "Google", true, null).isNull("vendorPolicy"))
        assertTrue(BatteryPolicy.statusJson(31, "Google", true, null).isNull("backgroundRestricted"))
        assertEquals(setOf("batteryOptimization", "backgroundRestricted", "vendorPolicy", "settingsTargets"), s.keys().asSequence().toSet())
    }
}
