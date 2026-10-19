"""SDD-218 B1~B11, A10: 일괄 작업 멱등·부분 실패·실행 시 권한 재검사.

핵심 계약: `failed`(재시도 가능)와 `excluded`(정책상 처리 제외)는 다르다.
"""

import uuid

import pytest
from fastapi import HTTPException

from app.models.class_program import Class, ClassInstructor, ClassMember
from app.models.class_report_job import ClassReportJob, ClassReportJobItem
from app.models.organization import Organization
from app.models.record import Report
from app.models.session import Session, SessionParticipant
from app.models.user import User
from app.models.user_org_membership import UserOrgMembership
from app.services import class_report_job_service as svc


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


def _counselor(db, org, *, status="active") -> User:
    user = User(
        id=uuid.uuid4(), email=f"{uuid.uuid4().hex[:10]}@e.com", name="지도사",
        role="counselor", status=status, password_hash="x",
    )
    db.add(user)
    db.add(UserOrgMembership(
        id=uuid.uuid4(), user_id=user.id, org_id=org.id, role="counselor", status="active"))
    db.flush()
    return user


def _client_user(db) -> User:
    user = User(
        id=uuid.uuid4(), email=f"{uuid.uuid4().hex[:10]}@e.com", name="회원",
        role="client", status="active", password_hash="x",
    )
    db.add(user)
    db.flush()
    return user


@pytest.fixture
def world(db):
    """지도사 1명 + 클래스 1개 + 회차 1개 + 검토 대기 리포트 3건."""
    org = Organization(
        id=uuid.uuid4(), name="기관", kind="center", org_code=uuid.uuid4().hex[:6])
    db.add(org)
    db.flush()
    host = _counselor(db, org)
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
        member_user = _client_user(db)
        member = ClassMember(
            id=uuid.uuid4(), class_id=cls.id, user_id=member_user.id,
            kind="member", status="active", joined_via="invite")
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
        reports.append((report, participant))
    db.commit()
    return {"db": db, "org": org, "host": host, "cls": cls, "session": session,
            "reports": [r for r, _ in reports], "participants": [p for _, p in reports]}


def _accept(world, **over):
    kwargs = dict(
        actor_id=world["host"].id, class_id=world["cls"].id, action="approve",
        operation_key="op-" + uuid.uuid4().hex[:8],
        targets=[str(r.id) for r in world["reports"]],
    )
    kwargs.update(over)
    return svc.accept_job(world["db"], **kwargs)


def test_b11_접수는_job_id와_대상_수를_돌려준다(world):
    res = _accept(world)
    assert res["job_id"]
    assert res["accepted"] == 3
    assert res["status"] == "accepted"
    assert res["excluded"] == []


def test_b1_같은_operation_key와_같은_본문은_기존_작업을_돌려준다(world):
    key = "op-fixed"
    first = _accept(world, operation_key=key)
    second = _accept(world, operation_key=key)
    assert first["job_id"] == second["job_id"]
    assert world["db"].query(ClassReportJob).count() == 1


def test_b2_같은_operation_key에_다른_본문은_409다(world):
    key = "op-fixed"
    _accept(world, operation_key=key)
    with pytest.raises(HTTPException) as exc:
        _accept(world, operation_key=key, targets=[str(world["reports"][0].id)])
    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "operation_key_reused"


def test_b3_b6_일괄_승인_후_전건_성공한다(world):
    job = _accept(world)
    res = svc.run_job(world["db"], job["job_id"])
    assert res["status"] == "completed"
    assert [i["state"] for i in res["items"]] == ["succeeded"] * 3
    for report in world["reports"]:
        world["db"].refresh(report)
        assert report.status == "completed"
        assert report.approved_by_user_id == world["host"].id


def test_b3_중복_실행해도_승인_시각이_바뀌지_않는다(world):
    job = _accept(world)
    svc.run_job(world["db"], job["job_id"])
    world["db"].refresh(world["reports"][0])
    first_approved_at = world["reports"][0].approved_at

    svc.run_job(world["db"], job["job_id"])
    world["db"].refresh(world["reports"][0])
    assert world["reports"][0].approved_at == first_approved_at


def test_b5_처리된_건을_다시_처리해도_효과가_없다(world):
    job = _accept(world)
    svc.run_job(world["db"], job["job_id"])
    item = world["db"].query(ClassReportJobItem).filter_by(
        job_id=uuid.UUID(job["job_id"])).first()
    attempts_before = item.attempts

    # 워커 재시도 상황 — 같은 건이 한 번 더 들어온다.
    assert svc.process_item(world["db"], item.id) == "succeeded"
    world["db"].refresh(item)
    assert item.attempts == attempts_before


def test_b4_이미_승인된_건도_성공으로_처리된다(world):
    from app.services import report_service

    report = world["reports"][0]
    report_service.approve_report(str(report.id), str(world["host"].id), world["db"])
    world["db"].commit()

    job = _accept(world)
    res = svc.run_job(world["db"], job["job_id"])
    assert all(i["state"] == "succeeded" for i in res["items"])


