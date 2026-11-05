"""SDD-306 — 100명 대응 배포 구성: nginx 소켓/REST 분리 라우팅·systemd 인스턴스 유닛 렌더, 허용목록 안전성."""
from __future__ import annotations

import importlib.util
import inspect
import re
import shlex
import sys
from pathlib import Path

import pytest

DEPLOY = Path(__file__).resolve().parents[3] / "deploy"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, DEPLOY / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


render = _load("render")
PROD = {"WEB_HOST": "mindbreeze.looxidlabs.com", "API_HOST": "api.mindbreeze.looxidlabs.com",
        "PUBLIC_IP": "203.0.113.10", "PRIVATE_IP": "10.20.1.10"}
SECRETS = {"MB_RENDER_LIVEKIT_API_KEY": "APIprodkey123", "MB_RENDER_LIVEKIT_API_SECRET": "prodsecretvalue456",
           "MB_RENDER_TURN_STATIC_AUTH_SECRET": "turnsecret789"}
UUID = "123e4567-e89b-12d3-a456-426614174000"


def _render(tmp_path, **over):
    sets = [f"{k}={v}" for k, v in {**PROD, **over}.items()]
    render.render_all(tmp_path, render.resolve_vars(sets, environ=SECRETS))
    return tmp_path


def _nginx(tmp_path, **over) -> str:
    return (_render(tmp_path, **over) / "etc/nginx/sites-available/mindbreeze.conf").read_text()


def _routes(conf: str):
    """map 블록의 (정규식, upstream) 목록 — nginx 의 `~` 는 대소문자 구분 PCRE."""
    block = re.search(r'map "\$request_method:\$uri" \$mb_backend \{(.*?)\n\}', conf, re.S).group(1)
    return [(m.group(1), m.group(2)) for m in re.finditer(r'"~([^"]+)"\s+(\w+);', block)]


def _pick(conf: str, method: str, uri: str) -> str:
    for rx, up in _routes(conf):
        if re.search(rx, f"{method}:{uri}"):
            return up
    return "mb_socket"


def test_V6_REST_PORTS_미지정이면_mb_rest_는_8000_하나(tmp_path):
    conf = _nginx(tmp_path)
    rest = re.search(r"upstream mb_rest \{(.*?)\}", conf, re.S).group(1)
    assert re.findall(r"server 127\.0\.0\.1:(\d+);", rest) == ["8000"]
    assert "upstream mb_socket" in conf and "proxy_pass http://$mb_backend;" in conf


def test_V7_REST_PORTS_지정시_분산하고_socket_io_는_항상_소켓(tmp_path):
    conf = _nginx(tmp_path, REST_PORTS="8001,8002,8003,8004")
    rest = re.search(r"upstream mb_rest \{(.*?)\}", conf, re.S).group(1)
    assert re.findall(r"server 127\.0\.0\.1:(\d+);", rest) == ["8001", "8002", "8003", "8004"]
    assert "least_conn;" in rest and "keepalive 64;" in rest
    sock = re.search(r"upstream mb_socket \{(.*?)\}", conf, re.S).group(1)
    assert re.findall(r"server 127\.0\.0\.1:(\d+);", sock) == ["8000"]
    for method in ("GET", "POST"):
        assert _pick(conf, method, "/socket.io/") == "mb_socket"


@pytest.mark.parametrize("ports", ["", "80", "abc", "8001;rm", "70000", "8001,x"])
def test_V7b_잘못된_REST_PORTS_는_렌더를_중단한다(tmp_path, ports):
    if ports == "":
        pytest.skip("빈 값은 기본값(8000)으로 대체")
    with pytest.raises(render.RenderError, match="REST_PORTS"):
        _render(tmp_path, REST_PORTS=ports)


def test_V9_허용목록_경로는_REST_상태변경_경로는_소켓(tmp_path):
    conf = _nginx(tmp_path, REST_PORTS="8001,8002")
    rest = [("GET", f"/api/v1/sessions/{UUID}"), ("POST", f"/api/v1/sessions/{UUID}/features/batch"),
            ("POST", f"/api/v1/sessions/{UUID}/biosignal-raw/presign"), ("POST", f"/api/v1/sessions/{UUID}/biosignal-raw/ack"),
            ("POST", f"/api/v1/sessions/{UUID}/biosignal-artifacts/presign"), ("POST", f"/api/v1/sessions/{UUID}/biosignal-artifacts/ack"),
            ("GET", f"/api/v1/sessions/{UUID}/biosignal-raw/summary"), ("GET", f"/api/v1/classes/{UUID}"),
            ("GET", f"/api/v1/classes/{UUID}/members"), ("POST", "/api/v1/auth/login"), ("POST", "/api/v1/auth/refresh")]
    for method, uri in rest:
        assert _pick(conf, method, uri) == "mb_rest", (method, uri)
    socket = [("POST", f"/api/v1/sessions/{UUID}/enter"), ("POST", "/api/v1/sessions/enter"), ("POST", "/api/v1/sessions"),
              ("PUT", f"/api/v1/sessions/{UUID}"), ("DELETE", f"/api/v1/sessions/{UUID}"),
              ("POST", f"/api/v1/sessions/{UUID}/live/command"), ("POST", f"/api/v1/classes/{UUID}/join"),
              ("GET", f"/api/v1/sessions/{UUID}/anything-else"), ("GET", "/api/v1/chat/rooms"),
              ("DELETE", "/api/v1/account"), ("GET", "/socket.io/"), ("POST", "/socket.io/")]
    for method, uri in socket:
        assert _pick(conf, method, uri) == "mb_socket", (method, uri)


