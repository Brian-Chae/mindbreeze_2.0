"""SDD-243 테스트 공용 월드 — 다기관·개인상담소·귀속 미상·상담 세션이 섞인 합성 데이터.

실데이터·실서버를 쓰지 않는다. 이메일은 example.invalid 만 사용한다.
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.config import settings
from app.models.class_program import Class, ClassInstructor, ClassMember
from app.models.organization import Organization
from app.models.session import Session, SessionParticipant
from app.models.user import User
from app.models.user_org_membership import UserOrgMembership

T0 = datetime(2026, 10, 1, 0, 0, 0, tzinfo=timezone.utc)


def mk_user(db, role, name, *, status="active", **extra) -> User:
    user = User(id=uuid.uuid4(), email=f"{uuid.uuid4().hex[:10]}@example.invalid", name=name, role=role,
                status=status, password_hash="x", **extra)
    db.add(user)
    db.flush()
    return user


def mk_member(db, user, org, role, status="active") -> UserOrgMembership:
    row = UserOrgMembership(id=uuid.uuid4(), user_id=user.id, org_id=org.id, role=role, status=status)
    db.add(row)
    db.flush()
    return row


def mk_org(db, name, kind="institution", deactivated=False) -> Organization:
    org = Organization(id=uuid.uuid4(), name=name, kind=kind, org_code=uuid.uuid4().hex[:6])
    if deactivated:
        org.deactivated_at = T0
    db.add(org)
    db.flush()
    return org


def mk_class(db, org, host, title, *, known=True, status="active") -> Class:
    cls = Class(id=uuid.uuid4(), organization_id=org.id if org else None, created_by=host.id, title=title,
                status=status, default_duration_min=30, organization_attribution_known=known)
    db.add(cls)
    db.flush()
    db.add(ClassInstructor(id=uuid.uuid4(), class_id=cls.id, user_id=host.id, role="lead"))
    db.flush()
    return cls


def mk_session(db, host, cls=None, org=None, *, stype="meditation", status="completed", day=0, known=True,
               seq=None, template=False) -> Session:
    start = T0 + timedelta(days=day)
    session = Session(
        id=uuid.uuid4(), type=stype, status=status, host_id=host.id, class_id=cls.id if cls else None,
        organization_id=org.id if org else None, organization_attribution_known=known, duration_min=30,
        started_at=start, ended_at=start + timedelta(minutes=30) if status == "completed" else None,
        scheduled_at=start, seq=seq, is_template=template)
    db.add(session)
    db.flush()
    return session


def mk_part(db, session, user=None, *, name=None, consent_eeg=True) -> SessionParticipant:
    part = SessionParticipant(id=uuid.uuid4(), session_id=session.id, user_id=user.id if user else None,
                              guest_name=name if user is None else None, consent_eeg=consent_eeg)
    db.add(part)
    db.flush()
    return part


class World:
    """속성으로 접근하는 단순 컨테이너."""

    def __init__(self, **kw):
        self.__dict__.update(kw)


def build_world(db) -> World:
    w = World()
    w.platform = mk_user(db, "platform_admin", "플랫폼")
    w.org_a = mk_org(db, "기관A")
    w.org_b = mk_org(db, "기관B")
    w.solo_org = mk_org(db, "개인상담소", kind="individual")
    w.dead_org = mk_org(db, "비활성기관", deactivated=True)
    w.admin_a = mk_user(db, "org_admin", "관리자A")
    mk_member(db, w.admin_a, w.org_a, "org_admin")
    w.admin_ab = mk_user(db, "org_admin", "관리자AB")
    mk_member(db, w.admin_ab, w.org_a, "org_admin")
    mk_member(db, w.admin_ab, w.org_b, "org_admin")
    w.admin_left = mk_user(db, "org_admin", "소속해제관리자")
    mk_member(db, w.admin_left, w.org_a, "org_admin", status="left")
    w.admin_dead = mk_user(db, "org_admin", "비활성기관관리자")
    mk_member(db, w.admin_dead, w.dead_org, "org_admin")
    w.admin_inactive = mk_user(db, "org_admin", "정지관리자", status="suspended")
    mk_member(db, w.admin_inactive, w.org_a, "org_admin")
    w.admin_none = mk_user(db, "org_admin", "소속없는관리자")
    w.counselor = mk_user(db, "counselor", "다기관상담사")  # A·B 소속 + 개인상담소
    mk_member(db, w.counselor, w.org_a, "counselor")
    mk_member(db, w.counselor, w.org_b, "counselor")
    mk_member(db, w.counselor, w.solo_org, "counselor")
    w.counselor_b = mk_user(db, "counselor", "B상담사")
    mk_member(db, w.counselor_b, w.org_b, "counselor")
    w.client = mk_user(db, "client", "회원1")
    w.client2 = mk_user(db, "client", "회원2")

    w.cls_a = mk_class(db, w.org_a, w.counselor, "A명상")
    w.cls_b = mk_class(db, w.org_b, w.counselor_b, "B명상")
    w.cls_unknown = mk_class(db, w.org_a, w.counselor, "귀속미상", known=False)
    w.cls_solo = mk_class(db, w.solo_org, w.counselor, "개인반")

    w.s_a1 = mk_session(db, w.counselor, w.cls_a, w.org_a, day=0, seq=1)
    w.s_a2 = mk_session(db, w.counselor, w.cls_a, w.org_a, day=1, seq=2)
    w.s_a_open = mk_session(db, w.counselor, w.cls_a, w.org_a, status="scheduled", day=2, seq=3)
    w.s_b1 = mk_session(db, w.counselor, w.cls_b, w.org_b, day=0, seq=1)  # 다기관 상담사가 B에서 진행
    w.s_b2 = mk_session(db, w.counselor_b, w.cls_b, w.org_b, day=1, seq=2)
    w.s_unknown = mk_session(db, w.counselor, w.cls_unknown, w.org_a, known=False, day=0)
    w.s_unknown_cls = mk_session(db, w.counselor, w.cls_unknown, w.org_a, known=True, day=3)  # 회차는 확정, 클래스 불명
    w.s_sess_unknown = mk_session(db, w.counselor, w.cls_a, w.org_a, known=False, day=4)  # 회차 귀속만 불명
    w.s_conflict = mk_session(db, w.counselor, w.cls_b, w.org_a, day=5)  # 회차는 A, 클래스는 B(상충)
    w.s_solo = mk_session(db, w.counselor, w.cls_solo, w.solo_org, day=0)
    w.s_clinical = mk_session(db, w.counselor, None, w.org_a, stype="clinical", day=0)
    w.s_template = mk_session(db, w.counselor, w.cls_a, w.org_a, template=True, day=0)

    w.p_a1_c = mk_part(db, w.s_a1, w.client)
    w.p_a1_c2 = mk_part(db, w.s_a1, w.client2)
    w.p_a2_c = mk_part(db, w.s_a2, w.client)
    w.p_b1_c = mk_part(db, w.s_b1, w.client)
    w.p_b2_c2 = mk_part(db, w.s_b2, w.client2)
    w.p_solo = mk_part(db, w.s_solo, w.client)
    w.p_clin = mk_part(db, w.s_clinical, w.client)
    w.p_guest = mk_part(db, w.s_a1, None, name="비회원")
    db.commit()
    return w


@pytest.fixture
def dc_enabled(monkeypatch):
    monkeypatch.setattr(settings, "data_center_enabled", True)


@pytest.fixture
def db(app_client):
    from app.core.database import get_db
    from app.main import app

    provider = app.dependency_overrides[get_db]()
    session = next(provider)
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def world(db):
    return build_world(db)
