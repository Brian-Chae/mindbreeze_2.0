"""SDD-237 P6: 회원·참여자·비참여 회원은 상담사용 클래스 리포트를 어떤 경로로도 받지 못한다."""

import copy

import pytest

from app.core.security import create_access_token
from app.models.record import Report
from app.services import report_service
from app.tasks import report_task
from tests.sdd237_helpers import add_windows, auth_for, build_class_world, make_user

LEAK_KEYS = ("class_report",)


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


def member_auth(user_id):
    return {"Authorization": f"Bearer {create_access_token(str(user_id))}"}


def contains_class_report(obj) -> bool:
    if isinstance(obj, dict):
        return "class_report" in obj or any(contains_class_report(v) for v in obj.values())
    if isinstance(obj, list):
        return any(contains_class_report(v) for v in obj)
    return False


def test_회원은_상담사용_리포트_상세를_열수_없다(client, world):
    for p in world["participants"]:
        res = client.get(f"/api/v1/reports/{world['counselor_report'].id}", headers=member_auth(p.user_id))
        assert res.status_code in (403, 404), res.text
        assert "class_report" not in res.text


def test_회원_목록에_상담사용_리포트가_없다(client, world, db):
    for r in world["client_reports"]:
        r.status = "completed"
    db.commit()
    for p in world["participants"]:
        res = client.get("/api/v1/reports", headers=member_auth(p.user_id))
        assert res.status_code == 200
        assert not contains_class_report(res.json())
        ids = [str(x["id"]) for x in res.json().get("items", res.json().get("reports", []))]
        assert str(world["counselor_report"].id) not in ids


def test_회원_본인_리포트_직렬화에서_class_report_키를_제거한다_이중_방어(client, world, db, monkeypatch):
    # 본인 승인 리포트 판정(class_read_service)은 이 테스트의 관심사가 아니므로 통과시키고 직렬화만 본다.
    monkeypatch.setattr("app.services.class_read_service.require_own_approved_report",
                        lambda *a, **k: (None, None))
    own = world["client_reports"][0]
    own.status = "completed"
    own.content = {**copy.deepcopy(own.content), "class_report": {"leaked": True}}
    db.commit()
    res = client.get(f"/api/v1/reports/{own.id}", headers=member_auth(world["participants"][0].user_id))
    assert res.status_code == 200, res.text
    assert not contains_class_report(res.json())


def test_serialize는_상담사용이_아니면_class_report를_싣지_않는다(world, db):
    own = world["client_reports"][0]
    own.content = {"eeg": {"status": "valid"}, "class_report": {"leaked": True}}
    db.commit()
    assert "class_report" not in report_service._serialize(own, world["session"])["content"]
    cr = report_service._serialize(world["counselor_report"], world["session"])["content"]
    assert "class_report" in cr  # 상담사용 리포트에는 그대로


def test_상담사는_리포트_상세에서_블록을_받는다(client, world):
    res = client.get(f"/api/v1/reports/{world['counselor_report'].id}", headers=world["auth"])
    assert res.status_code == 200
    assert res.json()["content"]["class_report"]["schema_version"] == 1
    assert "회원1" not in str(res.json()["content"]["class_report"])


def test_요약_리포트_엔드포인트는_회원에게_403(client, world):
    for p in world["participants"]:
        for kind in ("class-summary", "class-report"):
            res = client.get(f"/api/v1/sessions/{world['session'].id}/{kind}", headers=member_auth(p.user_id))
            assert res.status_code == 403


# ── 메일·알림·루시 경로 (발송 대상 아님) ───────────────────────────
def test_상담사용_클래스_리포트는_메일_발송_대상이_아니다(world, db, monkeypatch):
    from app.services import report_email_service

    calls = []
    monkeypatch.setattr(report_email_service, "enqueue_report_email", lambda *a, **k: calls.append(a))
    rep = world["counselor_report"]
    assert report_email_service.deliver_report_email(str(rep.id), db) == "unavailable"
    report_service._enqueue_client_email_on_approval(rep, db)
    report_task._maybe_enqueue_client_report_email(rep, db)
    assert calls == []


def test_루시_대화_훅은_상담사용_리포트에서_메시지를_만들지_않는다(world, db):
    from app.services import agent_report_chat

    assert agent_report_chat.on_report_approved(world["counselor_report"], db) is False


def test_상담사용_리포트_승인_알림은_진행_상담사에게만_간다(world, db, monkeypatch):
    from app.services import notification_service

    recipients = []
    monkeypatch.setattr(notification_service, "notify_event",
                        lambda event, uid, payload, session, **k: recipients.append(uid))
    report_service.approve_report(str(world["counselor_report"].id), str(world["host"].id), db)
    member_ids = {p.user_id for p in world["participants"]}
    assert recipients and not (set(recipients) & member_ids)


def test_회원_본인_승인_경로는_상담사용_리포트에_404(client, world, db):
    rep = world["counselor_report"]
    rep.status = "completed"
    db.commit()
    for p in world["participants"]:
        res = client.get(f"/api/v1/reports/{rep.id}", headers=member_auth(p.user_id))
        assert res.status_code in (403, 404)
