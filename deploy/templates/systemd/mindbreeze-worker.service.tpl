# MIND BREEZE 2.0 — 메인 Celery 워커 (기본 큐 celery: 아웃박스·알림·예약 등). STT·요약·리포트는 SDD-212 전용 워커가 소비한다.
[Unit]
Description=MIND BREEZE main worker (queue: celery)
After=network.target redis-server.service
Wants=redis-server.service

[Service]
Type=simple
User=@@SERVICE_USER@@
Group=@@SERVICE_USER@@
WorkingDirectory=@@PREFIX@@/current/backend
EnvironmentFile=@@ENV_FILE@@
ExecStart="@@PREFIX@@/venv/bin/celery" -A app.core.celery_app:celery_app worker -Q celery --concurrency=1 --prefetch-multiplier=1 --hostname=main@%H --loglevel=INFO
Restart=on-failure
RestartSec=5
# PrivateTmp 미사용: 백엔드가 쓰는 호스트 /tmp 의 청크를 읽어야 한다.
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
