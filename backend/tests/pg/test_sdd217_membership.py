"""SDD-217 V01~06: 실제 마이그레이션 PG의 멤버 명령·FIFO·원자성."""
from app.api.deps import get_current_user_optional
from datetime import datetime, timedelta, timezone
from uuid import uuid4
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import event, text
from sqlalchemy.orm import Session as DBSession

from app.models.class_program import Class, ClassMember, ClassMemberEvent
from app.models.class_membership import ClassAttendanceEvent
from app.models.class_scheduling import ClassEffect, ClassOperation
from app.models.session import Session, SessionParticipant
from tests.pg.sdd216_helpers import world, user

pytestmark = pytest.mark.pg
NOW = datetime(2026, 11, 2, 1, tzinfo=timezone.utc)


def api():
    from app.services import class_membership_service as service
    assert hasattr(service, "transition_membership"), "멤버 전이 명령 구현 필요"
    assert hasattr(service, "request_waitlist"), "명시 대기 신청 명령 구현 필요"
    return service


def command(parent, **extra):
    return {"operation_key": str(uuid4()), "expected_revision": parent.revision, **extra}


def setup(db, capacity=1):
    org, host, other, parent = world(db)
    parent.capacity = capacity
    parent.access_code = None
    clients = [user(db, role="client") for _ in range(4)]
    from app.services.class_membership_service import invite_members
    first = invite_members(db, parent, [clients[0].id], host.id, NOW)[0]
    parent.access_code = "0217"
    db.flush()
    return host, other, parent, clients, first


def waiting(db, parent, client, position):
    row = ClassMember(class_id=parent.id, user_id=client.id, kind="member", status="waitlisted", joined_via="code", waitlist_position=position)
    db.add(row)
    db.flush()
    return row


def transition(db, actor, parent, member, action, **extra):
    return api().transition_membership(db, actor.id, parent.id, member.id, command(parent, action=action, **extra), now=NOW)


def test_v01_rejoin_same_id_future_only_and_idempotent(pg_session):
    db = pg_session
    host, _, parent, clients, member = setup(db)
    for i, days in enumerate((-2, 2)):
        db.add(Session(type="meditation", class_id=parent.id, host_id=host.id, seq=i + 1, status="scheduled", host_state="assigned", duration_min=60, scheduled_at=NOW+timedelta(days=days)))
    db.commit()
    transition(db, clients[0], parent, member, "leave")
    cmd = command(parent, action="rejoin")
    result = api().transition_membership(db, clients[0].id, parent.id, member.id, cmd, now=NOW)
    assert result["member"]["id"] == str(member.id)
    assert result["member"]["status"] == "active"
    assert api().transition_membership(db, clients[0].id, parent.id, member.id, cmd, now=NOW) == result
    rows = db.query(SessionParticipant).filter_by(member_id=member.id).all()
    assert len(rows) == 1 and rows[0].attendance_status == "expected"
    assert db.query(ClassMember).filter_by(class_id=parent.id, user_id=clients[0].id).count() == 1
    changed = {**cmd, "reason": "다른 요청"}
    with pytest.raises(HTTPException) as exc:
        api().transition_membership(db, clients[0].id, parent.id, member.id, changed, now=NOW)
    assert exc.value.detail["code"] == "operation_key_reused"


def test_v02_removed_only_host_restore_completed_rejoin_forbidden(pg_session):
    db = pg_session
    host, _, parent, clients, member = setup(db)
    db.commit()
    transition(db, host, parent, member, "remove")
    for action in ("rejoin", "restore"):
        with pytest.raises(HTTPException) as exc:
            transition(db, clients[0], parent, member, action)
        assert exc.value.status_code in (403, 409)
    from app.services.class_code_service import join_class_code
    with pytest.raises(HTTPException) as exc:
        join_class_code(db, parent.id, clients[0].id, "0217", now=NOW)
    assert exc.value.status_code == 409
    assert transition(db, host, parent, member, "restore")["member"]["status"] == "active"
    member.status = "completed"
    db.commit()
    with pytest.raises(HTTPException) as exc:
        transition(db, clients[0], parent, member, "rejoin")
    assert exc.value.detail["code"] == "member_transition_invalid"


