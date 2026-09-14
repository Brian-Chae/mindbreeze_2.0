# SDD-038 Plan — 명상 지표 실제 데이터 + 몸/마음 그래프

## 워커: 단일 FE (cursor)

### T1. 데이터 소스 교체
- `PlaygroundMeditationPanel.tsx`: `mockDataGenerator` import 제거
- `band: UseBandResult` prop 추가 → running tick에서 `band.scoredIndices` + `band.heartRate/respiratoryRate/sdnn` 사용
- `PlaygroundMeditationSimulator.tsx`: band prop 수용 → Panel로 전달
- `PlaygroundPage.tsx`: `<PlaygroundMeditationSimulator band={band} connected={connected} />`

### T2. 몸/마음 그래프
- Panel 하단에 Recharts LineChart 2개 (몸: BPM/호흡수/SDNN, 마음: 이완/집중/정서)
- 1Hz 링버퍼 (useRef 패턴, MAX_POINTS=300)

### T3. 효과적 휴식·요약 유지
- 기존 calmSec/isCalmState/세션요약 로직 유지

## 완료 기준
- build 0 error
- 실제 band 지표 표시 + 그래프 시계열
