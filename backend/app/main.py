"""MIND BREEZE 2.0 — FastAPI Application Entry Point"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import router as v1_router
from app.ws import sio, asgi_app as socketio_asgi  # noqa: F401

app = FastAPI(
    title="MIND BREEZE 2.0",
    description="뇌파 기반 심리상담·명상 통합 서비스 플랫폼 API",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://dev.mindbreeze.looxidlabs.com",
        "https://dev.mindbreeze.looxidlabs.com",
        "http://dev-api.mindbreeze.looxidlabs.com",
        "https://dev-api.mindbreeze.looxidlabs.com",
        # prod (릴리즈 시 활성화)
        # "https://mindbreeze.looxidlabs.com",
        # "https://api.mindbreeze.looxidlabs.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(v1_router)


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "mindbreeze-api"}


# Socket.IO ASGI를 FastAPI 앱에 마운트 (socket.io 경로로 핸드셰이크)
import socketio as _socketio  # noqa: E402

asgi_app = _socketio.ASGIApp(sio, other_asgi_app=app, socketio_path="socket.io")
