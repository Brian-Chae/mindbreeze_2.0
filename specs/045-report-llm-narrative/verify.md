# SDD-045 Verify — 구현 전 QA 체크리스트

## 1. 백엔드 LLM 서사
- [ ] 생체 지표 → 서사 LLM 호출
- [ ] Deepseek→Gemini 폴백
- [ ] 실패 시 규칙 폴백
- [ ] content에 narrative 필드

## 2. 프론트 서사형 디자인
- [ ] SDD-043 디자인 반영
- [ ] 섹션: 종합 → 몸 → 마음
- [ ] LLM 서사 + 변화량 표시

## 3. 회귀
- [ ] 기존 계약 하위호환
- [ ] BE pytest 통과, FE build 0 error
