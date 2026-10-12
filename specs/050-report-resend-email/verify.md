# SDD-050 Verify — 구현 전 QA 체크리스트

## 1. BE
- [ ] report_email 노출
- [ ] resend_report_email 함수
- [ ] POST /reports/{id}/resend-email API (상담사 전용)

## 2. FE
- [ ] 하단 재발송 섹션 (기본값 채움)
- [ ] 재발송 버튼 + 피드백

## 3. 회귀
- [ ] client 리포트만 대상
- [ ] host 권한 확인
- [ ] BE pytest, FE build 0 error
