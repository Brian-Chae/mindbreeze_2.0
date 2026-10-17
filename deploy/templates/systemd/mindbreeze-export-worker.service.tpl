# MIND BREEZE 2.0 — 데이터 내보내기 워커 (-Q exports). export-beat 는 설치하지 않는다(주기 작업은 timer 가 대체).
[Unit]
Description=MIND BREEZE data export worker
After=network.target redis-server.service
Wants=redis-server.service

[Service]
Type=simple
User=@@SERVICE_USER@@
Group=@@SERVICE_USER@@
WorkingDirectory=@@PREFIX@@/current/backend
EnvironmentFile=@@ENV_FILE@@
ExecStart=@@PREFIX@@/venv/bin/celery -A app.core.celery_app:celery_app worker -Q exports --concurrency=1 --prefetch-multiplier=1 --hostname=exports@%H --loglevel=INFO
Restart=on-failure
RestartSec=5
PrivateTmp=true
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
