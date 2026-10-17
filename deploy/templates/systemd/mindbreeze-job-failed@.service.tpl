# MIND BREEZE 2.0 — 주기 작업 실패 알림. journald 에 err 로 남기고, ALERT_SNS_TOPIC_ARN 이 있으면 SNS 로 발행한다.
[Unit]
Description=MIND BREEZE job %i failure notice

[Service]
Type=oneshot
User=@@SERVICE_USER@@
Group=@@SERVICE_USER@@
EnvironmentFile=-@@ENV_FILE@@
ExecStart=@@PREFIX@@/current/deploy/notify-job-failure.sh %i
