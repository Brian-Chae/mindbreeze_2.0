# SDD-148 — 인증·계정 정합 요약

## 구현 결과

| # | ID | 변경 | 파일 |
|---|---|---|---|
| 1 | MB2-AUTH-01 | google_auth `_ensure_account_active` 호출 | `api/v1/auth.py` |
| 2 | MB2-AUTH-02 | 이메일 lower 정규화 + 조회 통일 + alembic `e036a0000030` | auth.py, password_reset/org/signup/dev_user/admin/client_service.py, alembic 마이그레이션 |

## 검증

- 백엔드 `pytest -q` **1018 passed / 12 skipped / 0 failed**
