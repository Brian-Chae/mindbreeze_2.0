#!/usr/bin/env bash
# dev 크론 등록: 시간·명령·옵션·로그 경로를 변경하지 않고 멱등하게 갱신한다.
set -e

# 5.5 알림 보관·파기 cron 등록 (매일 04:00, celery beat 대체)
#     INFRA-03: DB·Redis 접속 정보(env)를 명시 export 해야 config 기본값(localhost)으로
#     떨어지지 않는다 — 다른 cron 들과 동일한 규약을 적용한다.
(crontab -l 2>/dev/null | grep -v 'cleanup_notifications_cron'; echo '0 4 * * * cd /home/ubuntu/mindbreeze/backend && export DATABASE_URL=$(grep -E ^DATABASE_URL= ./.env.dev | head -1 | cut -d= -f2-) && export REDIS_URL=$(grep -E ^REDIS_URL= ./.env.dev | head -1 | cut -d= -f2-) && venv/bin/python cleanup_notifications_cron.py >> /var/log/mindbreeze-cleanup.log 2>&1') | crontab -

# 5.6 SDD-100: open 상태 방치 세션 자동 취소 cron 등록 (매 5분, celery beat 대체)
(crontab -l 2>/dev/null | grep -v 'sweep_stale_open_sessions_cron'; echo '*/5 * * * * cd /home/ubuntu/mindbreeze/backend && export DATABASE_URL=$(grep -E "^DATABASE_URL=" ./.env.dev | head -1 | cut -d= -f2-) && export REDIS_URL=$(grep -E "^REDIS_URL=" ./.env.dev | head -1 | cut -d= -f2-) && venv/bin/python sweep_stale_open_sessions_cron.py >> /var/log/mindbreeze-stale-open-sessions.log 2>&1') | crontab -

# 5.7 SDD-138: celery beat 대체 나머지 주기 스윕 cron 등록
(crontab -l 2>/dev/null | grep -v 'sweep_stale_reports_cron'; echo '*/5 * * * * cd /home/ubuntu/mindbreeze/backend && export DATABASE_URL=$(grep -E ^DATABASE_URL= ./.env.dev | head -1 | cut -d= -f2-) && export REDIS_URL=$(grep -E ^REDIS_URL= ./.env.dev | head -1 | cut -d= -f2-) && venv/bin/python sweep_stale_reports_cron.py >> /var/log/mindbreeze-stale-reports.log 2>&1') | crontab -
(crontab -l 2>/dev/null | grep -v 'sweep_session_reminders_cron'; echo '*/5 * * * * cd /home/ubuntu/mindbreeze/backend && export DATABASE_URL=$(grep -E ^DATABASE_URL= ./.env.dev | head -1 | cut -d= -f2-) && export REDIS_URL=$(grep -E ^REDIS_URL= ./.env.dev | head -1 | cut -d= -f2-) && venv/bin/python sweep_session_reminders_cron.py >> /var/log/mindbreeze-reminders.log 2>&1') | crontab -
# SDD-188: AI 비서 예약 사전 노티(3시간 전·1시간 전) 스윕 cron 등록 (매 1분)
(crontab -l 2>/dev/null | grep -v 'sweep_agent_reminders_cron'; echo '* * * * * cd /home/ubuntu/mindbreeze/backend && export DATABASE_URL=$(grep -E ^DATABASE_URL= ./.env.dev | head -1 | cut -d= -f2-) && export REDIS_URL=$(grep -E ^REDIS_URL= ./.env.dev | head -1 | cut -d= -f2-) && venv/bin/python sweep_agent_reminders_cron.py >> /var/log/mindbreeze-agent-reminders.log 2>&1') | crontab -
# SDD-189: AI 비서 상담사 브리핑(아침 일정·저녁 정리) 스윕 cron 등록 (매 1분)
#     상담사가 지정한 KST 시각 도래 + 30분 보정 창 안에서만 생성한다.
(crontab -l 2>/dev/null | grep -v 'sweep_agent_briefings_cron'; echo '* * * * * cd /home/ubuntu/mindbreeze/backend && export DATABASE_URL=$(grep -E ^DATABASE_URL= ./.env.dev | head -1 | cut -d= -f2-) && export REDIS_URL=$(grep -E ^REDIS_URL= ./.env.dev | head -1 | cut -d= -f2-) && venv/bin/python sweep_agent_briefings_cron.py >> /var/log/mindbreeze-agent-briefings.log 2>&1') | crontab -
(crontab -l 2>/dev/null | grep -v 'process_pipeline_outbox_cron'; echo '* * * * * cd /home/ubuntu/mindbreeze/backend && export DATABASE_URL=$(grep -E ^DATABASE_URL= ./.env.dev | head -1 | cut -d= -f2-) && export REDIS_URL=$(grep -E ^REDIS_URL= ./.env.dev | head -1 | cut -d= -f2-) && venv/bin/python process_pipeline_outbox_cron.py >> /var/log/mindbreeze-pipeline-outbox.log 2>&1') | crontab -
# 5.8 NOTIF-03/OUTBOX-001: 이메일 아웃박스 발송 cron 등록 (매 1분, celery beat 대체)
(crontab -l 2>/dev/null | grep -v 'process_email_outbox_cron'; echo '* * * * * cd /home/ubuntu/mindbreeze/backend && export DATABASE_URL=$(grep -E ^DATABASE_URL= ./.env.dev | head -1 | cut -d= -f2-) && export REDIS_URL=$(grep -E ^REDIS_URL= ./.env.dev | head -1 | cut -d= -f2-) && export RESEND_API_KEY=$(grep -E ^RESEND_API_KEY= ./.env.dev | head -1 | cut -d= -f2-) && export RESEND_FROM_EMAIL=$(grep -E ^RESEND_FROM_EMAIL= ./.env.dev | head -1 | cut -d= -f2-) && venv/bin/python process_email_outbox_cron.py >> /var/log/mindbreeze-email-outbox.log 2>&1') | crontab -
(crontab -l 2>/dev/null | grep -v 'cleanup_data_exports_cron'; echo '*/5 * * * * cd /home/ubuntu/mindbreeze/backend && export DATABASE_URL=$(grep -E ^DATABASE_URL= ./.env.dev | head -1 | cut -d= -f2-) && export REDIS_URL=$(grep -E ^REDIS_URL= ./.env.dev | head -1 | cut -d= -f2-) && venv/bin/python cleanup_data_exports_cron.py >> /var/log/mindbreeze-exports.log 2>&1') | crontab -

