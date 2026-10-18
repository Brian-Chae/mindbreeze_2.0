# MIND BREEZE 2.0 — 요약·리포트 생성 전용 워커 (-Q report). SDD-212 줄 분리.
# 짧은 작업이 음성 변환 줄 뒤에서 굶지 않도록 별도 줄·별도 프로세스로 둔다.
[Unit]
Description=MIND BREEZE summary/report worker (queue: report)
After=network.target redis-server.service
Wants=redis-server.service

[Service]
Type=simple
User=@@SERVICE_USER@@
Group=@@SERVICE_USER@@
WorkingDirectory=@@PREFIX@@/current/backend
EnvironmentFile=@@ENV_FILE@@
ExecStart=@@PREFIX@@/venv/bin/celery -A app.core.celery_app:celery_app worker -Q report --concurrency=2 --prefetch-multiplier=1 --hostname=report@%H --loglevel=INFO
Restart=on-failure
RestartSec=5
# PrivateTmp 미사용: 백엔드가 쓰는 호스트 /tmp 를 공유한다(워커 공통 정책).
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
