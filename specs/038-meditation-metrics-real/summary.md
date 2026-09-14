# SDD-038 Summary — 명상 지표 실제 데이터 + 몸/마음 그래프

## 구현 결과

### 데이터 소스 교체 (mock → useBand 실제)
- `mockDataGenerator` 직접 호출 제거
- 마음 지표 = `band.scoredIndices` (relaxationIndex/focusIndex/emotionalStability/stressIndex, 0~100)
- 몸 지표 = `band.heartRate`/`respiratoryRate`/`sdnn`

### 몸/마음 시계열 그래프 추가
- 몸 시계열: BPM · 호흡수 · SDNN (1Hz 링버퍼)
- 마음 시계열: 이완도 · 집중도 · 정서 안정도 (0~100)

### 배선
- PlaygroundMeditationSimulator → Panel로 band prop 전달
- PlaygroundPage에서 `<PlaygroundMeditationSimulator band={band} connected={connected} />`

## 검증·배포
- `npm run build` 0 error
- 커밋 `8b9c10c` → Deploy Dev `34815252727` 성공
