"""MIND BREEZE 2.0 — FastAPI Application Entry Point"""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1 import router as v1_router
from app.config import settings
from app.ws import sio, asgi_app as socketio_asgi  # noqa: F401

logger = logging.getLogger(__name__)


async def _outbox_ws_poll_loop() -> None:
    """WS 서버 이벤트 루프에서 outbox(ws 채널)를 주기적으로 처리."""
    from app.services.outbox_worker import poll_and_deliver_ws

    while True:
        try:
            await poll_and_deliver_ws()
        except Exception as e:
            logger.error(f"[OUTBOX-WS] poll loop error: {e}", exc_info=True)
        await asyncio.sleep(2)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # SDD-136: JWT 서명 키 미설정/기본값은 기동 중단 — 임의 토큰 위조 방지.
    if not settings.jwt_secret_key:
        raise RuntimeError("JWT_SECRET_KEY가 설정되지 않았습니다. 배포 전 반드시 환경변수로 설정하세요.")
    task = asyncio.create_task(_outbox_ws_poll_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="MIND BREEZE 2.0",
    description="뇌파 기반 심리상담·명상 통합 서비스 플랫폼 API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://dev.mindbreeze.looxidlabs.com",
        "https://dev.mindbreeze.looxidlabs.com",
        "http://dev-api.mindbreeze.looxidlabs.com",
        "https://dev-api.mindbreeze.looxidlabs.com",
        # SDD-190: Capacitor 앱 WebView 오리진 (Android=https://localhost, iOS=capacitor://localhost)
        "https://localhost",
        "capacitor://localhost",
        # prod (릴리즈 시 활성화)
        # "https://mindbreeze.looxidlabs.com",
        # "https://api.mindbreeze.looxidlabs.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(v1_router)


# ---------------------------------------------------------------------------
# MB-ERR-013: 전역 예외 핸들러 — 응답 봉투 통일 + 서버측 로깅
# ---------------------------------------------------------------------------
@app.exception_handler(RequestValidationError)
async def _validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """요청 검증 실패(422)를 FastAPI 기본과 동일한 봉투로 반환하고 경로를 로깅한다."""
    logger.warning("[422] %s %s — 요청 검증 실패", request.method, request.url.path)
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(exc.errors())})


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """처리되지 않은 500 을 구조화된 봉투로 반환한다.

    스택 등 민감 정보는 응답에 싣지 않고 서버 로그에만 남긴다(운영 스택 비노출).
    """
    logger.exception("[500] %s %s — 처리되지 않은 예외", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "서버 내부 오류가 발생했습니다"})


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "mindbreeze-api"}


# Socket.IO ASGI를 FastAPI 앱에 마운트 (socket.io 경로로 핸드셰이크)
import socketio as _socketio  # noqa: E402

asgi_app = _socketio.ASGIApp(sio, other_asgi_app=app, socketio_path="socket.io")
