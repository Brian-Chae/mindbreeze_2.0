# SDD-248 Summary

## 구현
- `POST /api/v1/public/org-inquiries` (비로그인, 201) — `backend/app/api/v1/org_inquiries.py`
- 서비스: rate limit(IP당 10분 5건, Redis INCR/EXPIRE, Redis 장애 시 fail-open)·저장·큐 적재·발송 — `services/org_inquiry_service.py`
- 모델/마이그레이션: `models/org_inquiry.py`, `alembic/versions/e261027a0248_org_inquiries.py` (down_revision `e261026c0001`, 가역)
- 메일: Celery `email_app` 태스크 `tasks.org_inquiry_notice` (`tasks/report_email_task.py`) → `tasks/email.py::send_org_inquiry_notice` → Resend. `_send_email` 에 다중 수신·reply_to 확장(기존 호출 호환).
- 프론트: `components/landing/OrgInquiryForm.tsx`(재사용 폼), `CTASection.tsx`(CTA 버튼+모달), `lib/api/org-inquiry.ts`. 기존 mailto 링크는 푸터에 유지.

## 결정
- 기존 `/signup-applications/organization`(가입 상담)과 분리 — 영업 문의는 계정 흐름과 무관.
- IP 는 Redis 키(TTL 10분)에만 사용, DB·메일 미기재.
- 허니팟 채움 → 422(저장·메일 없음). 메일 실패/큐 실패여도 접수 201, notify_status(pending/queued/sent/failed)로 추적, Celery autoretry 3회.

## 테스트 결과
- backend `tests/test_sdd248_org_inquiry.py` 21 passed; 인접 회귀(signup/public/org_public/email) 84 passed.
- frontend `tests/org-inquiry-form.test.tsx` 4 passed; `tsc -b` 0 error; 전체 vitest 17 fail/8파일(기준선 동일, 신규 실패 0).

## 운영 반영 사항
1. 마이그레이션: `alembic upgrade head` (org_inquiries 생성, 신규 테이블이라 락 영향 없음).
2. 환경변수: `ORG_INQUIRY_NOTIFY_EMAIL`(선택, 기본 brian.chae@looxidlabs.com, 쉼표 다중). `RESEND_API_KEY`·`RESEND_FROM_EMAIL` 이 설정돼 있어야 실발송.
3. `mindbreeze-email-worker`(Celery email_app, `-Q email`) 재시작 — 신규 태스크 등록 필요.
4. 프록시 뒤라면 `request.client.host` 가 프록시 IP 가 되지 않도록 uvicorn `--proxy-headers`/forwarded-allow-ips 확인(그렇지 않으면 전체 사용자가 한 IP 로 rate limit).
5. 개인정보 보관 1년: org_inquiries 보관 만료 삭제 배치는 미구현(후속).

## 남은 위험
- 보관 1년 자동 삭제·관리자 처리(handled) 화면 미구현.
- 허니팟/레이트리밋만으로는 정교한 스팸 방어 한계(CAPTCHA 미도입).
- 실제 Resend 발송은 로컬에서 검증 불가(mock 검증) — dev 배포 후 실메일 확인 필요.
