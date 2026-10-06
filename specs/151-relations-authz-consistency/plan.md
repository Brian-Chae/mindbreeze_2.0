# SDD-151 — 구현 계획

| # | 파일 | 변경 |
|---|---|---|
| 1 | client_counselor_link.py + alembic e036a0000031 + client_service.py | memo 컬럼·저장 |
| 2 | password_reset_service.py | check_password_history |
| 3 | onboarding.py | assign_counselor 위임 |
| 4 | signup_application_service.py | 반려 정리 + 재사용 분기 |
| 5 | org.py | membership 기준 |
| 6~7 | org_service.py | is_member 통일 + 역할 제한 |

## 테스트

- test_mb2_relations_consistency.py 신규 7건 + test_sdd073/078 갱신.
