"""웹 목록 지연 개선 회귀: GET /classes 쿼리 수 상수화 + 역할별 viewer 필드 동치, /reports/counts 배지 동치."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import event

from app.core import database
from app.models.class_program import Class, ClassInstructor, ClassMember
from app.models.organization import Organization
from app.models.record import Report
from app.models.session import Session
from app.models.user_org_membership import UserOrgMembership
from app.services import class_read_service, report_service
from tests.pg.sdd216_helpers import user

NOW = datetime.now(timezone.utc)


def _make_classes(db, org, lead, n, *, members=(), assistants=(), guests=()):
    out = []
    for i in range(n):
        cls = Class(created_by=lead.id, organization_id=org.id, organization_attribution_known=True,
                    title=f"클래스{i}", default_duration_min=60, recurrence_rule={"version": 1},
                    status="active" if i % 3 else "completed")
        db.add(cls)
        db.flush()
        db.add(ClassInstructor(class_id=cls.id, user_id=lead.id, role="lead", status="active"))
        for a in assistants:
            db.add(ClassInstructor(class_id=cls.id, user_id=a.id, role="assistant", status="active"))
        for g in guests:
            db.add(ClassInstructor(class_id=cls.id, user_id=g.id, role="guest", status="active"))
        for m in members:
            db.add(ClassMember(class_id=cls.id, user_id=m.id, status="active", joined_via="code", joined_at=NOW))
        for seq, status in enumerate(("completed", "scheduled"), 1):
            db.add(Session(type="meditation", class_id=cls.id, host_id=lead.id, seq=seq, status=status,
                           host_state="assigned", duration_min=60, scheduled_at=NOW + timedelta(days=seq - 2),
                           max_participants=8))
        out.append(cls)
    db.commit()
    return out


def _count_queries(db, fn):
    stmts = []
    engine = db.get_bind()

    def hook(conn, cursor, statement, params, context, executemany):
        stmts.append(statement)

    event.listen(engine, "before_cursor_execute", hook)
    try:
        result = fn()
    finally:
        event.remove(engine, "before_cursor_execute", hook)
    return len(stmts), result


def test_list_classes_쿼리수는_클래스_수와_무관하다(client):
    with database.SessionLocal() as db:
        org = Organization(name="배치 센터", verified=True)
        db.add(org)
        db.flush()
        lead, client = user(db, org), user(db, org, role="client")
        _make_classes(db, org, lead, 3, members=[client])
        db.commit()
        db.expire_all()
        small, _ = _count_queries(db, lambda: class_read_service.list_classes(str(lead.id), db))
        _make_classes(db, org, lead, 12, members=[client])
        db.expire_all()
        large, items = _count_queries(db, lambda: class_read_service.list_classes(str(lead.id), db))
        assert len(items[0]) == 15
        assert large == small, (small, large)


def test_list_classes_viewer_필드는_개별_계산과_역할별로_동일하다(client):
    with database.SessionLocal() as db:
        org = Organization(name="동치 센터", verified=True)
        db.add(org)
        db.flush()
        lead, assistant, guest, member, outsider = (user(db, org), user(db, org), user(db, org),
                                                   user(db, org, role="client"), user(db, org, role="client"))
        admin = user(db, org, role="org_admin")
        _make_classes(db, org, lead, 5, members=[member], assistants=[assistant], guests=[guest])
        for viewer in (lead, assistant, guest, member, outsider, admin):
            items, _ = class_read_service.list_classes(str(viewer.id), db)
            for item in items:
                cls = db.get(Class, item["id"]) if not isinstance(item["id"], str) else db.query(Class).filter(Class.id == item["id"]).one()
                expected = class_read_service._viewer_fields(db, cls, viewer.id, now=None)
                for key in ("membership", "attendance_summary", "capabilities"):
                    assert item[key] == expected[key], (viewer.role, key)


def _seed_reports(db, org, counselor, client, statuses):
    session_ids = []
    for i, status in enumerate(statuses):
        s = Session(type="clinical", host_id=counselor.id, status="completed", duration_min=30,
                    scheduled_at=NOW - timedelta(days=i + 1), participant_mode="one_on_one", max_participants=1)
        db.add(s)
        db.flush()
        if status:
            db.add(Report(session_id=s.id, user_id=client.id, type="client", status=status, content={}, is_read=(i % 2 == 0)))
        session_ids.append(s.id)
    db.commit()


def _frontend_badges(user_id, db):
    """기존 프론트(reportStore.refresh) 계산을 /reports 응답으로 재현."""
    reports = report_service.list_reports(user_id, db, None, 100)["reports"]
    unread = sum(1 for r in reports if not r["is_read"] and r.get("in_review") is not True)
    pending = 0
    for r in reports:
        if r.get("approval_required") is False:
            continue
        st = r["status"] if r["status"] in ("pending_analysis", "pending_review", "completed", "error") else (
            "completed" if r["sent_at"] else "pending_review")
        pending += st == "pending_review"
    return {"unread": unread, "pending_review": pending}


def test_reports_counts는_목록_기반_배지_계산과_동일하다(client):
    with database.SessionLocal() as db:
        org = Organization(name="배지 센터", verified=True)
        db.add(org)
        db.flush()
        counselor, client = user(db, org), user(db, org, role="client")
        _seed_reports(db, org, counselor, client, ["completed", "pending_review", "pending_analysis", "error", None, "pending_review"])
        for viewer in (counselor, client):
            got = report_service.count_reports_badges(str(viewer.id), db)
            assert got == _frontend_badges(str(viewer.id), db), viewer.role
        assert report_service.count_reports_badges(str(counselor.id), db)["pending_review"] >= 2


def test_reports_counts는_본문_없이_쿼리_수가_일정하다(client):
    with database.SessionLocal() as db:
        org = Organization(name="배지쿼리 센터", verified=True)
        db.add(org)
        db.flush()
        counselor, client = user(db, org), user(db, org, role="client")
        _seed_reports(db, org, counselor, client, ["pending_review"] * 3)
        small, _ = _count_queries(db, lambda: report_service.count_reports_badges(str(counselor.id), db))
        _seed_reports(db, org, counselor, client, ["pending_review"] * 20)
        large, _ = _count_queries(db, lambda: report_service.count_reports_badges(str(counselor.id), db))
        assert small == large
