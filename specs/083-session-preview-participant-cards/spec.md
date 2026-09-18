# SDD-083 — 세션 시작 프리뷰 + 내담자 상태 카드

> Mind Breeze MVP1: 세션 시작 전 카메라/마이크 프리뷰(zoom형) + 내담자 상태 카드 뷰 + 카드 상세(상태 변화).
> 기존 코드 재사용 위주 FE 작업. **claude(fable) 위주로 개발**. (영상 녹화 저장은 SDD-084로 분리)

## 1. 배경
- 기존: `SessionLivePage.tsx`(752줄)에 호스트 콘솔 + LiveKit 화상 + 녹음 + 내담자 모니터링 테이블이 이미 있음
- 기존 내담자 모니터링은 `SessionMonitorTable.tsx`(테이블) 형태
- 세션 시작은 `SessionDetailPage`의 "시작" 버튼 → `transitionSession('start')` → SessionLivePage 진입

## 2. 요구 (Brian)
1. 세션 시작 버튼 → **바로 시작 X**, 카메라/마이크를 열어 상태 확인(zoom 프리조인 형태) 후 시작
2. 세션 중 → 상담사 전면/후면 카메라 영상 + 음성 레코딩 표시 + 내담자 상태 **카드**(카드별)
3. 카드 선택 → 내담자 현재 상태 + 세션 동안 상태 변화 데이터 확인

## 3. 구현 범위

### T1. 세션 시작 전 카메라/마이크 프리뷰 (FE)
- SessionLivePage 진입 시 "시작 전 프리뷰" 상태 추가
- `getUserMedia`로 카메라/마이크 열어 프리뷰 표시 (전면/후면 카메라 전환)
- 프리뷰 확인 후 "세션 시작" 버튼 → `transitionSession('start')` → 본 세션 시작
- 브라우저 미지원/권한 거부 시 안내 (Web Bluetooth·미디어 제약 고려)

### T2. 내담자 상태 카드 뷰 (FE)
- 기존 `SessionMonitorTable`(테이블) → **카드 그리드**로 전환 (또는 병행)
- 카드 내용: 이름/게스트 여부 + LINK BAND 연결 상태 + 배터리 + 현재 지표(집중도/이완도/스트레스)
- 카드 상태 시각화 (연결됨/끊김/배터리 부족 배지)

### T3. 카드 선택 → 상세 뷰 (FE)
- 카드 클릭 → 상세 패널/모달
- 현재 상태(실시간 지표) + 세션 동안 상태 변화(시계열 차트)
- 기존 `SessionMonitorSummary`/live-metrics/EEG feature 데이터 재사용

## 4. 재사용 (수정 최소화)
- `useLiveKit.ts`, `VideoConference.tsx` (LiveKit 화상)
- `useAudioRecorder.ts` (음성 녹음)
- `useBand.ts` + EEG feature WS (LINK BAND 실시간)
- `SessionMonitorSummary.tsx`, `SessionMonitorTable.tsx` (모니터링 데이터)
- `session-live/signal-status.ts` (상태 판정 유틸)

## 5. 주의
- LINK BAND 미착용 내담자도 카드에 정상 표시 (밴드 없음 상태)
- 실시간 데이터는 1초 튀는 표시보다 스로틀/평균으로 차분 표시 (Brian 선호)
- 카메라 프리뷰는 LiveKit 접속 전 별도 getUserMedia 사용 (토큰 불필요)
- 내담자 영상/음성 저장은 하지 않음 (온라인 클래스 정책 — SDD-084에서 녹화 정책과 함께)

## 6. 완료 기준
- 세션 시작 전 카메라/마이크 프리뷰 → 확인 후 시작
- 내담자 상태 카드 그리드 + 카드 상세(현재+변화 시계열)
- FE build 0 error, 기존 BE pytest 통과 (FE 위주라 BE 변경 최소)