def test_V8_허용목록_엔드포인트가_실제_라우트이고_소켓_방송을_호출하지_않는다():
    from fastapi.routing import APIRoute

    from app.main import app

    conf_src = (DEPLOY / "templates/nginx/mindbreeze.conf.tpl").read_text()
    allow = _routes(conf_src)
    assert len(allow) == 7
    samples = [("GET", f"/api/v1/sessions/{UUID}"), ("POST", f"/api/v1/sessions/{UUID}/features/batch"),
               ("POST", f"/api/v1/sessions/{UUID}/biosignal-raw/presign"), ("POST", f"/api/v1/sessions/{UUID}/biosignal-raw/ack"),
               ("POST", f"/api/v1/sessions/{UUID}/biosignal-artifacts/presign"), ("POST", f"/api/v1/sessions/{UUID}/biosignal-artifacts/ack"),
               ("GET", f"/api/v1/sessions/{UUID}/biosignal-raw/summary"), ("GET", f"/api/v1/classes/{UUID}"),
               ("GET", f"/api/v1/classes/{UUID}/members"), ("POST", "/api/v1/auth/login"), ("POST", "/api/v1/auth/refresh")]
    forbidden = ("session_live_namespace", "schedule_publish", "_notify_", "chat_namespace", "emit_to_room", "notify_session")
    for method, uri in samples:
        matched = None
        for route in app.routes:
            if isinstance(route, APIRoute) and method in route.methods:
                m = route.path_regex.match(uri)
                if m:
                    matched = route
                    break
        assert matched is not None, f"라우트 없음 {method} {uri}"
        src = inspect.getsource(matched.endpoint)
        for bad in forbidden:
            assert bad not in src, f"{matched.path} 가 {bad} 를 직접 사용"


def test_V8b_허용목록_서비스_진입점이_소켓_모듈을_import_하지_않는다():
    """엔드포인트가 부르는 서비스 함수(최상위 호출 1단계)도 소켓 방송 모듈을 직접 쓰지 않는다."""
    from app.services import biosignal_service, class_read_service, live_ingest_service

    forbidden = ("session_live_namespace", "chat_namespace", "schedule_publish")
    for fn in (class_read_service.get_class_detail, biosignal_service.presign_raw, biosignal_service.ack_raw,
               live_ingest_service.store_batch, live_ingest_service.feature_summary):
        src = inspect.getsource(fn)
        for bad in forbidden:
            assert bad not in src, f"{fn.__name__} 가 {bad} 사용"


def test_V10_REST_인스턴스_유닛은_포트_템플릿과_한도를_갖는다(tmp_path):
    root = _render(tmp_path)
    rest = (root / "etc/systemd/system/mindbreeze-backend-rest@.service").read_text()
    assert "--port %i" in rest and "--backlog 2048" in rest and "--timeout-keep-alive 30" in rest
    assert "LimitNOFILE=65535" in rest and "EnvironmentFile=/etc/mindbreeze/prod.env" in rest
    main = (root / "etc/systemd/system/mindbreeze-backend.service").read_text()
    assert "--port 8000" in main and "LimitNOFILE=65535" in main and "--backlog 2048" in main


def test_V10b_공백_PREFIX_에서도_REST_유닛_ExecStart_는_하나의_인자(tmp_path):
    prefix = "/srv/명상 클래스"
    render.render_all(tmp_path, render.resolve_vars([f"PREFIX={prefix}", "SERVICE_USER=svc"], environ=SECRETS), only="app")
    body = (tmp_path / "etc/systemd/system/mindbreeze-backend-rest@.service").read_text()
    start = next(line.split("=", 1)[1] for line in body.splitlines() if line.startswith("ExecStart="))
    args = shlex.split(start)
    assert args[0] == f"{prefix}/venv/bin/uvicorn" and "--port" in args and args[args.index("--port") + 1] == "%i"
    assert f"WorkingDirectory={prefix}/current/backend" in body


def test_V11_렌더_결과에_dev_흔적과_미해석_토큰이_없다(tmp_path):
    root = _render(tmp_path, REST_PORTS="8001,8002")
    for p in root.rglob("*"):
        if p.is_file():
            body = p.read_text()
            assert "@@" not in body, p
            for marker in render.DEV_MARKERS:
                assert marker not in body.lower(), (p.name, marker)
