"""참관은 참여자·진행자 채널을 사용하지 않는다."""

import asyncio
from datetime import datetime, timezone
import pytest
from fastapi import HTTPException
from jose import jwt
from app.models.session import SessionParticipant
from tests.pg.sdd216_helpers import user
from tests.pg.test_sdd216_review_regressions import setup_class

pytestmark = pytest.mark.pg


def test_observer_token_snapshot_and_notice_gate(pg_session, monkeypatch):
    from app.config import settings
    from app.services import class_access_service as access, session_service

    a, b, cls, rows = setup_class(pg_session)
    row = rows[0]
    row.status = "open"
    member = user(pg_session, role="client")
    p = SessionParticipant(
        session_id=row.id,
        user_id=member.id,
        report_included=False,
        report_notice_version="class-team-v1",
        report_notice_ack_at=datetime.now(timezone.utc),
        entered_at=datetime.now(timezone.utc),
    )
    pg_session.add(p)
    pg_session.flush()
    monkeypatch.setattr(settings, "class_team_read_enabled", True)
    monkeypatch.setattr(settings, "livekit_api_key", "synthetic")
    monkeypatch.setattr(
        settings, "livekit_api_secret", "synthetic-secret-at-least-32-bytes"
    )
    assert hasattr(access, "observe_session")
    result = access.observe_session(pg_session, b.id, cls.id, row.id)
    claim = jwt.get_unverified_claims(result["token"])
    assert (
        claim["video"]["canPublish"] is False
        and claim["video"]["canPublishData"] is False
    )
    assert claim["exp"] - claim["nbf"] <= 60
    assert (
        pg_session.query(SessionParticipant).filter_by(session_id=row.id).count() == 1
    )
    resolved = session_service.resolve_live_join(
        str(row.id), str(b.id), None, pg_session
    )
    assert resolved["role"] == "observer" and resolved["participant_id"] is None
    assert set(resolved["snapshot"]) == {
        "session_id",
        "status",
        "state_version",
        "started_at",
        "role",
    }
    p.report_notice_version = "r5-1"
    pg_session.flush()
    with pytest.raises(HTTPException):
        access.observe_session(pg_session, b.id, cls.id, row.id)


def test_same_socket_downgrade_drops_old_host_rooms(monkeypatch):
    from app.ws import session_live_namespace as live
    from tests.test_sdd024_session_live_ws import FakeSio

    sio = FakeSio()
    live.register_session_live_namespace(sio)
    sid = "socket"
    session_id = "synthetic-session"
    sio.sessions[sid] = {
        "user_id": "synthetic-user",
        "session_id": session_id,
        "role": "host",
        "participant_id": None,
    }
    sio.rooms[("/session-live", sid)] = {
        live._room_host(session_id),
        live._room_all(session_id),
    }
    monkeypatch.setattr(live, "_account_is_active", lambda uid: True)
    monkeypatch.setattr(
        live,
        "_resolve_join",
        lambda *args: {
            "role": "observer",
            "participant_id": None,
            "snapshot": {"status": "open"},
        },
    )

    async def deny_group(*args, **kwargs):
        pytest.fail("참관자에게 뇌파 집계를 전달하면 안 됩니다")

    monkeypatch.setattr(live, "publish_group_average", deny_group)
    asyncio.run(
        sio.handlers[("/session-live", "join")](sid, {"session_id": session_id})
    )
    assert live._room_host(session_id) not in sio.rooms[("/session-live", sid)]
    assert live._room_all(session_id) not in sio.rooms[("/session-live", sid)]
    assert all(":self:" not in room for room in sio.rooms[("/session-live", sid)])


def test_observer_state_is_projected_and_stale_host_is_evicted(monkeypatch):
    from app.ws import session_live_namespace as live
    from tests.test_sdd024_session_live_ws import FakeSio

    sio = FakeSio()
    sid, session_id = "stale-host", "live-class"
    sio.sessions[sid] = {
        "user_id": "old-host",
        "role": "host",
        "session_id": session_id,
    }
    sio.rooms[("/session-live", sid)] = {
        live._room_host(session_id),
        live._room_all(session_id),
    }
    monkeypatch.setattr(live, "_get_sio", lambda: sio)
    monkeypatch.setattr(live, "_sid_session_ids", {sid: session_id})
    monkeypatch.setattr(live, "_resolve_join", lambda *args: None)
    asyncio.run(
        live.broadcast_session_state(
            session_id,
            {"status": "open", "state_version": 2, "participants": ["PRIVATE"]},
        )
    )
    observer_events = [
        e for e in sio.emits if e["room"] == f"session:{session_id}:observer"
    ]
    assert len(observer_events) == 1
    assert "PRIVATE" not in str(observer_events)
    assert not sio.rooms[("/session-live", sid)]


def test_livekit_reconciliation_removes_only_revoked_observer(pg_session, monkeypatch):
    from app.services import class_access_service as access
    from types import SimpleNamespace

    a, b, cls, rows = setup_class(pg_session)
    row = rows[0]
    row.status = "open"
    monkeypatch.setattr(
        access, "can_observe", lambda db, uid, session: str(uid) == str(b.id)
    )
    removed = []

    class Room:
        async def list_participants(self, request):
            return SimpleNamespace(
                participants=[
                    SimpleNamespace(identity=f"observer:{a.id}"),
                    SimpleNamespace(identity=f"observer:{b.id}"),
                    SimpleNamespace(identity="member"),
                ]
            )

        async def remove_participant(self, request):
            removed.append(request.identity)

    class Client:
        room = Room()

        async def aclose(self):
            pass

    assert hasattr(access, "reconcile_observers")
    asyncio.run(access.reconcile_observers(pg_session, row, Client()))
    assert removed == [f"observer:{a.id}"]


def test_missing_livekit_room_is_already_revoked(pg_session):
    from app.services.class_access_service import reconcile_observers
    from livekit import api

    a, b, cls, rows = setup_class(pg_session)

    class Room:
        async def list_participants(self, request):
            raise api.TwirpError("not_found", "합성 없음", status=404)

    class Client:
        room = Room()

    assert asyncio.run(reconcile_observers(pg_session, rows[0], Client())) == 0
