"""WebSocket (Socket.IO) — 네임스페이스 모음"""

import socketio

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")

from app.ws import chat_namespace  # noqa: F401,E402

asgi_app = socketio.ASGIApp(sio, socketio_path="socket.io")
