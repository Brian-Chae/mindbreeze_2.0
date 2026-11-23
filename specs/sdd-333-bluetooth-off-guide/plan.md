# SDD-333 plan
- `lib/native/app-settings.ts`: isBluetoothEnabled / requestEnableBluetooth / openBluetoothSettings 추가(실패는 삼켜 폴백).
- `lib/native/bluetooth-notice.ts`: 우선순위 순수 함수(`pickBandNotice`), 플랫폼별 안내문.
- `hooks/useBluetoothPower.ts`: 3경로 감지 + 꺼짐→켜짐 콜백. 직접 읽은 전원값이 있으면 그것이 정본, 알 수 없음(null)은 꺼짐으로 보지 않음.
- `components/native/bluetooth-off-shortcuts.tsx`: 버튼 묶음. BandStepView(입장)·MemberSheets(수업 중 기기 시트)에 연결.
- `device-status.ts`: snapshot → `bluetoothOff`. MemberClassContainer: 꺼짐이면 wakeHint 억제, 켜짐 전환 시 reconnectBand/wakeBand.
- Android: `AppSettingsPlugin.java`(isBluetoothEnabled·requestEnableBluetooth·openBluetoothSettings), `MeasurementPlugin.kt`(어댑터 꺼짐이면 blocked_reason=bluetooth_off).
- iOS: `AppSettingsPlugin.swift`(isBluetoothEnabled·requestEnableBluetooth, CoreBluetooth).
- 하니스 `?btoff=1` 파라미터(캡처용).
