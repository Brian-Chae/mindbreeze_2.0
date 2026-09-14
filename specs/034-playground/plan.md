# SDD-034 Plan — Playground (명상 시뮬레이터)

## Task 분할 (단일 FE 워커 — cursor)

### T1. 명상 세션 스토어
- `frontend/src/stores/useMeditationSessionStore.ts` (Zustand)
- 상태: status(idle/running/stopped), elapsedSec, calmSec, generation, start()/stop()/reset()/tick(isCalm)
- 1초 tick으로 elapsedSec 증가, isCalm이면 calmSec 증가

### T2. 명상 시뮬레이터·패널
- `frontend/src/components/playground/PlaygroundMeditationSimulator.tsx`
  - 시작/중지/리셋 버튼 + 상태 배지 + 경과 타이머(mm:ss)
- `frontend/src/components/playground/PlaygroundMeditationPanel.tsx`
  - 효과적 휴식: calmSec + (calmSec/elapsedSec)%
  - 몸 3개: BPM · 호흡수 · HRV(SDNN) — ValueCard + pending(버퍼 충전) 표시
  - 마음 3개: 이완도(currentEfficiency) · 집중도(focusIndex) · 정서 안정도 — 게이지
  - 중지 시 요약: 평균 BPM/호흡수/SDNN/이완도

### T3. Playground 페이지·라우트
- `frontend/src/pages/playground/PlaygroundPage.tsx` + `App.tsx` `/playground` 라우트
- 명상 시뮬레이터 + (선택) 실기기 진단 패널 배치

## 구현 참고 (mindbreeze 재사용)
- `useBand` — currentEfficiency(이완), focusIndex(집중), stressIndex, heartRate, respiratoryRate, HRV(sdnn), isMock
- `useMockEeg()` + `mockDataGenerator` — mock 모드에서 지표 변동
- `VITE_USE_MOCK_EEG=true` 또는 playground에서 mock 전용으로 시뮬레이션

## 완료 기준
- `cd frontend && npm run build` 0 error
- `/playground` → 시작 → 몸/마음 지표 실시간 변동 → 중지(요약) → 리셋
