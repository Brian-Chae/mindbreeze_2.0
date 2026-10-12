# SDD-175 — 구현 계획

- 프론트: client.ts(refresh 판별+타임아웃), authStore.ts, package.json
- 백엔드: reminder_service, report_task, audio_service, pipeline_outbox_task, upload_service, media_cleanup_service(+task/cron), session_service, admin_service, tasks 로깅

## 테스트

- 백엔드 test_mb2_high_severity_fixes_5.py 17건.
