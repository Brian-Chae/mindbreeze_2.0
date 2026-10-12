# SDD-152 — 구현 계획

| # | 파일 | 변경 |
|---|---|---|
| 1 | report_service.py, schemas/report.py, api/reports.py | participant_id 필수 |
| 2 | session_service.py | 정원·대기열 |
| 3 | report_task.py | 완료 후 메일 큐 |
| 4 | reminder_service.py | outbox commit 후 enqueue |
| 5 | report_task.py | device_timestamp_ms 경계 |
| 6 | report_task.py | counselor participant_id |
| 7 | session_live_namespace.py, session_service.py | newer 가드 |
| 8 | session_live_namespace.py | 이전 룸 leave |
| 9 | chat_namespace.py | sid→user_id 매핑 |

## 테스트

- test_func_fixes.py, test_ws_chat_multitab.py 신규 + 기존 갱신.
