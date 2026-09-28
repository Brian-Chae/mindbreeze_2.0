#!/usr/bin/env python3
"""LiveKit nginx 프록시(/livekit/ → 127.0.0.1:7880) 보장 — 재프로비저닝 내구성.

dev-api 서버 블록의 `location / { proxy_pass http://127.0.0.1:8000; }` 앞에
LiveKit 시그널링 프록시 블록을 삽입한다. 이미 있으면 아무것도 하지 않는다.
"""

import sys

CONF = "/etc/nginx/sites-enabled/mindbreeze-ssl"
MARKER = "    location / {\n        proxy_pass http://127.0.0.1:8000;"
BLOCK = (
    "    location /livekit/ {\n"
    "        proxy_pass http://127.0.0.1:7880/;\n"
    "        proxy_http_version 1.1;\n"
    "        proxy_set_header Upgrade $http_upgrade;\n"
    "        proxy_set_header Connection \"upgrade\";\n"
    "        proxy_set_header Host $host;\n"
    "        proxy_set_header X-Real-IP $remote_addr;\n"
    "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n"
    "        proxy_set_header X-Forwarded-Proto https;\n"
    "    }\n\n"
)


def main() -> None:
    with open(CONF) as f:
        content = f.read()

    if "location /livekit/" in content:
        print("livekit nginx proxy already present - skip")
        return

    if MARKER not in content:
        print(f"ERROR: LiveKit 마커를 찾을 수 없습니다: {CONF}", file=sys.stderr)
        sys.exit(1)

    content = content.replace(MARKER, BLOCK + MARKER, 1)
    with open(CONF, "w") as f:
        f.write(content)

    print("livekit nginx proxy inserted")


if __name__ == "__main__":
    main()
