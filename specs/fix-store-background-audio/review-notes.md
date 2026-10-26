# 스토어 심사 메모 — 백그라운드 수업 음성 녹음

## 1. App Store 심사 메모 (App Review Notes)
### 한국어
- UIBackgroundModes `audio`: 상담사가 진행하는 온라인/대면 수업에서, 참여자 동의를 받은 **수업 음성 녹음**과 수업 음원(BGM·명상 음성) 재생이 화면 잠금·앱 전환 중에도 끊기지 않게 하기 위해 사용합니다. 오디오 세션은 `playAndRecord`입니다.
- UIBackgroundModes `bluetooth-central`: 수업 중 LINK BAND(뇌파 측정기) BLE 연결 유지용입니다.
- 마이크는 상담사가 동의 모달에서 참여자 동의를 확인한 뒤 [녹음 시작]을 눌렀을 때만 켜지며, 마이크를 끈 수업에서는 녹음하지 않습니다. 녹음 중에는 화면에 녹음 표시가 보입니다.
- 재현 절차: ① 상담사 계정(심사용 계정 별도 제공)으로 로그인 → ② 클래스 만들기·시작 → ③ [녹음 시작] 후 동의 확인 → ④ 홈 버튼으로 앱을 백그라운드로 보내 2분 이상 둠(상태 표시줄의 녹음 표시 유지) → ⑤ 앱 복귀 → 클래스 종료 후 기록에서 끊김 없는 음성 기록 확인.
### English
- `audio` background mode: keeps **class voice recording** (made only after the host confirms participant consent) and class audio playback running when the screen locks or the user switches apps during a live counseling/meditation class. The audio session category is `playAndRecord`.
- `bluetooth-central`: keeps the BLE connection to the LINK BAND EEG device during class.
- The microphone starts only after the host confirms consent and taps Start Recording; classes with the microphone off are never recorded. The system recording indicator stays visible.
- Steps: (1) sign in with the provided host demo account → (2) create and start a class → (3) tap Start Recording and confirm consent → (4) press Home and leave the app in the background for 2+ minutes → (5) return to the app, end the class and check that the recording is continuous.

## 2. Google Play 포그라운드 서비스 선언 (FOREGROUND_SERVICE_MICROPHONE)
### 한국어
- 유형: `microphone`(+ `connectedDevice`). 용도: 상담사가 참여자 동의를 받아 수업 음성을 녹음하는 동안, 앱이 백그라운드에 있어도 녹음이 중단되지 않게 합니다. 사용자가 시작한 녹음이 진행 중일 때만 서비스가 microphone 유형으로 실행되고 상시 알림("명상 클래스 진행 중")이 표시되며, 종료하면 서비스도 종료됩니다.
- 영상 시연: 클래스 시작 → 녹음 시작 → 홈 버튼 → 알림 표시줄의 서비스 알림 확인 → 앱 복귀 → 종료.
### English
- Type: `microphone` (plus `connectedDevice`). Purpose: lets the host's consented class voice recording continue while the app is in the background. The service runs with the microphone type only while a user-initiated recording is active, shows a persistent notification ("명상 클래스 진행 중"), and stops when the class or recording ends.
- Video: start class → start recording → press Home → show the service notification → return → end.

## 3. 시연 영상 촬영 체크리스트 (Brian 직접 촬영)
- [ ] iOS: 상담사 계정, 마이크 권한 허용, 녹음 시작 후 홈 → 상태 표시줄 마이크 표시(주황 점) 보이게 2분 이상
- [ ] iOS: 복귀 후 클래스 종료 → 기록에서 음성 기록 확인
- [ ] Android: 녹음 시작 → 홈 → 알림 서랍에서 서비스 알림 노출 → 복귀 → 종료
- [ ] 마이크 끈 수업에서는 녹음 버튼이 비활성임을 함께 촬영
- [ ] 동의 모달 화면을 반드시 포함, 개인정보가 보이는 화면은 가림
