# MIND BREEZE 2.0 — LiveKit 서버 (dev 서버 유닛과 동일 구조, 설정 경로만 prod 렌더 결과)
[Unit]
Description=LiveKit WebRTC Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/livekit-server --config /etc/livekit/livekit.yaml
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
