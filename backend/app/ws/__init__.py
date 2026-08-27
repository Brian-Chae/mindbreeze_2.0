"""WebSocket (Socket.IO) — 네임스페이스 모음"""

import socketio

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")

from app.ws import chat_namespace  # noqa: F401,E402
from app.ws.record_namespace import register_record_namespace  # noqa: E402

# circular import 방지: import 대신 함수 호출로 등록
register_record_namespace(sio)

asgi_app = socketio.ASGIApp(sio, socketio_path="socket.io")
