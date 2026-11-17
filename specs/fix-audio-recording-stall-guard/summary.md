# [Fix] 녹음 끊김 감지·자동 재시작 — Summary

## 구현
- (a) iOS 인터럽션 ended 미수신 → `InterruptionWatchdog`(10초) + `AudioCaptureEngine` 가 2초 주기·포그라운드 복귀·라우트 변경 시 `restartIfNeeded()` 성공하면 `interruptionEnded` 합성. 사용자 일시정지는 상태기계가 그대로 유지.
- (b) 마이크 꺼짐 → 정지로 오판하지 않음(`active=false`) + 배너 제목 `마이크 꺼짐 · 녹음 일시정지`.
- 공통: `useRecordingStallGuard`(30초 무증가 → 경고 + 자동 복구 1회), `useAudioRecorder` 의 `stalled`/`restartRecording`/`pausedByInterruption`, 호스트 화면 오류 배너 + [녹음 다시 시작].
- Android: 인터럽션 paused 상태 없음(코드 확인). 무음 정지는 JS 감지·수동 재시작이 동일 적용. 네이티브 변경 없음.
- 서버 변경 없음.

## 테스트
- vitest 신규 12건(`recording-stall-guard` 6, `recording-stall-hook` 5, 컨테이너 V11 1) + 기존 녹음·호스트 플레이어 8개 파일 169건 통과.
- 전체 vitest: 실패 16파일은 변경 전(기준선)에도 동일 — 12개 파일 39건 재현, 4개는 `.cjs` 브라우저 스위트. 녹음 관련 아님.
- `swift test`(AudioRecorderKit) 27건 통과(신규 7건). `swiftc -typecheck`(iphonesimulator SDK)로 `AudioCaptureEngine.swift` 오류 0.
- `npx tsc --noEmit -p .` 오류 0.
- `xcodebuild` 앱 타깃 풀 빌드는 하지 않음(SPM 원격 패키지 내려받기 필요·빌드 금지 지침).
