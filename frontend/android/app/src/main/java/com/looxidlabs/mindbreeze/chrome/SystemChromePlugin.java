package com.looxidlabs.mindbreeze.chrome;

import android.graphics.Color;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 클래스 모드 화면용 시스템 바(상태바·내비게이션 바) 배경/아이콘 제어.
 * Android 15+(targetSdk 36)는 edge-to-edge 강제라 StatusBar.setBackgroundColor 가 무시되고,
 * Capacitor SystemBars 가 웹뷰를 인셋만큼 내린 뒤 그 뒤를 decorView 배경(흰색)으로 둔다.
 * decorView 배경색과 아이콘 밝기를 직접 바꿔 클래스 화면에서 흰 띠를 없앤다.
 */
@CapacitorPlugin(name = "SystemChrome")
public class SystemChromePlugin extends Plugin {
    @PluginMethod
    public void setChrome(final PluginCall call) {
        final String colorHex = call.getString("color", "#FFFFFF");
        final boolean lightIcons = Boolean.TRUE.equals(call.getBoolean("lightIcons", false));
        getBridge().executeOnMainThread(() -> {
            try {
                Window window = getActivity().getWindow();
                window.getDecorView().setBackgroundColor(Color.parseColor(colorHex));
                WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
                // lightIcons=true → 밝은 아이콘(어두운 배경용) = appearanceLight* false
                controller.setAppearanceLightStatusBars(!lightIcons);
                controller.setAppearanceLightNavigationBars(!lightIcons);
                call.resolve();
            } catch (Exception e) {
                call.reject("setChrome failed: " + e.getMessage());
            }
        });
    }
}
