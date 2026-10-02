"""SDD-100: open 상태 방치 세션 자동 취소 QA.

- Session.status == 'open' + opened_at 24h 경과 → cancelled 자동 전이
- 미만료·open 외 상태·템플릿 세션은 스윕 대상 제외
- 전이는 transition_status('cancel') 재사용(알림·state_version)
"""

import uuid
from datetime import datetime, timedelta, timezone

VALID_PASSWORD = "Passw0rd!"


def _register(client, email: str) -> dict:
    from app.services import email_verify_service
    from tests.conftest import create_test_org, post_register

    payload = {
        "org_code": create_test_org(),
        "email": email,
        "password": VALID_PASSWORD,
        "name": "테스트",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": {"tos": True, "privacy": True, "sensitive": True},
    }
    res = post_register(client, "counselor", payload)
    body = res.json()
    token = body.get("access_token") or body.get("tokens", {}).get("access_token")
    return {
        "id": body["user"]["id"],
        "access_token": token,
        "auth": {"Authorization": f"Bearer {token}"},
    }


def _payload(**overrides):
    payload = {
        "type": "meditation",
        "duration_min": 40,
        "title": "주간 명상 수업",
        "max_participants": 12,
        "location_type": "online",
        "participant_mode": "group",
        "linkband_mode": "optional",
    }
    payload.update(overrides)
    return payload


def _create_open_session(client, host, **overrides) -> str:
    """세션 생성 → open 전이까지 마친 뒤 id 를 반환한다."""
    res = client.post("/api/v1/sessions", json=_payload(**overrides), headers=host["auth"])
    assert res.status_code == 201, res.text
    sid = res.json()["id"]
    opened = client.post(f"/api/v1/sessions/{sid}/open", headers=host["auth"])
    assert opened.status_code == 200, opened.text
    return sid


def _get_session(sid: str):
    from app.core.database import SessionLocal
    from app.models.session import Session

    db = SessionLocal()
    try:
        return db.query(Session).filter(Session.id == uuid.UUID(sid)).first()
    finally:
        db.close()


def _set_opened_at(sid: str, opened_at: datetime):
    from app.core.database import SessionLocal
    from app.models.session import Session

    db = SessionLocal()
    try:
        s = db.query(Session).filter(Session.id == uuid.UUID(sid)).first()
        s.opened_at = opened_at
        db.commit()
    finally:
        db.close()


def _force_open_stale(sid: str):
    """템플릿 세션을 open + 과거 opened_at 으로 강제 조작한다(스윕 필터 검증용)."""
    from app.core.database import SessionLocal
    from app.models.session import Session

    db = SessionLocal()
    try:
        s = db.query(Session).filter(Session.id == uuid.UUID(sid)).first()
        s.status = "open"
        s.opened_at = datetime.now(timezone.utc) - timedelta(hours=25)
        db.commit()
    finally:
        db.close()


def _sweep():
    from app.core.database import SessionLocal
    from app.services import session_service

    db = SessionLocal()
    try:
        return session_service.sweep_stale_open_sessions(db)
    finally:
        db.close()


def _status(sid: str) -> str:
    s = _get_session(sid)
    return s.status


def _state_version(sid: str) -> int:
    return _get_session(sid).state_version


# ── 만료 전이 ─────────────────────────────────────────────────────────


def test_01_24h_경과_open_세션은_cancelled로_전이(client):
    host = _register(client, "stale01@test.com")
    sid = _create_open_session(client, host)
    _set_opened_at(sid, datetime.now(timezone.utc) - timedelta(hours=25))

    cancelled = _sweep()

    assert sid in cancelled
    assert _status(sid) == "cancelled"


def test_02_전이_시_state_version이_증가한다(client):
    host = _register(client, "stale02@test.com")
    sid = _create_open_session(client, host)
    before = _state_version(sid)
    _set_opened_at(sid, datetime.now(timezone.utc) - timedelta(hours=25))

    _sweep()

    assert _status(sid) == "cancelled"
    assert _state_version(sid) == before + 1


def test_03_24h_미경과_open_세션은_유지(client):
    host = _register(client, "stale03@test.com")
    sid = _create_open_session(client, host)
    _set_opened_at(sid, datetime.now(timezone.utc) - timedelta(hours=1))

    cancelled = _sweep()

    assert cancelled == []
    assert _status(sid) == "open"


def test_04_경계_정확히_24h는_포함(client):
    host = _register(client, "stale04@test.com")
    sid = _create_open_session(client, host)
    _set_opened_at(sid, datetime.now(timezone.utc) - timedelta(hours=24))

    cancelled = _sweep()

    assert sid in cancelled


def test_05_open_아닌_상태는_제외(client):
    host = _register(client, "stale05@test.com")
    res = client.post("/api/v1/sessions", json=_payload(), headers=host["auth"])
    sid = res.json()["id"]

    cancelled = _sweep()

    assert sid not in cancelled
    assert _status(sid) == "ready"


def test_06_template_세션은_제외(client):
    host = _register(client, "stale06@test.com")
    res = client.post(
        "/api/v1/sessions", json=_payload(is_template=True), headers=host["auth"]
    )
    sid = res.json()["id"]
    _force_open_stale(sid)

    cancelled = _sweep()

    assert sid not in cancelled
    assert _status(sid) == "open"


def test_07_opened_at_없는_open_세션은_건너뛴다(client):
    host = _register(client, "stale07@test.com")
    sid = _create_open_session(client, host)
    # opened_at 을 None 으로 되돌려 비정상 상태를 만든다.
    from app.core.database import SessionLocal
    from app.models.session import Session

    db = SessionLocal()
    try:
        s = db.query(Session).filter(Session.id == uuid.UUID(sid)).first()
        s.opened_at = None
        db.commit()
    finally:
        db.close()

    cancelled = _sweep()

    assert sid not in cancelled
    assert _status(sid) == "open"
