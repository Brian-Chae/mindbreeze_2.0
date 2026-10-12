# SDD-049 Verify — 구현 전 QA 체크리스트

## 1. BE
- [ ] auto_approve_report 컬럼 + 마이그레이션
- [ ] 자동 승인 ON → 생성 직후 completed + sent_at
- [ ] GET/PATCH auto-approve API

## 2. FE
- [ ] 우상단 토글 스위치
- [ ] 설정 조회 + PATCH

## 3. 회귀
- [ ] 수동 승인(기존) 동작 유지
- [ ] counselor만 적용
- [ ] BE pytest, FE build 0 error
