"""SDD-289 정원 늘리기 API — verify.md 서버 항목 V1~V13 (PG_SMOKE=1, 로컬 DB).

실행: PG_SMOKE=1 DATABASE_URL=postgresql://<user>@127.0.0.1:5432/<db> pytest tests/sdd289
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.class_program import ClassMember
from app.models.class_scheduling import ClassCapacityEvent, ClassEffect, ClassOperation
from app.models.session import Session, SessionParticipant
from tests.pg.sdd216_helpers import user, world

pytestmark = pytest.mark.pg


def _future(days: int = 3) -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=days)


def _setup(db, *, cap=40, active=40, waiting=10, live=False, recurring=True,
           location="offline", extra_status=None):
    org, host, other, cls = world(db)
    cls.capacity = cap
    cls.location_type = location
    cls.status = "active"
    cls.recurrence_rule = {"weekdays": [1], "time": "19:00"} if recurring else None
    sessions = []
    specs = [("in_progress" if live else "scheduled", 1)] + (
        [("scheduled", 2)] if live else []
    ) + ([(extra_status, 3)] if extra_status else [])
    for status, seq in specs:
        s = Session(
            type="meditation", class_id=cls.id, host_id=host.id, seq=seq,
            status=status, host_state="assigned", duration_min=60,
            max_participants=cap, scheduled_at=_future(seq),
            started_at=datetime.now(timezone.utc) if status == "in_progress" else None,
        )
        db.add(s)
        sessions.append(s)
    db.flush()
    from app.services.class_membership_service import invite_members

    now = datetime.now(timezone.utc)
    clients = [user(db, role="client") for _ in range(active + waiting)]
    if active:
        invite_members(db, cls, [c.id for c in clients[:active]], host.id, now)
    for i, c in enumerate(clients[active:]):
        db.add(ClassMember(class_id=cls.id, user_id=c.id, kind="member",
                           status="waitlisted", waitlist_position=i + 1,
                           joined_via="code", joined_at=now))
    db.flush()
    return org, host, other, cls, sessions, clients


def _client(db, monkeypatch, actor):
    from app.api.v1.classes import router
    from app.config import settings

    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: actor
    monkeypatch.setattr(settings, "class_scheduling_enabled", True)
    return TestClient(app)


def _post(client, cls, capacity, rev=None, key=None, **extra):
    return client.post(
        f"/api/v1/classes/{cls.id}/capacity",
        json={"operation_key": key or str(uuid4()),
              "expected_revision": cls.revision if rev is None else rev,
              "capacity": capacity, **extra},
    )


def _seats(db, session):
    return db.query(SessionParticipant).filter(
        SessionParticipant.session_id == session.id,
        SessionParticipant.attendance_status.in_(("expected", "attended")),
    ).count()


def test_V1_V2_V3_V11_V10_increase_promotes_all(pg_session, monkeypatch):
    db = pg_session
    org, host, other, cls, sessions, clients = _setup(db, live=True)
    http = _client(db, monkeypatch, {"id": str(host.id), "role": "counselor"})
    res = _post(http, cls, 50)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["promoted_count"] == 10 and body["capacity"] == 50
    db.expire_all()
    assert cls.capacity == 50
    assert all(s.max_participants == 50 for s in sessions)  # V2 반복 클래스, V3 진행 중
    members = db.query(ClassMember).filter_by(class_id=cls.id).all()
    assert sum(m.status == "active" for m in members) == 50
    assert sum(m.status == "waitlisted" for m in members) == 0
    # 순번대로 승격: 대기 1번이 먼저 activated
    promoted = sorted((m for m in members if m.joined_via == "waitlist_promotion"),
                      key=lambda m: m.activated_at)
    assert len(promoted) == 10
    assert all(_seats(db, s) == 50 for s in sessions)
    # V11 알림은 기존 효과만
    kinds = {e.kind for e in db.query(ClassEffect).filter_by(class_id=cls.id)}
    assert "class_waitlist_promoted" in kinds
    assert db.query(ClassEffect).filter_by(class_id=cls.id, kind="class_waitlist_promoted").count() == 10
    # V10 감사
    ev = db.query(ClassCapacityEvent).filter_by(class_id=cls.id).one()
    assert (ev.old_capacity, ev.new_capacity, ev.promoted_count) == (40, 50, 10)
    assert str(ev.actor_id) == str(host.id)


def test_V3_live_reconcile_queued(pg_session, monkeypatch):
    db = pg_session
    org, host, other, cls, sessions, clients = _setup(db, live=True, active=5, waiting=0, cap=5)
    called = []
    import app.services.class_access_service as acc
    monkeypatch.setattr(acc, "queue_live_reconcile", lambda d, cid: called.append(cid))
    http = _client(db, monkeypatch, {"id": str(host.id), "role": "counselor"})
    assert _post(http, cls, 8).status_code == 200
    assert called == [cls.id]


def _actor_client(db, monkeypatch, host):
    return _client(db, monkeypatch, {"id": str(host.id), "role": "counselor"})


def test_V4_below_occupied_422(pg_session, monkeypatch):
    # 오류 응답은 mutate_class 가 롤백하므로 케이스마다 준비를 새로 한다.
    db = pg_session
    org, host, other, cls, sessions, clients = _setup(db, cap=10, active=10, waiting=0)
    r = _post(_actor_client(db, monkeypatch, host), cls, 5)
    assert r.status_code == 422 and r.json()["detail"]["code"] == "capacity_below_occupied"


def test_V4_decrease_422(pg_session, monkeypatch):
    db = pg_session
    org, host, other, cls, sessions, clients = _setup(db, cap=12, active=10, waiting=0)
    r = _post(_actor_client(db, monkeypatch, host), cls, 11)  # 점유 이상이지만 현재보다 작음
    assert r.status_code == 422 and r.json()["detail"]["code"] == "capacity_not_increase"


def test_V4_same_value_no_change(pg_session, monkeypatch):
    db = pg_session
    org, host, other, cls, sessions, clients = _setup(db, cap=10, active=10, waiting=0)
    r = _post(_actor_client(db, monkeypatch, host), cls, 10)
    assert r.status_code == 200 and r.json()["changed"] is False
    assert db.query(ClassCapacityEvent).count() == 0
    db.expire_all()
    assert cls.capacity == 10 and sessions[0].max_participants == 10


def test_V5_terminal_sessions_untouched_and_class_status(pg_session, monkeypatch):
    db = pg_session
    org, host, other, cls, sessions, clients = _setup(
        db, cap=5, active=3, waiting=0, extra_status="completed")
    done = sessions[-1]
    http = _client(db, monkeypatch, {"id": str(host.id), "role": "counselor"})
    assert _post(http, cls, 8).status_code == 200
    db.expire_all()
    assert done.max_participants == 5 and sessions[0].max_participants == 8
    for st in ("completed", "cancelled"):
        cls.status = st
        db.flush()
        r = _post(http, cls, 9)
        assert r.status_code == 409 and r.json()["detail"]["code"] == "class_not_active"


def test_V6_limits(pg_session, monkeypatch):
    db = pg_session
    org, host, other, cls, sessions, clients = _setup(
        db, cap=50, active=2, waiting=0, location="online")
    http = _client(db, monkeypatch, {"id": str(host.id), "role": "counselor"})
    r = _post(http, cls, 51)
    assert r.status_code == 422 and r.json()["detail"]["code"] == "online_capacity_exceeded"
    org, host, other, cls2, sessions, clients = _setup(db, cap=100, active=2, waiting=0)
    http = _client(db, monkeypatch, {"id": str(host.id), "role": "counselor"})
    assert _post(http, cls2, 101).status_code == 422
    assert _post(http, cls2, 100).status_code == 200  # 같은 값 → 변경 없음 허용


def test_V8_idempotent_and_stale(pg_session, monkeypatch):
    db = pg_session
    org, host, other, cls, sessions, clients = _setup(db, cap=5, active=5, waiting=3)
    http = _client(db, monkeypatch, {"id": str(host.id), "role": "counselor"})
    rev = cls.revision
    key = str(uuid4())
    first = _post(http, cls, 8, rev=rev, key=key)
    assert first.status_code == 200 and first.json()["promoted_count"] == 3
    again = _post(http, cls, 8, rev=rev, key=key)
    assert again.status_code == 200 and again.json() == first.json()
    assert db.query(ClassCapacityEvent).filter_by(class_id=cls.id).count() == 1
    assert db.query(ClassEffect).filter_by(class_id=cls.id, kind="class_waitlist_promoted").count() == 3
    reused = _post(http, cls, 9, rev=rev, key=key)
    assert reused.status_code == 409 and reused.json()["detail"]["code"] == "operation_key_reused"
    stale = _post(http, cls, 9, rev=rev)  # 이미 revision 증가
    assert stale.status_code == 409 and stale.json()["detail"]["code"] == "stale_class"


def test_V9_outsider_counselor_denied(pg_session, monkeypatch):
    db = pg_session
    org, host, other, cls, sessions, clients = _setup(db, cap=5, active=2, waiting=0)
    outsider = user(db)
    r = _post(_client(db, monkeypatch, {"id": str(outsider.id), "role": "counselor"}), cls, 8)
    assert r.status_code in (403, 404)


def test_V9_client_denied(pg_session, monkeypatch):
    db = pg_session
    org, host, other, cls, sessions, clients = _setup(db, cap=5, active=2, waiting=0)
    r = _post(_client(db, monkeypatch, {"id": str(clients[0].id), "role": "client"}), cls, 8)
    assert r.status_code in (403, 404)


def test_V9_org_admin_requires_reason(pg_session, monkeypatch):
    db = pg_session
    org, host, other, cls, sessions, clients = _setup(db, cap=5, active=2, waiting=0)
    admin = user(db, org, role="org_admin")
    http = _client(db, monkeypatch, {"id": str(admin.id), "role": "org_admin"})
    r = _post(http, cls, 8)
    assert r.status_code == 422 and r.json()["detail"]["code"] == "reason_required"


def test_V9_org_admin_with_reason_ok(pg_session, monkeypatch):
    db = pg_session
    org, host, other, cls, sessions, clients = _setup(db, cap=5, active=2, waiting=0)
    admin = user(db, org, role="org_admin")
    http = _client(db, monkeypatch, {"id": str(admin.id), "role": "org_admin"})
    r = _post(http, cls, 8, reason="행사 인원 증가")
    assert r.status_code == 200, r.text
    ev = db.query(ClassCapacityEvent).filter_by(class_id=cls.id).one()
    assert ev.reason == "행사 인원 증가" and str(ev.actor_id) == str(admin.id)


def test_V9_anonymous_denied(pg_session, monkeypatch):
    from app.api.v1.classes import router
    from app.config import settings

    db = pg_session
    org, host, other, cls, sessions, clients = _setup(db, cap=5, active=2, waiting=0)
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_db] = lambda: db
    monkeypatch.setattr(settings, "class_scheduling_enabled", True)
    r = TestClient(app).post(f"/api/v1/classes/{cls.id}/capacity",
                             json={"operation_key": "k", "capacity": 9})
    assert r.status_code in (401, 403)


def test_V10_failure_leaves_no_audit(pg_session, monkeypatch):
    db = pg_session
    org, host, other, cls, sessions, clients = _setup(db, cap=5, active=5, waiting=0)
    http = _client(db, monkeypatch, {"id": str(host.id), "role": "counselor"})
    assert _post(http, cls, 3).status_code == 422
    assert db.query(ClassCapacityEvent).filter_by(class_id=cls.id).count() == 0


def test_V12_mismatched_sessions_realigned(pg_session, monkeypatch):
    db = pg_session
    org, host, other, cls, sessions, clients = _setup(db, live=True, cap=10, active=4, waiting=0)
    # 과거 PATCH 로 클래스만 올라가고 회차는 어긋난 상태 재현
    cls.capacity = 12
    sessions[0].max_participants = 10
    sessions[1].max_participants = 11
    db.flush()
    http = _client(db, monkeypatch, {"id": str(host.id), "role": "counselor"})
    r = _post(http, cls, 12)  # 같은 클래스 값이어도 회차 정렬
    assert r.status_code == 200 and r.json()["changed"] is True
    db.expire_all()
    assert [s.max_participants for s in sessions] == [12, 12]
    assert cls.capacity == 12


def test_V13_legacy_paths_unchanged(pg_session, monkeypatch):
    from fastapi import HTTPException
    from app.services import session_service
    db = pg_session
    org, host, other, cls, sessions, clients = _setup(db, cap=5, active=2, waiting=0)
    with pytest.raises(HTTPException) as e:
        session_service._require_legacy_mutation(sessions[0], db)
    assert e.value.status_code == 409