def test_v04_fifo_cancel_reapply_end_and_capacity_shrink(pg_session):
    db = pg_session
    host, _, parent, clients, member = setup(db)
    first, second = waiting(db, parent, clients[1], 1), waiting(db, parent, clients[2], 2)
    db.commit()
    transition(db, clients[1], parent, first, "cancel_waitlist")
    api().request_waitlist(db, clients[1].id, parent.id, command(parent, code="0217"), now=NOW)
    assert first.waitlist_position > second.waitlist_position
    result = transition(db, clients[0], parent, member, "leave")
    assert result["promoted_member_ids"] == [str(second.id)]
    assert first.status == "waitlisted" and second.status == "active"
    parent.capacity = 1
    db.commit()
    with pytest.raises(HTTPException) as exc:
        transition(db, host, parent, first, "promote")
    assert exc.value.detail["code"] == "class_capacity"
    assert second.status == "active"
    parent.capacity = 2
    db.commit()
    transition(db, host, parent, first, "promote")
    parent.capacity = 1
    last = waiting(db, parent, clients[3], 3)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        transition(db, host, parent, last, "promote")
    assert exc.value.detail["code"] == "class_capacity"
    assert db.query(ClassMember).filter_by(class_id=parent.id, status="active").count() == 2


def test_waitlist_explicit_only_and_promote_cannot_skip_fifo(pg_session):
    db = pg_session
    host, _, parent, clients, member = setup(db)
    parent.capacity = 2
    db.commit()
    with pytest.raises(HTTPException) as exc:
        api().request_waitlist(db, clients[1].id, parent.id, command(parent, code="0217"), now=NOW)
    assert exc.value.detail["code"] == "waitlist_not_required"
    first, second = waiting(db, parent, clients[1], 1), waiting(db, parent, clients[2], 2)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        transition(db, host, parent, second, "promote")
    assert exc.value.detail["code"] == "waitlist_precedes"
    transition(db, host, parent, first, "promote")
    assert first.status == "active"


def test_v05_leave_withdraws_only_future_and_revokes_live_access(pg_session):
    db = pg_session
    host, _, parent, clients, member = setup(db)
    for i, (state, days, attendance) in enumerate((("completed", -1, "attended"), ("scheduled", 1, "expected"), ("scheduled", 2, "excused"), ("open", 0, "attended"))):
        session = Session(type="meditation", class_id=parent.id, host_id=host.id, seq=i+1, status=state, host_state="assigned", duration_min=60, scheduled_at=NOW+timedelta(days=days))
        db.add(session)
        db.flush()
        db.add(SessionParticipant(session_id=session.id, user_id=member.user_id, member_id=member.id, attendance_status=attendance, entered_at=NOW if attendance=="attended" else None))
    db.flush()
    from app.models.record import Report
    past = db.query(SessionParticipant).join(Session, Session.id == SessionParticipant.session_id).filter(SessionParticipant.member_id == member.id, Session.status == "completed").one()
    report = Report(session_id=past.session_id, participant_id=past.id, user_id=member.user_id, type="client", content={"summary":"합성 과거 기록"}, status="completed")
    db.add(report)
    db.commit()
    report_id, participant_id = report.id, past.id
    transition(db, clients[0], parent, member, "leave")
    rows = db.query(SessionParticipant).filter_by(member_id=member.id).execution_options(include_removed=True).all()
    assert db.get(Report, report_id).participant_id == participant_id
    assert db.get(Report, report_id).content == {"summary":"합성 과거 기록"}
    assert sorted(p.attendance_status for p in rows) == ["attended", "attended", "withdrawn", "withdrawn"]
    assert all(p.entry_ver == 1 for p in rows)
    assert member.entry_ver == 1
    assert db.query(ClassAttendanceEvent).filter_by(member_id=member.id).count() == 2
    assert db.query(ClassEffect).filter_by(class_id=parent.id, kind="live_access_reconcile").count() == 1


