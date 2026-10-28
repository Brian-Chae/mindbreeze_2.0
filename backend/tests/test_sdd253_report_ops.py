"""SDD-253: 리포트 승인 권한(기관관리자)·감사 스냅샷·발송 상태·계층 조회·호환 (verify TS1~TS8).

메일은 실제로 보내지 않는다 — enqueue/send 는 모두 모킹한다.
"""

import uuid
from datetime import date, timedelta
from unittest.mock import patch

import pytest

from app.models.class_program import Class
from app.models.organization import Organization
from app.models.record import Report
from app.models.session import SessionParticipant
from app.models.user_org_membership import UserOrgMembership
from tests.sdd237_helpers import auth_for, build_class_world, make_user

ENQ = "app.services.report_email_service.enqueue_report_email"
SEND = "app.services.report_email_service.send_report_email"


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
    w = build_class_world(db, members=3)
    # 첫 회원에게 리포트 수신 주소를 등록한다(발송 대상).
    p = w["participants"][0]
    p.report_email = "member1@example.com"
    db.commit()
    w["admin"] = make_user(db, role="org_admin", name="기관 관리자", org=w["org"])
    db.commit()  # StaticPool 단일 연결: 미커밋 행은 첫 요청 세션 종료 때 롤백된다
    return w


def _reload(db, report):
    db.expire_all()
    return db.get(Report, report.id)


# ── TS1 권한 ─────────────────────────────────────────────────────
def test_담당_상담사_승인(client, db, world):
    with patch(ENQ):
        res = client.post(f"/api/v1/reports/{world['client_reports'][0].id}/approve-and-send", headers=world["auth"])
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "completed"


def test_허용_기관의_기관관리자_승인(client, db, world):
    with patch(ENQ):
        res = client.post(f"/api/v1/reports/{world['client_reports'][0].id}/approve-and-send", headers=auth_for(world["admin"]))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["approved_by_name"] == "기관 관리자" and body["approved_by_role"] == "org_admin"
    assert body["approval_source"] == "manual" and body["approved_at"]


def test_타_기관_기관관리자_승인_불가(client, db, world):
    other_org = Organization(id=uuid.uuid4(), name="타 기관", kind="center", org_code=uuid.uuid4().hex[:6])
    db.add(other_org)
    db.flush()
    outsider = make_user(db, role="org_admin", name="타기관관리자", org=other_org)
    db.commit()
    with patch(ENQ):
        res = client.post(f"/api/v1/reports/{world['client_reports'][0].id}/approve-and-send", headers=auth_for(outsider))
    assert res.status_code == 403
    assert _reload(db, world["client_reports"][0]).status == "pending_review"


def test_비활성_기관관리자_승인_불가(client, db, world):
    world["admin"].status = "inactive"
    db.commit()
    with patch(ENQ):
        res = client.post(f"/api/v1/reports/{world['client_reports'][0].id}/approve-and-send", headers=auth_for(world["admin"]))
    assert res.status_code in (401, 403)


def test_회원은_승인_불가(client, db, world):
    from app.models.user import User

    member = db.get(User, world["client_reports"][0].user_id)
    with patch(ENQ):
        res = client.post(f"/api/v1/reports/{world['client_reports'][0].id}/approve-and-send", headers=auth_for(member))
    assert res.status_code == 403


def test_기관관리자는_코멘트_편집_불가_승인과_분리(client, db, world):
    res = client.patch(
        f"/api/v1/reports/{world['client_reports'][0].id}/comment", json={"comment": "x"}, headers=auth_for(world["admin"])
    )
    assert res.status_code == 403
    resp = client.get(f"/api/v1/reports/{world['client_reports'][0].id}", headers=auth_for(world["admin"]))
    assert resp.status_code == 200, resp.text
    detail = resp.json()
    assert detail.get("capabilities"), detail
    assert detail["capabilities"]["can_approve"] is True
    assert detail["capabilities"]["can_edit_comment"] is False


# ── TS2 감사 ─────────────────────────────────────────────────────
def test_재승인으로_최초_감사_불변(client, db, world):
    rid = world["client_reports"][0].id
    with patch(ENQ):
        first = client.post(f"/api/v1/reports/{rid}/approve-and-send", headers=world["auth"]).json()
        again = client.post(f"/api/v1/reports/{rid}/approve-and-send", headers=auth_for(world["admin"])).json()
    assert again["approved_by_name"] == first["approved_by_name"] == "채 상담사"
    assert again["approved_at"] == first["approved_at"]


