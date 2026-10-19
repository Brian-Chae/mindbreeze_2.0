# MIND BREEZE 2.0 — 이메일 전용 Celery 워커 (-Q email, 메인 워커와 큐 분리)
[Unit]
Description=MIND BREEZE report email worker (Celery)
After=network.target redis-server.service
Wants=redis-server.service

[Service]
Type=simple
User=@@SERVICE_USER@@
Group=@@SERVICE_USER@@
WorkingDirectory=@@PREFIX@@/current/backend
EnvironmentFile=@@ENV_FILE@@
ExecStart="@@PREFIX@@/venv/bin/celery" -A app.tasks.report_email_task:email_app worker -Q email --loglevel=info --concurrency=2
Restart=always
RestartSec=5
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
