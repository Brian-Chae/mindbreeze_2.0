"""SDD-324: 코치 회원·리포트 관리 요약 서버 집계 (verify V1~V17). 시각은 now= 로 고정 주입한다."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event

from app.models.class_program import Class, ClassMember
from app.models.client_counselor_link import ClientCounselorLink
from app.models.record import EEGRecord, Report
from app.models.session import Session, SessionParticipant
from app.models.user import User
from app.services import client_overview_service as cos
from app.services import report_hierarchy_service as rhs
from tests.sdd237_helpers import auth_for, build_class_world, make_user

KST = timezone(timedelta(hours=9))
# 2026-11-11(수) 15:00 KST — 이번 주 월요일 = 11-09 00:00 KST
NOW = datetime(2026, 11, 11, 15, 0, tzinfo=KST).astimezone(timezone.utc)
MON = datetime(2026, 11, 9, 0, 0, tzinfo=KST).astimezone(timezone.utc)


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


def _link(db, coach, name, matched_days_ago):
    u = make_user(db, role="client", name=name)
    db.add(ClientCounselorLink(
        id=uuid.uuid4(), client_id=u.id, counselor_id=coach.id, status="active",
        matched_at=NOW - timedelta(days=matched_days_ago)))
    db.flush()
    return u


def _attend(db, coach, user, at, *, status="attended", sess_status="completed", eeg=False, cls=None):
    s = Session(id=uuid.uuid4(), type="meditation", status=sess_status, host_id=coach.id, duration_min=30,
                class_id=cls.id if cls else None, started_at=at, ended_at=at + timedelta(minutes=30))
    db.add(s)
    db.flush()
    p = SessionParticipant(id=uuid.uuid4(), session_id=s.id, user_id=user.id, attendance_status=status,
                           entered_at=at, joined_at=at)
    db.add(p)
    db.flush()
    if eeg:
        db.add(EEGRecord(id=uuid.uuid4(), session_id=s.id, user_id=user.id, participant_id=p.id,
                         s3_key="k", duration_sec=60, file_count=1, created_at=at))
        db.flush()
    return s, p


def _report(db, s, p, user, *, status="completed", is_read=False, created=None, approved=None, source="manual",
            gen="ready", delivery=None, rtype="client"):
    r = Report(id=uuid.uuid4(), session_id=s.id, participant_id=p.id, user_id=user.id, type=rtype,
               status=status, generation_status=gen, is_read=is_read, content={}, delivery_status=delivery,
               approved_at=approved, approval_source=source if approved else None,
               created_at=created or NOW - timedelta(hours=1))
    db.add(r)
    db.flush()
    return r


@pytest.fixture
def coach(db):
    return make_user(db, role="counselor", name="코치")


# ───────────── 회원 요약 ─────────────
def test_V1_연결회원만_total_일치(client, db, coach):
    a = _link(db, coach, "가", 40)
    other = make_user(db, role="counselor", name="타코치")
    b = _link(db, other, "나", 40)
    db.commit()
    body = cos.client_summary(db, str(coach.id), NOW)
    assert body["total"] == 1
    res = client.get("/api/v1/clients", headers=auth_for(coach)).json()
    assert res["total"] == body["total"]
    assert not {"score", "grade", "ratio", "overall"} & set(body)  # V17
    assert a and b


def test_V2_7일_30일_경계(client, db, coach):
    u6 = _link(db, coach, "6일", 100)
    u8 = _link(db, coach, "8일", 100)
    u31 = _link(db, coach, "31일", 100)
    _attend(db, coach, u6, NOW - timedelta(days=6, hours=23))
    _attend(db, coach, u8, NOW - timedelta(days=8))
    _attend(db, coach, u31, NOW - timedelta(days=31))
    db.commit()
    b = cos.client_summary(db, str(coach.id), NOW)
    assert (b["active_7d"], b["active_30d"]) == (1, 2)


def test_V3_week_attended_월요일_경계_결석제외_고유(client, db, coach):
    ok = _link(db, coach, "참석", 60)
    before = _link(db, coach, "월전", 60)
    absent = _link(db, coach, "결석", 60)
    scheduled = _link(db, coach, "예정", 60)
    _attend(db, coach, ok, MON + timedelta(minutes=1))
    _attend(db, coach, ok, MON + timedelta(days=1))  # 2회여도 1명
    _attend(db, coach, before, MON - timedelta(minutes=1))
    _attend(db, coach, absent, MON + timedelta(hours=5), status="absent")
    _attend(db, coach, scheduled, MON + timedelta(hours=5), status="expected")
    db.commit()
    assert cos.client_summary(db, str(coach.id), NOW)["week_attended"] == 1


def test_V4_inactive_14d_never_attended(client, db, coach):
    fresh = _link(db, coach, "신규무활동", 10)       # 연결 14일 미만 → 제외
    never = _link(db, coach, "미참여", 20)           # 포함 + never
    recent = _link(db, coach, "최근참여", 20)        # 제외
    old = _link(db, coach, "오래전참여", 60)         # 포함, never 아님
    _attend(db, coach, recent, NOW - timedelta(days=5))
    _attend(db, coach, old, NOW - timedelta(days=30))
    db.commit()
    b = cos.client_summary(db, str(coach.id), NOW)
    assert b["inactive_14d"] == 2 and b["never_attended"] == 1
    assert fresh and never


def test_V5_report_unread_members(client, db, coach):
    a = _link(db, coach, "미열람", 60)
    b = _link(db, coach, "열람", 60)
    c = _link(db, coach, "대기", 60)
    s1, p1 = _attend(db, coach, a, NOW - timedelta(days=3))
    s1b, p1b = _attend(db, coach, a, NOW - timedelta(days=2))
    s2, p2 = _attend(db, coach, b, NOW - timedelta(days=3))
    s3, p3 = _attend(db, coach, c, NOW - timedelta(days=3))
    _report(db, s1, p1, a, is_read=False)
    _report(db, s1b, p1b, a, is_read=False)   # 같은 회원 2건 → 1명
    _report(db, s2, p2, b, is_read=True)
    _report(db, s3, p3, c, status="pending_review", is_read=False)
    _report(db, s3, p3, c, rtype="counselor", is_read=False)
    db.commit()
    assert cos.client_summary(db, str(coach.id), NOW)["report_unread_members"] == 1


def test_V6_band_worn_attended_건수(client, db, coach):
    a = _link(db, coach, "착용", 60)
    b = _link(db, coach, "미착용", 60)
    d = _link(db, coach, "오래전", 60)
    _attend(db, coach, a, NOW - timedelta(days=3), eeg=True)
    _attend(db, coach, b, NOW - timedelta(days=3))
    _attend(db, coach, d, NOW - timedelta(days=40), eeg=True)
    db.commit()
    body = cos.client_summary(db, str(coach.id), NOW)
    assert (body["band_worn_members"], body["attended_members"]) == (1, 2)
    assert "band_worn_ratio" not in body


def test_V7_filter_목록_일치_422_403(client, db, coach):
    never = _link(db, coach, "미참여", 20)
    ok = _link(db, coach, "참석", 20)
    s, p = _attend(db, coach, ok, datetime.now(timezone.utc) - timedelta(minutes=5))
    _report(db, s, p, ok, is_read=False)
    db.commit()
    h = auth_for(coach)
    inactive = client.get("/api/v1/clients?filter=inactive_14d", headers=h).json()
    assert [c["name"] for c in inactive["clients"]] == ["미참여"] and inactive["total"] == 1
    unread = client.get("/api/v1/clients?filter=report_unread", headers=h).json()
    assert [c["name"] for c in unread["clients"]] == ["참석"]
    assert client.get("/api/v1/clients?filter=bogus", headers=h).status_code == 422
    assert client.get("/api/v1/clients/summary", headers=auth_for(never)).status_code == 403
    assert client.get("/api/v1/clients/summary", headers=h).status_code == 200
    # 서비스 직접 호출 시에도 잘못된 필터는 422
    with pytest.raises(Exception):
        cos.list_clients_overview(str(coach.id), None, 1, 20, None, None, db, summary_filter="x")


def test_V8_기관관리자_기관범위(client, db):
    w = build_class_world(db, members=3)
    admin = make_user(db, role="org_admin", name="관리자", org=w["org"])
    db.commit()
    body = cos.client_summary(db, str(admin.id), NOW)
    assert body["total"] == 3
    res = client.get("/api/v1/clients/summary", headers=auth_for(admin))
    assert res.status_code == 200 and res.json()["total"] == 3


def _count_queries(db, fn):
    n = []
    bind = db.get_bind()
    def hook(*_a, **_k):
        n.append(1)
    event.listen(bind, "before_cursor_execute", hook)
    try:
        fn()
    finally:
        event.remove(bind, "before_cursor_execute", hook)
    return len(n)


def test_V16_회원요약_쿼리수_상수(client, db, coach):
    for i in range(3):
        u = _link(db, coach, f"회{i}", 40)
        s, p = _attend(db, coach, u, NOW - timedelta(days=2), eeg=True)
        _report(db, s, p, u)
    db.commit()
    few = _count_queries(db, lambda: cos.client_summary(db, str(coach.id), NOW))
    for i in range(12):
        u = _link(db, coach, f"추가{i}", 40)
        s, p = _attend(db, coach, u, NOW - timedelta(days=2), eeg=True)
        _report(db, s, p, u)
    db.commit()
    many = _count_queries(db, lambda: cos.client_summary(db, str(coach.id), NOW))
    assert many == few


# ───────────── 리포트 요약 ─────────────
@pytest.fixture
def rworld(client, db):
    return build_class_world(db, members=3)


def test_V9_hierarchy_무필터_일치(client, db, rworld):
    body = rhs.report_summary(str(rworld["host"].id), db, now=NOW)
    h = rhs.build_hierarchy(str(rworld["host"].id), db, now=NOW)["summary"]
    for k in ("needs_review", "failed_delivery", "total_members", "generation_failed"):
        assert body[k] == h[k], k
    assert body["needs_review"] == 3 and body["total_members"] == 3
    res = client.get("/api/v1/reports/summary", headers=rworld["auth"])
    assert res.status_code == 200 and res.json()["needs_review"] == 3
    assert not {"score", "grade", "ratio", "overall"} & set(body)


def test_V10_generation_failed_전역(client, db, rworld):
    r = rworld["client_reports"][0]
    r.status, r.generation_status = "error", "partial"
    db.commit()
    host = str(rworld["host"].id)
    assert rhs.report_summary(host, db, now=NOW)["generation_failed"] == 1
    for kwargs in ({"tab": "needs_review"}, {"q": "회원2"}):
        assert rhs.build_hierarchy(host, db, now=NOW, **kwargs)["summary"]["generation_failed"] == 1, kwargs


def test_V11_created_today_KST_경계(client, db, rworld):
    reps = rworld["client_reports"]
    reps[0].created_at = datetime(2026, 11, 10, 23, 59, tzinfo=KST).astimezone(timezone.utc)   # 전날
    reps[1].created_at = datetime(2026, 11, 11, 0, 0, tzinfo=KST).astimezone(timezone.utc)     # 당일 시작
    reps[2].created_at = datetime(2026, 11, 11, 14, 0, tzinfo=KST).astimezone(timezone.utc)
    rworld["counselor_report"].created_at = datetime(2026, 11, 11, 9, 0, tzinfo=KST).astimezone(timezone.utc)  # 코치용 제외
    db.commit()
    assert rhs.report_summary(str(rworld["host"].id), db, now=NOW)["created_today"] == 2


def test_V12_member_unread(client, db, rworld):
    reps = rworld["client_reports"]
    reps[0].status, reps[0].is_read = "completed", False   # 포함
    reps[1].status, reps[1].is_read = "completed", True    # 열람
    # reps[2] pending_review 제외
    rworld["counselor_report"].status = "completed"        # 코치용 제외
    db.commit()
    assert rhs.report_summary(str(rworld["host"].id), db, now=NOW)["member_unread"] == 1


def test_V13_avg_review_hours(client, db, rworld):
    reps = rworld["client_reports"]
    reps[0].status, reps[0].created_at, reps[0].approved_at, reps[0].approval_source = "completed", NOW - timedelta(hours=10), NOW - timedelta(hours=8), "manual"   # 2h
    reps[1].status, reps[1].created_at, reps[1].approved_at, reps[1].approval_source = "completed", NOW - timedelta(hours=10), NOW - timedelta(hours=5), "manual"   # 5h
    reps[2].status, reps[2].created_at, reps[2].approved_at, reps[2].approval_source = "completed", NOW - timedelta(hours=10), NOW - timedelta(hours=9), "auto"     # 제외
    db.commit()
    b = rhs.report_summary(str(rworld["host"].id), db, now=NOW)
    assert (b["avg_review_hours"], b["review_sample"]) == (3.5, 2)
    # 30일 밖 승인 제외 → 표본 0 이면 null
    for r in reps:
        r.approved_at = NOW - timedelta(days=45)
    db.commit()
    b = rhs.report_summary(str(rworld["host"].id), db, now=NOW)
    assert b["avg_review_hours"] is None and b["review_sample"] == 0


def test_V14_hierarchy_신규탭(client, db, rworld):
    reps = rworld["client_reports"]
    reps[0].status, reps[0].generation_status = "error", "partial"
    reps[1].status, reps[1].is_read = "completed", False
    db.commit()
    host = str(rworld["host"].id)

    def names(tab):
        out = rhs.build_hierarchy(host, db, tab=tab, now=NOW)
        return sorted(m["name"] for g in out["groups"] for s in g["sessions"] for m in s["members"])

    assert names("generation_failed") == ["회원1"]
    assert names("member_unread") == ["회원2"]
    assert names("needs_review") == ["회원3"]
    assert len(names("all")) == 3
    # created_today: 생성 시각을 오늘로 둔 문서만
    reps[2].created_at = NOW
    for r in reps[:2]:
        r.created_at = NOW - timedelta(days=3)
    db.commit()
    assert names("created_today") == ["회원3"]
    res = client.get("/api/v1/reports/hierarchy?tab=bogus", headers=rworld["auth"])
    assert res.status_code == 422
    assert client.get("/api/v1/reports/hierarchy?tab=member_unread", headers=rworld["auth"]).status_code == 200


def test_V16_리포트요약_쿼리수_상수(client, db):
    w1 = build_class_world(db, members=2)
    few = _count_queries(db, lambda: rhs.report_summary(str(w1["host"].id), db, now=NOW))
    w2 = build_class_world(db, members=10)
    many = _count_queries(db, lambda: rhs.report_summary(str(w2["host"].id), db, now=NOW))
    assert many == few


# ───────────── 읽음 처리 ─────────────
def test_V15_코치_상세조회는_회원용_읽음_처리_안함(client, db, rworld):
    rep = rworld["client_reports"][0]
    rep.status = "completed"
    cr = rworld["counselor_report"]
    cr.status = "completed"
    db.commit()
    res = client.get(f"/api/v1/reports/{rep.id}", headers=rworld["auth"])
    assert res.status_code == 200, res.text
    db.expire_all()
    assert db.get(Report, rep.id).is_read is False   # 호스트 코치 열람 → 불변
    res = client.get(f"/api/v1/reports/{cr.id}", headers=rworld["auth"])
    assert res.status_code == 200, res.text
    db.expire_all()
    assert db.get(Report, cr.id).is_read is True     # 코치용 리포트 호스트 열람은 기존대로


def test_V15b_회원_본인_열람은_읽음_처리(client, db):
    """클래스 없는 개인 회차의 회원용 리포트 — 회원 본인 GET 만 읽음 처리, 호스트 GET 은 불변."""
    w = build_class_world(db, members=1)
    s = w["session"]
    s.class_id = None
    rep = w["client_reports"][0]
    rep.status = "completed"
    db.commit()
    assert client.get(f"/api/v1/reports/{rep.id}", headers=w["auth"]).status_code == 200
    db.expire_all()
    assert db.get(Report, rep.id).is_read is False
    member = db.get(User, rep.user_id)
    res = client.get(f"/api/v1/reports/{rep.id}", headers=auth_for(member))
    assert res.status_code == 200, res.text
    db.expire_all()
    assert db.get(Report, rep.id).is_read is True