def test_기존_기록은_승인자_미확인으로_null(client, db, world):
    r = world["client_reports"][1]
    r.status = "completed"
    r.approved_by_user_id = None
    db.commit()
    detail = client.get(f"/api/v1/reports/{r.id}", headers=world["auth"]).json()
    assert detail["approved_by_name"] is None and detail["approval_source"] is None


def test_자동_승인은_source_auto(client, db, world):
    from app.services import report_service

    with patch(ENQ):
        out = report_service._approve_auto(str(world["client_reports"][1].id), str(world["host"].id), db)
    assert out["approval_source"] == "auto"


# ── TS3·TS4 발송 상태 ────────────────────────────────────────────
def test_주소_있으면_pending_예약_한_번(client, db, world):
    rid = world["client_reports"][0].id
    with patch(ENQ) as enq:
        res = client.post(f"/api/v1/reports/{rid}/approve-and-send", headers=world["auth"])
        client.post(f"/api/v1/reports/{rid}/approve-and-send", headers=world["auth"])
        client.post(f"/api/v1/reports/{rid}/approve", headers=world["auth"])
    assert res.json()["delivery_status"] == "pending"
    assert enq.call_count == 1


def test_주소_없으면_not_requested(client, db, world):
    rid = world["client_reports"][1].id
    world["participants"][1].report_email = None
    db.commit()
    from app.models.user import User

    db.get(User, world["participants"][1].user_id).email = ""
    db.commit()
    with patch(ENQ) as enq:
        res = client.post(f"/api/v1/reports/{rid}/approve-and-send", headers=world["auth"])
    assert res.json()["delivery_status"] == "not_requested"
    enq.assert_not_called()


def test_제외_참가자는_unavailable(client, db, world):
    world["participants"][0].report_included = False
    db.commit()
    with patch(ENQ):
        res = client.post(f"/api/v1/reports/{world['client_reports'][0].id}/approve-and-send", headers=world["auth"])
    assert res.json()["delivery_status"] == "unavailable"


def test_예약_실패해도_승인은_유지되고_failed(client, db, world):
    rid = world["client_reports"][0].id
    with patch(ENQ, side_effect=RuntimeError("broker down")):
        res = client.post(f"/api/v1/reports/{rid}/approve-and-send", headers=world["auth"])
    body = res.json()
    assert res.status_code == 200 and body["status"] == "completed"
    assert body["delivery_status"] == "failed" and body["delivery_failure_code"] == "enqueue_failed"
    assert body["delivery_attempt_count"] == 1


def test_워커_전달_결과가_상태에_기록된다(client, db, world):
    from app.services.report_email_service import deliver_report_email

    rid = world["client_reports"][0].id
    with patch(ENQ):
        client.post(f"/api/v1/reports/{rid}/approve-and-send", headers=world["auth"])
    sent_at_before = _reload(db, world["client_reports"][0]).sent_at
    with patch(SEND, return_value=False):
        assert deliver_report_email(str(rid), db) == "failed"
    r = _reload(db, world["client_reports"][0])
    assert r.delivery_status == "failed" and r.delivery_failure_code == "send_failed"
    assert r.sent_at == sent_at_before  # sent_at 은 발송 성공 증거가 아니다
    with patch(SEND, return_value=True):
        assert deliver_report_email(str(rid), db) == "sent"
    assert _reload(db, world["client_reports"][0]).delivery_status == "sent"


# ── TS5 다시 발송 ────────────────────────────────────────────────
def _failed(client, db, world):
    rid = world["client_reports"][0].id
    with patch(ENQ, side_effect=RuntimeError("down")):
        client.post(f"/api/v1/reports/{rid}/approve-and-send", headers=world["auth"])
    return rid


def test_다시_발송_성공은_sent_승인자_불변(client, db, world):
    rid = _failed(client, db, world)
    before = client.get(f"/api/v1/reports/{rid}", headers=world["auth"]).json()
    with patch(SEND, return_value=True):
        res = client.post(f"/api/v1/reports/{rid}/retry-delivery", headers=auth_for(world["admin"]))
    assert res.status_code == 200, res.text
    after = res.json()
    assert after["delivery_status"] == "sent"
    assert after["approved_by_name"] == before["approved_by_name"] and after["approved_at"] == before["approved_at"]
    assert after["delivery_attempt_count"] == before["delivery_attempt_count"] + 1


def test_다시_발송_success_false는_failed_유지(client, db, world):
    rid = _failed(client, db, world)
    with patch(SEND, return_value=False):
        res = client.post(f"/api/v1/reports/{rid}/retry-delivery", headers=world["auth"])
    assert res.json()["delivery_status"] == "failed"
    assert res.json()["delivery_attempt_count"] == 2


