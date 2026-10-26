package com.looxidlabs.mindbreeze;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.looxidlabs.mindbreeze.audiorecorder.NativeAudioRecorderPlugin;
import com.looxidlabs.mindbreeze.measurement.MeasurementPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // SDD-246 T08: 네이티브 측정 플러그인(수집은 서비스 소유, WebView 는 제어·조회).
        registerPlugin(MeasurementPlugin.class);
        // SDD-247: 앱 자체 백그라운드 수업 녹음.
        registerPlugin(NativeAudioRecorderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
