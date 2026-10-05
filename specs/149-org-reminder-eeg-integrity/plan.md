# SDD-149 — 구현 계획

| # | 파일 | 변경 |
|---|---|---|
| 1 | org_service.py | remove_counselor → change_counselor(role=None) 위임 |
| 2 | reminder_service.py, session_service.py | run_reminder due 검증 + 결정적 task_id + revoke |
| 3 | session_service.py | _quality_from_signal(None)→'unknown' |
| 4 | group_aggregate.py | 지표별 non_null 개수 게이트 |

## 테스트

- test_sdd097(4), test_class_group_average(1), test_sdd023(1), test_sdd082(2) 신규/갱신.
