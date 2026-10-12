# SDD-148 — 인증·계정 정합 (2건)

## 배경

기능 오류 전수조사 상(상) 10건 중 인증·계정 정합 2건.

## 대상

| # | ID | 이슈 |
|---|---|---|
| 1 | MB2-AUTH-01 | Google OAuth 로그인이 계정 상태(suspended/pending) 미검사 → 정지 계정도 세션 발급 |
| 2 | MB2-AUTH-02 | 이메일 대소문자 정규화 없음 → 로컬파트 대소문자 다른 중복 계정 |

## 변경

1. **MB2-AUTH-01** — google_auth 기존 사용자 분기에 `_ensure_account_active(user)` 호출(pending/suspended 403).
2. **MB2-AUTH-02** — 저장 `.strip().lower()` + 조회 `func.lower(User.email)` 통일. alembic `e036a0000030` 마이그레이션(중복 탐지 시 중단, 없으면 일괄 lower 백필).

## 검증

- 백엔드 1018 passed (+신규 8건: 소문자 저장·대소문자 무관 로그인·중복 409·Google suspended/pending 403 등)
