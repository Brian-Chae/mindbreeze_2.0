package com.looxidlabs.mindbreeze;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.looxidlabs.mindbreeze.chrome.SystemChromePlugin;
import com.looxidlabs.mindbreeze.audiorecorder.NativeAudioRecorderPlugin;
import com.looxidlabs.mindbreeze.measurement.MeasurementPlugin;
import com.looxidlabs.mindbreeze.update.ApkUpdaterPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // SDD-246 T08: 네이티브 측정 플러그인(수집은 서비스 소유, WebView 는 제어·조회).
        registerPlugin(MeasurementPlugin.class);
        // SDD-247: 앱 자체 백그라운드 수업 녹음.
        registerPlugin(NativeAudioRecorderPlugin.class);
        // 클래스 모드 시스템 바 배경·아이콘 제어(Android 15+ edge-to-edge 대응).
        registerPlugin(SystemChromePlugin.class);
        // SDD-259: 다운로드 사이트 APK 앱 내 업데이트(권한은 sideload 빌드에만 포함).
        registerPlugin(ApkUpdaterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
