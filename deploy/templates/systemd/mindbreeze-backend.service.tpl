# MIND BREEZE 2.0 — API 서버 (렌더 결과물). 릴리스 링크: @@PREFIX@@/current , venv 링크: @@PREFIX@@/venv
[Unit]
Description=MIND BREEZE backend API (uvicorn)
After=network.target redis-server.service
Wants=redis-server.service

[Service]
Type=simple
User=@@SERVICE_USER@@
Group=@@SERVICE_USER@@
WorkingDirectory=@@PREFIX@@/current/backend
EnvironmentFile=@@ENV_FILE@@
ExecStart="@@PREFIX@@/venv/bin/uvicorn" app.main:asgi_app --host 127.0.0.1 --port 8000 --backlog 2048 --timeout-keep-alive 30
Restart=always
# SDD-306: 100명 소켓·REST 동시 연결 대비(기본 1024 → 65535)
LimitNOFILE=65535
RestartSec=5
UMask=0077
NoNewPrivileges=true
# PrivateTmp 미사용: 오디오·영상 청크가 호스트 /tmp 를 워커와 공유한다(dev 2026-10-03 장애 사례).

[Install]
WantedBy=multi-user.target
