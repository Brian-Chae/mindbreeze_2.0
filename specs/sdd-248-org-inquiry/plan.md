# SDD-248 Plan

## 백엔드
| 파일 | 내용 |
|---|---|
| `app/models/org_inquiry.py` + `models/__init__.py` | OrgInquiry 모델(status, notify_status, consented_at 포함) |
| `alembic/versions/e261027a0248_org_inquiries.py` | head `e261026c0001` 에 연결, 가역 |
| `app/schemas/org_inquiry.py` | Pydantic 검증(길이·enum·허니팟·동의) |
| `app/services/org_inquiry_service.py` | rate limit(Redis INCR+EXPIRE), 저장, 큐 적재, 발송 deliver |
| `app/api/v1/org_inquiries.py` + `v1/__init__.py` | `/public/org-inquiries` 라우터 |
| `app/tasks/email.py` | `send_org_inquiry_notice`(reply_to 지원 위해 `_send_email` 확장, 다중 수신) |
| `app/tasks/report_email_task.py` | `org_inquiry_notice_task` (email_app) |
| `app/config.py` | `org_inquiry_notify_email` |
## 프론트
| 파일 | 내용 |
|---|---|
| `lib/api/org-inquiry.ts` | API 클라이언트(skipAuth) |
| `components/landing/OrgInquiryForm.tsx` | 재사용 폼(검증·상태) |
| `components/landing/CTASection.tsx` | CTA 버튼 + 모달 |
## 테스트
backend `tests/test_sdd248_org_inquiry.py`, frontend `tests/org-inquiry-form.test.tsx`.
## Task 순서
모델/마이그레이션 → 스키마/서비스/API → 메일/태스크 → 백엔드 테스트 → 프론트 → 프론트 테스트 → summary.
