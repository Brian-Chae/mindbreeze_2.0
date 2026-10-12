# SDD-149 — 기관·알림·EEG 정합 요약

## 구현 결과

| # | ID | 변경 | 파일 |
|---|---|---|---|
| 1 | MB2-ORG-01 | remove_counselor 위임 + 가드 | org_service.py |
| 2 | FUNC-01 | 리마인더 due 검증 + revoke | reminder_service.py, session_service.py |
| 3 | EEG-QUALITY-NULL | null→unknown | session_service.py |
| 4 | GROUP-AVG-ANON | 지표별 표본 게이트 | group_aggregate.py |

## 검증

- 백엔드 `pytest -q` **1026 passed / 12 skipped / 0 failed**
