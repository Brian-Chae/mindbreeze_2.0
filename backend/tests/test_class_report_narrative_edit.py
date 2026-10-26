"""SDD-237 B5: 서사 문장 수정·되돌리기 PATCH (verify E1~E14)."""

import copy
import logging
import uuid

import pytest

from app.models.class_program import ClassInstructor
from app.services import class_report_narrative as nar
from app.tasks import report_task
from tests.sdd237_helpers import add_windows, auth_for, build_class_world, make_user


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


def patch(client, w, body, headers=None):
    return client.patch(f"/api/v1/sessions/{w['session'].id}/class-report/narrative", json=body,
                        headers=headers or w["auth"])


def block_of(db, w):
    db.expire_all()
    from app.models.record import Report
    return db.get(Report, w["counselor_report"].id).content["class_report"]


# ── E1 수정 저장 ─────────────────────────────────────────────────
def test_수정_저장은_edited_필드를_채우고_rule_text와_ai_draft를_보존한다(client, world, db):
    before = block_of(db, world)["narrative"]["fields"]["headline"]
    res = patch(client, world, {"field": "headline", "text": "  오늘은 호흡이 느려지는 쪽으로 움직였어요.  "})
    assert res.status_code == 200, res.text
    v = res.json()["value"]
    assert res.json()["field"] == "headline"
    assert v["text"] == "오늘은 호흡이 느려지는 쪽으로 움직였어요." and v["source"] == "edited"
    assert v["edited_by"] == str(world["host"].id) and v["edited_by_name"] == "채 상담사"
    assert v["edited_at"] and v["stale"] is False
    stored = block_of(db, world)["narrative"]["fields"]["headline"]
    assert stored["rule_text"] == before["rule_text"] and stored["ai_draft"] == before["ai_draft"]
    assert stored["edited_text"] == v["text"]
    assert stored["edited_input_hash"] == block_of(db, world)["narrative"]["input_hash"]


@pytest.mark.parametrize("key", ["headline", "flow", "body_subtitle", "mind_subtitle", "metric.respiration",
                                 "metric.focus"])
def test_편집_가능한_모든_키(client, world, db, key):
    fields = block_of(db, world)["narrative"]["fields"]
    if key not in fields:
        pytest.skip("합성 데이터에서 만들어지지 않는 필드")
    assert patch(client, world, {"field": key, "text": "고친 문장"}).status_code == 200


def test_요약과_리포트가_같은_수정본을_보여준다(client, world):
    patch(client, world, {"field": "headline", "text": "상담사가 고친 한 줄"})
    s = client.get(f"/api/v1/sessions/{world['session'].id}/class-summary", headers=world["auth"]).json()
    r = client.get(f"/api/v1/sessions/{world['session'].id}/class-report", headers=world["auth"]).json()
    assert s["class_report"]["headline"]["text"] == "상담사가 고친 한 줄"
    assert s["class_report"]["headline"]["source"] == "edited"
    assert r["block"]["narrative"]["fields"]["headline"]["text"] == "상담사가 고친 한 줄"


def test_참여자_한_줄_수정과_이름_비저장(client, world, db):
    pid = str(world["participants"][0].id)
    res = patch(client, world, {"field": f"participant.{pid}", "text": "이 분은 천천히 호흡했어요."})
    assert res.status_code == 200
    assert "회원1" not in str(block_of(db, world))


# ── E3 되돌리기 ──────────────────────────────────────────────────
def test_되돌리기는_edited_를_비우고_규칙_문장으로_복원한다(client, world, db):
    rule = block_of(db, world)["narrative"]["fields"]["headline"]["rule_text"]
    patch(client, world, {"field": "headline", "text": "내 문장"})
    res = patch(client, world, {"field": "headline", "revert": True})
    assert res.status_code == 200
    v = res.json()["value"]
    assert v["source"] == "rule" and v["text"] == rule
    assert v["edited_text"] is None and v["edited_by"] is None and v["edited_at"] is None
    assert v["rule_text"] == rule


def test_되돌리기는_유효한_AI_초안이_있으면_ai로_복원한다(client, world, db):
    from app.models.record import Report
    rep = db.get(Report, world["counselor_report"].id)
    c = copy.deepcopy(rep.content)
    n = c["class_report"]["narrative"]
    n["fields"]["headline"].update(ai_draft="AI가 쓴 한 줄", ai_draft_input_hash=n["input_hash"], source="ai")
    rep.content = c
    db.commit()
    patch(client, world, {"field": "headline", "text": "내 문장"})
    v = patch(client, world, {"field": "headline", "revert": True}).json()["value"]
    assert v["source"] == "ai" and v["text"] == "AI가 쓴 한 줄" and v["ai_draft"] == "AI가 쓴 한 줄"


def test_수정하지_않은_필드의_되돌리기는_변화_없이_200(client, world):
    res = patch(client, world, {"field": "headline", "revert": True})
    assert res.status_code == 200 and res.json()["value"]["source"] == "rule"


