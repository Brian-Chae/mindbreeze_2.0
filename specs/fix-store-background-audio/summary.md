# Summary — 앱 백그라운드 수업 음성 녹음 보장

## 원인
1. iOS: AVAudioSession 이 `.playback`(입력 불가) — 백그라운드 마이크 유지 근거 부족, 인터럽션 후 재활성 없음.
2. Android: microphone FGS 타입이 "호스트+온라인"에서만 요청 → 대면 수업 녹음은 백그라운드 마이크 차단. 로비에서 권한 거부로 connectedDevice 폴백되면 녹음 시작 후에도 업그레이드 안 됨.
3. 공통: 복귀 시 마이크 track 종료(인터럽션·OS 회수)를 감지·복구하지 않아 UI 는 '녹음 중'인데 실제론 끊김.

## 변경 (A안, 서버·파일 형식 불변, B안 미채택 사유는 plan.md)
- iOS `AudioSessionConfig`(playAndRecord + A2DP + defaultToSpeaker), 인터럽션 종료·미디어서비스 리셋 시 재활성.
- `useHostBackgroundSession(recording)`: 녹음 중이면 microphone 타입(옵션 변경 시 서비스 재시작).
- `useAudioRecorder`: 복귀 시 녹음 중이고 track 이 ended/recorder 비활성이면 새 스트림으로 이어 녹음(청크 인덱스 연속). 마이크 오프·정지·일시정지는 건드리지 않음.
- MeasurementService.kt 미변경.

## 시험 결과
- vitest 신규 14건(복구 4·FGS 2·정적 설정 4 + 기존 host-background 포함) 통과. 전체 실행의 실패 8개 파일은 변경 전에도 동일(기준선 동일, 무관).
- tsc 0 오류. xcodebuild 시뮬레이터 Debug 빌드 성공. gradlew assembleDevDebug·testDevDebugUnitTest 성공.

## 실기기 V11 (Note10 R3CMA0C3Y4T, Android 12, dev API, 대면 clinical 클래스)
- 절차: 상담사 로그인 → 대면 클래스 열기·시작 → 동의 후 녹음 시작 → 홈 버튼 → 약 3분 후 복귀. 청크는 dev DB 읽기 조회(audio_chunks, 읽기 전용)로 확인.
- 마이크 캡처: 백그라운드 2분 55초 내내 `RECORD_AUDIO … (running)` — OS 는 마이크 접근을 허용(FGS `isForeground=true`, id 2220). FGS 타입 비트값은 dumpsys 에 노출되지 않아 직접 확인 못함(간접 증거만).
- **업로드는 백그라운드 약 1분 뒤 멈춤(실패)**. 1차: 청크 0~16 정상(5초 간격) 후 백그라운드 구간 이후 2분 가까이 공백, 복귀 직후 재개(인덱스 17 의 크기 12KB 로 작음 → 공백 구간 오디오 유실 가능). 2차: 청크 0~13(18:18:03~18:19:08, 누락·5초 초과 간격 없음) 후 공백, 18:21:22 복귀 시 14 재개, **15 번 청크 누락**.
- 2차에는 MainActivity 에서 녹음 중 `WebView.onResume()/resumeTimers()` 로 WebView 를 되살리는 시도를 더했으나 결과 동일 → 효과 없어 **되돌림**(커밋에 없음).
- 결론: A안(오디오 세션·FGS·복귀 복구)만으로는 **Android 백그라운드 연속 업로드가 보장되지 않음**. 마이크 캡처는 이어지나 WebView(렌더러) JS 타이머·네트워크가 약 1분 뒤 정지.
- 시험 뒤 정리: RECORD_AUDIO 권한 revoke, `svc power stayon false`, deviceidle mForceIdle=false, stay_on=0 확인(원복 완료). 시험용 dev 세션 3건 생성(앱 API, ae376bbc 완료·e79e3bc3 완료 시도·394ef32f ready 미사용) — dev 데이터로 남음.

## 다음 안 (B안 일부, 결정 필요)
- Android: 네이티브 `MediaRecorder`(OutputFormat.WEBM + OPUS, API 29+)를 FGS 안에서 돌려 **webm 형식·기존 청크 업로드 API 그대로** 유지 가능 → 서버·형식 불변 조건 충족.
- iOS: 네이티브 webm 생성 불가 → 형식 변경 없이는 AVAudioRecorder 불가. iOS 는 WKWebView 가 audio 백그라운드 모드에서 캡처를 유지하는지 **실기기 시험이 선행**돼야 함.

## 한계
- iOS 실기기 백그라운드 마이크는 미검증(시뮬레이터는 백그라운드 마이크 확인 불가). 심사 제출 전 실기기 시험 필요.