def test_v06_effect_insert_failure_rolls_back_promotion_audit_and_retry(pg_session):
    db = pg_session
    host, _, parent, clients, member = setup(db)
    queued = waiting(db, parent, clients[1], 1)
    db.commit()
    before = {model: db.query(model).count() for model in (ClassMemberEvent, ClassAttendanceEvent, ClassOperation, ClassEffect)}
    cmd = command(parent, action="leave")
    def fail(mapper, connection, target):
        if target.kind == "class_waitlist_promoted":
            raise RuntimeError("합성 전달 의도 저장 실패")
    event.listen(ClassEffect, "before_insert", fail)
    try:
        with pytest.raises(RuntimeError, match="합성 전달"):
            api().transition_membership(db, clients[0].id, parent.id, member.id, cmd, now=NOW)
    finally:
        event.remove(ClassEffect, "before_insert", fail)
    assert member.status == "active" and queued.status == "waitlisted"
    assert {model: db.query(model).count() for model in before} == before
    result = api().transition_membership(db, clients[0].id, parent.id, member.id, cmd, now=NOW)
    assert result["promoted_member_ids"] == [str(queued.id)]
    assert api().transition_membership(db, clients[0].id, parent.id, member.id, cmd, now=NOW) == result
    assert db.query(ClassEffect).filter_by(class_id=parent.id, kind="class_waitlist_promoted").count() == 1


def test_http_permissions_hidden_member_and_strict_input(pg_session, monkeypatch):
    db = pg_session
    host, other, parent, clients, member = setup(db)
    db.commit()
    import importlib.util
    assert importlib.util.find_spec("app.api.v1.class_membership"), "멤버 명령 HTTP 라우트 구현 필요"
    from app.api.v1 import class_membership
    from app.api.deps import get_current_user
    from app.core.database import get_db
    from app.config import settings
    monkeypatch.setattr(settings, "class_scheduling_enabled", True)
    app = FastAPI()
    app.include_router(class_membership.router, prefix="/api/v1")
    identity = {"id": str(clients[1].id)}
    app.dependency_overrides[get_current_user] = lambda: identity
    app.dependency_overrides[get_current_user_optional] = app.dependency_overrides[get_current_user]
    app.dependency_overrides[get_db] = lambda: db
    path = f"/api/v1/classes/{parent.id}/members/{member.id}/transition"
    with TestClient(app) as client:
        assert client.post(path, json=command(parent, action="leave")).status_code == 403
        assert client.post(path, json=command(parent, action="remove")).status_code in (403, 404)
        identity["id"] = str(clients[0].id)
        assert client.post(path, json=command(parent, action="leave", guest_member_id=str(member.id))).status_code == 422
        assert client.post(path, json=command(parent, action="remove")).status_code == 403
        identity["id"] = str(host.id)
        assert client.post(path, json=command(parent, action="remove")).status_code == 200
        identity["id"] = str(clients[0].id)
        response = client.post(path, json=command(parent, action="rejoin"))
        assert response.status_code == 409
        monkeypatch.setattr(settings, "class_scheduling_enabled", False)
        assert client.post(path, json=command(parent, action="rejoin")).status_code == 404


def test_code_left_rejoins_same_row_and_cannot_jump_waitlist(pg_session):
    from app.services.class_code_service import join_class_code
    db = pg_session
    host, _, parent, clients, member = setup(db)
    member.status = "left"
    db.commit()
    result = join_class_code(db, parent.id, clients[0].id, "0217", now=NOW)
    assert result["member_id"] == str(member.id) and result["status"] == "active"
    member.status = "left"
    queued = waiting(db, parent, clients[1], 1)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        join_class_code(db, parent.id, clients[2].id, "0217", now=NOW)
    assert exc.value.detail["code"] == "waitlist_precedes"
    result = join_class_code(db, parent.id, clients[0].id, "0217", now=NOW)
    assert result["status"] == "waitlisted" and member.waitlist_position > queued.waitlist_position