# ── E4·E5·E6 검증 ───────────────────────────────────────────────
@pytest.mark.parametrize("text", ["", "   ", "\n\t "])
def test_빈_문자열_공백은_422_empty_text(client, world, db, text):
    res = patch(client, world, {"field": "headline", "text": text})
    assert res.status_code == 422 and res.json()["detail"]["code"] == "empty_text"
    assert block_of(db, world)["narrative"]["fields"]["headline"]["edited_text"] is None


def test_text_누락도_empty_text(client, world):
    res = patch(client, world, {"field": "headline"})
    assert res.status_code == 422 and res.json()["detail"]["code"] == "empty_text"


@pytest.mark.parametrize("key,limit", [("headline", 200), ("flow", 150), ("body_subtitle", 150),
                                       ("mind_subtitle", 150), ("metric.focus", 100)])
def test_길이_상한_경계(client, world, db, key, limit):
    if key not in block_of(db, world)["narrative"]["fields"]:
        pytest.skip("합성 데이터에서 만들어지지 않는 필드")
    ok = patch(client, world, {"field": key, "text": "가" * limit})
    assert ok.status_code == 200
    over = patch(client, world, {"field": key, "text": "가" * (limit + 1)})
    assert over.status_code == 422 and over.json()["detail"]["code"] == "text_too_long"


def test_공백은_길이에서_제외하고_센다(client, world):
    assert patch(client, world, {"field": "metric.focus", "text": " " + "가" * 100 + " "}).status_code == 200


def test_제어문자는_422(client, world):
    res = patch(client, world, {"field": "headline", "text": "가나\x07다"})
    assert res.status_code == 422 and res.json()["detail"]["code"] == "invalid_text"


@pytest.mark.parametrize("key", ["status", "metric.focus.mean", "metric.score", "scope", "participant.",
                                 "disclaimer", "headcount", "series", "narrative", ""])
def test_수정_불가_키는_422_field_not_editable(client, world, key):
    res = patch(client, world, {"field": key, "text": "숫자를 고치려는 시도"})
    assert res.status_code == 422 and res.json()["detail"]["code"] == "field_not_editable"


def test_존재하지_않는_참여자_줄은_422(client, world):
    res = patch(client, world, {"field": f"participant.{uuid.uuid4()}", "text": "x"})
    assert res.status_code == 422 and res.json()["detail"]["code"] == "field_not_editable"


def test_수정_가능한_키라도_문장이_없는_지표는_422(client, world, db):
    fields = block_of(db, world)["narrative"]["fields"]
    missing = next(k for k in ("metric.hrv", "metric.emotional", "metric.relaxation") if k not in fields) \
        if any(k not in fields for k in ("metric.hrv", "metric.emotional", "metric.relaxation")) else None
    if missing is None:
        pytest.skip("모든 지표 문장이 존재")
    assert patch(client, world, {"field": missing, "text": "x"}).status_code == 422


# ── E7 권한 ─────────────────────────────────────────────────────
def test_org_admin_assistant_회원_무관자는_403_narrative_edit_forbidden(client, world, db):
    admin = make_user(db, role="org_admin", name="기관관리자", org=world["org"])
    assistant = make_user(db, name="보조", org=world["org"])
    db.add(ClassInstructor(id=uuid.uuid4(), class_id=world["cls"].id, user_id=assistant.id, role="assistant"))
    stranger = make_user(db, name="무관")
    db.commit()
    from app.core.security import create_access_token
    member = {"Authorization": f"Bearer {create_access_token(str(world['participants'][0].user_id))}"}
    for headers in (auth_for(admin), auth_for(assistant), member, auth_for(stranger)):
        res = patch(client, world, {"field": "headline", "text": "x"}, headers=headers)
        assert res.status_code == 403 and res.json()["detail"]["code"] == "narrative_edit_forbidden"
    assert block_of(db, world)["narrative"]["fields"]["headline"]["edited_text"] is None


def test_미인증은_401(client, world):
    res = client.patch(f"/api/v1/sessions/{world['session'].id}/class-report/narrative",
                       json={"field": "headline", "text": "x"})
    assert res.status_code in (401, 403)


def test_클래스_lead는_진행자가_아니어도_수정_가능(client, world, db):
    lead = make_user(db, name="다른 주강사", org=world["org"])
    db.add(ClassInstructor(id=uuid.uuid4(), class_id=world["cls"].id, user_id=lead.id, role="lead"))
    db.commit()
    res = patch(client, world, {"field": "headline", "text": "주강사가 고침"}, headers=auth_for(lead))
    assert res.status_code == 200 and res.json()["value"]["edited_by_name"] == "다른 주강사"


# ── 상태 오류 ───────────────────────────────────────────────────
def test_미종료_409_not_completed(client, db):
    w = build_class_world(db, members=1, status="in_progress", ended=False)
    res = patch(client, w, {"field": "headline", "text": "x"})
    assert res.status_code == 409 and res.json()["detail"]["code"] == "not_completed"


