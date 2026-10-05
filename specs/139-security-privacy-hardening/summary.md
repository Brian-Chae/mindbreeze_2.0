# SDD-139 — 보안·프라이버시 2차 하드닝 (10건) 요약

## 구현 결과

3개 그룹으로 병렬 구현 완료. 백엔드 9건 + 프론트 1건.

| # | ID | 변경 | 파일 |
|---|---|---|---|
| 1 | SEC-06 | OTP 실패 카운터(5회) → 초과 시 폐기 | `otp_service.py` |
| 2 | SEC-07 | 재설정 메일 60초 쿨다운 + 절대 URL | `password_reset_service.py` |
| 3 | SEC-08 | 공개 기관 상세에서 ceo_name·biz_number·phone 제거 | `org.py` `schemas/org.py` |
| 4 | SEC-09 | 내담자 list/profile/memo `status=='active'` 필터 | `client_service.py` |
| 5 | SEC-10 | 공개 클래스 목록에서 access_code 제거 | `org_public_service.py` `schemas/org_public.py` |
| 6 | SEC-11 | 레거시 /register 가 email_verify_token·consents 강제 | `auth.py` |
| 7 | DATA-02 | Refresh 회전 원자화(UPDATE WHERE revoked_at IS NULL) | `refresh_token_service.py` |
| 8 | DATA-04 | 초대 토큰 created_at 7일 만료 | `client_service.py` |
| 9 | OUT-01 | 이메일 아웃박스 FOR UPDATE SKIP LOCKED | `tasks/outbox.py` |
| 10 | SEC-02(FE) | localStorage 즉시 인증 → refresh 검증 후 확정 | `authStore.ts` |

## 테스트

- 백엔드 `pytest -q` → **1009 passed / 12 skipped / 0 failed**
- 프론트 `vitest run` → **44 files / 318 tests** (브라우저 4파일은 vite 5175 기동)
- 프론트 `npm run build` → **0 errors**
- 테스트 2파일 신규 정책 반영 갱신: `test_org_public.py`, `test_sdd016_org_admin_onboarding.py`

## 배포

GitHub Actions Deploy Dev.