def test_v03_last_seat_restore_promote_join_three_connections(pg_engine, scratch_db):
    from sqlalchemy import create_engine
    from app.services.class_code_service import join_class_code
    from tests.pg.conftest import alembic_ok
    url = scratch_db("membership_race")
    alembic_ok(url, "upgrade", "head")
    engine = create_engine(url)
    try:
        with DBSession(engine) as db:
            host, _, parent, clients, removed = setup(db)
            removed.status = "removed"
            queued = waiting(db, parent, clients[1], 1)
            db.commit()
            ids = (host.id, parent.id, removed.id, queued.id, clients[2].id)
            revision = parent.revision
        barrier = threading.Barrier(3)
        def worker(action):
            with DBSession(engine) as db:
                db.execute(text("SET LOCAL lock_timeout = '5s'"))
                barrier.wait(timeout=5)
                try:
                    if action == "join":
                        return join_class_code(db, ids[1], ids[4], "0217", now=NOW)
                    return api().transition_membership(db, ids[0], ids[1], ids[2] if action=="restore" else ids[3], {"operation_key":str(uuid4()), "expected_revision":revision, "action":action}, now=NOW)
                except HTTPException as exc:
                    return {"error":exc.detail["code"]}
        with ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(worker, ("restore", "promote", "join")))
        assert results[2].get("error") in ("waitlist_precedes", "class_capacity")
        with DBSession(engine) as db:
            active = db.query(ClassMember).filter_by(class_id=ids[1], status="active").all()
            assert len(active) <= 1
            if active:
                assert active[0].id == ids[3]
            else:
                cls = db.get(Class, ids[1])
                result = api().transition_membership(db, ids[0], cls.id, ids[3], command(cls, action="promote"), now=NOW)
                assert result["member"]["status"] == "active"
    finally:
        engine.dispose()


def test_v06_participant_and_class_revision_rollback_with_effect_failure(pg_session):
    db = pg_session
    host, _, parent, clients, member = setup(db)
    queued = waiting(db, parent, clients[1], 1)
    session = Session(type="meditation", class_id=parent.id, host_id=host.id, seq=1, status="scheduled", host_state="assigned", duration_min=60, scheduled_at=NOW+timedelta(days=1))
    db.add(session)
    db.flush()
    participant = SessionParticipant(session_id=session.id, user_id=member.user_id, member_id=member.id, attendance_status="expected")
    db.add(participant)
    db.commit()
    revision = parent.revision
    def fail(mapper, connection, target):
        if target.kind == "class_waitlist_promoted":
            raise RuntimeError("합성 승격 의도 실패")
    event.listen(ClassEffect, "before_insert", fail)
    try:
        with pytest.raises(RuntimeError):
            transition(db, clients[0], parent, member, "leave")
    finally:
        event.remove(ClassEffect, "before_insert", fail)
    assert participant.attendance_status == "expected" and participant.entry_ver == 0
    assert parent.revision == revision and session.participation_version == 0
    assert db.query(ClassAttendanceEvent).filter_by(class_id=parent.id).count() == 0
    assert db.query(SessionParticipant).filter_by(member_id=queued.id).count() == 0


def test_member_dto_capabilities_follow_current_actor(pg_session):
    db = pg_session
    host, _, parent, clients, member = setup(db)
    db.commit()
    result = transition(db, host, parent, member, "remove")
    assert result["member"]["capabilities"]["manage_members"] is True
    assert result["member"]["capabilities"]["rejoin"] is False
    result = transition(db, host, parent, member, "restore")
    assert result["member"]["capabilities"]["leave"] is False
    result = transition(db, clients[0], parent, member, "leave")
    assert result["member"]["capabilities"]["rejoin"] is True
    assert result["member"]["capabilities"]["manage_members"] is False


def test_session_capacity_applies_to_restore_and_code_join_atomically(pg_session):
    from app.services.class_code_service import join_class_code
    db = pg_session
    host, _, parent, clients, member = setup(db, capacity=3)
    session = Session(type="meditation", class_id=parent.id, host_id=host.id, seq=1, status="scheduled", host_state="assigned", max_participants=1, duration_min=60, scheduled_at=NOW+timedelta(days=1))
    db.add(session)
    db.flush()
    db.add(SessionParticipant(session_id=session.id, user_id=member.user_id, member_id=member.id, attendance_status="expected"))
    removed = waiting(db, parent, clients[1], 1)
    removed.status = "removed"
    db.commit()
    for action in ("restore", "join"):
        with pytest.raises(HTTPException) as exc:
            if action == "restore":
                transition(db, host, parent, removed, "restore")
            else:
                join_class_code(db, parent.id, clients[2].id, "0217", now=NOW)
        assert exc.value.detail["code"] == "session_capacity"
    assert removed.status == "removed"
    assert db.query(ClassMember).filter_by(class_id=parent.id, user_id=clients[2].id).count() == 0
    assert db.query(SessionParticipant).filter_by(session_id=session.id).count() == 1


