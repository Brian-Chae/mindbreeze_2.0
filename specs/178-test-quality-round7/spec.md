# SDD-178 — 중(중) 테스트 8건 (7차)

## 배경

7차 전수조사 중(중) 테스트 품질 8건.

## 대상

| # | ID | 이슈 |
|---|---|---|
| 1 | TQ-04 | Celery eager 전역 설정 |
| 2 | TQ-06 | FakeSio 대신 실제 AsyncServer |
| 3 | TQ-07 | Redis manager pytest 격리 |
| 4 | TQ-09 | 내담자 포털·조직 가입 테스트 |
| 5 | TQ-10 | PDF WeasyPrint skip |
| 6 | TQ-11 | 리마인더 apply_async patch |
| 7 | TQ-12 | 상담사 가입 DB 직접 삽입 |
| 8 | TQ-14 | 단언 강도 보강 |

## 검증

- 백엔드 `pytest -q` **1364 passed / 12 skipped / 0 failed** (신규 31건)
