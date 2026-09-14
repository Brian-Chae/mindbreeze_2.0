# SDD-034 FE 구현 보고 (cursor worker)

> task: `task_e50b1e03f2ee` · dispatch: `ctx_11597bd27c66`  
> 완료: 2026-09-14

## 구현 요약

haru_band_app 명상 시뮬레이터를 mindbreeze frontend에 이식했다.
LINK BAND 없이 `mockDataGenerator` 1초 tick으로 몸/마음 지표가 변동한다.

## 산출 파일

| Task | 경로 |
|------|------|
| T1 | `frontend/src/stores/useMeditationSessionStore.ts` |
| T2 | `frontend/src/components/playground/PlaygroundMeditationSimulator.tsx` |
| T2 | `frontend/src/components/playground/PlaygroundMeditationPanel.tsx` |
| T2 | `frontend/src/components/playground/MetricGauge.tsx` (ValueCard 포함) |
| T3 | `frontend/src/pages/playground/PlaygroundPage.tsx` |
| T3 | `frontend/src/App.tsx` — `path="/playground"` 추가 |

## 동작

1. `/playground` → 명상 시뮬레이터 표시 (대기)
2. **시작** → status=`running`, 1초마다 mock EEG/PPG 지표 갱신 + `tick(isCalm)`
3. 몸: BPM · 호흡수 · SDNN (3초 버퍼 충전 후 표시)
4. 마음: 이완도 · 집중도 · 정서 안정도 게이지
5. **중지** → 평균 BPM/호흡수/SDNN/이완도 요약
6. **리셋** → idle 초기화 (`generation` 증가)

## 설계 메모

- `useBand`는 sessionId·IndexedDB 큐·WS 의존이 있어 playground mock 경로에 직접 연결하지 않음.
  동일 지표 계약(이완/집중/스트레스/BPM/호흡/SDNN)을 `mockDataGenerator`로 충족.
- `lucide-react` 미설치 → 기존 `StrokeIcon`으로 Play/Pause/Reset 아이콘 대체.
- `/join`, `/sessions` 라우트·라이브 훅 미변경.

## 검증

- [x] `cd frontend && npm run build` — **0 error** (tsc + vite 성공)
- [ ] 브라우저 E2E: `/playground` 시작→변동→중지→리셋 (수동 확인 권장)

## 남은 것

- 브라우저에서 `/playground` 수동 스모크
- (선택) 실기기 진단 패널을 같은 페이지에 추가하거나, `useBand` mock 모드와 통합
