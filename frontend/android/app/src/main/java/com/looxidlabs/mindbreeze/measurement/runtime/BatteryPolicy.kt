package com.looxidlabs.mindbreeze.measurement.runtime

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.PowerManager
import org.json.JSONObject

/** 사용자가 직접 바꾸도록 여는 설정 화면 후보. */
data class SettingsTarget(val id: String, val action: String, val withPackageUri: Boolean)

/**
 * 배터리 최적화(Doze·삼성 Freecess) 상태 **읽기**와 설정 화면 안내(T08 후속 「배터리 예외 권고안」).
 * 예외를 자동으로 거는 코드는 두지 않는다(설정 몰래 변경 금지). 직접 다이얼로그(ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)는
 * Play 정책상 사유 서술·권한 선언이 필요해 쓰지 않고, 사용자가 설정 화면에서 직접 "제한 없음"을 고르게 한다.
 *
 *  batteryOptimization:
 *   - exempt     : 최적화 제외(Doze 예외 목록). 삼성 Freecess 제외 여부는 실기기 확인 전까지 보장 아님.
 *   - optimized  : 기본값(최적화 대상) — 화면 꺼짐·비충전에서 앱이 얼 수 있음(Note10 실측 44초 정지).
 *   - restricted : 사용자가 백그라운드 사용을 제한(API 28+) — 측정 지속 불가에 가까움.
 *   - unknown    : 읽기 실패.
 */
object BatteryPolicy {
    const val EXEMPT = "exempt"
    const val OPTIMIZED = "optimized"
    const val RESTRICTED = "restricted"
    const val UNKNOWN = "unknown"

    const val TARGET_APP_DETAILS = "app_details"
    const val TARGET_OPTIMIZATION_LIST = "battery_optimization_list"

    fun classify(sdkInt: Int, ignoringOptimizations: Boolean?, backgroundRestricted: Boolean?): String = when {
        backgroundRestricted == true -> RESTRICTED
        sdkInt < 23 -> EXEMPT // Doze 이전 OS
        ignoringOptimizations == true -> EXEMPT
        ignoringOptimizations == false -> OPTIMIZED
        else -> UNKNOWN
    }

    /**
     * 시도 순서. 기본은 앱 정보 화면(Android 12+/One UI 는 여기서 배터리 → "제한 없음"을 바로 고른다),
     * 실패하면 전체 앱 최적화 목록. preferred 로 순서를 바꿀 수 있다.
     */
    fun settingsTargets(preferred: String? = null): List<SettingsTarget> {
        val all = listOf(
            SettingsTarget(TARGET_APP_DETAILS, "android.settings.APPLICATION_DETAILS_SETTINGS", withPackageUri = true),
            SettingsTarget(TARGET_OPTIMIZATION_LIST, "android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS", withPackageUri = false),
        )
        return all.sortedBy { if (it.id == preferred) 0 else 1 }
    }

    /** 브리지로 내보내는 상태(토큰·식별자 없음). */
    fun statusJson(sdkInt: Int, manufacturer: String?, ignoringOptimizations: Boolean?, backgroundRestricted: Boolean?): JSONObject {
        val vendor = manufacturer?.lowercase()?.trim().orEmpty()
        return JSONObject()
            .put("batteryOptimization", classify(sdkInt, ignoringOptimizations, backgroundRestricted))
            .put("backgroundRestricted", backgroundRestricted ?: JSONObject.NULL)
            // 삼성은 AOSP 예외와 별개로 "수면 중인 앱"(Freecess)이 있어 안내 문구를 달리해야 한다
            .put("vendorPolicy", if (vendor == "samsung") "samsung_sleeping_apps" else JSONObject.NULL)
            .put("settingsTargets", org.json.JSONArray(settingsTargets().map { it.id }))
    }

    /** 현재 기기 상태 읽기(읽기만 한다). */
    fun read(ctx: Context): JSONObject {
        val ignoring = try { (ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager)?.isIgnoringBatteryOptimizations(ctx.packageName) } catch (_: Exception) { null }
        val restricted = if (Build.VERSION.SDK_INT >= 28) {
            try { (ctx.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager)?.isBackgroundRestricted } catch (_: Exception) { null }
        } else null
        return statusJson(Build.VERSION.SDK_INT, Build.MANUFACTURER, ignoring, restricted)
    }
}
