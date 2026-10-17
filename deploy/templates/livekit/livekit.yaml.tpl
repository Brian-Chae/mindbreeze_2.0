# MIND BREEZE 2.0 — LiveKit (렌더 결과물, 시크릿 포함 → 0600 root:livekit 로 설치)
# 변수: PUBLIC_IP, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_UDP_PORT_START, LIVEKIT_UDP_PORT_END
# dev 서버(/etc/livekit/livekit.yaml, 2026-10-17 읽기 확인)와 동일 구조. node_ip 는 환경별 공인 IP 이므로 변수.
# dev 는 UDP 범위를 지정하지 않았으나(SG 전체 개방이라 무관), prod 보안그룹 최소 개방을 위해 범위를 고정한다.
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: @@LIVEKIT_UDP_PORT_START@@
  port_range_end: @@LIVEKIT_UDP_PORT_END@@
  use_external_ip: false
  node_ip: @@PUBLIC_IP@@
  stun_servers:
    - stun.l.google.com:19302
keys:
  @@LIVEKIT_API_KEY@@: @@LIVEKIT_API_SECRET@@