def test_블록이_없으면_409_report_not_ready(client, db):
    w = build_class_world(db, members=1)
    res = patch(client, w, {"field": "headline", "text": "x"})
    assert res.status_code == 409 and res.json()["detail"]["code"] == "report_not_ready"


def test_상담_세션은_400(client, db):
    from app.models.session import Session
    host = make_user(db, name="상담사")
    s = Session(id=uuid.uuid4(), type="clinical", status="completed", host_id=host.id, is_template=True,
                duration_min=50)
    db.add(s)
    db.commit()
    res = client.patch(f"/api/v1/sessions/{s.id}/class-report/narrative",
                       json={"field": "headline", "text": "x"}, headers=auth_for(host))
    assert res.status_code == 400 and res.json()["detail"]["code"] == "not_class_session"


# ── E10 동시성 ──────────────────────────────────────────────────
def test_base_edited_at_불일치는_409_edit_conflict와_최신_값(client, world):
    first = patch(client, world, {"field": "headline", "text": "첫 수정", "base_edited_at": None}).json()["value"]
    stale = patch(client, world, {"field": "headline", "text": "늦은 수정", "base_edited_at": None})
    assert stale.status_code == 409
    d = stale.json()["detail"]
    assert d["code"] == "edit_conflict" and d["value"]["text"] == "첫 수정"
    ok = patch(client, world, {"field": "headline", "text": "정상 수정", "base_edited_at": first["edited_at"]})
    assert ok.status_code == 200


def test_base_edited_at을_보내지_않으면_충돌_검사를_하지_않는다(client, world):
    patch(client, world, {"field": "headline", "text": "A"})
    assert patch(client, world, {"field": "headline", "text": "B"}).status_code == 200


# ── E8·E9 AI/재생성과 공존 ──────────────────────────────────────
def test_수정_후_통계가_바뀌면_stale_표시(client, world, db):
    patch(client, world, {"field": "headline", "text": "고친 문장"})
    add_windows(db, world["session"], world["participants"][2], 300)
    report_task.generate_report_inline(str(world["counselor_report"].id), db)
    r = client.get(f"/api/v1/sessions/{world['session'].id}/class-report", headers=world["auth"]).json()
    h = r["block"]["narrative"]["fields"]["headline"]
    assert h["text"] == "고친 문장" and h["stale"] is True


# ── E11·E14 부작용 없음 / 로그 ──────────────────────────────────
def test_수정은_알림_메일_승인_AI_재생성을_호출하지_않는다(client, world, monkeypatch):
    from app.services import notification_service, report_email_service, report_service
    from app.tasks import summary_task

    def forbidden(*a, **k):
        raise AssertionError("수정 저장이 호출하면 안 된다")

    monkeypatch.setattr(report_service, "approve_report", forbidden)
    monkeypatch.setattr(report_service, "generate_report", forbidden)
    monkeypatch.setattr(report_task, "generate_report_inline", forbidden)
    monkeypatch.setattr(report_email_service, "enqueue_report_email", forbidden)
    monkeypatch.setattr(notification_service, "notify_event", forbidden)
    monkeypatch.setattr(summary_task, "_call_gemini_text", forbidden)
    assert patch(client, world, {"field": "headline", "text": "수정"}).status_code == 200
    assert patch(client, world, {"field": "headline", "revert": True}).status_code == 200


def test_다른_필드와_리포트_상태는_바뀌지_않는다(client, world, db):
    from app.models.record import Report
    rep = db.get(Report, world["counselor_report"].id)
    before_status, before_gen = rep.status, rep.generation_status
    before_fields = copy.deepcopy(block_of(db, world)["narrative"]["fields"])
    patch(client, world, {"field": "headline", "text": "수정"})
    after = block_of(db, world)["narrative"]["fields"]
    for key in before_fields:
        if key != "headline":
            assert after[key] == before_fields[key]
    db.expire_all()
    rep = db.get(Report, world["counselor_report"].id)
    assert (rep.status, rep.generation_status) == (before_status, before_gen)


def test_로그에는_키_사용자_시각만_남고_문장_원문과_이름이_없다(client, world, caplog):
    secret = "비밀스러운_수정_문장_ABC"
    with caplog.at_level(logging.INFO):
        patch(client, world, {"field": "headline", "text": secret})
        patch(client, world, {"field": "headline", "revert": True})
    joined = "\n".join(r.getMessage() for r in caplog.records)
    assert secret not in joined and "채 상담사" not in joined and "회원1" not in joined
    assert "headline" in joined and str(world["host"].id) in joined


# ── 순수 함수 ───────────────────────────────────────────────────
def test_apply_edit_revert_edit은_입력을_변경하지_않는다():
    fields = nar.merge_fields(None, {"headline": "R"}, "h1")
    snap = copy.deepcopy(fields)
    out = nar.apply_edit(fields, "headline", "E", "u1", "h1", "2026-10-23T10:00:00.000000Z")
    assert fields == snap and out["headline"]["source"] == "edited"
    back = nar.revert_edit(out, "headline", "h1")
    assert back["headline"]["source"] == "rule" and back["headline"]["edited_text"] is None
