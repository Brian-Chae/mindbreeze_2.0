"""SDD-327 T12/T14 — 리포트 공유 API (권한·계약·기존 resend-email 회귀)."""
import uuid
from unittest.mock import Mock

import fakeredis
import pytest

from app.core.database import get_db
from app.main import app
from app.models.record import Report
from app.models.report_share_event import ReportShareEvent
from app.models.session import SessionParticipant
from app.services import report_email_service
from app.services import report_share_service as svc
from tests.test_report import _create_session, _register


@pytest.fixture
def env(client, monkeypatch):
    fake = fakeredis.FakeStrictRedis(decode_responses=True)
    enq = Mock()
    monkeypatch.setattr(svc, "get_sync_redis", lambda: fake)
    monkeypatch.setattr(svc, "_enqueue", enq)
    host = _register(client, "share-host@example.com")
    member = _register(client, "share-member@example.com", "client")
    other = _register(client, "share-other@example.com", "client")
    sid = _create_session(client, host)
    provider = app.dependency_overrides[get_db]()
    db = next(provider)
    p = SessionParticipant(session_id=sid, user_id=uuid.UUID(member["id"]), report_included=True,
                           report_email="share-member@example.com")
    db.add(p)
    db.flush()
    r = Report(session_id=sid, participant_id=p.id, user_id=p.user_id, type="client",
               status="completed", content={})
    db.add(r)
    db.commit()
    yield client, db, r, host, member, other, fake, enq
    provider.close()


def _post(client, rid, who, **body):
    payload = {"recipients": ["friend@example.com"], "acknowledged": True, **body}
    return client.post(f"/api/v1/me/reports/{rid}/share-email", json=payload, headers=who["auth"])


def test_member_shares_own_report(env):
    client, db, r, _, member, _, _, enq = env
    res = _post(client, r.id, member, message="안녕 http://x.com")
    assert res.status_code == 202, res.text
    body = res.json()
    assert body["accepted_count"] == 1 and body["accepted"][0]["masked"] == "f***@e***.com"
    assert "friend@example.com" not in res.text
    assert enq.call_args.args[4] == "안녕" and enq.call_args.args[5] == "MIND BREEZE 회원"
    ev = db.query(ReportShareEvent).one()
    assert ev.sender_role == "member" and str(ev.sender_user_id) == member["id"]


def test_other_member_forbidden_and_host_not_member_route(env):
    client, _, r, host, _, other, _, enq = env
    assert _post(client, r.id, other).status_code == 403
    assert client.get(f"/api/v1/me/reports/{r.id}/share-history", headers=other["auth"]).status_code == 403
    assert _post(client, r.id, host).status_code == 403
    assert _post(client, uuid.uuid4(), other).status_code == 404
    enq.assert_not_called()


def test_requires_auth_and_acknowledgement(env):
    client, _, r, _, member, _, _, enq = env
    assert client.post(f"/api/v1/me/reports/{r.id}/share-email",
                       json={"recipients": ["a@x.com"], "acknowledged": True}).status_code == 401
    assert _post(client, r.id, member, acknowledged=False).status_code == 422
    enq.assert_not_called()


def test_recipient_count_and_validation(env):
    client, _, r, _, member, _, _, _ = env
    assert _post(client, r.id, member, recipients=["a@x.com", "b@x.com", "c@x.com", "d@x.com"]).status_code == 422
    assert _post(client, r.id, member, recipients=[]).status_code == 422
    assert _post(client, r.id, member, recipients=["bad"]).status_code == 422
    assert _post(client, r.id, member, message="가" * 201).status_code == 422


def test_partial_invalid_address_202_with_rejected(env):
    client, _, r, _, member, _, _, _ = env
    res = _post(client, r.id, member, recipients=["a@x.com", "bad"])
    assert res.status_code == 202
    body = res.json()
    assert body["accepted_count"] == 1
    assert [x["reason"] for x in body["rejected"]] == ["invalid"]


def test_unapproved_report_409(env):
    client, db, r, _, member, _, _, _ = env
    r.status = "pending_review"
    db.commit()
    assert _post(client, r.id, member).status_code == 409


def test_member_daily_limit_api_429_on_11th(env):
    client, _, r, _, member, _, _, _ = env
    for i in range(10):
        assert _post(client, r.id, member, recipients=[f"u{i}@x.com"]).status_code == 202
    assert _post(client, r.id, member, recipients=["u10@x.com"]).status_code == 429


def test_same_address_too_soon_reported_in_rejected(env):
    client, _, r, _, member, _, _, _ = env
    assert _post(client, r.id, member).status_code == 202
    again = _post(client, r.id, member)
    assert again.status_code == 202
    assert again.json()["rejected"][0]["reason"] == "too_soon" and again.json()["accepted_count"] == 0


def test_redis_down_returns_503(env, monkeypatch):
    client, _, r, _, member, _, _, enq = env
    broken = Mock()
    broken.set.side_effect = ConnectionError("down")
    monkeypatch.setattr(svc, "get_sync_redis", lambda: broken)
    assert _post(client, r.id, member).status_code == 503
    enq.assert_not_called()


def test_history_lists_own_masked_only(env):
    client, _, r, _, member, _, _, _ = env
    _post(client, r.id, member)
    res = client.get(f"/api/v1/me/reports/{r.id}/share-history", headers=member["auth"])
    assert res.status_code == 200
    items = res.json()["items"]
    assert len(items) == 1 and items[0]["recipient_masked"] == "f***@e***.com"
    assert "friend@example.com" not in res.text