def test_actor_operation_key_is_global_and_current_authorization_precedes_replay(pg_session):
    from app.models.class_program import ClassInstructor
    db = pg_session
    host, _, parent, clients, member = setup(db)
    db.commit()
    cmd = command(parent, action="remove")
    result = api().transition_membership(db, host.id, parent.id, member.id, cmd, now=NOW)
    assert result["member"]["status"] == "removed"
    db.query(ClassInstructor).filter_by(class_id=parent.id, user_id=host.id).one().status = "removed"
    db.commit()
    with pytest.raises(HTTPException) as exc:
        api().transition_membership(db, host.id, parent.id, member.id, cmd, now=NOW)
    assert exc.value.status_code in (403, 404)
    # 본인 키도 다른 클래스·대상에서 재사용할 수 없다.
    own = command(parent, action="rejoin")
    member.status = "left"
    db.commit()
    api().transition_membership(db, clients[0].id, parent.id, member.id, own, now=NOW)
    _, _, _, parent2 = world(db)
    member2 = ClassMember(class_id=parent2.id, user_id=clients[0].id, status="left", kind="member", joined_via="code")
    db.add(member2)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        api().transition_membership(db, clients[0].id, parent2.id, member2.id, {**own,"expected_revision":parent2.revision}, now=NOW)
    assert exc.value.detail["code"] == "operation_key_reused"


def test_waitlist_http_preserves_code_attempt_limit(pg_session, monkeypatch):
    from app.api.v1 import class_membership
    from app.api.deps import get_current_user
    from app.core.database import get_db
    from app.core.redis import get_redis
    from app.config import settings
    host, _, parent, clients, member = setup(pg_session)
    pg_session.commit()
    monkeypatch.setattr(settings, "class_scheduling_enabled", True)
    class MemoryRedis:
        def __init__(self):
            self.values = {}
        async def get(self, key):
            return self.values.get(key)
        async def incr(self, key):
            self.values[key] = int(self.values.get(key, 0)) + 1
            return self.values[key]
        async def expire(self, key, seconds):
            return True
        async def setex(self, key, seconds, value):
            self.values[key] = value
    redis = MemoryRedis()
    app = FastAPI()
    app.include_router(class_membership.router, prefix="/api/v1")
    app.dependency_overrides[get_db] = lambda: pg_session
    app.dependency_overrides[get_current_user] = lambda: {"id":str(clients[1].id)}
    app.dependency_overrides[get_current_user_optional] = app.dependency_overrides[get_current_user]
    app.dependency_overrides[get_redis] = lambda: redis
    path = f"/api/v1/classes/{parent.id}/waitlist"
    with TestClient(app) as client:
        for _ in range(10):
            assert client.post(path, json=command(parent, code="9999")).status_code == 404
        assert client.post(path, json=command(parent, code="0217")).status_code == 429


def test_leave_without_promotion_still_stores_notification_intent_once(pg_session):
    db = pg_session
    host, _, parent, clients, member = setup(db)
    db.commit()
    cmd = command(parent, action="leave")
    api().transition_membership(db, clients[0].id, parent.id, member.id, cmd, now=NOW)
    intents = db.query(ClassEffect).filter_by(class_id=parent.id, kind="class_member_left").all()
    assert len(intents) == 1 and str(host.id) in intents[0].payload["recipient_ids"]
    api().transition_membership(db, clients[0].id, parent.id, member.id, cmd, now=NOW)
    assert db.query(ClassEffect).filter_by(class_id=parent.id, kind="class_member_left").count() == 1


def test_existing_distinct_guest_members_count_toward_login_capacity(pg_session):
    from app.services.class_code_service import join_class_code
    from app.services.class_membership_service import invite_members
    db = pg_session
    host, _, parent, clients, member = setup(db, capacity=2)
    member.status = "left"
    for _ in range(2):
        db.add(ClassMember(class_id=parent.id, user_id=None, kind="guest", status="active", joined_via="code"))
    db.commit()
    for operation in ("code", "invite"):
        with pytest.raises(HTTPException) as exc:
            if operation == "code":
                join_class_code(db, parent.id, clients[2].id, "0217", now=NOW)
            else:
                invite_members(db, parent, [clients[2].id], host.id, NOW)
        assert exc.value.detail["code"] == "class_capacity"
    assert db.query(ClassMember).filter_by(class_id=parent.id, status="active").count() == 2


