"""CORS 허용 오리진 해석 (SDD-210 T-2).

- `CORS_ALLOWED_ORIGINS`(쉼표 구분)가 **명시 설정**되면 그 목록만 허용한다(운영 경로).
- 미설정이면 기존 동작을 유지한다: HTTP 는 로컬 개발 + dev 도메인 + 앱 WebView 목록,
  Socket.IO 는 기존처럼 전체 허용("*"). dev 서버는 변수 없이 지금처럼 동작한다.
- 운영(`ENVIRONMENT=production` 명시)은 `production_config_problems` 가 변수 미설정·"*"·dev 오리진을
  기동 중단으로 막는다.
"""

# Capacitor 앱 WebView 오리진 (SDD-190): Android=https://localhost, iOS=capacitor://localhost
APP_WEBVIEW_ORIGINS: tuple[str, ...] = ("https://localhost", "capacitor://localhost")

# 변수 미설정 시 기본값 — 기존 main.py 하드코딩 목록과 동일(dev 서버 호환).
DEFAULT_CORS_ORIGINS: tuple[str, ...] = (
    "http://localhost:5173",
    "http://dev.mindbreeze.looxidlabs.com",
    "https://dev.mindbreeze.looxidlabs.com",
    "http://dev-api.mindbreeze.looxidlabs.com",
    "https://dev-api.mindbreeze.looxidlabs.com",
    *APP_WEBVIEW_ORIGINS,
)


def parse_origins(raw: str) -> list[str]:
    """쉼표 구분 문자열 → 공백·빈 항목·끝 슬래시를 제거한 오리진 목록(중복 제거, 순서 유지)."""
    seen: dict[str, None] = {}
    for item in (raw or "").split(","):
        origin = item.strip().rstrip("/")
        if origin:
            seen.setdefault(origin, None)
    return list(seen)


def cors_explicitly_configured(cfg) -> bool:
    return "cors_allowed_origins" in cfg.model_fields_set and bool(parse_origins(cfg.cors_allowed_origins))


def http_cors_origins(cfg) -> list[str]:
    """FastAPI CORSMiddleware 용 허용 오리진."""
    if cors_explicitly_configured(cfg):
        return parse_origins(cfg.cors_allowed_origins)
    return list(DEFAULT_CORS_ORIGINS)


def socketio_cors_origins(cfg) -> str | list[str]:
    """Socket.IO 용 허용 오리진. 명시 설정 시 HTTP 와 동일 목록, 미설정이면 기존 동작("*")."""
    if cors_explicitly_configured(cfg):
        return parse_origins(cfg.cors_allowed_origins)
    return "*"
