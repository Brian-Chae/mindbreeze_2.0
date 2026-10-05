# SDD-142 — 보안·무결성 3차 (11건) 요약

## 구현 결과

2개 그룹 병렬 구현 (백엔드 7건 + 프론트 4건).

| # | ID | 변경 | 파일 |
|---|---|---|---|
| 1 | AUTHZ-02 | 관리자 판정 membership 기반 통일 | `org.py` `membership_service.py` |
| 2 | CONC-01 | 청크 savepoint + IntegrityError 흡수 | `audio_service.py` `video_service.py` |
| 3 | AUTHZ-04 | 계정 잠금 이메일+IP 복합 키 | `login_attempt_service.py` `auth.py` |
| 4 | SEC-12 | 매직바이트(PDF/JPEG/PNG) 검증 | `credential_service.py` |
| 5 | CFG-01 | invite_url 설정 도메인 기반 | `client_service.py` |
| 6 | TXN-01 | notify_event flush 분리(commit 파라미터) | `notification_service.py` `counselor_info_service.py` |
| 7 | REM-01 | 리마인더 로그 원자적 선점 | `reminder_service.py` |
| 8 | SEC-03(FE) | VerifiedTier 단일 정의 + 'verified' 비교 | `credentials.ts` `auth.ts` `RoleGuard.tsx` `ClientEssentialsPage.tsx` |
| 9 | SEC-05(FE) | devAuth 동적 import(tree-shake) | `authStore.ts` `LoginPage.tsx` |
| 10 | SEC-06(FE) | 증빙 업로드 apiClient.postForm | `client.ts` `credentials.ts` |
| 11 | SEC-07(FE) | 내담자 프로필 useRequireRole | `ClientProfilePage.tsx` |

## 테스트

- 백엔드 `pytest -q` → **1009 passed / 12 skipped / 0 failed**
- 프론트 `vitest run` → **44 files / 318 tests**
- 프론트 `npm run build` → **0 errors**
- 테스트 갱신: `test_auth_login.py`(잠금 키 정책), `test_sdd075_org_management.py`·`test_sdd077_counselor_info.py`·`test_sdd078_admin_password_reset.py`(membership 기반 판정)

## 배포

GitHub Actions Deploy Dev.
