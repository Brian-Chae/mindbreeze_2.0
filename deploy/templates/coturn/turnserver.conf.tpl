# MIND BREEZE 2.0 — coturn (렌더 결과물, 시크릿 포함 → 0640 root:turnserver 로 설치)
# 변수: PUBLIC_IP, PRIVATE_IP, TURN_REALM, TURN_STATIC_AUTH_SECRET, TURN_MIN_PORT, TURN_MAX_PORT
# dev(/etc/turnserver.conf) 대비 변경: external-ip 를 AWS NAT 표준 형식(공인/사설)으로, relay-ip 지정 제거
#   (dev 는 relay-ip 에 공인 IP 를 넣었으나 EC2 NIC 에 없는 주소라 바인드 불가 — T-15/V-5.5 TURN 경유 시험에서 확인).
listening-port=3478
external-ip=@@PUBLIC_IP@@/@@PRIVATE_IP@@
min-port=@@TURN_MIN_PORT@@
max-port=@@TURN_MAX_PORT@@
realm=@@TURN_REALM@@
use-auth-secret
static-auth-secret=@@TURN_STATIC_AUTH_SECRET@@
fingerprint
no-cli
no-loopback-peers
no-multicast-peers
no-tcp-relay
# TLS(5349)는 dev 에서도 인증서 미설정으로 비활성이었다. 필요 시 certbot 인증서 경로 지정 후 활성화한다.
# tls-listening-port=5349
# cert=/etc/letsencrypt/live/@@CERT_NAME@@/fullchain.pem
# pkey=/etc/letsencrypt/live/@@CERT_NAME@@/privkey.pem
