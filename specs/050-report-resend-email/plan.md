# SDD-050 Plan — 리포트 메일 재발송

## 워커: BE(codex) + FE(cursor) 병렬

### BE (codex)
- T1. report_email 노출 (participant.report_email)
- T2. resend_report_email 함수 + POST /reports/{id}/resend-email API

### FE (cursor)
- T1. ReportDetailPage 하단 재발송 섹션 (이메일 입력 + 재발송 버튼)
- T2. API 연동 + 성공/실패 피드백

## 완료 기준
- 재발송 시 수정한 메일로 발송
- BE pytest, FE build 0 error
