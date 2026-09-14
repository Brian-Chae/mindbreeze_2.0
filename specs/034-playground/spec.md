# SDD-034 — Playground (생체신호 진단 + 명상 시뮬레이터)

> haru_band_app의 Playground(admin/playground) 패턴을 mindbreeze에 이식.
> 핵심은 **명상 시뮬레이터** — "명상 중이라고 가정 → 시작 → 몸/마음 지표 실시간 표시 → 중지(요약) → 리셋".

## 1. 배경·목표

haru_band_app의 playground에는 `PlaygroundMeditationSimulator`(시작/중지/리셋 + 명상 지표)가 있다.
LINK BAND 없이도(또는 연결해서) 명상 세션을 시뮬레이션하며 몸·마음 지표를 검증한다. 목표:

1. **명상 시뮬레이터** — 시작 → 지표 수집 → 중지(요약) → 리셋
2. **몸 지표 3개** — BPM · 호흡수 · HRV(SDNN) + 해석
3. **마음 지표 3개** — 이완도 · 집중도 · 정서 안정도
4. **효과적 휴식** — 고요 구간 누적(calmSec) + 비율
5. **세션 요약** — 중지 시 평균 지표 표시

## 2. haru_band_app 이식 대상 (정밀 분석)

### PlaygroundMeditationSimulator (컨테이너)
- 시작/중지/리셋 버튼 + 상태 배지(idle=대기/running=진행 중/stopped=종료) + 경과 타이머(mm:ss)
- `useMeditationSessionStore`: status, elapsedSec, start/stop/reset

### PlaygroundMeditationPanel (지표 뷰)
- **효과적 휴식**: calmSec 누적 + (calmSec/elapsedSec)%
- **몸 3개**: BPM, 호흡수, HRV=SDNN — ValueCard + 해석(interpretHeartRate/interpretBreathingRate/interpretBodyMetric)
- **마음 3개**: 이완도, 집중도, 정서 안정도 — MetricGauge + SQI stale
- **중지 시 요약**: avgHeartRate, avgBreathingRate, avgSdnn, avgBrainRest 등

## 3. mindbreeze 이식 설계

### 재사용 (mindbreeze `useBand`가 이미 노출)
- 이완도=currentEfficiency, 집중도=focusIndex, 정서 안정도=emotionalStability(있으면), 스트레스=stressIndex
- 몸: heartRate, respiratoryRate, HRV(sdnn 등)
- mock 모드: `useMockEeg()` + `mockDataGenerator` (LINK BAND 없이 시뮬레이션)

### 신규
- `useMeditationSessionStore` — status(idle/running/stopped), elapsedSec, calmSec, start/stop/reset, tick
- `PlaygroundMeditationSimulator` — 시작/중지/리셋 + 타이머
- `PlaygroundMeditationPanel` — 몸 3개 + 마음 3개 + 효과적 휴식 + 요약

## 4. 구현 계획

### T1. 명상 세션 스토어
- `frontend/src/stores/useMeditationSessionStore.ts` (Zustand)
- status(idle/running/stopped) + elapsedSec + calmSec + start/stop/reset

### T2. 명상 시뮬레이터·패널
- `frontend/src/components/playground/PlaygroundMeditationSimulator.tsx` — 시작/중지/리셋 + 타이머
- `frontend/src/components/playground/PlaygroundMeditationPanel.tsx` — 몸/마음 지표 + 효과적 휴식 + 요약
- mock 데이터로 1초 tick 시 지표 갱신 (useBand mock 모드 재사용)

### T3. Playground 페이지·라우트
- `frontend/src/pages/playground/PlaygroundPage.tsx` + `App.tsx` `/playground`
- 실기기 진단 패널(연결/지표/밴드파워) + 명상 시뮬레이터 배치

## 5. 검증 기준
- `/playground` → 명상 시뮬레이터 "시작" → 몸/마음 지표 실시간 표시
- "중지" → 세션 요약 표시, "리셋" → 초기화
- LINK BAND 없이 mock 데이터로 동작
- `npm run build` 0 error
