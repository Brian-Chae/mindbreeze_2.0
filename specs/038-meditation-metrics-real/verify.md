# SDD-038 Verify — 구현 전 QA 체크리스트

## 1. 데이터 소스
- [ ] mockDataGenerator 직접 호출 제거
- [ ] 마음 지표 = band.scoredIndices (0~100)
- [ ] 몸 지표 = band.heartRate/respiratoryRate/sdnn

## 2. 그래프
- [ ] 몸 그래프(BPM/호흡수/SDNN) 시계열 표시
- [ ] 마음 그래프(이완/집중/정서) 시계열 표시

## 3. 회귀
- [ ] 효과적 휴식·세션 요약 정상
- [ ] mock/실기기 전환 무관 동작
- [ ] build 0 error
