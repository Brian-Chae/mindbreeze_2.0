# SDD-170 — 구현 계획

- 백엔드: ws/__init__.py(AsyncRedisManager), schemas/session.py(features max_length), models/notification_outbox.py(복합 인덱스)+alembic e036a0000033.
- 프론트: lib/socket.ts(토큰 갱신), hooks/useDialogA11y.ts 신규, register/onboarding/sessions/clients 페이지 label·라이브 리전.

## 테스트

- 백엔드 test_mb2_high_severity_fixes_4.py 신규 13건.
