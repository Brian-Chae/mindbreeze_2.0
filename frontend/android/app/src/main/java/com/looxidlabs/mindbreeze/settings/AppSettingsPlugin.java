package com.looxidlabs.mindbreeze.settings;

import android.Manifest;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.annotation.ActivityCallback;
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

    /** SDD-333: 블루투스 어댑터가 켜져 있는지. 어댑터가 없는 기기는 null(알 수 없음). 권한 없이 읽을 수 있다. */
    @PluginMethod
    public void isBluetoothEnabled(final PluginCall call) {
        JSObject result = new JSObject();
        BluetoothAdapter adapter = adapter();
        result.put("enabled", adapter == null ? null : adapter.isEnabled());
        call.resolve(result);
    }

    /**
     * SDD-333: 시스템 "블루투스 켜기" 창(ACTION_REQUEST_ENABLE)을 띄운다. Android 12+ 는 BLUETOOTH_CONNECT 권한이 없으면 창이 안 뜨므로
     * "permission" 으로 거절해 호출부가 권한 요청 뒤 다시 부르게 한다. 창을 못 띄우면 블루투스 설정 화면으로 대신 보낸다.
     */
    @PluginMethod
    public void requestEnableBluetooth(final PluginCall call) {
        BluetoothAdapter adapter = adapter();
        if (adapter != null && adapter.isEnabled()) {
            call.resolve(new JSObject().put("mode", "already_on"));
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                && getContext().checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            call.reject("permission", "permission");
            return;
        }
        try {
            startActivityForResult(call, new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), "onEnableBluetoothResult");
        } catch (Exception e) {
            openBluetoothSettingsScreen(call, "settings");
        }
    }

    @ActivityCallback
    private void onEnableBluetoothResult(final PluginCall call, final ActivityResult result) {
        if (call == null) return;
        // 거부(RESULT_CANCELED)면 사용자가 직접 켜도록 설정 화면으로 보낸다.
        if (result.getResultCode() == Activity.RESULT_OK) {
            call.resolve(new JSObject().put("mode", "system_dialog"));
        } else {
            openBluetoothSettingsScreen(call, "settings");
        }
    }

    /** SDD-333: 블루투스 설정 화면을 연다. */
    @PluginMethod
    public void openBluetoothSettings(final PluginCall call) {
        openBluetoothSettingsScreen(call, "settings");
    }

    private void openBluetoothSettingsScreen(final PluginCall call, final String mode) {
        try {
            Intent intent = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve(new JSObject().put("mode", mode));
        } catch (Exception e) {
            call.reject("openBluetoothSettings failed: " + e.getMessage());
        }
    }

    private BluetoothAdapter adapter() {
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return manager == null ? null : manager.getAdapter();
    }
}
