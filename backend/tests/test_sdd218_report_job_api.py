"""SDD-218 B11·B12·C1·C2 + IDOR: 일괄 작업 API 계약.

기존 단건 승인과 approve-all 의 응답·의미가 변하지 않았는지도 여기서 본다.
"""

import time
import uuid

import pytest

from app.models.class_program import Class, ClassInstructor, ClassMember
from app.models.organization import Organization
from app.models.record import Report
from app.models.session import Session, SessionParticipant
from app.models.user import User
from app.models.user_org_membership import UserOrgMembership

VALID_PASSWORD = "Passw0rd!"


def _login_counselor(client, db, org):
    """실제 로그인 토큰이 필요한 API 테스트용 지도사."""
    from app.core.security import create_access_token

    user = User(
        id=uuid.uuid4(), email=f"{uuid.uuid4().hex[:10]}@e.com", name="지도사",
        role="counselor", status="active", password_hash="x",
    )
    db.add(user)
    db.add(UserOrgMembership(
        id=uuid.uuid4(), user_id=user.id, org_id=org.id, role="counselor", status="active"))
    db.commit()
    token = create_access_token(str(user.id))
    return user, {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def _enable_class_scheduling(monkeypatch):
    """클래스 편성 기능 플래그. 218 경로는 이 플래그 아래에 있다."""
    from app.config import settings

    monkeypatch.setattr(settings, "class_scheduling_enabled", True)


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
    org = Organization(
        id=uuid.uuid4(), name="기관", kind="center", org_code=uuid.uuid4().hex[:6])
    db.add(org)
    db.flush()
    host, auth = _login_counselor(client, db, org)
    cls = Class(
        id=uuid.uuid4(), organization_id=org.id, created_by=host.id, title="MBSR 8주",
        status="active", default_duration_min=60, recurrence_rule="FREQ=WEEKLY")
    db.add(cls)
    db.flush()
    db.add(ClassInstructor(id=uuid.uuid4(), class_id=cls.id, user_id=host.id, role="lead"))
    session = Session(
        id=uuid.uuid4(), type="meditation", status="completed", host_id=host.id,
        class_id=cls.id, duration_min=60)
    db.add(session)
    db.flush()

    reports = []
    for _ in range(3):
        member_user = User(
            id=uuid.uuid4(), email=f"{uuid.uuid4().hex[:10]}@e.com", name="회원",
            role="client", status="active", password_hash="x")
        db.add(member_user)
        db.flush()
        member = ClassMember(
            id=uuid.uuid4(), class_id=cls.id, user_id=member_user.id, kind="member",
            status="active", joined_via="invite")
        db.add(member)
        db.flush()
        participant = SessionParticipant(
            id=uuid.uuid4(), session_id=session.id, user_id=member_user.id,
            member_id=member.id, attendance_status="attended", report_included=True)
        db.add(participant)
        db.flush()
        report = Report(
            id=uuid.uuid4(), session_id=session.id, participant_id=participant.id,
            user_id=member_user.id, type="client", status="pending_review", content={})
        db.add(report)
        db.flush()
        reports.append(report)
    db.commit()
    return {"org": org, "host": host, "auth": auth, "cls": cls,
            "session": session, "reports": reports}


def _payload(world, **over):
    body = {
        "action": "approve",
        "operation_key": "op-" + uuid.uuid4().hex[:12],
        "targets": [str(r.id) for r in world["reports"]],
    }
    body.update(over)
    return body


def test_b11_접수는_202와_location_헤더를_준다(client, world):
    res = client.post(
        f"/api/v1/classes/{world['cls'].id}/report-jobs",
        json=_payload(world), headers=world["auth"])
    assert res.status_code == 202, res.text
    body = res.json()
    assert body["accepted"] == 3
    assert body["status"] in ("accepted", "running", "completed")
    assert "Location" in res.headers
    assert body["job_id"] in res.headers["Location"]


def test_b12_b13_대량_접수의_응답시간과_쿼리수를_측정한다(client, world, db):
    """아키텍처 규칙: HTTP 요청은 200ms 이내 응답.

    TestClient 는 BackgroundTask 까지 동기로 돌리므로 HTTP 왕복 시간에는
    실제 운영에서 응답 이후에 일어나는 건별 처리가 섞인다.
    따라서 접수 경로(accept_job) 자체의 시간과 쿼리 수를 따로 측정한다.
    """
    from sqlalchemy import event

    from app.services import class_report_job_service as svc

    extra = []
    for _ in range(47):
        member_user = User(
            id=uuid.uuid4(), email=f"{uuid.uuid4().hex[:10]}@e.com", name="회원",
            role="client", status="active", password_hash="x")
        db.add(member_user)
        db.flush()
        member = ClassMember(
            id=uuid.uuid4(), class_id=world["cls"].id, user_id=member_user.id,
            kind="member", status="active", joined_via="invite")
        db.add(member)
        db.flush()
        participant = SessionParticipant(
            id=uuid.uuid4(), session_id=world["session"].id, user_id=member_user.id,
            member_id=member.id, attendance_status="attended", report_included=True)
        db.add(participant)
        db.flush()
        report = Report(
            id=uuid.uuid4(), session_id=world["session"].id, participant_id=participant.id,
            user_id=member_user.id, type="client", status="pending_review", content={})
        db.add(report)
        extra.append(report)
    db.commit()
    targets = [str(r.id) for r in world["reports"] + extra]

    queries: list[str] = []

    def _count(conn, cursor, statement, params, context, executemany):
        queries.append(statement)

    event.listen(db.get_bind(), "before_cursor_execute", _count)
    try:
        started = time.perf_counter()
        result = svc.accept_job(
            db, actor_id=world["host"].id, class_id=world["cls"].id, action="approve",
            operation_key="op-" + uuid.uuid4().hex[:12], targets=targets)
        elapsed_ms = (time.perf_counter() - started) * 1000
    finally:
        event.remove(db.get_bind(), "before_cursor_execute", _count)

    print(f"\n[B12] 50건 접수: {elapsed_ms:.1f}ms")
    print(f"[B13] 50건 접수 쿼리 수: {len(queries)}회")
    assert result["accepted"] == 50
    assert elapsed_ms < 200, f"접수가 200ms 를 넘는다: {elapsed_ms:.1f}ms"
    # 대상 수에 비례해 쿼리가 늘면 N+1 이다. 50건에 30회 미만이어야 한다.
    assert len(queries) < 30, f"N+1 의심: 50건에 쿼리 {len(queries)}회"


def test_b11_http_접수는_202를_준다(client, world):
    res = client.post(
        f"/api/v1/classes/{world['cls'].id}/report-jobs",
        json=_payload(world), headers=world["auth"])
    assert res.status_code == 202, res.text


def test_b1_같은_키_재요청은_같은_작업을_준다(client, world):
    body = _payload(world)
    first = client.post(
        f"/api/v1/classes/{world['cls'].id}/report-jobs", json=body, headers=world["auth"])
    second = client.post(
        f"/api/v1/classes/{world['cls'].id}/report-jobs", json=body, headers=world["auth"])
    assert first.status_code == second.status_code == 202
    assert first.json()["job_id"] == second.json()["job_id"]


def test_b2_같은_키_다른_본문은_409다(client, world):
    body = _payload(world)
    client.post(f"/api/v1/classes/{world['cls'].id}/report-jobs",
                json=body, headers=world["auth"])
    changed = dict(body, targets=[str(world["reports"][0].id)])
    res = client.post(f"/api/v1/classes/{world['cls'].id}/report-jobs",
                      json=changed, headers=world["auth"])
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "operation_key_reused"


def test_조회는_작업_결과를_돌려준다(client, world):
    created = client.post(
        f"/api/v1/classes/{world['cls'].id}/report-jobs",
        json=_payload(world), headers=world["auth"]).json()
    res = client.get(
        f"/api/v1/classes/{world['cls'].id}/report-jobs/{created['job_id']}",
        headers=world["auth"])
    assert res.status_code == 200
    body = res.json()
    assert len(body["items"]) == 3
    assert all("retriable" in i for i in body["items"])


def test_idor_남의_작업은_조회할_수_없다(client, world, db):
    created = client.post(
        f"/api/v1/classes/{world['cls'].id}/report-jobs",
        json=_payload(world), headers=world["auth"]).json()

    other_org = Organization(
        id=uuid.uuid4(), name="다른 기관", kind="center", org_code=uuid.uuid4().hex[:6])
    db.add(other_org)
    db.flush()
    _, other_auth = _login_counselor(client, db, other_org)
    db.commit()

    res = client.get(
        f"/api/v1/classes/{world['cls'].id}/report-jobs/{created['job_id']}",
        headers=other_auth)
    assert res.status_code in (403, 404)


def test_idor_다른_클래스_경로로는_조회할_수_없다(client, world, db):
    created = client.post(
        f"/api/v1/classes/{world['cls'].id}/report-jobs",
        json=_payload(world), headers=world["auth"]).json()
    other_cls = Class(
        id=uuid.uuid4(), organization_id=world["org"].id, created_by=world["host"].id,
        title="다른 클래스", status="active", default_duration_min=60)
    db.add(other_cls)
    db.commit()

    res = client.get(
        f"/api/v1/classes/{other_cls.id}/report-jobs/{created['job_id']}",
        headers=world["auth"])
    assert res.status_code == 404


def test_지원하지_않는_action은_422다(client, world):
    res = client.post(
        f"/api/v1/classes/{world['cls'].id}/report-jobs",
        json=_payload(world, action="delete_all"), headers=world["auth"])
    assert res.status_code == 422


def test_빈_대상은_422다(client, world):
    res = client.post(
        f"/api/v1/classes/{world['cls'].id}/report-jobs",
        json=_payload(world, targets=[]), headers=world["auth"])
    assert res.status_code == 422
