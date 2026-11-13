# [Fix] 녹음 끊김 감지·자동 재시작 (P0) — Plan

- 카드: `[MB261113][FIX] 녹음 끊김 감지·자동 재시작` / 브랜치 `fix/audio-recording-stall-guard`
- 유형: [Fix] (Spec 생략, 원인분석 → Verify → Fix → Test → Summary)
- 원인 진단 원문: `~/.hermes/share/briefs/audio-cutoff-1113-result.md`

## 1. 원인 분석 요약
11/4 몸돌봄 1회차: iOS 진행자 앱(네이티브 녹음)이 2분 49초에 캡처를 멈추고 재개하지 않음. 서버·네트워크·업로드는 정상, 서버는 계속 `recording`.
- (a) iOS 오디오 인터럽션 `began` 후 `ended` 미수신 → `StateMachine` 이 `paused(interruption)` 에 영구 잔류.
- (b) 마이크 끈 뒤 켜기 누락 — 의도된 동작이나 화면에서 "정지"와 구분이 안 됨.
- 후보: 오디오 엔진 설정 변경(라우트 변경) 후 `restartIfNeeded` 실패 → 서버에 알려지지 않음.
- 공통 결함: **감지 장치 없음.** 클라이언트는 `recording` 인데 청크가 안 늘어도 경고·복구가 없다.

## 2. 변경안
### 2.1 클라이언트 정지 감지 (웹·iOS·Android 공통) — `frontend/src`
- 신규 `hooks/useRecordingStallGuard.ts`: `active`(= 상태가 `recording`) 일 때 5초마다 진행 신호(네이티브 `getStatus().nextChunkIndex+uploadedCount`, 웹 `indexRef`/업로드 수)를 읽는다. **30초 동안 불변이면** `stalled=true` + 자동 복구 1회(`onStall`). 신호가 늘면 `stalled=false`, 시도 횟수 초기화.
  - `active=false`(일시정지·마이크 꺼짐·정지·오류)에서는 타이머를 끄고 기준선을 리셋 → **마이크 끔을 정지로 오판하지 않는다.**
- `hooks/useAudioRecorder.ts`:
  - `stalled`, `restartRecording()`(수동 [녹음 다시 시작]), `pausedByInterruption`(`stateChanged.reason==='interruption'`) 노출.
  - 자동 복구(1회) = 네이티브 `getStatus` 확인 후 `resume()`(iOS 는 엔진 재기동 포함). 수동 재시작 = 네이티브 `stop()` → 같은 세션 `startChunkIndex=lastChunkIndex+1` 로 `start()`, 웹은 recorder/stream 재생성(`attachRecorder`, 인덱스 이어서).
- `HostLiveContainer.tsx`: `errorBanners` 에 정지 경고 배너 추가(문구 한 줄 + [녹음 다시 시작]); 인터럽션 일시정지는 별도 안내.
- `host-player-case.ts`: 마이크 꺼짐 배너 제목을 `마이크 꺼짐 · 녹음 일시정지` 로 명확화(진단 P1 중 이 부분만).

### 2.2 iOS 인터럽션 복구 — `frontend/ios`
- `AudioRecorderKit` 신규 `InterruptionWatchdog`(순수 로직, 주입 시계): `began` 시각 기록, `ended` 해제, `shouldAttempt(now)` — 10초 경과 시 true, 시도 후 다음 시도는 다시 10초 뒤.
- `AudioCaptureEngine`: 인터럽션 중 2초 주기 점검 → 10초 넘으면 `restartIfNeeded()` 성공(엔진 가동) 시에만 `onInput(.interruptionEnded)`. 실패하면 다음 10초에 재시도(전화 통화 중 등 정당한 인터럽션은 상태 유지).
- 앱 포그라운드 복귀(`didBecomeActive`)·오디오 라우트 변경에서도 `recheck()`: 인터럽션 잔류면 즉시 시도, 엔진이 멈춰 있으면 재기동. `restartIfNeeded` 는 성공 여부(Bool)를 반환.
- LiveKit 연결 변화는 JS 쪽 정지 감지(2.1)가 커버(30초 이내 감지·복구).

### 2.3 Android — 코드 확인 결과
- Android 는 `AudioRecord` 직접 캡처(`RecorderEngine`)이며 iOS 와 같은 인터럽션 `paused` 상태가 **없다**. 읽기 실패(`n<0`)는 `fail()` → 비복구 `error` 로 JS 에 전달되어 정지가 아닌 오류로 표시된다.
- 다만 `read` 가 블록/무진행하는 무음 정지는 가능성이 남으므로 2.1 의 JS 감지·수동 재시작(네이티브 stop→start)이 동일하게 적용된다. Android 네이티브 코드 변경 없음.

## 3. 서버
변경 없음. (P1 서버 무청크 알림은 후속.)

## 4. Task
1. 문서(plan·verify) 커밋
2. `useRecordingStallGuard` + vitest (RED→GREEN)
3. `useAudioRecorder` 연동 + 배너 + vitest
4. iOS `InterruptionWatchdog` + Swift 테스트 + 엔진 연동
5. tsc / vitest / swift test / xcodebuild 확인 → summary.md
