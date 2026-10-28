"""SDD-237 B4: 회차 요약·클래스 리포트 조회 API — 권한, 참여자 행, 승인 현황, 읽기 전용."""

import copy
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.class_program import ClassInstructor
from app.models.record import Report
from app.models.session import Session
from app.tasks import report_task
from tests.sdd237_helpers import (
    START, add_windows, auth_for, build_class_world, make_user,
)


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
    for p in w["participants"][:2]:
        add_windows(db, w["session"], p, 300)
    report_task.generate_report_inline(str(w["counselor_report"].id), db)
    return w


def url(w, kind="class-summary"):
    return f"/api/v1/sessions/{w['session'].id}/{kind}"


# ── 권한 표 (verify A1·A2) ─────────────────────────────────────────
def test_host는_요약과_리포트를_읽는다(client, world):
    assert client.get(url(world), headers=world["auth"]).status_code == 200
    assert client.get(url(world, "class-report"), headers=world["auth"]).status_code == 200


def test_같은_기관_org_admin은_열람_가능_편집_불가(client, world, db):
    admin = make_user(db, role="org_admin", name="기관관리자", org=world["org"])
    db.commit()
    s = client.get(url(world), headers=auth_for(admin))
    assert s.status_code == 200, s.text
    assert s.json()["capabilities"] == {"can_edit_narrative": False, "can_write_note": False,
                                        "can_approve": False}
    assert s.json()["note_prompt"]["eligible"] is False
    r = client.get(url(world, "class-report"), headers=auth_for(admin))
    assert r.status_code == 200 and r.json()["capabilities"]["can_edit_narrative"] is False


def test_다른_기관_org_admin은_403(client, world, db):
    from app.models.organization import Organization
    other = Organization(id=uuid.uuid4(), name="타기관", kind="center", org_code=uuid.uuid4().hex[:6])
    db.add(other)
    db.flush()
    admin = make_user(db, role="org_admin", name="타기관관리자", org=other)
    db.commit()
    for kind in ("class-summary", "class-report"):
        res = client.get(url(world, kind), headers=auth_for(admin))
        assert res.status_code == 403
        assert res.json()["detail"]["code"] == "report_read_forbidden"


def test_회원_참여자와_무관한_상담사는_403(client, world, db):
    member_user_id = world["participants"][0].user_id
    from app.core.security import create_access_token
    member_auth = {"Authorization": f"Bearer {create_access_token(str(member_user_id))}"}
    stranger = make_user(db, name="무관 상담사")
    db.commit()
    for headers in (member_auth, auth_for(stranger)):
        for kind in ("class-summary", "class-report"):
            assert client.get(url(world, kind), headers=headers).status_code == 403


def test_미인증은_401(client, world):
    assert client.get(url(world)).status_code in (401, 403)


def test_팀_열람은_설정과_고지_동의를_모두_충족해야_lead_assistant에게_열린다(client, world, db, monkeypatch):
    from app.config import settings
    lead2 = make_user(db, name="다른 주강사", org=world["org"])
    db.add(ClassInstructor(id=uuid.uuid4(), class_id=world["cls"].id, user_id=lead2.id, role="assistant"))
    db.commit()
    monkeypatch.setattr(settings, "class_team_read_enabled", True)
    # 고지 동의 전 → 403
    assert client.get(url(world), headers=auth_for(lead2)).status_code == 403
    for p in world["participants"]:
        p.report_notice_version = "class-team-v1"
        p.report_notice_ack_at = datetime.now(timezone.utc)
    db.commit()
    res = client.get(url(world), headers=auth_for(lead2))
    assert res.status_code == 200
    assert res.json()["capabilities"]["can_edit_narrative"] is False
    monkeypatch.setattr(settings, "class_team_read_enabled", False)
    assert client.get(url(world), headers=auth_for(lead2)).status_code == 403


