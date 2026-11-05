# MIND BREEZE 2.0 — API 서버 REST 전용 인스턴스 (SDD-306). 인스턴스 이름 = 포트: mindbreeze-backend-rest@8001
# 소켓(상태 보유)은 mindbreeze-backend(8000) 한 프로세스만 처리한다. nginx 가 허용목록 REST 만 이 인스턴스들로 분산한다.
[Unit]
Description=MIND BREEZE backend API REST instance %i (uvicorn)
After=network.target redis-server.service mindbreeze-backend.service
Wants=redis-server.service

[Service]
Type=simple
User=@@SERVICE_USER@@
Group=@@SERVICE_USER@@
WorkingDirectory=@@PREFIX@@/current/backend
EnvironmentFile=@@ENV_FILE@@
ExecStart="@@PREFIX@@/venv/bin/uvicorn" app.main:asgi_app --host 127.0.0.1 --port %i --backlog 2048 --timeout-keep-alive 30
Restart=always
RestartSec=5
LimitNOFILE=65535
UMask=0077
NoNewPrivileges=true
# PrivateTmp 미사용: 오디오·영상 청크가 호스트 /tmp 를 워커와 공유한다(dev 2026-10-03 장애 사례).

[Install]
WantedBy=multi-user.target
