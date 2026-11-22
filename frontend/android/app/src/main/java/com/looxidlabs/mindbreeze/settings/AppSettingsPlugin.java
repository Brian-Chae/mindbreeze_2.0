package com.looxidlabs.mindbreeze.settings;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * SDD-330: 권한·배터리 설정 화면 바로가기.
 * 사용자가 설정 메뉴를 직접 찾지 않도록 앱 정보 화면과 배터리 최적화 예외 요청을 바로 연다.
 */
@CapacitorPlugin(name = "AppSettings")
public class AppSettingsPlugin extends Plugin {

    /** 이 앱의 정보(권한) 화면을 연다. */
    @PluginMethod
    public void openAppSettings(final PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("openAppSettings failed: " + e.getMessage());
        }
    }

    /** 배터리 최적화 예외(백그라운드 제한 해제) 상태. Android 5 이하는 항상 true. */
    @PluginMethod
    public void isIgnoringBatteryOptimizations(final PluginCall call) {
        JSObject result = new JSObject();
        boolean ignoring = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            ignoring = pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
        }
        result.put("ignoring", ignoring);
        call.resolve(result);
    }

    /**
     * 배터리 최적화 예외 요청 다이얼로그(ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)를 연다.
     * 열 수 없는 기기면 배터리 최적화 설정 목록 화면으로 대신 보낸다.
     */
    @PluginMethod
    public void requestIgnoreBatteryOptimizations(final PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception first) {
            openBatterySettingsList(call);
        }
    }

    /** 배터리 최적화 설정 목록 화면을 연다. */
    @PluginMethod
    public void openBatterySettings(final PluginCall call) {
        openBatterySettingsList(call);
    }

    private void openBatterySettingsList(final PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            // 마지막 폴백: 앱 정보 화면
            openAppSettings(call);
        }
    }
}