# 5.9 SDD-048/INFRA-02: 서사 캐시 주기 업그레이드 cron 등록 (매일 05:00, celery beat 대체)
#     번들에는 포함(upgrade_narrative_cache_cron.py)되나 crontab 등록이 누락돼
#     실행되지 않던 항목을 보완한다.
(crontab -l 2>/dev/null | grep -v 'upgrade_narrative_cache_cron'; echo '0 5 * * * cd /home/ubuntu/mindbreeze/backend && export DATABASE_URL=$(grep -E ^DATABASE_URL= ./.env.dev | head -1 | cut -d= -f2-) && export REDIS_URL=$(grep -E ^REDIS_URL= ./.env.dev | head -1 | cut -d= -f2-) && venv/bin/python upgrade_narrative_cache_cron.py >> /var/log/mindbreeze-narrative-cache.log 2>&1') | crontab -

# 5.10 INT-VERIFY-2AXIS: EEG raw 고아·보관기간 정리 + 미디어 고아 정리 cron 등록.
#     스크립트는 존재했으나 배포 번들·crontab 등록이 누락돼 실행되지 않던 항목.
(crontab -l 2>/dev/null | grep -v 'sweep_stale_eeg_raw_cron'; echo '30 4 * * * cd /home/ubuntu/mindbreeze/backend && export DATABASE_URL=$(grep -E ^DATABASE_URL= ./.env.dev | head -1 | cut -d= -f2-) && export REDIS_URL=$(grep -E ^REDIS_URL= ./.env.dev | head -1 | cut -d= -f2-) && venv/bin/python sweep_stale_eeg_raw_cron.py >> /var/log/mindbreeze-eeg-raw.log 2>&1') | crontab -
(crontab -l 2>/dev/null | grep -v 'sweep_stale_media_cron'; echo '45 4 * * * cd /home/ubuntu/mindbreeze/backend && export DATABASE_URL=$(grep -E ^DATABASE_URL= ./.env.dev | head -1 | cut -d= -f2-) && export REDIS_URL=$(grep -E ^REDIS_URL= ./.env.dev | head -1 | cut -d= -f2-) && venv/bin/python sweep_stale_media_cron.py >> /var/log/mindbreeze-media-sweep.log 2>&1') | crontab -
# SDD-238: 보관 정리 보고 cron 등록 (매일 03:00 UTC). dev는 설정값과 무관하게 항상 dry-run.
#     상담·뇌파 원본 보호를 위해 실삭제는 운영 승인 후에만 허용한다.
(crontab -l 2>/dev/null | grep -v 'retention_sweep_cron'; echo '0 3 * * * cd /home/ubuntu/mindbreeze/backend && export DATABASE_URL=$(grep -E ^DATABASE_URL= ./.env.dev | head -1 | cut -d= -f2-) && export REDIS_URL=$(grep -E ^REDIS_URL= ./.env.dev | head -1 | cut -d= -f2-) && venv/bin/python retention_sweep_cron.py --dry-run >> /var/log/mindbreeze-retention-sweep.log 2>&1') | crontab -
# SDD-190: 앱 푸시 아웃박스 발송 cron 등록 (매 1분, celery beat 대체)
(crontab -l 2>/dev/null | grep -v 'process_push_outbox_cron'; echo '* * * * * cd /home/ubuntu/mindbreeze/backend && export DATABASE_URL=$(grep -E ^DATABASE_URL= ./.env.dev | head -1 | cut -d= -f2-) && export REDIS_URL=$(grep -E ^REDIS_URL= ./.env.dev | head -1 | cut -d= -f2-) && export FCM_PROJECT_ID=$(grep -E ^FCM_PROJECT_ID= ./.env.dev | head -1 | cut -d= -f2-) && export FCM_SERVICE_ACCOUNT_JSON=$(grep -E ^FCM_SERVICE_ACCOUNT_JSON= ./.env.dev | head -1 | cut -d= -f2-) && export VAPID_PUBLIC_KEY=$(grep -E ^VAPID_PUBLIC_KEY= ./.env.dev | head -1 | cut -d= -f2-) && export VAPID_PRIVATE_KEY=$(grep -E ^VAPID_PRIVATE_KEY= ./.env.dev | head -1 | cut -d= -f2-) && export VAPID_SUBJECT=$(grep -E ^VAPID_SUBJECT= ./.env.dev | head -1 | cut -d= -f2-) && venv/bin/python process_push_outbox_cron.py >> /var/log/mindbreeze-push-outbox.log 2>&1') | crontab -
# SDD-191: AI 비서 안부 대화(체크인) 아웃리치 스윕 cron 등록 (매 5분)
(crontab -l 2>/dev/null | grep -v 'sweep_agent_checkins_cron'; echo '*/5 * * * * cd /home/ubuntu/mindbreeze/backend && export DATABASE_URL=$(grep -E ^DATABASE_URL= ./.env.dev | head -1 | cut -d= -f2-) && export REDIS_URL=$(grep -E ^REDIS_URL= ./.env.dev | head -1 | cut -d= -f2-) && venv/bin/python sweep_agent_checkins_cron.py >> /var/log/mindbreeze-agent-checkins.log 2>&1') | crontab -
# SDD-216: 클래스 운영/정기 보충. Settings가 .env.dev를 읽으며 기능 스위치 기본값은 off다.
# 같은 작업의 겹친 실행은 flock으로 건너뛴다. 롤링 함수가 서버 시간대와 무관하게 KST 02시를 판정한다.
(crontab -l 2>/dev/null | grep -v 'class_operations_cron'; echo '* * * * * cd /home/ubuntu/mindbreeze/backend && flock -n -E 0 .class_operations.lock venv/bin/python class_operations_cron.py --dev-env >> /var/log/mindbreeze-class-operations.log 2>&1') | crontab -
(crontab -l 2>/dev/null | grep -v 'class_rolling_cron'; echo '0 * * * * cd /home/ubuntu/mindbreeze/backend && flock -n -E 0 .class_rolling.lock venv/bin/python class_rolling_cron.py --dev-env >> /var/log/mindbreeze-class-rolling.log 2>&1') | crontab -