def test_상담_세션은_400_not_class_session(client, db):
    host = make_user(db, name="상담사")
    s = Session(id=uuid.uuid4(), type="clinical", status="completed", host_id=host.id,
                is_template=True, duration_min=50)
    db.add(s)
    db.commit()
    for kind in ("class-summary", "class-report"):
        res = client.get(f"/api/v1/sessions/{s.id}/{kind}", headers=auth_for(host))
        assert res.status_code == 400
        assert res.json()["detail"]["code"] == "not_class_session"


def test_미종료_회차는_409_not_completed(client, db):
    w = build_class_world(db, members=1, status="in_progress", ended=False)
    for kind in ("class-summary", "class-report"):
        res = client.get(url(w, kind), headers=w["auth"])
        assert res.status_code == 409
        assert res.json()["detail"]["code"] == "not_completed"


def test_없는_회차는_404(client, world):
    res = client.get(f"/api/v1/sessions/{uuid.uuid4()}/class-summary", headers=world["auth"])
    assert res.status_code == 404


# ── 요약 본문 ────────────────────────────────────────────────────
def test_요약_기본_필드(client, world):
    body = client.get(url(world), headers=world["auth"]).json()
    assert body["session"]["class_name"] == "아침 호흡 명상"
    assert body["session"]["seq"] == 3 and body["session"]["duration_min"] == 45
    assert body["session"]["domain"] == "meditation"
    assert body["headcount"] == {"attended": 3, "measured": 2, "report_targets": 3, "excluded": 0}
    # 전사가 없는 합성 회차는 generation_status 가 partial 이어도 화면 상태(state)는 ready 다
    assert body["report"]["generation_status"] in ("ready", "partial") and body["report"]["state"] == "ready"
    cr = body["class_report"]
    assert cr["available"] is True and cr["status"] in ("measured", "partial")
    assert cr["headline"]["source"] == "rule" and cr["headline"]["text"]
    assert [c["key"] for c in cr["chips"]["body"]] == ["respiration", "bpm", "hrv"]
    assert [c["key"] for c in cr["chips"]["mind"]] == ["focus", "relaxation", "emotional"]
    assert body["fetched_at"]
    assert body["capabilities"] == {"can_edit_narrative": True, "can_write_note": True, "can_approve": True}


def test_요약과_리포트의_숫자는_같은_블록에서_나온다(client, world):
    s = client.get(url(world), headers=world["auth"]).json()
    r = client.get(url(world, "class-report"), headers=world["auth"]).json()
    assert s["class_report"]["scope"] == r["block"]["scope"]
    assert s["class_report"]["status"] == r["block"]["status"]
    assert s["class_report"]["flags"] == r["block"]["flags"]
    chips = {c["key"]: c for g in s["class_report"]["chips"].values() for c in g}
    for key, m in r["block"]["metrics"].items():
        assert chips[key]["direction"] == m["direction"]
    assert s["class_report"]["headline"]["text"] == r["block"]["narrative"]["fields"]["headline"]["text"]


def test_칩_상태_매핑(client, world):
    cr = client.get(url(world), headers=world["auth"]).json()["class_report"]
    by_key = {c["key"]: c for g in cr["chips"].values() for c in g}
    assert by_key["focus"]["state"] == "ok" and by_key["focus"]["direction"] in ("up", "down", "stable")
    # 합성 윈도우에 값이 전부 같아 방향은 stable. 몸 지표도 ok
    assert by_key["respiration"]["state"] == "ok"


def test_분석_중이면_pending_이고_측정_인원은_null(client, world, db):
    rep = world["counselor_report"]
    rep.generation_status = "processing"
    rep.status = "pending_analysis"
    db.commit()
    body = client.get(url(world), headers=world["auth"]).json()
    assert body["class_report"] == {"available": False, "status": "pending", "flags": [], "scope": None,
                                    "headline": None, "chips": {"body": [], "mind": []}}
    assert body["headcount"]["measured"] is None
    assert body["report"]["state"] == "processing"
    r = client.get(url(world, "class-report"), headers=world["auth"]).json()
    assert r["block"] is None and r["report"]["state"] == "processing"


