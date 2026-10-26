package com.looxidlabs.mindbreeze.measurement.runtime

import org.junit.Assert.*
import org.junit.Test
import java.io.File

/**
 * 위험 7(T08): dev 변형 apk 는 debuggable 이라 src/debug manifest 가 그대로 들어간다 → 측정 서비스 exported=true 가 배포본에 실리면 안 된다.
 * adb 시험용 export 는 `-PmbAdbExport=true` 로 빌드할 때만(src/adbtest) 붙는다.
 */
class ManifestExportTest {
    private fun serviceBlocks(xml: String) = Regex("""<service[^>]*MeasurementService[^>]*>""").findAll(xml).map { it.value }.toList()

    @Test fun mainAndDebugManifestsDoNotExportMeasurementService() {
        for (f in listOf("src/main/AndroidManifest.xml", "src/debug/AndroidManifest.xml")) {
            val blocks = serviceBlocks(File(f).readText())
            assertTrue("$f: $blocks", blocks.none { it.contains("""android:exported="true"""") })
        }
    }

    @Test fun adbExportIsOptInOnly() {
        assertTrue(serviceBlocks(File("src/adbtest/AndroidManifest.xml").readText()).any { it.contains("""android:exported="true"""") })
        val gradle = File("build.gradle").readText()
        assertTrue(gradle.contains("hasProperty('mbAdbExport')"))
    }
}
