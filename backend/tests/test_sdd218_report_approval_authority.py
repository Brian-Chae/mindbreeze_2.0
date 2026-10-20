"""SDD-218 A1~A9: 리포트 승인 권한 (D-36 주강사 대행 승인).

검증 대상은 `report_service.can_approve_report` 단일 함수다.
편집 권한(`_can_edit_report`)은 확대하지 않으며 A9에서 회귀를 확인한다.
"""

import uuid

import pytest

from app.models.class_program import Class, ClassInstructor
from app.models.organization import Organization
from app.models.user_org_membership import UserOrgMembership
from app.models.session import Session
from app.models.user import User


def _org(db) -> Organization:
    org = Organization(id=uuid.uuid4(), name="테스트 기관", kind="center", org_code=uuid.uuid4().hex[:6])
    db.add(org)
    db.flush()
    return org


def _counselor(db, org, *, status: str = "active", member_status: str = "active") -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"{uuid.uuid4().hex[:10]}@example.com",
        name="지도사",
        role="counselor",
        status=status,
        password_hash="x",
    )
    db.add(user)
    db.add(
        UserOrgMembership(
            id=uuid.uuid4(), user_id=user.id, org_id=org.id, role="counselor", status=member_status
        )
    )
    db.flush()
    return user


def _org_admin(db, org) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"{uuid.uuid4().hex[:10]}@example.com",
        name="센터 관리자",
        role="org_admin",
        status="active",
        password_hash="x",
    )
    db.add(user)
    db.add(
        UserOrgMembership(
            id=uuid.uuid4(), user_id=user.id, org_id=org.id, role="org_admin", status="active"
        )
    )
    db.flush()
    return user


def _class_with_session(db, org, host: User):
    cls = Class(
        id=uuid.uuid4(),
        organization_id=org.id,
        created_by=host.id,
        title="마음챙김 기초 8주",
        status="active",
        default_duration_min=60,
        recurrence_rule="FREQ=WEEKLY",
    )
    db.add(cls)
    db.flush()
    session = Session(
        id=uuid.uuid4(),
        type="meditation",
        status="completed",
        host_id=host.id,
        class_id=cls.id,
        duration_min=60,
    )
    db.add(session)
    db.flush()
    return cls, session


def _instructor(db, cls, user, role: str, *, status: str = "active") -> ClassInstructor:
    row = ClassInstructor(
        id=uuid.uuid4(), class_id=cls.id, user_id=user.id, role=role, status=status
    )
    db.add(row)
    db.flush()
    return row


@pytest.fixture
def db(app_client):
    from app.core.database import get_db
    from app.main import app

    gen = app.dependency_overrides[get_db]()
    session = next(gen)
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def test_a1_진행_지도사는_승인할_수_있다(db):
    from app.services.report_service import can_approve_report

    org = _org(db)
    host = _counselor(db, org)
    cls, session = _class_with_session(db, org, host)
    _instructor(db, cls, host, "assistant")

    assert can_approve_report(db, host, session) is True


def test_a2_현재_주강사는_타인_진행_회차를_대행_승인한다(db):
    from app.services.report_service import can_approve_report

    org = _org(db)
    host = _counselor(db, org)
    lead = _counselor(db, org)
    cls, session = _class_with_session(db, org, host)
    _instructor(db, cls, host, "assistant")
    _instructor(db, cls, lead, "lead")

    assert can_approve_report(db, lead, session) is True


def test_a3_일반_보조_강사는_승인할_수_없다(db):
    from app.services.report_service import can_approve_report

    org = _org(db)
    host = _counselor(db, org)
    assistant = _counselor(db, org)
    cls, session = _class_with_session(db, org, host)
    _instructor(db, cls, host, "assistant")
    _instructor(db, cls, assistant, "assistant")

    assert can_approve_report(db, assistant, session) is False


def test_a4_센터_관리자는_승인할_수_없다(db):
    from app.services.report_service import can_approve_report

    org = _org(db)
    host = _counselor(db, org)
    admin = _org_admin(db, org)
    cls, session = _class_with_session(db, org, host)
    _instructor(db, cls, host, "assistant")

    assert can_approve_report(db, admin, session) is False


def test_a5_비활성_강사는_승인할_수_없다(db):
    from app.services.report_service import can_approve_report

    org = _org(db)
    host = _counselor(db, org)
    lead = _counselor(db, org, status="inactive")
    cls, session = _class_with_session(db, org, host)
    _instructor(db, cls, host, "assistant")
    _instructor(db, cls, lead, "lead")

    assert can_approve_report(db, lead, session) is False


def test_a6_클래스에서_제거된_주강사는_승인할_수_없다(db):
    from app.services.report_service import can_approve_report

    org = _org(db)
    host = _counselor(db, org)
    removed = _counselor(db, org)
    cls, session = _class_with_session(db, org, host)
    _instructor(db, cls, host, "assistant")
    _instructor(db, cls, removed, "lead", status="removed")

    assert can_approve_report(db, removed, session) is False


def test_a7_다른_기관_강사는_승인할_수_없다(db):
    from app.services.report_service import can_approve_report

    org = _org(db)
    other_org = _org(db)
    host = _counselor(db, org)
    outsider = _counselor(db, other_org)
    cls, session = _class_with_session(db, org, host)
    _instructor(db, cls, host, "assistant")
    _instructor(db, cls, outsider, "lead")

    assert can_approve_report(db, outsider, session) is False


def test_a8_주강사_교체_후_구_주강사는_승인할_수_없다(db):
    from app.services.report_service import can_approve_report

    org = _org(db)
    host = _counselor(db, org)
    old_lead = _counselor(db, org)
    new_lead = _counselor(db, org)
    cls, session = _class_with_session(db, org, host)
    _instructor(db, cls, host, "assistant")
    old = _instructor(db, cls, old_lead, "lead")
    _instructor(db, cls, new_lead, "lead")

    # 주강사 교체: 구 주강사는 보조로 강등된다.
    old.role = "assistant"
    db.flush()

    assert can_approve_report(db, old_lead, session) is False
    assert can_approve_report(db, new_lead, session) is True


def test_a9_편집_권한은_확대되지_않는다(db):
    """승인만 넓힌다. 주강사라도 타인 진행 회차를 편집할 수 없다."""
    from app.services.report_service import _can_edit_report, can_approve_report

    org = _org(db)
    host = _counselor(db, org)
    lead = _counselor(db, org)
    cls, session = _class_with_session(db, org, host)
    _instructor(db, cls, host, "assistant")
    _instructor(db, cls, lead, "lead")

    assert can_approve_report(db, lead, session) is True
    assert _can_edit_report(str(lead.id), session, db) is False
