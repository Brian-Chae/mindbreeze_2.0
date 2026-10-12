# SDD-148 — 구현 계획

## MB2-AUTH-01 (auth.py)

- google_auth `if user:` 블록 첫 줄에 `_ensure_account_active(user)` 호출.
- login/refresh/deps 와 동일 정책.

## MB2-AUTH-02 (이메일 정규화)

- 저장: `_create_user_with_role`, register, google_auth 등에서 `.strip().lower()`.
- 조회: login/중복검사/비번재설정/기관/신청 등에서 `func.lower(User.email)` 통일.
- 적용 파일: auth.py, password_reset_service.py, org_service.py, signup_application_service.py, dev_user_service.py, admin_service.py, client_service.py.
- alembic `e036a0000030_normalize_user_emails.py`: lower(trim()) 중복 사전 탐지 → 있으면 중단, 없으면 일괄 백필. downgrade no-op.

## 테스트

- `test_mb2_auth_email_status.py` 신규 8건.