@pytest.mark.parametrize("action", ["leave", "remove"])
@pytest.mark.parametrize("attendance", ["expected", "attended"])
def test_review_r1_live_departure_frees_eligibility_without_erasing_attendance(pg_session, action, attendance):
    db = pg_session
    host, _, parent, clients, member = setup(db)
    parent.recurrence_rule = {"start_now": True}
    queued = waiting(db, parent, clients[1], 1)
    session = Session(type="meditation", class_id=parent.id, host_id=host.id, seq=1, status="in_progress", host_state="assigned", max_participants=1, duration_min=60, scheduled_at=NOW, started_at=NOW)
    db.add(session)
    db.flush()
    participant = SessionParticipant(session_id=session.id, user_id=member.user_id, member_id=member.id, attendance_status=attendance, entered_at=NOW if attendance == "attended" else None)
    db.add(participant)
    db.commit()
    participant_id = participant.id
    result = transition(db, clients[0] if action == "leave" else host, parent, member, action)
    assert result["member"]["status"] == ("left" if action == "leave" else "removed")
    assert result["promoted_member_ids"] == [str(queued.id)]
    assert db.get(SessionParticipant, participant_id).attendance_status == attendance
    assert db.get(SessionParticipant, participant_id).entered_at == (NOW if attendance == "attended" else None)
    assert db.get(SessionParticipant, participant_id).entry_ver == 1
    assert db.query(SessionParticipant).filter_by(session_id=session.id, member_id=queued.id).one().attendance_status == "expected"
    assert db.query(ClassEffect).filter_by(class_id=parent.id, kind="live_access_reconcile").count() == 1


def test_review_r2_existing_invite_http_cannot_exceed_session_capacity(pg_session, monkeypatch):
    from app.api.v1 import classes
    from app.api.deps import get_current_user
    from app.core.database import get_db
    from app.config import settings
    db = pg_session
    host, _, parent, clients, member = setup(db, capacity=3)
    session = Session(type="meditation", class_id=parent.id, host_id=host.id, seq=1, status="scheduled", host_state="assigned", max_participants=1, duration_min=60, scheduled_at=datetime.now(timezone.utc)+timedelta(days=1))
    db.add(session)
    db.flush()
    db.add(SessionParticipant(session_id=session.id, user_id=member.user_id, member_id=member.id, attendance_status="expected"))
    db.commit()
    revision = parent.revision
    monkeypatch.setattr(settings, "class_scheduling_enabled", True)
    app = FastAPI()
    app.include_router(classes.router, prefix="/api/v1")
    app.dependency_overrides[get_current_user] = lambda: {"id": str(host.id)}
    app.dependency_overrides[get_current_user_optional] = app.dependency_overrides[get_current_user]
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as client:
        response = client.post(f"/api/v1/classes/{parent.id}/members", json=command(parent, user_ids=[str(clients[1].id)]))
    assert response.status_code == 409 and response.json()["detail"]["code"] == "session_capacity"
    assert db.query(ClassMember).filter_by(class_id=parent.id, user_id=clients[1].id).count() == 0
    assert db.query(SessionParticipant).filter_by(session_id=session.id).count() == 1
    assert parent.revision == revision


