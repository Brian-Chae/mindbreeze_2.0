"""SDD-329 A: 수업 종료(/end) 멱등 — 이미 completed 면 잠금 없이 200, 잠금 경합은 500 대신 상태 재조회."""
import pytest
from fastapi import HTTPException
from sqlalchemy.exc import OperationalError

from app.api.v1 import session as session_api
from tests.sdd237_helpers import auth_for, build_class_world, make_user
from tests.test_sdd027_rollup_raw_report import _db


@pytest.fixture
def world(client):
    with _db() as db:
        w = build_class_world(db, members=1, status="in_progress", ended=False)
        return {"sid": str(w["session"].id), "h": w["auth"], "host": w}


def _end(client, w):
    return client.post(f"/api/v1/sessions/{w['sid']}/end", headers=w["h"], json={})


def test_종료_재호출은_200이고_첫_응답과_같은_형식(client, world):
    first = _end(client, world)
    assert first.status_code == 200, first.text
    again = _end(client, world)
    assert again.status_code == 200, again.text
    assert set(again.json().keys()) == set(first.json().keys())
    assert again.json()["status"] == "completed"


def test_이미_종료된_회차는_전이_경로_잠금을_타지_않는다(client, world, monkeypatch):
    assert _end(client, world).status_code == 200

    def boom(*a, **k):
        raise AssertionError("종료된 회차 재호출이 잠금 경로(_run_transition)를 탔다")

    monkeypatch.setattr(session_api, "_run_transition", boom)
    assert _end(client, world).status_code == 200


def test_잠금_실패는_500_대신_상태_재조회_후_200(client, world, monkeypatch):
    real = session_api._run_transition
    calls = {"n": 0}

    def flaky(db, session_id, action, payload, current_user, hdr):
        out = real(db, session_id, action, payload, current_user, hdr)  # 실제 종료는 반영
        calls["n"] += 1
        raise OperationalError("SELECT ... FOR UPDATE", {}, type("LockNotAvailable", (Exception,), {})("lock timeout"))

    monkeypatch.setattr(session_api, "_run_transition", flaky)
    res = _end(client, world)
    assert calls["n"] == 1
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "completed"


def test_잠금_실패인데_종료가_안됐으면_원래_오류를_올린다(client, world, monkeypatch):
    def always_lock(*a, **k):
        raise OperationalError("x", {}, type("LockNotAvailable", (Exception,), {})("lock timeout"))

    monkeypatch.setattr(session_api, "_run_transition", always_lock)
    with pytest.raises(OperationalError):
        _end(client, world)


def test_비호스트는_종료_재호출도_거절(client, world):
    assert _end(client, world).status_code == 200
    with _db() as db:
        other = make_user(db, role="counselor", name="타인")
        db.commit()
        h = auth_for(other)
    res = client.post(f"/api/v1/sessions/{world['sid']}/end", headers=h, json={})
    assert res.status_code in (403, 404)


def test_동시_종료_경합의_패자는_409_대신_200(client, world, monkeypatch):
    """승자가 먼저 종료를 커밋한 뒤 패자가 사전 확인(미종료)→CAS 409 로 진 상황을 순서대로 재현한다.

    테스트 DB(SQLite)는 연결을 공유해 실제 동시성을 만들 수 없으므로 순서를 결정적으로 시뮬레이션한다.
    """
    assert _end(client, world).status_code == 200  # 승자
    real_check = session_api._completed_end_response
    seen = {"n": 0}

    def check(db, sid, user):
        seen["n"] += 1
        return None if seen["n"] == 1 else real_check(db, sid, user)  # 최초 사전 확인은 승자 커밋 전으로 보인다

    def lose(*a, **k):
        raise HTTPException(status_code=409, detail="상태가 이미 변경되었습니다")

    monkeypatch.setattr(session_api, "_completed_end_response", check)
    monkeypatch.setattr(session_api, "_run_transition", lose)
    res = _end(client, world)
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "completed"


def test_409가_종료와_무관하면_그대로_409(client, world, monkeypatch):
    def lose(*a, **k):
        raise HTTPException(status_code=409, detail="x")

    monkeypatch.setattr(session_api, "_run_transition", lose)
    monkeypatch.setattr(session_api.time, "sleep", lambda s: None)
    assert _end(client, world).status_code == 409
