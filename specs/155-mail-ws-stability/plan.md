# SDD-155 — 구현 계획

| # | 파일 | 변경 |
|---|---|---|
| 1 | report_email_service.py | sent_at/status 갱신 |
| 2 | notification_service.py, report_email_task.py | body_html |
| 3 | record_namespace.py, chat_namespace.py | null 방어 |
| 4 | video.py | _to_uuid |
| 5 | export_service.py | None 체크 |
| 6 | eeg_metrics.py | 졸음 가드 |

## 테스트

- 신규 7건(졸음 플래그, html 전달, 재발송, WS null, 영상 400, 내보내기 폴백).
