# SDD-048 Verify — 구현 전 QA 체크리스트

## 1. pre-seeding
- [ ] 규칙 기반으로 대표 패턴 캐시 채우기
- [ ] source='rule'로 저장

## 2. 주기적 업그레이드
- [ ] source='rule' 항목 일부만 LLM 재생성
- [ ] 매회 개수 제한 (비용 제어)

## 3. 회귀
- [ ] 캐시 조회/저장 동작 유지
- [ ] BE pytest 통과
