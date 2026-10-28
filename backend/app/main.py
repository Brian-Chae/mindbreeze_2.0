"""MIND BREEZE 2.0 — FastAPI Application Entry Point"""

import asyncio
import logging
import re
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1 import router as v1_router
from app.config import settings
from app.core.cors import http_cors_origins, parse_origins, cors_explicitly_configured
from app.ws import sio, asgi_app as socketio_asgi  # noqa: F401
from app.services import data_center_runtime  # SDD-243/244 통합: 측정 backend·raw 반출 어댑터 등록

logger = logging.getLogger(__name__)

# SDD-209(B4): 클래스 입장 코드(4자리)가 접근 로그·에러 로그에 원문으로 남지 않게 마스킹한다.
from app.core.log_redaction import install_log_redaction  # noqa: E402

install_log_redaction()


async def _outbox_ws_poll_loop() -> None:
    """WS 서버 이벤트 루프에서 outbox(ws 채널)를 주기적으로 처리."""
    from app.services.outbox_worker import poll_and_deliver_ws

    while True:
        try:
            await poll_and_deliver_ws()
        except Exception as e:
            logger.error(f"[OUTBOX-WS] poll loop error: {e}", exc_info=True)
        await asyncio.sleep(2)


_DEV_MARKERS = ("://dev.", "dev-api.", "mindbreeze-dev", "mindbreeze_dev", "18.183.86.88")


def _is_dev_value(value: str) -> bool:
    low = (value or "").lower()
    return any(marker in low for marker in _DEV_MARKERS)


def _production_extra_problems(cfg) -> list[str]:
    """SDD-210(T-2): 운영에서 dev 값·기본값이 조용히 쓰이는 경로를 기동 단계에서 차단한다. 값은 출력하지 않는다."""
    problems: list[str] = []

    # S3 — dev 버킷에 쓰는 사고 방지 + 인스턴스 역할 사용 강제(장기 키 금지)
    bucket = (cfg.s3_bucket or "").strip()
    if not bucket:
        problems.append("s3_bucket 미설정")
    elif _is_dev_value(bucket) or "dev" in bucket.lower().split("-"):
        problems.append("s3_bucket 가 개발 버킷을 가리킴")
    if (cfg.aws_access_key_id or "").strip() or (cfg.aws_secret_access_key or "").strip():
        problems.append("AWS 액세스 키가 설정됨 (운영은 인스턴스 역할 사용 — 키 제거)")
    if not cfg.s3_use_instance_role:
        problems.append("S3_USE_INSTANCE_ROLE 가 꺼져 있음 (운영은 인스턴스 역할로 S3 접근)")

    # CORS — 명시 필수, 와일드카드·dev 오리진·로컬 http 금지
    if not cors_explicitly_configured(cfg):
        problems.append("CORS_ALLOWED_ORIGINS 미설정")
    else:
        for origin in parse_origins(cfg.cors_allowed_origins):
            if origin == "*":
                problems.append("CORS_ALLOWED_ORIGINS 에 와일드카드(*) 포함")
            elif _is_dev_value(origin):
                problems.append("CORS_ALLOWED_ORIGINS 에 개발 도메인 포함")
            elif origin.startswith("http://"):
                problems.append("CORS_ALLOWED_ORIGINS 에 비 TLS(http) 오리진 포함")

    # 메일 발신 — 기본 발신자·DEV 표기 금지
    sender = (cfg.resend_from_email or "").strip().lower()
    if not sender:
        problems.append("resend_from_email 미설정")
    elif "resend.dev" in sender or re.search(r"(?<![a-z])dev(?![a-z])", sender):
        problems.append("resend_from_email 가 개발/기본 발신자를 가리킴")
    if not (cfg.resend_api_key or "").strip():
        problems.append("resend_api_key 미설정")

    # LiveKit — 기본값(ws://localhost, devkey/secret) 금지
    lk_host = (cfg.livekit_host or "").strip().lower()
    if not lk_host or "localhost" in lk_host or "127.0.0.1" in lk_host or _is_dev_value(lk_host):
        problems.append("livekit_host 가 기본/개발 주소를 가리킴")
    # livekit_api_url 은 서버 내부 호출용이라 loopback 을 허용하되, 비어 있지 않으면 dev 흔적만 금지
    lk_api = (getattr(cfg, "livekit_api_url", "") or "").strip().lower()
    if lk_api and _is_dev_value(lk_api):
        problems.append("livekit_api_url 가 개발 주소를 가리킴")
    if (cfg.livekit_api_key or "") in ("", "devkey") or (cfg.livekit_api_secret or "") in ("", "secret"):
        problems.append("LiveKit API 키/시크릿이 기본값이거나 비어 있음")

    # 푸시 — 둘 다 비면 푸시 비활성(허용), 한쪽만 있으면 설정 오류
    if bool((cfg.fcm_project_id or "").strip()) != bool((cfg.fcm_service_account_json or "").strip()):
        problems.append("FCM_PROJECT_ID 와 FCM_SERVICE_ACCOUNT_JSON 이 한쪽만 설정됨")
    if bool((cfg.vapid_public_key or "").strip()) != bool((cfg.vapid_private_key or "").strip()):
        problems.append("VAPID 공개키/개인키가 한쪽만 설정됨")

    # DB — dev 엔드포인트·기본 로컬 DB 금지
    db_url = (cfg.database_url or "").strip()
    if not db_url or "localhost" in db_url or _is_dev_value(db_url):
        problems.append("database_url 가 기본/개발 DB 를 가리킴")

    # 연구 가명 키 — 분실·미설정 시 동일인 매핑 단절(R14)
    if not (cfg.research_id_key_v1 or "").strip():
        problems.append("RESEARCH_ID_KEY_V1 미설정")
    if cfg.research_export_enabled and not (cfg.research_export_ack_token or "").strip():
        problems.append("RESEARCH_EXPORT_ACK_TOKEN 미설정 (연구 내보내기 활성)")

    return problems


