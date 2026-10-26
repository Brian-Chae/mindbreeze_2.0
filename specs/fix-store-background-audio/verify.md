# Verify — 구현 전 체크리스트
## 단위(vitest)
- V1 호스트 오프라인 수업이라도 녹음 중이면 FGS 시작 옵션 microphone=true.
- V2 녹음 시작 전(로비) 온라인이 아니면 microphone=false(기존 동작 유지), 온라인이면 기존대로 true.
- V3 회원 role 은 항상 옵션 undefined(기존 V41 유지).
- V4 앱 복귀 시 state='recording' 이고 track.readyState='ended' → 새 getUserMedia + 새 MediaRecorder 시작, 다음 청크 인덱스 이어짐(중복·역행 없음).
- V5 복귀 시 track live 면 재시작하지 않음. state!='recording'(idle/stopped/paused)이면 아무 것도 안 함(마이크 오프 규칙).
- V6 stop 후 복귀 구독 해제.
## iOS
- V7 AudioSessionConfig: category=playAndRecord, options 에 allowBluetoothA2DP·defaultToSpeaker 포함, mixWithOthers 미포함.
- V8 Info.plist UIBackgroundModes 에 audio·bluetooth-central 유지.
- V9 xcodebuild 시뮬레이터 빌드 성공.
## Android
- V10 gradlew assembleDevDebug, testDevDebugUnitTest 통과. Manifest: FOREGROUND_SERVICE_MICROPHONE·서비스 타입 유지, MeasurementService.kt 미변경.
## 실기기(Note10 R3CMA0C3Y4T)
- V11 dev APK 설치, 클래스 녹음 중 홈 버튼 2분+ → 업로드 청크 연속(인덱스 간격 없음, 5초 주기), logcat FGS microphone 타입 확인.
- V12 시험 후 deviceidle·battery 원복.