def test_public_view_with_share_token_and_bad_tokens(env):
    client, db, r, _, member, _, _, enq = env
    _post(client, r.id, member)
    token = enq.call_args.args[2].split("token=")[1]
    ok = client.get("/api/v1/reports/view", params={"token": token})
    assert ok.status_code == 200, ok.text
    assert ok.json()["id"] == str(r.id) and ok.json().get("report_email") in (None, "")
    forged = report_email_service._token("report_share", str(r.id), str(r.session_id), rcpt="a" * 32, jti="nope")
    assert client.get("/api/v1/reports/view", params={"token": forged}).status_code == 403
    assert client.get("/api/v1/reports/view", params={"token": "garbage"}).status_code == 401


# ---- 기존 resend-email 계약 회귀 (상담사/기관관리자 경로) ----
def test_resend_email_contract_preserved_and_300_limit(env, monkeypatch):
    client, db, r, host, _, _, fake, _ = env
    sender = Mock(return_value=True)
    monkeypatch.setattr(report_email_service, "send_report_email", sender)
    res = client.post(f"/api/v1/reports/{r.id}/resend-email", json={"email": "new@example.com"},
                      headers=host["auth"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["success"] is True and body["sent"] is True and body["message"]
    assert sender.call_args.args[0] == "new@example.com"
    assert "report-view?token=" in sender.call_args.args[1]
    ev = db.query(ReportShareEvent).one()
    assert ev.sender_role == "counselor" and ev.status == "sent"
    # 상한 300: 301번째 429
    fake.set(svc._day_key(host["id"]), 300)
    over = client.post(f"/api/v1/reports/{r.id}/resend-email", json={"email": "z@example.com"},
                       headers=host["auth"])
    assert over.status_code == 429


def test_resend_email_failure_reports_false_and_non_host_403(env, monkeypatch):
    client, db, r, host, _, other, _, _ = env
    monkeypatch.setattr(report_email_service, "send_report_email", Mock(return_value=False))
    res = client.post(f"/api/v1/reports/{r.id}/resend-email", json={"email": "new@example.com"},
                      headers=host["auth"])
    assert res.status_code == 200 and res.json()["success"] is False
    assert db.query(ReportShareEvent).one().status == "failed"
    assert client.post(f"/api/v1/reports/{r.id}/resend-email", json={"email": "n@example.com"},
                       headers=other["auth"]).status_code == 403


def test_member_sender_name_flows_to_mail(env):
    client, db, r, _, member, _, _, enq = env
    res = _post(client, r.id, member, sender_name="  지은 ")
    assert res.status_code == 202, res.text
    assert enq.call_args.args[5] == "지은"
    ev = db.query(ReportShareEvent).one()
    assert not hasattr(ev, "sender_name")  # 이력에는 저장하지 않는다


def test_member_sender_name_21_chars_is_422(env):
    client, _, r, _, member, _, _, enq = env
    assert _post(client, r.id, member, sender_name="가" * 21).status_code == 422
    assert _post(client, r.id, member, sender_name="가" * 20).status_code == 202


def test_member_sender_name_tags_urls_stripped(env):
    client, _, r, _, member, _, _, enq = env
    res = _post(client, r.id, member, sender_name="<i>x</i>철수 www.a.com")
    assert res.status_code == 202, res.text
    assert enq.call_args.args[5] == "x철수"


def test_member_sender_name_forbidden_word_400(env):
    from app.services.member_report_wording import FORBIDDEN_WORDS

    client, _, r, _, member, _, _, enq = env
    assert _post(client, r.id, member, sender_name=FORBIDDEN_WORDS[0]).status_code == 400
    enq.assert_not_called()


def test_public_view_pdf_with_share_token(env, monkeypatch):
    """SDD-327: 공유 링크의 PDF 다운로드 — report_share 토큰도 받아야 한다(기존은 401)."""
    import json
    from pathlib import Path
    from app.api.v1 import reports as reports_api

    client, db, r, _, member, _, _, enq = env
    _post(client, r.id, member)
    token = enq.call_args.args[2].split("token=")[1]
    old_pdf = Mock(return_value=reports_api.Response(content=b"%PDF-old", media_type="application/pdf"))
    monkeypatch.setattr(reports_api, "pdf_response", old_pdf)
    # member_report 없으면 기존 PDF
    res = client.get("/api/v1/reports/view/pdf", params={"token": token})
    assert res.status_code == 200, res.text
    assert res.content == b"%PDF-old"
    # member_report 있으면 명상 기록 책 PDF
    sample = json.loads((Path(__file__).parent / "fixtures/member_report/member-report-sample.json").read_text())
    r.content = {**(r.content or {}), "member_report": sample}
    db.commit()
    import app.services.member_report_book as book
    monkeypatch.setattr(book, "render_member_report_book", lambda mr: b"%PDF-book")
    res = client.get("/api/v1/reports/view/pdf", params={"token": token})
    assert res.status_code == 200 and res.content == b"%PDF-book"
    assert "meditation-record" in res.headers["content-disposition"]
    # 위조 공유 토큰은 거부
    forged = report_email_service._token("report_share", str(r.id), str(r.session_id), rcpt="a" * 32, jti="nope")
    assert client.get("/api/v1/reports/view/pdf", params={"token": forged}).status_code == 403
