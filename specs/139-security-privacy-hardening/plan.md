# SDD-139 — 구현 계획

## 접근 방식

10건을 3개 그룹으로 병렬 구현 후 전체 테스트로 회귀 검증.

| 그룹 | 건 | 수정 방식 |
|---|---|---|
| A. 인증·가입·토큰 | SEC-06/07/11, DATA-02/04 | Redis 실패 카운터·쿨다운, 원자 UPDATE, created_at 만료 |
| B. 프라이버시·접근제어 | SEC-08/09/10, OUT-01 | 공개 스키마 최소화, active 연결 필터, SKIP LOCKED |
| C. 프론트 인증 | SEC-02(FE) | refresh 검증 전 isInitialized=false |

## 건별 설계

1. **SEC-06** `otp_service.verify_otp` — Redis 이메일별 실패 카운터, 5회 초과 시 OTP 삭제. 성공 시 카운터 삭제.
2. **SEC-07** `password_reset_service.initiate_reset` — 이메일별 Redis 쿨다운(60초) + reset_link 절대 URL(frontend_base_url).
3. **SEC-08** `org.py get_org`/`_serialize_org` — 공개 응답에서 ceo_name/biz_number/phone 제거.
4. **SEC-09** `client_service` list/get_profile/update_memo — `ClientCounselorLink.status == 'active'` 필터 추가.
5. **SEC-10** `org_public_service`/`schemas/org_public` — 공개 응답에서 access_code 제거.
6. **SEC-11** `auth.py /register` — 레거시 경로 검증 강제/폐쇄.
7. **DATA-02** `refresh_token_service.rotate_refresh_token` — `UPDATE ... WHERE revoked_at IS NULL` 원자 회전.
8. **DATA-04** `client_service` 초대 수락 — `created_at` 기준 7일 경과 시 만료(마이그레이션 없이).
9. **OUT-01** `outbox.process_email_outbox` — `SELECT ... FOR UPDATE SKIP LOCKED`.
10. **SEC-02(FE)** `authStore.initialize` — refresh 검증 성공 전 `isInitialized=false` 유지, 검증 후에만 `isAuthenticated` 확정.

## 검증

- 백엔드 `pytest -q` → 1009 passed / 0 failed
- 프론트 `vitest run`(브라우저 4파일은 vite 5175 기동) → 44 files / 318 tests
- 프론트 `npm run build` → 0 errors
