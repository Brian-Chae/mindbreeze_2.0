"""시험용 Socket.IO 서버(별도 OS 프로세스). 운영 `app.ws.asgi_app` 을 그대로 띄운다 — 환경변수로 DB·Redis·채널만 지정한다.

사용: python -m tests.sdd246.transport.server_app <port>
필요 env: DATABASE_URL, REDIS_URL, SOCKETIO_REDIS_CHANNEL, LIVE_REDIS_URL, LIVE_REDIS_PREFIX, JWT_SECRET_KEY, LIVE_PROTOCOL_V2
"""
import sys

import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.ws:asgi_app", host="127.0.0.1", port=int(sys.argv[1]), log_level="warning")
