# SDD-052 Verify — 구현 전 QA 체크리스트

## 1. BE
- [ ] report_view 토큰 검증 API (content JSON)
- [ ] 메일 링크 /report-view?token= 변경

## 2. FE
- [ ] /report-view 토큰 열람 라우트
- [ ] NarrativeSections 재사용 (상담사 동일)

## 3. 회귀
- [ ] 토큰 만료/무효 처리
- [ ] 점수 노출 최소화
- [ ] BE pytest, FE build 0 error