def test_b10_결석자는_excluded_absent로_분류된다(world):
    world["participants"][0].attendance_status = "excused"
    world["db"].commit()

    res = svc.run_job(world["db"], _accept(world)["job_id"])
    states = {i["report_id"]: (i["state"], i["reason_code"]) for i in res["items"]}
    assert states[str(world["reports"][0].id)] == ("excluded", "absent")
    # 결석 건은 승인되지 않는다.
    world["db"].refresh(world["reports"][0])
    assert world["reports"][0].status == "pending_review"
    assert sum(1 for i in res["items"] if i["state"] == "succeeded") == 2


def test_b9_실행_중_동의_철회는_failed가_아니라_excluded다(world):
    job = _accept(world)
    # 접수 뒤, 실행 전에 참여자가 이 회차 반영을 철회한다.
    world["participants"][0].report_consent_override = True
    world["participants"][0].report_included = False
    world["db"].commit()

    res = svc.run_job(world["db"], job["job_id"])
    item = next(i for i in res["items"] if i["report_id"] == str(world["reports"][0].id))
    assert item["state"] == "excluded"
    assert item["reason_code"] == "consent_withdrawn"
    assert item["retriable"] is False


def test_a10_실행_시점에_권한을_잃으면_excluded_forbidden이다(world):
    job = _accept(world)
    # 접수 뒤 지도사가 비활성화된다.
    world["host"].status = "inactive"
    world["db"].commit()

    res = svc.run_job(world["db"], job["job_id"])
    assert all(i["state"] == "excluded" and i["reason_code"] == "forbidden"
               for i in res["items"])


def test_b7_retry는_failed_건만_다시_시도한다(world):
    job = _accept(world)
    svc.run_job(world["db"], job["job_id"])

    items = world["db"].query(ClassReportJobItem).filter_by(
        job_id=uuid.UUID(job["job_id"])).all()
    # 한 건을 인위적으로 실패시킨다.
    items[0].state, items[0].reason_code = "failed", "internal_error"
    # 한 건은 제외 상태로 둔다.
    items[1].state, items[1].reason_code = "excluded", "absent"
    world["db"].commit()
    excluded_attempts = items[1].attempts

    res = svc.retry_job(world["db"], job["job_id"], world["host"].id)
    by_id = {i["report_id"]: i for i in res["items"]}
    assert by_id[str(items[0].report_id)]["state"] == "succeeded"
    # 제외 건은 손대지 않는다.
    world["db"].refresh(items[1])
    assert items[1].state == "excluded"
    assert items[1].attempts == excluded_attempts


def test_b8_excluded_건은_재시도_대상으로_노출되지_않는다(world):
    world["participants"][0].attendance_status = "excused"
    world["db"].commit()
    res = svc.run_job(world["db"], _accept(world)["job_id"])
    for item in res["items"]:
        if item["state"] == "excluded":
            assert item["retriable"] is False


def test_타_클래스_리포트를_섞으면_제외된다(world, db):
    """IDOR — 대상에 다른 클래스의 리포트를 끼워 넣어도 처리되지 않는다."""
    org2 = Organization(
        id=uuid.uuid4(), name="다른 기관", kind="center", org_code=uuid.uuid4().hex[:6])
    db.add(org2)
    db.flush()
    other_host = _counselor(db, org2)
    other_cls = Class(
        id=uuid.uuid4(), organization_id=org2.id, created_by=other_host.id, title="타 클래스",
        status="active", default_duration_min=60)
    db.add(other_cls)
    db.flush()
    other_session = Session(
        id=uuid.uuid4(), type="meditation", status="completed", host_id=other_host.id,
        class_id=other_cls.id, duration_min=60)
    db.add(other_session)
    db.flush()
    foreign = Report(
        id=uuid.uuid4(), session_id=other_session.id, type="client",
        status="pending_review", content={})
    db.add(foreign)
    db.commit()

    res = _accept(world, targets=[str(world["reports"][0].id), str(foreign.id)])
    item = next(i for i in res["items"] if i["report_id"] == str(foreign.id))
    assert item["state"] == "excluded"
    assert item["reason_code"] == "not_target"


def test_a2_대행_승인이면_on_behalf가_기록된다(world, db):
    """주강사가 타인 진행 회차를 승인하면 작업에 대행 사실이 남는다."""
    lead = _counselor(db, world["org"])
    db.add(ClassInstructor(
        id=uuid.uuid4(), class_id=world["cls"].id, user_id=lead.id, role="lead"))
    # 기존 host 는 보조로 내린다.
    db.query(ClassInstructor).filter_by(
        class_id=world["cls"].id, user_id=world["host"].id).update({"role": "assistant"})
    db.commit()

    res = _accept(world, actor_id=lead.id)
    assert res["on_behalf"] is True
    res = svc.run_job(db, res["job_id"])
    assert all(i["state"] == "succeeded" for i in res["items"])
    # 실제 승인자가 기록된다. 진행 지도사로 위장하지 않는다.
    for report in world["reports"]:
        db.refresh(report)
        assert report.approved_by_user_id == lead.id
