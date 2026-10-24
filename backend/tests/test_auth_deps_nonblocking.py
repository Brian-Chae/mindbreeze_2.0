"""인증 의존성 비차단·DB 풀 설정 고정 테스트 (FIX backend-auth-nonblocking).

- get_current_user / get_current_user_optional 은 동기 def 여야 한다(스레드풀 실행).
  async def 안에서 동기 DB 조회를 하면 이벤트 루프가 막히고 풀 소진 시 교착한다.
- require_roles 의 가드는 DB 를 쓰지 않으므로 async 여도 된다(순수 연산).
- create_engine 풀 인자는 settings 값을 반영하고 SQLite 에서는 붙이지 않는다.
"""

import inspect
import threading

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.api import deps
from app.config import settings
from app.core import database


def test_인증_의존성은_코루틴이_아니다():
    assert not inspect.iscoroutinefunction(deps.get_current_user)
    assert not inspect.iscoroutinefunction(deps.get_current_user_optional)


def test_인증_의존성은_이벤트루프_스레드가_아닌_스레드풀에서_실행된다(monkeypatch):
    """실제 get_current_user 를 Depends 로 걸고, 내부 decode_token 이 불린 스레드를 기록한다.

    async def 였다면 이벤트 루프 스레드(loop_probe 와 같은 스레드)에서 실행된다.
    """
    seen: dict[str, str] = {}

    def spy_decode(token):
        seen["auth"] = threading.current_thread().name
        raise deps.JWTError("probe")  # 401 로 즉시 종료 — DB 를 건드리지 않는다

    monkeypatch.setattr(deps, "decode_token", spy_decode)

    async def loop_probe():
        seen["loop"] = threading.current_thread().name

    app = FastAPI()

    @app.get("/probe")
    def probe(_loop=Depends(loop_probe), user=Depends(deps.get_current_user)):  # noqa: B008
        return {"ok": True}

    # get_db 는 빈 DB 라도 세션만 만들 뿐이라 안전하다(쿼리 전에 401)
    assert TestClient(app).get("/probe", headers={"Authorization": "Bearer x"}).status_code == 401
    assert "auth" in seen and "loop" in seen
    assert seen["auth"] != seen["loop"]


def test_풀_설정이_settings_를_반영한다(monkeypatch):
    monkeypatch.setattr(settings, "db_pool_size", 7)
    monkeypatch.setattr(settings, "db_max_overflow", 3)
    monkeypatch.setattr(settings, "db_pool_timeout", 11)
    monkeypatch.setattr(settings, "db_pool_pre_ping", True)
    monkeypatch.setattr(settings, "db_pool_recycle", 600)
    kwargs = database.build_engine_kwargs("postgresql://localhost:5432/x")
    assert kwargs["pool_size"] == 7
    assert kwargs["max_overflow"] == 3
    assert kwargs["pool_timeout"] == 11
    assert kwargs["pool_pre_ping"] is True
    assert kwargs["pool_recycle"] == 600


def test_풀_기본값은_보수적이다():
    assert settings.db_pool_size == 10
    assert settings.db_max_overflow == 10
    assert settings.db_pool_pre_ping is True
    assert settings.db_pool_recycle > 0


def test_sqlite_에서는_풀_인자를_붙이지_않는다():
    kwargs = database.build_engine_kwargs("sqlite://")
    assert "pool_size" not in kwargs and "max_overflow" not in kwargs
    # 실제로 create_engine 이 오류 없이 만들어져야 한다
    from sqlalchemy import create_engine

    create_engine("sqlite://", **kwargs)


def test_실제_엔진에_풀_크기가_적용된다():
    """모듈 로드 시 만들어진 엔진(PostgreSQL URL)의 풀 크기가 settings 와 같다."""
    if database.engine.dialect.name != "postgresql":
        return
    assert database.engine.pool.size() == settings.db_pool_size
