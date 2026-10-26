# FIX — 앱 백그라운드 수업 음성 녹음 보장 (원인분석·계획)

## 1. 녹음 경로 (코드 추적)
- 녹음 주체는 **상담사(호스트) 화면만**이다. 회원 앱에는 녹음이 없다(마이크는 LiveKit 송출뿐).
- 시작: `ClassPlayerPage.tsx` 의 클래스 시작(audio==='record') 또는 동의 모달 확인(`handleConsentConfirm`)에서 `startAudio(id,true)` → `useAudioRecorder.start()`. 마이크 오프(`mediaPrefs.micOn=false`)면 `handleStartClick` 에서 차단.
- 녹음: `useAudioRecorder.ts` — `getUserMedia({audio:true})` + `MediaRecorder(audio/webm;codecs=opus)`, `start(5000)` → 5초 청크.
- 업로드: `ondataavailable` → `uploadChunk(sessionId, idx, blob)`(multipart, 재시도 3회). 실패 청크는 `pendingRef` 보관 후 종료 시 재전송. 정지: `handleStop` → `recorder.stop()` → `stopAudio`.
- 서버(STT)는 `audio/webm` 가정(`stt_task.py:157,256`) → **파일 형식·API 변경 불가** → 웹 MediaRecorder 경로 유지가 전제.

## 2. 백그라운드에서 무엇이 멈추나 (원인)
| 플랫폼 | 현재 | 문제 |
|---|---|---|
| iOS | `UIBackgroundModes=audio` 있음, 그러나 `AppDelegate.configureAudioSession` 이 `.playback` | `.playback` 은 입력(마이크) 미허용 → 오디오 세션이 녹음을 보장하지 않음. 백그라운드 마이크 캡처는 세션이 `playAndRecord` 이고 활성이어야 유지됨(Apple: Audio Session — Recording in the background requires audio background mode + record-capable category). 인터럽션(전화·Siri) 후 세션 재활성 코드 없음. |
| Android | `AndroidForegroundService` 타입 `connectedDevice\|microphone` 선언, JS 가 호스트+**온라인**일 때만 microphone 타입 요청 | (1) 오프라인(대면) 수업 녹음은 microphone 타입 없음 → Android 11+ 백그라운드 마이크 차단(Android 문서: while-in-use 권한, 마이크는 FGS microphone 타입 필요). (2) 로비 진입 시점(RECORD_AUDIO 미허용)에 microphone 시작이 실패하면 `connectedDevice` 로 폴백한 채 녹음 시작 후에도 업그레이드 안 됨 → 선언은 있으나 실제 동작은 microphone 아님. |
| 공통 | 앱 복귀 시 recorder/track 상태 점검 없음 | 인터럽션·OS 회수로 track 이 `ended` 되면 녹음이 조용히 끊긴 채 UI 는 'recording'. |

## 3. 설계 선택 — A안(오디오 세션 + FGS + 복구), B안 미채택
- B(네이티브 녹음)는 m4a/aac 산출 → 서버 STT 가 webm 가정이라 **파일 형식 변경 필요** → 지시(서버·형식 불변)와 충돌. 네이티브 플러그인 신규 개발 범위도 큼.
- A 채택. 변경:
  1. iOS `AppDelegate`: category `.playAndRecord`, mode `.default`, options `[.allowBluetoothA2DP, .defaultToSpeaker]`(스피커 출력 유지, HFP 저음질 회피). `AudioSessionConfig` 로 분리해 단위 시험. 인터럽션 종료·미디어서비스 리셋 시 세션 재활성.
  2. Android: 호스트 `microphone` 옵션 = 온라인 **또는 녹음 중**. 녹음이 `recording` 이 되면(권한 허용 후) FGS 를 microphone 타입으로 재시작(`useBackgroundSession` startOptions 변화 → 정지/시작). MeasurementService.kt(BLE) 는 수정하지 않음.
  3. `useAudioRecorder`: 앱 복귀(`subscribeAppResume`, order audio) 시 track `ended`/recorder `inactive` 이면 새 스트림으로 recorder 재시작(청크 인덱스 이어서). 마이크 오프·동의 규칙은 호출부(변경 없음) 그대로.
- 서버 API·형식·contracts 불변. `NSMicrophoneUsageDescription`·동의·마이크 오프 규칙 불변.

## 4. 시험 계획
vitest(훅·background-session), xcodebuild 시뮬레이터 빌드+AudioSessionConfig 시험, gradlew assembleDevDebug/testDevDebugUnitTest, Note10 실기기(막히면 지점 보고). 상세는 verify.md.
