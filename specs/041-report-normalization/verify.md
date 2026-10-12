# SDD-041 Verify — 구현 전 QA 체크리스트

## 1. sigmoid 이식
- [ ] transformRaw(ln/abs) + sigmoidScore 동작
- [ ] 프론트 eegSigmoidScore와 동일 수식

## 2. 리포트 적용
- [ ] 활성 표준 모델 있으면 sigmoid 정규화 적용
- [ ] 없으면 코호트 상수 fallback
- [ ] normalization_source 표기

## 3. 회귀
- [ ] 기존 코호트 점수 로직 유지 (fallback)
- [ ] BE pytest 통과