def production_config_problems(cfg) -> list[str]:
    """ENVIRONMENT=production 일 때만 검사하는 운영 설정 문제 목록(빈 목록=정상).

    dev 서버(environment != production)는 영향이 없다. 운영에서 환경변수 누락 시
    기본값(dev 주소)으로 조용히 동작하는 것을 막는 fail-fast 용도다.
    ENVIRONMENT 를 **명시적으로** production 으로 설정한 경우에만 검사한다(기본값 production 으로
    동작하는 로컬·테스트 환경은 제외 — 명시 설정 여부는 model_fields_set 으로 판별).
    """
    if cfg.environment != "production" or "environment" not in cfg.model_fields_set:
        return []
    problems: list[str] = []
    for name in ("frontend_base_url", "report_email_base_url"):
        value = (getattr(cfg, name, "") or "").lower()
        if not value:
            problems.append(f"{name} 미설정")
        elif "://dev." in value or "dev-api." in value or "localhost" in value:
            problems.append(f"{name} 가 개발 주소를 가리킴")
    if cfg.debug:
        problems.append("DEBUG 가 켜져 있음")
    if cfg.enable_dev_role_simulation:
        problems.append("개발용 역할 시뮬레이션이 켜져 있음")
    problems.extend(_production_extra_problems(cfg))
    return problems


data_center_runtime.install()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # SDD-136: JWT 서명 키 미설정/기본값은 기동 중단 — 임의 토큰 위조 방지.
    if not settings.jwt_secret_key:
        raise RuntimeError("JWT_SECRET_KEY가 설정되지 않았습니다. 배포 전 반드시 환경변수로 설정하세요.")
    # SDD-197: 운영 환경 설정 검증 — dev 주소·디버그·역할 시뮬레이션이 섞인 채 기동하지 않는다.
    problems = production_config_problems(settings)
    if problems:
        raise RuntimeError("운영 설정 오류: " + "; ".join(problems))
    task = asyncio.create_task(_outbox_ws_poll_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


def docs_urls(environment: str) -> dict[str, str | None]:
    """SDD-220: 운영(production)에서는 API 문서·스키마 경로를 만들지 않는다."""
    if environment == "production":
        return {"docs_url": None, "redoc_url": None, "openapi_url": None}
    return {"docs_url": "/docs", "redoc_url": "/redoc", "openapi_url": "/openapi.json"}


app = FastAPI(
    title="MIND BREEZE 2.0",
    description="뇌파 기반 심리상담·명상 통합 서비스 플랫폼 API",
    version="0.1.0",
    lifespan=lifespan,
    **docs_urls(settings.environment),
)

# SDD-210: 허용 오리진은 CORS_ALLOWED_ORIGINS 로 주입(미설정 시 기존 기본 목록 — app/core/cors.py).
app.add_middleware(
    CORSMiddleware,
    allow_origins=http_cors_origins(settings),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-MB-Refresh-Token"],
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
    # 위반 필드 경로·사유만 남긴다(입력 값은 개인정보·생체값일 수 있어 기록하지 않는다).
    fields = "; ".join(
        f"{'.'.join(str(p) for p in e.get('loc', ()))}: {e.get('type')}" for e in exc.errors()[:5]
    )
    logger.warning("[422] %s %s — 요청 검증 실패 (%s)", request.method, request.url.path, fields)
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


@app.get("/health/live")
async def health_live():
    """프로세스 생존만 확인 — 의존 서비스는 보지 않는다."""
    return {"status": "ok", "service": "mindbreeze-api"}


@app.get("/health/ready")
async def health_ready():
    """DB·Redis 응답까지 확인 — 하나라도 실패하면 503. 배포 후 점검·업타임 감시용.

    오류 상세(주소·계정 등)는 응답에 싣지 않고 서버 로그에만 남긴다.
    """
    checks: dict[str, str] = {}
    try:
        from sqlalchemy import text

        from app.core.database import SessionLocal

        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception:  # noqa: BLE001
        logger.exception("[health/ready] DB 점검 실패")
        checks["database"] = "fail"
    try:
        from app.core.redis import get_redis

        await get_redis().ping()
        checks["redis"] = "ok"
    except Exception:  # noqa: BLE001
        logger.exception("[health/ready] Redis 점검 실패")
        checks["redis"] = "fail"
    ok = all(v == "ok" for v in checks.values())
    return JSONResponse(
        status_code=200 if ok else 503,
        content={"status": "ok" if ok else "degraded", "checks": checks},
    )


# Socket.IO ASGI를 FastAPI 앱에 마운트 (socket.io 경로로 핸드셰이크)
import socketio as _socketio  # noqa: E402

asgi_app = _socketio.ASGIApp(sio, other_asgi_app=app, socketio_path="socket.io")
