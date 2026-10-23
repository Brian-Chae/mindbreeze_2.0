"""SDD-237 B1: 진행 기록 1회 안내(claim/dismiss)와 전체 끄기 설정 API."""

import pytest

from tests.sdd237_helpers import add_record, auth_for, build_class_world, make_user


@pytest.fixture
def db(app_client):
    from app.core.database import get_db
    from app.main import app

    session = next(app.dependency_overrides[get_db]())
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture
def world(client, db):
    return build_class_world(db)


def _claim(client, world, headers=None):
    return client.post(
        f"/api/v1/sessions/{world['session'].id}/note-prompt/claim",
        headers=headers or world["auth"])


def test_같은_회차_claim_두번째는_false(client, world):
    first = _claim(client, world)
    assert first.status_code == 200, first.text
    assert first.json() == {"show": True}
    assert _claim(client, world).json() == {"show": False}


def test_다른_계정은_claim_false이고_호스트_안내를_소모하지_않는다(client, world, db):
    other = make_user(db, name="다른 상담사")
    db.commit()
    res = _claim(client, world, headers=auth_for(other))
    assert res.status_code == 200
    assert res.json() == {"show": False}
    assert _claim(client, world).json() == {"show": True}


def test_사용자가_전체_안내를_껐으면_claim_false(client, world, db):
    res = client.patch("/api/v1/users/me/session-note-prompt", json={"enabled": False},
                       headers=world["auth"])
    assert res.status_code == 200
    assert res.json() == {"enabled": False}
    assert _claim(client, world).json() == {"show": False}


def test_이미_기록이_있으면_claim_false(client, world, db):
    add_record(db, world["session"], "오늘 메모")
    assert _claim(client, world).json() == {"show": False}


def test_빈_기록_행은_기록으로_보지_않는다(client, world, db):
    add_record(db, world["session"], "   ")
    assert _claim(client, world).json() == {"show": True}


def test_dismiss는_멱등이고_같은_시각을_돌려준다(client, world):
    url = f"/api/v1/sessions/{world['session'].id}/note-prompt/dismiss"
    a = client.post(url, headers=world["auth"])
    b = client.post(url, headers=world["auth"])
    assert a.status_code == 200 and b.status_code == 200
    assert a.json()["dismissed_at"] == b.json()["dismissed_at"]


def test_dismiss는_호스트만(client, world, db):
    other = make_user(db, name="다른 상담사")
    db.commit()
    res = client.post(f"/api/v1/sessions/{world['session'].id}/note-prompt/dismiss",
                      headers=auth_for(other))
    assert res.status_code == 403


def test_기록을_지워도_seen이_초기화되지_않는다(client, world, db):
    assert _claim(client, world).json() == {"show": True}
    rec = add_record(db, world["session"], "메모")
    rec.counselor_notes = None
    db.commit()
    assert _claim(client, world).json() == {"show": False}


def test_설정_get_기본값은_켜짐_토글_후_다시_켜면_미안내_회차에만_적용(client, world):
    assert client.get("/api/v1/users/me/session-note-prompt",
                      headers=world["auth"]).json() == {"enabled": True}
    client.patch("/api/v1/users/me/session-note-prompt", json={"enabled": False},
                 headers=world["auth"])
    client.patch("/api/v1/users/me/session-note-prompt", json={"enabled": True},
                 headers=world["auth"])
    assert _claim(client, world).json() == {"show": True}
    assert _claim(client, world).json() == {"show": False}


def test_상담_세션은_400_not_class_session(client, db):
    from app.models.session import Session
    import uuid

    host = make_user(db, name="상담사")
    s = Session(id=uuid.uuid4(), type="clinical", status="completed", host_id=host.id, is_template=True, duration_min=50)
    db.add(s)
    db.commit()
    res = client.post(f"/api/v1/sessions/{s.id}/note-prompt/claim", headers=auth_for(host))
    assert res.status_code == 400
    assert res.json()["detail"]["code"] == "not_class_session"


def test_회원은_설정_api를_쓸_수_없다(client, db):
    member = make_user(db, role="client", name="회원")
    db.commit()
    res = client.get("/api/v1/users/me/session-note-prompt", headers=auth_for(member))
    assert res.status_code == 403


def test_미인증은_401(client, world):
    res = client.post(f"/api/v1/sessions/{world['session'].id}/note-prompt/claim")
    assert res.status_code in (401, 403)
