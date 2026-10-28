"""SDD-225 — 상담사·기관 홈 통계/목록에서 상담 세션(counseling_relationship_id)을 제외한다."""

from datetime import datetime, timedelta, timezone

import pytest

from app.api.deps import get_current_user
from app.core import database
from app.main import app
from app.models.class_program import Class
from app.models.counseling import CounselingRelationship
from app.models.record import Report
from app.models.session import Session, SessionParticipant
from tests.pg.sdd216_helpers import user, world


def _class_session(db, host, parent, seq, status):
    s = Session(
        host_id=host.id,
        class_id=parent.id,
        seq=seq,
        title=f"회차{seq}",
        type="meditation",
        duration_min=60,
        status=status,
        scheduled_at=datetime.now(timezone.utc) + timedelta(days=seq),
    )
    db.add(s)
    db.flush()
    return s


def _counseling_session(db, host, client_user, seq, status):
    rel = db.query(CounselingRelationship).filter_by(counselor_id=host.id).first()
    if rel is None:
        rel = CounselingRelationship(
            counselor_id=host.id, client_user_id=client_user.id, is_placeholder=False
        )
        db.add(rel)
        db.flush()
    s = Session(
        host_id=host.id,
        counseling_relationship_id=rel.id,
        seq=seq,
        title=f"상담{seq}",
        type="clinical",
        participant_mode="one_on_one",
        duration_min=60,
        status=status,
        scheduled_at=datetime.now(timezone.utc) + timedelta(days=seq),
    )
    db.add(s)
    db.flush()
    return s


@pytest.fixture
def seeded(client):
    """클래스 회차 2(진행중·완료) + 상담 세션 3(진행중·완료·예정, 참여자·검토 대기 리포트 포함)."""
    with database.SessionLocal() as db:
        org, lead, other, parent = world(db)
        admin = user(db, org, role="org_admin")
        c1 = _class_session(db, lead, parent, 1, "in_progress")
        c2 = _class_session(db, lead, parent, 2, "completed")
        db.add(SessionParticipant(session_id=c1.id, guest_name="클래스참여자", is_waitlisted=False))
        k1 = _counseling_session(db, lead, other, 1, "in_progress")
        k2 = _counseling_session(db, lead, other, 2, "completed")
        k3 = _counseling_session(db, lead, other, 3, "scheduled")
        for k in (k1, k2):
            db.add(SessionParticipant(session_id=k.id, guest_name="내담자", is_waitlisted=False))
            db.add(Report(session_id=k.id, status="pending_review", type="client", content={}))
        db.commit()
        return {
            "lead": str(lead.id),
            "admin": str(admin.id),
            "class_ids": {str(c1.id), str(c2.id)},
            "counseling_ids": {str(k1.id), str(k2.id), str(k3.id)},
        }


def _get(client, uid, role, path):
    app.dependency_overrides[get_current_user] = lambda: {"id": uid, "role": role}
    try:
        res = client.get(path)
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert res.status_code == 200, res.text
    return res.json()


def test_상담사_홈은_클래스_회차만_센다(client, seeded):
    body = _get(client, seeded["lead"], "counselor", "/api/v1/dashboard/counselor")
    assert {c["id"] for c in body["classes"]} == seeded["class_ids"]
    assert all(c["area"] == "meditation" for c in body["classes"])
    assert body["total_classes"] == 1  # 한 클래스의 2회차 = 클래스 1개 (후속)
    assert body["in_progress_classes"] == 1
    assert body["completed_classes"] == 1
    assert body["total_participants"] == 1
    assert body["pending_review_count"] == 0


def test_기관_홈은_클래스_회차만_센다(client, seeded):
    body = _get(client, seeded["admin"], "org_admin", "/api/v1/dashboard/org")
    assert {c["id"] for c in body["classes"]} == seeded["class_ids"]
    assert body["total_classes"] == 1  # 한 클래스의 2회차 = 클래스 1개 (후속)
    assert body["in_progress_classes"] == 1
    assert body["completed_classes"] == 1
    assert body["total_participants"] == 1
    lead_stat = next(c for c in body["counselors"] if c["id"] == seeded["lead"])
    assert lead_stat["class_count"] == 1
    assert lead_stat["participant_count"] == 1
    assert lead_stat["completed_count"] == 1


@pytest.fixture
def seeded_distinct(client):
    """한 클래스 3회차 + 다른 클래스 1회차 + 레거시 단건(class_id 없음) 1건."""
    with database.SessionLocal() as db:
        org, lead, _other, parent = world(db)
        admin = user(db, org, role="org_admin")
        parent2 = Class(
            created_by=lead.id,
            organization_id=org.id,
            organization_attribution_known=True,
            title="다른 명상",
            default_duration_min=60,
        )
        db.add(parent2)
        db.flush()
        _class_session(db, lead, parent, 1, "in_progress")
        _class_session(db, lead, parent, 2, "completed")
        _class_session(db, lead, parent, 3, "scheduled")
        _class_session(db, lead, parent2, 1, "completed")
        legacy = _class_session(db, lead, parent, 9, "scheduled")
        legacy.class_id = None
        db.commit()
        return {"lead": str(lead.id), "admin": str(admin.id)}


def test_상담사_홈_total_classes는_고유_클래스_수(client, seeded_distinct):
    body = _get(client, seeded_distinct["lead"], "counselor", "/api/v1/dashboard/counselor")
    assert len(body["classes"]) == 5  # 목록은 회차 행 그대로
    assert body["total_classes"] == 3
    assert body["in_progress_classes"] == 1
    assert body["completed_classes"] == 2


def test_기관_홈_total_classes와_class_count는_고유_클래스_수(client, seeded_distinct):
    body = _get(client, seeded_distinct["admin"], "org_admin", "/api/v1/dashboard/org")
    assert len(body["classes"]) == 5
    assert body["total_classes"] == 3
    assert body["completed_classes"] == 2
    lead_stat = next(c for c in body["counselors"] if c["id"] == seeded_distinct["lead"])
    assert lead_stat["class_count"] == 3


def test_총_참여자는_회차_합이_아니라_서로_다른_사람_수(client):
    """같은 회원이 여러 회차에 참여해도 1명으로 센다(운영 제보: 1명인데 61명 표시)."""
    with database.SessionLocal() as db:
        org, lead, member, parent = world(db)
        for seq in (1, 2, 3):
            s = _class_session(db, lead, parent, seq, "completed")
            db.add(SessionParticipant(session_id=s.id, user_id=member.id, is_waitlisted=False))
        s4 = _class_session(db, lead, parent, 4, "in_progress")
        db.add(SessionParticipant(session_id=s4.id, user_id=member.id, is_waitlisted=False))
        db.add(SessionParticipant(session_id=s4.id, guest_name="게스트", is_waitlisted=False))
        db.add(SessionParticipant(session_id=s4.id, guest_name="대기", is_waitlisted=True))
        db.commit()
        lead_id = str(lead.id)
    body = _get(client, lead_id, "counselor", "/api/v1/dashboard/counselor")
    assert body["total_participants"] == 2  # 회원 1 + 게스트 1, 대기열 제외
