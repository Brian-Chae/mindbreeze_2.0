# MIND BREEZE 2.0 — 메인 Celery 워커 (STT·요약·리포트·영상 병합)
[Unit]
Description=MIND BREEZE pipeline worker (STT/summary/report/video merge)
After=network.target redis-server.service
Wants=redis-server.service

[Service]
Type=simple
User=@@SERVICE_USER@@
Group=@@SERVICE_USER@@
WorkingDirectory=@@PREFIX@@/current/backend
EnvironmentFile=@@ENV_FILE@@
ExecStart=@@PREFIX@@/venv/bin/celery -A app.core.celery_app:celery_app worker --loglevel=INFO --prefetch-multiplier=1
Restart=on-failure
RestartSec=5
# PrivateTmp 미사용: 백엔드가 쓰는 호스트 /tmp 의 청크를 읽어야 한다.
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