def test_리포트_행이_없으면_pending(client, db):
    w = build_class_world(db, members=1)
    db.delete(w["counselor_report"])
    db.commit()
    body = client.get(url(w), headers=w["auth"]).json()
    assert body["class_report"]["available"] is False and body["report"]["id"] is None


def test_블록이_error면_리포트_상태는_ready_그대로_error_상태를_표시(client, world, db):
    from app.services import class_report_narrative as nar
    rep = world["counselor_report"]
    c = copy.deepcopy(rep.content)
    c["class_report"] = nar.error_block()
    rep.content = c
    db.commit()
    body = client.get(url(world), headers=world["auth"]).json()
    assert body["class_report"]["status"] == "error"
    assert body["report"]["state"] == "ready"


# ── 승인 현황 (type=client 만, P8) ───────────────────────────────
def test_승인_집계는_client_리포트만_센다(client, world, db):
    world["host"].auto_approve_report = False  # 기본값이 켜짐이므로 끔 경로를 명시
    reps = world["client_reports"]
    reps[0].status = "completed"
    reps[1].status = "pending_review"
    reps[2].status = "pending_analysis"
    reps[2].generation_status = "processing"
    db.commit()
    a = client.get(url(world), headers=world["auth"]).json()["approval"]
    assert a["counts"] == {"generating": 1, "pending_review": 1, "approved": 1, "error": 0,
                           "no_data_manual": 0}
    assert a["participants_total"] == 3
    assert a["auto_approve"] == {"enabled": False, "grace_minutes": 0}


def test_자동_승인_켬이고_무데이터_리포트가_검토_대기면_no_data_manual(client, world, db):
    world["host"].auto_approve_report = True
    reps = world["client_reports"]
    reps[0].status = "pending_review"
    reps[0].content = {"eeg": {"status": "not_measured"}}
    reps[1].status = "pending_review"
    reps[1].content = {"eeg": {"status": "valid"}}
    reps[2].status = "completed"
    db.commit()
    a = client.get(url(world), headers=world["auth"]).json()["approval"]
    assert a["auto_approve"]["enabled"] is True
    assert a["counts"]["pending_review"] == 2 and a["counts"]["no_data_manual"] == 1


def test_자동_승인_끔이면_no_data_manual은_0(client, world, db):
    world["host"].auto_approve_report = False  # 기본값이 켜짐이므로 끔 경로를 명시
    reps = world["client_reports"]
    reps[0].status = "pending_review"
    reps[0].content = {"eeg": {"status": "not_measured"}}
    db.commit()
    assert client.get(url(world), headers=world["auth"]).json()["approval"]["counts"]["no_data_manual"] == 0


def test_리포트_반영_제외_참여자의_리포트는_승인_집계에서_뺀다(client, world, db):
    world["participants"][2].report_included = False
    db.commit()
    a = client.get(url(world), headers=world["auth"]).json()
    assert a["approval"]["participants_total"] == 2
    assert sum(a["approval"]["counts"].values()) <= 2 * 2
    assert a["headcount"]["excluded"] == 1 and a["headcount"]["report_targets"] == 2


# ── 진행 기록 안내 / 다음 회차 ───────────────────────────────────
def test_note_prompt_상태(client, world, db):
    n = client.get(url(world), headers=world["auth"]).json()["note_prompt"]
    assert n == {"eligible": True, "has_note": False, "seen": False, "dismissed": False, "user_enabled": True}
    client.post(f"/api/v1/sessions/{world['session'].id}/note-prompt/claim", headers=world["auth"])
    n2 = client.get(url(world), headers=world["auth"]).json()["note_prompt"]
    assert n2["seen"] is True and n2["eligible"] is False


