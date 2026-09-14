# SDD-038 — 명상 지표 실제 데이터 기반 전환 + 몸/마음 그래프

> PlaygroundMeditationPanel의 마음 지표(이완도·집중도·정서안정도)가 현재 mockDataGenerator로 생성되고 있다.
> useBand의 실제 지표(haru 정본 정규화 적용)로 교체하고, 몸/마음 시계열 그래프를 추가한다.

## 1. 배경·목표

SDD-035(스펙트럼)·037(지표 수식)·036(표준 모델 정규화)로 신호처리·지표·정규화가 haru 정본과 정합됐다.
그런데 명상 시뮬레이터(P5 명상 지표)는 여전히 `mockDataGenerator` + 랜덤 호흡수(12+rand*8)를 쓴다.
useBand가 이미 실제 지표를 노출하므로, 이를 연결해 haru와 동일한 수치가 표시되게 한다.

## 2. useBand 노출 지표 (이미 존재)

| 지표 | 필드 | 단위 |
|------|------|------|
| 이완도 | `scoredIndices.relaxationIndex` | 0~100 |
| 집중도 | `scoredIndices.focusIndex` | 0~100 |
| 정서 안정도 | `scoredIndices.emotionalStability` | 0~100 |
| 스트레스 | `scoredIndices.stressIndex` | 0~100 |
| 심박수 | `heartRate` | bpm |
| 호흡수 | `respiratoryRate` | 회/분 |
| HRV | `sdnn` / `rmssd` | ms |

## 3. 구현 범위

### T1. 데이터 소스 교체 (mock → useBand 실제)
- `PlaygroundMeditationPanel`에 `band`(UseBandResult) prop 전달
- running 중 1Hz tick에서 `mockDataGenerator` 호출 제거 → `band.scoredIndices` + `band.heartRate`/`respiratoryRate`/`sdnn` 사용
- mock 연결(useMock)일 때는 mockDataGenerator가 band로 흐르므로 동일 경로

### T2. 몸/마음 시계열 그래프 추가
- `PlaygroundMeditationPanel` 하단에 Recharts LineChart 2개:
  - 몸 그래프: BPM · 호흡수 · SDNN (1Hz 누적 시계열)
  - 마음 그래프: 이완도 · 집중도 · 정서 안정도 (0~100)
- TrendPanel의 useRef 링버퍼 패턴 재사용 (stale closure 방지)

### T3. PlaygroundPage 연결
- `<PlaygroundMeditationSimulator />` → band/connected 전달
- PlaygroundMeditationSimulator → PlaygroundMeditationPanel로 band prop 전달

## 4. 주의
- mock/실기기 전환(useMock)과 무관하게 동일 경로로 동작 (mock이면 mockDataGenerator가 band에 주입됨)
- 기존 효과적 휴식(calmSec)·세션 요약 로직 유지 (isCalmState 임계값 유지)
- mindbreeze 디자인 토큰(#5F0080, bg-white)

## 5. 완료 기준
- `npm run build` 0 error
- 명상 지표가 mock이 아닌 실제 band 지표 표시
- 몸/마음 그래프가 시계열로 쌓임