def test_다시_발송은_실패_상태만_허용(client, db, world):
    rid = world["client_reports"][0].id
    with patch(ENQ):
        client.post(f"/api/v1/reports/{rid}/approve-and-send", headers=world["auth"])
    with patch(SEND, return_value=True) as send:
        res = client.post(f"/api/v1/reports/{rid}/retry-delivery", headers=world["auth"])
    assert res.status_code == 409
    send.assert_not_called()


def test_다시_발송_권한_없음_403(client, db, world):
    rid = _failed(client, db, world)
    from app.models.user import User

    member = db.get(User, world["client_reports"][1].user_id)
    with patch(SEND, return_value=True) as send:
        res = client.post(f"/api/v1/reports/{rid}/retry-delivery", headers=auth_for(member))
    assert res.status_code == 403
    send.assert_not_called()


# ── TS6 호환·누출 ────────────────────────────────────────────────
def test_구_승인_API도_감사를_기록하고_기존_필드_유지(client, db, world):
    rid = world["client_reports"][0].id
    with patch(ENQ):
        res = client.post(f"/api/v1/reports/{rid}/approve", headers=world["auth"])
    body = res.json()
    for key in ("id", "session_id", "type", "status", "sent_at", "generation_status", "content", "approval_required"):
        assert key in body
    assert body["status"] == "completed" and body["sent_at"]


def test_회원_응답에는_운영_필드가_비어_있다(client, db, world):
    from app.models.user import User

    rid = world["client_reports"][0].id
    with patch(ENQ):
        client.post(f"/api/v1/reports/{rid}/approve-and-send", headers=world["auth"])
    member = db.get(User, world["client_reports"][0].user_id)
    detail = client.get(f"/api/v1/reports/{rid}", headers=auth_for(member)).json()
    listing = client.get("/api/v1/reports", headers=auth_for(member)).json()["reports"]
    for body in [detail, *listing]:
        assert body.get("approved_by_name") is None
        assert body.get("delivery_status") is None
        assert body.get("capabilities") is None


def test_스태프_목록에는_운영_필드가_채워진다(client, db, world):
    rid = world["client_reports"][0].id
    with patch(ENQ):
        client.post(f"/api/v1/reports/{rid}/approve-and-send", headers=world["auth"])
    rows = client.get("/api/v1/reports", headers=world["auth"]).json()["reports"]
    mine = next(r for r in rows if r["id"] == str(rid))
    assert mine["approved_by_name"] == "채 상담사" and mine["delivery_status"] == "pending"


