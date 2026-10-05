# [SDD-128] 뇌파 데이터 전송 신뢰성 — 중복 전송 · 접촉불량 표시

## Goal
1. EEG feature 중복 전송(REST 5초 배치 + WS 1초 실시간 이중)을 제거해 불필요 트래픽을 줄인다.
2. 접촉불량(lead_off)/링크 stale 시 이완도만 표시되는 모순을 해소한다.

## Context
- ②-22: 동일 window_index를 WS 1초 실시간 + REST 5초 배치로 이중 전송. 서버 멱등 키(play_group_id, window_index)가 전적으로 방어. SDD-108 이후 게스트도 feature_ack를 받으므로 WS 정상 시 REST 주기 flush는 불필요.
- ②-21: `readSnapshot`이 "밴드 없음"과 "접촉불량"을 한 분기로 합쳐, 접촉불량 시에도 이완도(remoteEfficiency)만 값이 표시.

## Scope
- `useBand.ts`: 5초 REST flush 타이머를 `wsConnectedRef` 가드로 WS 정상 시 중지. 실패 ACK(saved=0)는 큐에서 제거하지 않음. 주석 정정.
- `GuestMeditationPanel.tsx`: `readSnapshot` 분기를 분리해 접촉불량/stale 시 전 지표 null.

## Acceptance Criteria
- [ ] WS 정상 연결 시 REST 주기 flush가 중지된다(이중 전송 제거).
- [ ] 실패 ACK(saved=0)는 큐에 남아 REST 폴백이 재시도한다.
- [ ] 접촉불량 시 모든 지표가 '—'(미측정)으로 일관 표시된다.
- [ ] `npm run build` 0 errors.