def test_다음_회차는_같은_클래스의_더_큰_seq_예정_회차(client, world, db):
    nxt = Session(id=uuid.uuid4(), type="meditation", status="scheduled", host_id=world["host"].id,
                  class_id=world["cls"].id, seq=4, duration_min=45, scheduled_at=START + timedelta(days=7))
    done = Session(id=uuid.uuid4(), type="meditation", status="completed", host_id=world["host"].id,
                   class_id=world["cls"].id, seq=5, duration_min=45)
    db.add_all([nxt, done])
    db.commit()
    body = client.get(url(world), headers=world["auth"]).json()
    assert body["next_session"]["id"] == str(nxt.id) and body["next_session"]["seq"] == 4
    assert body["next_session"]["scheduled_at"]
    db.delete(nxt)
    db.commit()
    assert client.get(url(world), headers=world["auth"]).json()["next_session"] is None


# ── 클래스 리포트 본문 / 참여자 행 ───────────────────────────────
def test_리포트_본문_필드는_표시_문장으로_합성된다(client, world):
    r = client.get(url(world, "class-report"), headers=world["auth"]).json()
    fields = r["block"]["narrative"]["fields"]
    h = fields["headline"]
    assert set(h) == {"text", "source", "ai_draft", "rule_text", "edited_text", "edited_by", "edited_by_name",
                      "edited_at", "stale", "max_len"}
    assert h["text"] == h["rule_text"] and h["max_len"] == 200 and h["stale"] is False
    assert r["block"]["schema_version"] == 1
    assert r["session"]["class_name"] == "아침 호흡 명상"
    assert r["capabilities"] == {"can_edit_narrative": True}


def test_수정본이_있으면_수정자_이름을_조회_시점에_붙인다(client, world, db):
    rep = world["counselor_report"]
    db.refresh(rep)
    c = copy.deepcopy(rep.content)
    narr = c["class_report"]["narrative"]
    narr["fields"]["headline"].update(edited_text="내 문장", edited_by=str(world["host"].id),
                                      edited_at="2026-10-23T10:02:11Z", source="edited",
                                      edited_input_hash=narr["input_hash"])
    rep.content = c
    db.commit()
    h = client.get(url(world, "class-report"), headers=world["auth"]).json()["block"]["narrative"]["fields"]["headline"]
    assert h["text"] == "내 문장" and h["source"] == "edited" and h["edited_by_name"] == "채 상담사"
    s = client.get(url(world), headers=world["auth"]).json()["class_report"]["headline"]
    assert s == {"text": "내 문장", "source": "edited", "edited_by_name": "채 상담사",
                 "edited_at": "2026-10-23T10:02:11Z"}


def test_참여자_행_이름은_응답에만_있고_순서가_고정된다(client, world, db):
    r = client.get(url(world, "class-report"), headers=world["auth"]).json()
    rows = r["participants"]
    assert [x["display_name"] for x in rows] == ["회원1", "회원2", "회원3"]
    assert [x["order"] for x in rows] == [1, 2, 3]
    assert rows[0]["measurement"] == "measured" and rows[2]["measurement"] == "unworn"
    assert rows[0]["narrative_field"] == f"participant.{rows[0]['participant_id']}"
    assert rows[0]["included"] is True and rows[0]["exclusion"] is None and rows[0]["kind"] == "member"
    assert rows[0]["report"]["id"] == str(world["client_reports"][0].id)
    dumped = str(r["block"])
    assert "회원1" not in dumped


def test_참여자_행_제외_결석_게스트(client, world, db):
    p = world["participants"]
    p[1].report_included = False
    p[2].attendance_status = "excused"
    guest = None
    from app.models.session import SessionParticipant
    guest = SessionParticipant(id=uuid.uuid4(), session_id=world["session"].id, guest_name="게스트님",
                               attendance_status="attended", report_included=True,
                               joined_at=START + timedelta(seconds=9))
    db.add(guest)
    db.commit()
    rows = {x["display_name"]: x for x in client.get(url(world, "class-report"), headers=world["auth"]).json()["participants"]}
    assert rows["회원2"]["included"] is False and rows["회원2"]["exclusion"] == "not_included"
    assert rows["회원2"]["report"]["id"] is None and rows["회원2"]["measurement"] == "excluded"
    assert rows["회원3"]["exclusion"] == "absent" and rows["회원3"]["measurement"] == "excluded"
    assert rows["게스트님"]["kind"] == "guest" and rows["게스트님"]["report"]["generation"] == "none"