# ── TS7 계층 ─────────────────────────────────────────────────────
def test_계층_구조와_개인정보_투영(client, db, world):
    from app.models.client_profile import ClientProfile

    u = world["client_reports"][0].user_id
    db.add(ClientProfile(user_id=u, gender="female", birth_date=date(1990, 1, 1)))
    db.commit()
    res = client.get("/api/v1/reports/hierarchy", headers=world["auth"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["summary"]["needs_review"] == 3
    group = body["groups"][0]
    assert group["kind"] == "class" and group["title"] == "아침 호흡 명상"
    sess = group["sessions"][0]
    assert sess["counselor_name"] == "채 상담사" and sess["participant_count"] == 3
    assert sess["common_report"]["type"] == "counselor"
    assert sess["common_report"]["approval_required"] is False
    member = next(m for m in sess["members"] if m["gender"] == "female")
    assert "birth_date" not in member and isinstance(member["age"], int)
    assert "birth_date" not in str(body)


def test_상담사용_공통_문서는_검토_대기에_중복_집계되지_않는다(client, db, world):
    body = client.get("/api/v1/reports/hierarchy", headers=world["auth"]).json()
    assert body["summary"]["needs_review"] == 3  # 회원용 3건, 상담사용(approval_required=false) 제외


def test_탭_필터와_검색은_상위_경로를_유지한다(client, db, world):
    with patch(ENQ):
        client.post(f"/api/v1/reports/{world['client_reports'][0].id}/approve-and-send", headers=world["auth"])
    body = client.get("/api/v1/reports/hierarchy?tab=needs_review", headers=world["auth"]).json()
    sess = body["groups"][0]["sessions"][0]
    assert body["groups"][0]["title"] == "아침 호흡 명상"
    assert len(sess["members"]) == 2 and sess["matched_count"] == 2 and sess["participant_count"] == 3
    found = client.get("/api/v1/reports/hierarchy?q=회원2", headers=world["auth"]).json()
    assert [m["name"] for m in found["groups"][0]["sessions"][0]["members"]] == ["회원2"]
    empty = client.get("/api/v1/reports/hierarchy?q=없는이름", headers=world["auth"]).json()
    assert empty["groups"] == []


def test_발송_실패_탭과_정렬(client, db, world):
    _failed(client, db, world)
    failed = client.get("/api/v1/reports/hierarchy?tab=failed", headers=world["auth"]).json()
    assert failed["summary"]["failed_delivery"] == 1
    members = failed["groups"][0]["sessions"][0]["members"]
    assert len(members) == 1 and members[0]["client_report"]["delivery_status"] == "failed"
    allm = client.get("/api/v1/reports/hierarchy", headers=world["auth"]).json()["groups"][0]["sessions"][0]["members"]
    assert allm[0]["client_report"]["delivery_status"] == "failed"  # 할 일 우선 정렬


def test_페이지는_회차_단위로_자른다(client, db, world):
    from app.models.session import Session

    base = world["session"]
    for i in range(3):
        s = Session(id=uuid.uuid4(), type="meditation", status="completed", host_id=world["host"].id,
                    class_id=base.class_id, seq=10 + i, duration_min=30,
                    scheduled_at=base.started_at - timedelta(days=i + 1))
        db.add(s)
        db.flush()
        part = SessionParticipant(id=uuid.uuid4(), session_id=s.id, user_id=world["client_reports"][0].user_id,
                                  attendance_status="attended", report_included=True)
        db.add(part)
        db.flush()
        db.add(Report(id=uuid.uuid4(), session_id=s.id, participant_id=part.id, user_id=part.user_id,
                      type="client", status="pending_review", generation_status="ready", content={}))
    db.commit()
    p1 = client.get("/api/v1/reports/hierarchy?limit=2&page=1", headers=world["auth"]).json()
    p2 = client.get("/api/v1/reports/hierarchy?limit=2&page=2", headers=world["auth"]).json()
    assert p1["total_sessions"] == 4
    n1 = sum(len(g["sessions"]) for g in p1["groups"])
    n2 = sum(len(g["sessions"]) for g in p2["groups"])
    assert (n1, n2) == (2, 2)
    # 첫 회차(회원 3명)는 한 페이지 안에서 갈라지지 않는다
    assert any(len(s["members"]) == 3 for g in p1["groups"] for s in g["sessions"])


def test_기관관리자는_허용_기관_회차만(client, db, world):
    other = build_class_world(db, members=1)  # 다른 기관
    body = client.get("/api/v1/reports/hierarchy", headers=auth_for(world["admin"])).json()
    ids = {s["session_id"] for g in body["groups"] for s in g["sessions"]}
    assert str(world["session"].id) in ids and str(other["session"].id) not in ids


def test_회원은_계층_조회_403(client, db, world):
    from app.models.user import User

    member = db.get(User, world["client_reports"][0].user_id)
    assert client.get("/api/v1/reports/hierarchy", headers=auth_for(member)).status_code == 403


def test_알_수_없는_탭은_422(client, db, world):
    assert client.get("/api/v1/reports/hierarchy?tab=zzz", headers=world["auth"]).status_code == 422


@pytest.mark.parametrize(
    "birth,today,expected",
    [
        (date(1990, 6, 15), date(2026, 6, 14), 35),  # 생일 전
        (date(1990, 6, 15), date(2026, 6, 15), 36),  # 생일 당일
        (date(2000, 2, 29), date(2026, 2, 28), 25),  # 윤일 생일 평년 전날
        (date(2000, 2, 29), date(2026, 3, 1), 26),
        (None, date(2026, 1, 1), None),
        (date(2030, 1, 1), date(2026, 1, 1), None),  # 미래 날짜
    ],
)
def test_만_나이_계산(birth, today, expected):
    from app.services.report_hierarchy_service import age_in_years

    assert age_in_years(birth, today) == expected


# ── TS8 정책 유지 ────────────────────────────────────────────────
def test_마이그레이션은_단일_head이고_chain에_포함():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    script = ScriptDirectory.from_config(Config("alembic.ini"))
    assert script.get_heads() == ["a253b0c1d2e3"] or len(script.get_heads()) == 1
    assert "a253b0c1d2e3" in [r.revision for r in script.walk_revisions()]
    rev = script.get_revision("a253b0c1d2e3")
    assert rev.down_revision == "e036a0245001"