def test_review_r2_invite_locks_session_and_rechecks_latest_occupancy(pg_engine, scratch_db):
    from sqlalchemy import create_engine
    from tests.pg.conftest import alembic_ok
    from app.services.class_membership_service import invite_members
    url = scratch_db("invite_session_lock")
    alembic_ok(url, "upgrade", "head")
    engine = create_engine(url)
    attempted_session_lock = threading.Event()
    try:
        with DBSession(engine) as seed:
            host, _, parent, clients, member = setup(seed, capacity=3)
            session = Session(type="meditation", class_id=parent.id, host_id=host.id, seq=1, status="scheduled", host_state="assigned", max_participants=1, duration_min=60, scheduled_at=NOW+timedelta(days=1))
            seed.add(session)
            seed.flush()
            participant = SessionParticipant(session_id=session.id, user_id=member.user_id, member_id=member.id, attendance_status="excused")
            seed.add(participant)
            seed.commit()
            ids = (parent.id, host.id, clients[1].id, session.id, participant.id)
        with DBSession(engine) as holder:
            holder.query(Session).filter_by(id=ids[3]).with_for_update().one()
            def observe(conn, cursor, statement, parameters, context, executemany):
                if "FROM sessions" in statement and "FOR UPDATE" in statement:
                    attempted_session_lock.set()
            event.listen(engine, "before_cursor_execute", observe)
            def invite():
                with DBSession(engine) as db:
                    db.execute(text("SET LOCAL lock_timeout = '5s'"))
                    cls = db.query(Class).filter_by(id=ids[0]).with_for_update().one()
                    try:
                        invite_members(db, cls, [ids[2]], ids[1], NOW)
                        db.commit()
                        return "success"
                    except HTTPException as exc:
                        db.rollback()
                        return exc.detail["code"]
            try:
                with ThreadPoolExecutor(max_workers=1) as pool:
                    future = pool.submit(invite)
                    assert attempted_session_lock.wait(timeout=5), "기존 초대가 회차 FOR UPDATE를 얻어야 한다"
                    assert not future.done(), "다른 연결의 회차 잠금 해제 전에 초대가 완료되면 안 된다"
                    holder.get(SessionParticipant, ids[4]).attendance_status = "expected"
                    holder.commit()
                    assert future.result(timeout=5) == "session_capacity"
            finally:
                event.remove(engine, "before_cursor_execute", observe)
        with DBSession(engine) as db:
            assert db.query(ClassMember).filter_by(class_id=ids[0], user_id=ids[2]).count() == 0
            assert db.query(SessionParticipant).filter_by(session_id=ids[3], attendance_status="expected").count() == 1
    finally:
        engine.dispose()


@pytest.mark.parametrize("depart,return_action", [("leave", "rejoin"), ("remove", "restore")])
def test_review_round2_attended_member_return_rechecks_current_session_capacity(pg_session, depart, return_action):
    from app.services.class_code_service import join_class_code
    db = pg_session
    host, _, parent, clients, member = setup(db, capacity=2)
    parent.recurrence_rule = {"start_now": True}
    session = Session(type="meditation", class_id=parent.id, host_id=host.id, seq=1, status="in_progress", host_state="assigned", max_participants=1, duration_min=60, scheduled_at=NOW, started_at=NOW)
    db.add(session)
    db.flush()
    original = SessionParticipant(session_id=session.id, user_id=member.user_id, member_id=member.id, attendance_status="attended", entered_at=NOW)
    db.add(original)
    db.commit()
    participant_id = original.id
    transition(db, clients[0] if depart == "leave" else host, parent, member, depart)
    joined = join_class_code(db, parent.id, clients[1].id, "0217", now=NOW)
    assert joined["status"] == "active"
    revision = parent.revision
    with pytest.raises(HTTPException) as exc:
        transition(db, clients[0] if return_action == "rejoin" else host, parent, member, return_action)
    assert exc.value.status_code == 409 and exc.value.detail["code"] == "session_capacity"
    assert member.status == ("left" if depart == "leave" else "removed")
    assert parent.revision == revision
    assert db.get(SessionParticipant, participant_id).attendance_status == "attended"
    assert db.get(SessionParticipant, participant_id).entered_at == NOW
    assert db.query(ClassMember).filter_by(class_id=parent.id, status="active").count() == 1
    assert db.query(SessionParticipant).filter_by(session_id=session.id, user_id=clients[1].id).one().attendance_status == "expected"
    # 자리가 실제로 반환되면 같은 attended 행을 보존하면서 재가입·복구할 수 있다.
    transition(db, clients[1], parent, db.query(ClassMember).filter_by(id=joined["member_id"]).one(), "leave")
    result = transition(db, clients[0] if return_action == "rejoin" else host, parent, member, return_action)
    assert result["member"]["status"] == "active"
    assert db.get(SessionParticipant, participant_id).attendance_status == "attended"
    assert db.get(SessionParticipant, participant_id).entered_at == NOW
