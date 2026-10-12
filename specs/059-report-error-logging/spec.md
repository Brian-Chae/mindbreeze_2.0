# SDD-059 — 리포트 발행/메일 에러 처리·로깅 개선

> 리포트 발행·메일 발송 실패 시 상태를 명확히 하고 로깅을 강화한다.

## 1. 배경
- report_task가 실패 시 status="error"만 기록, 구체 사유 없음.
- 메일 발송 실패 시 report_email_status="failed"만 기록.

## 2. 구현 범위 (BE codex)
- `generate_report_inline` 실패 시: status="error" + content.error_message에 구체 사유 저장 (예외 메시지)
- `deliver_report_email`/`send_report_email` 실패 시: 로깅에 컨텍스트(report_id, participant) 강화
- 예외 로깅에 session_id/report_id 포함

## 3. 완료 기준
- 실패 시 구체 사유가 상태/로그에 남음
- BE pytest 통과