@pytest.mark.parametrize("gen,status,expected", [
    ("pending", "pending_analysis", ("pending", "pending_analysis")),
    ("processing", "pending_analysis", ("processing", "pending_analysis")),
    ("ready", "pending_review", ("ready", "pending_review")),
    ("partial", "completed", ("ready", "completed")),
    ("ready", "error", ("failed", "error")),
])
def test_참여자_리포트_상태_매핑(client, world, db, gen, status, expected):
    rep = world["client_reports"][0]
    rep.generation_status, rep.status = gen, status
    db.commit()
    row = client.get(url(world, "class-report"), headers=world["auth"]).json()["participants"][0]
    assert (row["report"]["generation"], row["report"]["approval"]) == expected


@pytest.mark.parametrize("email_status,sent_at,address,approved,expected", [
    ("sent", None, True, True, "sent"),
    ("failed", None, True, True, "failed"),
    (None, datetime(2026, 10, 23, tzinfo=timezone.utc), True, True, "unknown"),  # sent_at 만으로 sent 금지
    (None, None, True, True, "waiting"),
    (None, None, True, False, "not_requested"),
    (None, None, False, True, "no_address"),
    ("cancelled", None, True, True, "not_requested"),
])
def test_참여자_이메일_전달_상태(client, world, db, email_status, sent_at, address, approved, expected):
    p = world["participants"][0]
    rep = world["client_reports"][0]
    p.report_email_status = email_status
    p.report_email_sent_at = sent_at
    p.report_email = "a@e.com" if address else None
    if not address:
        p.user_id = None
        p.guest_name = "게스트"
        p.member_id = None
        rep.user_id = None
    rep.status = "completed" if approved else "pending_review"
    db.commit()
    row = client.get(url(world, "class-report"), headers=world["auth"]).json()["participants"][0]
    assert row["report"]["delivery"] == expected


def test_응답에_이메일_원문이_없다(client, world, db):
    p = world["participants"][0]
    p.report_email = "secret-address@example.com"
    db.commit()
    for kind in ("class-summary", "class-report"):
        assert "secret-address" not in client.get(url(world, kind), headers=world["auth"]).text
        assert "@e.com" not in client.get(url(world, kind), headers=world["auth"]).text


# ── 읽기 전용 (P9) ───────────────────────────────────────────────
def test_조회는_쓰기_승인_메일_알림_AI를_호출하지_않는다(client, world, db, monkeypatch):
    from app.services import notification_service, report_email_service, report_service
    from app.tasks import summary_task

    def forbidden(*a, **k):
        raise AssertionError("조회 경로에서 호출되면 안 된다")

    monkeypatch.setattr(report_service, "approve_report", forbidden)
    monkeypatch.setattr(report_service, "generate_report", forbidden)
    monkeypatch.setattr(report_task, "generate_report_inline", forbidden)
    monkeypatch.setattr(report_email_service, "enqueue_report_email", forbidden)
    monkeypatch.setattr(notification_service, "notify_event", forbidden)
    monkeypatch.setattr(summary_task, "_call_gemini_text", forbidden)

    from sqlalchemy import event
    writes = []

    def on_write(conn, cursor, statement, *a):
        if statement.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE")):
            writes.append(statement[:60])

    engine = db.get_bind()
    event.listen(engine, "before_cursor_execute", on_write)
    try:
        for kind in ("class-summary", "class-report"):
            assert client.get(url(world, kind), headers=world["auth"]).status_code == 200
    finally:
        event.remove(engine, "before_cursor_execute", on_write)
    assert writes == []
