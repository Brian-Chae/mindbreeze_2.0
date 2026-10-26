# MIND BREEZE 2.0 — 음성 변환(STT)·영상 병합 전용 워커 (-Q stt). SDD-212 줄 분리.
# 긴 작업(STT 최대 30분)이 요약·리포트 줄을 막지 않도록 별도 줄·별도 프로세스로 둔다.
[Unit]
Description=MIND BREEZE STT/video-merge worker (queue: stt)
After=network.target redis-server.service
Wants=redis-server.service

[Service]
Type=simple
User=@@SERVICE_USER@@
Group=@@SERVICE_USER@@
WorkingDirectory=@@PREFIX@@/current/backend
EnvironmentFile=@@ENV_FILE@@
ExecStart="@@PREFIX@@/venv/bin/celery" -A app.core.celery_app:celery_app worker -Q stt --concurrency=2 --prefetch-multiplier=1 --hostname=stt@%H --loglevel=INFO
Restart=on-failure
RestartSec=5
# PrivateTmp 미사용: 백엔드가 쓰는 호스트 /tmp 의 청크를 읽어야 한다.
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
