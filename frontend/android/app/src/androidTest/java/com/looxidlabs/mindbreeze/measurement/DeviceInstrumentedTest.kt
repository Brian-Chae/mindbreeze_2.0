package com.looxidlabs.mindbreeze.measurement

import android.content.Intent
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.looxidlabs.mindbreeze.measurement.live.MetricOutbox
import com.looxidlabs.mindbreeze.measurement.runtime.BatteryPolicy
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * SDD-246 T08d 계측 시험(실기기). 기기 설정은 읽기만 하고 바꾸지 않는다.
 * 실행: 앱·테스트 apk 를 `adb install -r` 후 `adb shell am instrument -w -e class com.looxidlabs.mindbreeze.measurement.DeviceInstrumentedTest
 *       com.looxidlabs.mindbreeze2.dev.test/androidx.test.runner.AndroidJUnitRunner` (connected*AndroidTest 는 끝나고 앱을 지우므로 쓰지 않는다)
 */
@RunWith(AndroidJUnit4::class)
class DeviceInstrumentedTest {
    private val ctx = InstrumentationRegistry.getInstrumentation().targetContext

    @Test fun rustCoreLoadsFromApkOnDevice() {
        assertTrue("apk 의 libmeasurement_core.so 로드", MeasurementCore.available())
        MeasurementCore.create(MeasurementCore.DEFAULT_CONFIG).close()
    }

    @Test fun batteryOptimizationIsReadableAndSettingsScreenResolves() {
        val s = BatteryPolicy.read(ctx)
        assertTrue(s.toString(), s.getString("batteryOptimization") in setOf("exempt", "optimized", "restricted", "unknown"))
        val t = BatteryPolicy.settingsTargets().first()
        val i = Intent(t.action).apply { if (t.withPackageUri) data = Uri.parse("package:" + ctx.packageName) }
        assertNotNull("설정 화면 intent 해석(실행은 하지 않음)", i.resolveActivity(ctx.packageManager))
        android.util.Log.i("MBMeasTest", "battery=$s")
    }

    @Test fun outboxQuarantineSurvivesReopenOnDeviceStorage() {
        val f = File(ctx.cacheDir, "t08d-outbox-${System.nanoTime()}.log")
        try {
            val frame = JSONObject("""{"sequence":"1","feature_hash":"${"a".repeat(64)}"}""")
            MetricOutbox(f).apply { add(1, frame); add(2, frame); quarantine(1, "stale_owner_generation"); close() }
            val b = MetricOutbox(f)
            assertEquals(1, b.size()); assertEquals(1L, b.quarantined()); assertFalse(b.contains(1))
            b.close()
        } finally { f.delete() }
    }
}
