"""SDD-221 T5 — 팀 강사로만 속한 클래스의 회차가 상담사 홈 집계·목록에 포함되는지 검증."""

from datetime import datetime, timedelta, timezone

from app.core import database
from app.models.class_program import ClassInstructor
from app.models.record import Report
from app.models.session import Session, SessionParticipant
from app.services.dashboard_service import counselor_dashboard
from tests.pg.sdd216_helpers import user, world


def _session(db, host, parent, seq, **kw):
    s = Session(
        host_id=host.id,
        class_id=parent.id,
        seq=seq,
        title=f"회차{seq}",
        type="meditation",
        duration_min=60,
        status=kw.pop("status", "scheduled"),
        scheduled_at=datetime.now(timezone.utc) + timedelta(days=seq),
        **kw,
    )
    db.add(s)
    db.flush()
    return s


def _dash(uid):
    with database.SessionLocal() as db:
        return counselor_dashboard(str(uid), db)


def test_팀_강사로만_속한_클래스_회차가_홈_목록과_집계에_포함된다(client):
    with database.SessionLocal() as db:
        org, lead, assistant, parent = world(db)
        db.add(ClassInstructor(class_id=parent.id, user_id=assistant.id, role="assistant"))
        mine = _session(db, assistant, parent, 1)
        others = _session(db, lead, parent, 2, status="in_progress")
        db.add(SessionParticipant(session_id=others.id, guest_name="참여자", is_waitlisted=False))
        db.add(Report(session_id=others.id, status="pending_review", type="counselor", content={}))
        db.commit()
        assistant_id, mine_id, others_id = assistant.id, mine.id, others.id

    data = _dash(assistant_id)
    ids = [c["id"] for c in data["classes"]]
    assert sorted(ids) == sorted([str(mine_id), str(others_id)])  # 중복 없이 합집합
    assert data["total_classes"] == 2
    assert data["in_progress_classes"] == 1
    row = next(c for c in data["classes"] if c["id"] == str(others_id))
    assert row["participant_count"] == 1
    # 진행 강사가 아닌 회차의 리포트 건수·검토 대기는 노출하지 않는다.
    assert row["report_count"] == 0 and row["pending_review_count"] == 0
    assert data["pending_review_count"] == 0


def test_제거된_강사_게스트_강사_템플릿은_포함하지_않는다(client):
    with database.SessionLocal() as db:
        org, lead, assistant, parent = world(db)
        removed, guest = user(db, org), user(db, org)
        db.add(ClassInstructor(class_id=parent.id, user_id=removed.id, role="assistant", status="removed"))
        db.add(ClassInstructor(class_id=parent.id, user_id=guest.id, role="guest"))
        _session(db, lead, parent, 1)
        db.commit()
        removed_id, guest_id, lead_id = removed.id, guest.id, lead.id

    assert _dash(removed_id)["total_classes"] == 0
    assert _dash(guest_id)["total_classes"] == 0
    assert _dash(lead_id)["total_classes"] == 1


def test_본인이_host이면서_팀_강사여도_중복되지_않고_건수가_유지된다(client):
    with database.SessionLocal() as db:
        org, lead, assistant, parent = world(db)
        s = _session(db, lead, parent, 1)
        db.add(Report(session_id=s.id, status="pending_review", type="counselor", content={}))
        db.commit()
        lead_id = lead.id

    data = _dash(lead_id)
    assert data["total_classes"] == 1
    assert data["pending_review_count"] == 1
    assert data["classes"][0]["report_count"] == 1


def test_HTTP_응답에_검토_대기_수가_포함된다(client):
    """서비스 함수가 계산해도 응답 스키마에 필드가 없으면 FastAPI 가 지워 FE 타일이 항상 0 이 된다."""
    from app.api.deps import get_current_user
    from app.main import app

    with database.SessionLocal() as db:
        org, lead, assistant, parent = world(db)
        s1 = _session(db, lead, parent, 1)
        s2 = _session(db, lead, parent, 2)
        db.add(Report(session_id=s1.id, status="pending_review", type="client", content={}))
        db.add(Report(session_id=s2.id, status="pending_review", type="client", content={}))
        db.commit()
        lead_id = str(lead.id)

    app.dependency_overrides[get_current_user] = lambda: {"id": lead_id, "role": "counselor"}
    try:
        body = client.get("/api/v1/dashboard/counselor").json()
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert body["pending_review_count"] == 2
    assert sorted(c["pending_review_count"] for c in body["classes"]) == [1, 1]
