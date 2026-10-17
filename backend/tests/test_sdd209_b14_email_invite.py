"""SDD-209 B14 — 비회원 이메일 초대·리포트 자동 발송 (verify BT73~BT78, RV9, N-3).

- 초대: 호스트 전용, 형식 검증, 중복, 쿨다운, email_app 큐 투입 1건, 등록 결과와 발송 요청 결과 분리.
- 전달 확인은 Resend 접수(2xx) 수준 — 상태 문구에 delivered/received 같은 확정 필드가 없다.
- 리포트: 승인(N-3) 후 입력 이메일로 자동 발송, 중복 0, 실패는 상담사 화면(참여자 DTO)에 표시.
"""

import re
import uuid
from datetime import timedelta
from unittest.mock import Mock

import pytest

from tests.entry_helpers import enter_guest
from tests.test_sdd015_class_code import _create_class, _open_class, _register

FORBIDDEN_KEYS = {"delivered", "received", "read", "delivery_confirmed", "bounced"}


def _db():
    from app.core.database import SessionLocal

    return SessionLocal()


def _keys(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield k
            yield from _keys(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _keys(v)


@pytest.fixture
def enq(monkeypatch):
    from app.services import session_email_invite_service as svc

    mock = Mock()
    monkeypatch.setattr(svc, "enqueue_invite_email", mock)
    return mock


def _cls(client, host, **kw):
    return _create_class(client, host["h"], participant_mode="group", max_participants=10, **kw)


def _post(client, cls, host, emails, headers=None):
    return client.post(
        f"/api/v1/sessions/{cls['id']}/invite/email", json={"emails": emails},
        headers=headers if headers is not None else host["h"],
    )


def _rows(session_id):
    from app.models.session_email_invite import SessionEmailInvite

    db = _db()
    try:
        return db.query(SessionEmailInvite).filter(SessionEmailInvite.session_id == uuid.UUID(session_id)).all()
    finally:
        db.close()


def test_BT73_호스트만_초대할_수_있다(client, enq):
    host = _register(client, "b14host1@test.com")
    other = _register(client, "b14other1@test.com")
    cls = _cls(client, host)
    assert _post(client, cls, host, ["a@example.com"], headers={"X-No": "1"}).status_code == 401
    assert _post(client, cls, other, ["a@example.com"]).status_code == 403
    assert _post(client, cls, host, ["a@example.com"]).status_code == 200
    enq.assert_called_once()


def test_BT73_형식검증_중복_등록_발송요청_결과_분리(client, enq):
    host = _register(client, "b14host2@test.com")
    cls = _cls(client, host)
    res = _post(client, cls, host, ["Good@Example.com", "bad-address", "good@example.com", "other@example.com"])
    assert res.status_code == 200, res.text
    body = res.json()
    by_email = {r["email"]: r for r in body["results"]}
    assert by_email["Good@Example.com"]["registered"] is True
    assert by_email["Good@Example.com"]["request"] == "queued"
    assert by_email["bad-address"]["request"] == "invalid_email" and by_email["bad-address"]["registered"] is False
    assert by_email["good@example.com"]["request"] == "duplicate_in_request"
    assert by_email["other@example.com"]["registered"] is True
    assert enq.call_count == 2, "큐 투입은 유효한 주소당 1건"
    assert len(_rows(cls["id"])) == 2
    assert not (set(_keys(body)) & FORBIDDEN_KEYS), "전달 확정 필드 금지(접수 수준)"


def test_BT73_빈_목록_과다_422(client, enq):
    host = _register(client, "b14host3@test.com")
    cls = _cls(client, host)
    assert _post(client, cls, host, []).status_code == 422
    assert _post(client, cls, host, [f"u{i}@example.com" for i in range(51)]).status_code == 422
    enq.assert_not_called()


def test_BT73_쿨다운과_재발송(client, enq):
    from app.models.session_email_invite import SessionEmailInvite
    from app.services import session_email_invite_service as svc

    host = _register(client, "b14host4@test.com")
    cls = _cls(client, host)
    first = _post(client, cls, host, ["a@example.com"]).json()["results"][0]
    assert first["request"] == "queued"
    again = _post(client, cls, host, ["A@example.com"]).json()["results"][0]
    assert again["registered"] is False and again["request"] == "skipped_pending"
    assert enq.call_count == 1

    db = _db()
    try:
        inv = db.query(SessionEmailInvite).one()
        inv.status = "requested"
        db.commit()
        invite_id = str(inv.id)
    finally:
        db.close()
    cool = _post(client, cls, host, ["a@example.com"]).json()["results"][0]
    assert cool["request"] == "skipped_cooldown"
    assert enq.call_count == 1

    db = _db()
    try:
        inv = db.query(SessionEmailInvite).one()
        inv.queued_at = inv.queued_at - timedelta(seconds=svc.INVITE_EMAIL_COOLDOWN_SEC + 1)
        db.commit()
    finally:
        db.close()
    resent = _post(client, cls, host, ["a@example.com"]).json()["results"][0]
    assert resent["registered"] is False and resent["request"] == "queued" and resent["invite_id"] == invite_id
    assert enq.call_count == 2
    rows = _rows(cls["id"])
    assert len(rows) == 1 and rows[0].request_count == 2


def test_BT73_큐_투입_실패는_등록은_성공_요청은_실패(client, enq):
    enq.side_effect = RuntimeError("broker down")
    host = _register(client, "b14host5@test.com")
    cls = _cls(client, host)
    res = _post(client, cls, host, ["a@example.com"])
    assert res.status_code == 200
    r = res.json()["results"][0]
    assert r["registered"] is True and r["request"] == "enqueue_failed"
    rows = _rows(cls["id"])
    assert len(rows) == 1 and rows[0].status == "failed" and rows[0].last_error == "enqueue_failed"


def test_BT73_종료된_클래스는_초대_불가(client, enq):
    from app.models.session import Session

    host = _register(client, "b14host6@test.com")
    cls = _cls(client, host)
    db = _db()
    try:
        s = db.query(Session).filter(Session.id == uuid.UUID(cls["id"])).one()
        s.status = "completed"
        db.commit()
    finally:
        db.close()
    assert _post(client, cls, host, ["a@example.com"]).status_code == 400
    enq.assert_not_called()


def test_BT74_초대_메일_본문_4자리_코드_join_안내_코드_URL_미포함(client, enq):
    from app.models.session import Session
    from app.services import session_email_invite_service as svc

    host = _register(client, "b14host7@test.com")
    cls = _cls(client, host, title="아침 명상")
    db = _db()
    try:
        s = db.query(Session).filter(Session.id == uuid.UUID(cls["id"])).one()
        subject, body = svc.build_invite_mail(s, "채상담", s.access_code)
    finally:
        db.close()
    code = cls["access_code"]
    assert len(code) == 4 and code.isdigit()
    assert f"입장 코드: {code}" in body
    assert "/join" in body
    assert "아침 명상" in subject
    assert f"/join?code={code}" not in body and "code=" not in body
    assert not re.search(r"\b\d{6}\b", body), "6자리 숫자 코드 0"


def test_BT73_발송_접수와_실패_상태(client, enq, monkeypatch):
    from app.services import session_email_invite_service as svc
    import app.tasks.email as email_mod

    host = _register(client, "b14host8@test.com")
    cls = _cls(client, host)
    invite_id = _post(client, cls, host, ["a@example.com"]).json()["results"][0]["invite_id"]

    sender = Mock(return_value=True)
    monkeypatch.setattr(email_mod, "send_session_invite_email", sender)
    db = _db()
    try:
        assert svc.deliver_invite_email(invite_id, db) == "sent"
        sender.assert_called_once()
        assert sender.call_args.args[0] == "a@example.com"
        sender.return_value = False
        assert svc.deliver_invite_email(invite_id, db) == "failed"
    finally:
        db.close()
    listing = client.get(f"/api/v1/sessions/{cls['id']}/invite/email", headers=host["h"]).json()
    assert listing["invites"][0]["status"] == "failed"
    assert listing["summary"]["failed"] == 1
    assert not (set(_keys(listing)) & FORBIDDEN_KEYS)


def test_BT77_Celery_태스크가_email_app_큐에_등록되어_있다():
    from app.tasks.report_email_task import email_app, session_invite_email_task

    assert "tasks.session_invite_email" in email_app.tasks
    assert email_app.conf.task_default_queue == "email"
    assert session_invite_email_task.app is email_app


def test_BT78_큐_적체_감지(client, enq):
    from app.models.session_email_invite import SessionEmailInvite
    from app.services import session_email_invite_service as svc

    host = _register(client, "b14host9@test.com")
    cls = _cls(client, host)
    _post(client, cls, host, ["a@example.com"])
    listing = client.get(f"/api/v1/sessions/{cls['id']}/invite/email", headers=host["h"]).json()
    assert listing["invites"][0]["stale"] is False

    db = _db()
    try:
        inv = db.query(SessionEmailInvite).one()
        inv.queued_at = inv.queued_at - timedelta(seconds=svc.QUEUE_STALE_SEC + 5)
        db.commit()
    finally:
        db.close()
    listing = client.get(f"/api/v1/sessions/{cls['id']}/invite/email", headers=host["h"]).json()
    assert listing["invites"][0]["stale"] is True and listing["summary"]["stale"] == 1
    again = _post(client, cls, host, ["a@example.com"]).json()["results"][0]
    assert again["request"] == "queued"


def test_BT73_목록_조회도_호스트_전용(client, enq):
    host = _register(client, "b14host10@test.com")
    other = _register(client, "b14other10@test.com")
    cls = _cls(client, host)
    assert client.get(f"/api/v1/sessions/{cls['id']}/invite/email", headers=other["h"]).status_code == 403


def test_스크럽_이메일_값을_비우고_행은_유지(client, enq):
    from app.models.session_email_invite import SessionEmailInvite
    from app.services import session_email_invite_service as svc

    host = _register(client, "b14host11@test.com")
    cls = _cls(client, host)
    _post(client, cls, host, ["a@example.com", "b@example.com"])
    db = _db()
    try:
        assert svc.scrub_invite_emails(db) >= 2
        rows = db.query(SessionEmailInvite).filter(SessionEmailInvite.session_id == uuid.UUID(cls["id"])).all()
        assert len(rows) == 2 and all(r.email is None and r.email_norm is None and r.pii_scrubbed_at for r in rows)
        assert svc.deliver_invite_email(str(rows[0].id), db) == "skipped"
        assert svc.scrub_invite_emails(db) == 0
    finally:
        db.close()


# ── 비회원 리포트 자동 발송(N-3: 승인 후 자동, OTP 없음) ───────────────────────────────

def _guest_report(client, email="guest-b14@example.com", included=True):
    """비회원이 이메일을 입력해 입장 → 클래스 종료 후 리포트 생성까지 진행한다."""
    from app.models.session import Session, SessionParticipant
    from app.services import report_service

    host = _register(client, f"b14rpt{uuid.uuid4().hex[:6]}@test.com")
    cls = _cls(client, host)
    _open_class(client, cls, host["h"])
    res = enter_guest(client, cls["access_code"], "게스트", email=email)
    assert res.status_code == 200, res.text
    pid = res.json()["participant_id"]
    db = _db()
    try:
        p = db.query(SessionParticipant).filter(SessionParticipant.id == uuid.UUID(pid)).one()
        p.report_included = included
        s = db.query(Session).filter(Session.id == uuid.UUID(cls["id"])).one()
        s.status = "completed"
        db.commit()
        report_service.generate_client_reports_for_session(cls["id"], db)
    finally:
        db.close()
    return host, cls, pid


def test_BT76_승인_후_입력_이메일로_1건_자동_발송_중복_없음(client, monkeypatch):
    from app.models.record import Report
    from app.services import report_email_service as service
    from app.services import report_service

    sender = Mock(return_value=True)
    monkeypatch.setattr(service, "send_report_email", sender)
    monkeypatch.setattr(service, "enqueue_report_email", lambda rid: None)
    host, cls, pid = _guest_report(client)
    db = _db()
    try:
        report = db.query(Report).filter(Report.session_id == uuid.UUID(cls["id"]), Report.type == "client").one()
        assert report.status == "pending_review"
        assert service.deliver_report_email(str(report.id), db) == "pending_review"
        sender.assert_not_called()
        report_service.approve_report(str(report.id), str(host["id"]), db)
        assert service.deliver_report_email(str(report.id), db) == "sent"
        assert service.deliver_report_email(str(report.id), db) == "sent"
        assert sender.call_count == 1, "승인 후 1건, 재호출해도 중복 발송 0"
        assert sender.call_args.args[0] == "guest-b14@example.com"
    finally:
        db.close()


def test_BT76_제외한_비회원은_리포트_발송_대상_아님(client, monkeypatch):
    from app.models.record import Report
    from app.services import report_email_service as service

    sender = Mock(return_value=True)
    monkeypatch.setattr(service, "send_report_email", sender)
    host, cls, pid = _guest_report(client, included=False)
    db = _db()
    try:
        assert db.query(Report).filter(Report.session_id == uuid.UUID(cls["id"]), Report.type == "client").count() == 0
    finally:
        db.close()
    sender.assert_not_called()


def test_BT77_리포트_메일_실패가_상담사_참여자_정보에_표시된다(client, monkeypatch):
    from app.models.record import Report
    from app.services import report_email_service as service
    from app.services import report_service

    monkeypatch.setattr(service, "send_report_email", Mock(return_value=False))
    monkeypatch.setattr(service, "enqueue_report_email", lambda rid: None)
    host, cls, pid = _guest_report(client, email="fail-b14@example.com")
    db = _db()
    try:
        report = db.query(Report).filter(Report.session_id == uuid.UUID(cls["id"]), Report.type == "client").one()
        report_service.approve_report(str(report.id), str(host["id"]), db)
        assert service.deliver_report_email(str(report.id), db) == "failed"
    finally:
        db.close()
    detail = client.get(f"/api/v1/sessions/{cls['id']}", headers=host["h"]).json()
    guest = [p for p in detail["participants"] if p["participant_id"] == pid][0]
    assert guest["report_email_status"] == "failed"


def test_BT79_정원_서버_검증은_그대로(client):
    """온라인 그룹 51 → 422, 오프라인 그룹 101 → 422, 1:1 은 정원 1 지정(서버 기본값 변경 없음) (B14 가 schemas 의 정원 검증을 바꾸지 않았다)."""
    host = _register(client, "b14cap@test.com")
    over = client.post(
        "/api/v1/sessions",
        json={"type": "meditation", "duration_min": 30, "title": "t", "participant_mode": "group",
              "max_participants": 51, "location_type": "online"},
        headers=host["h"],
    )
    assert over.status_code == 422, over.text
    offline_over = client.post(
        "/api/v1/sessions",
        json={"type": "meditation", "duration_min": 30, "title": "t", "participant_mode": "group",
              "max_participants": 101, "location_type": "offline"},
        headers=host["h"],
    )
    assert offline_over.status_code == 422, offline_over.text
    solo = client.post(
        "/api/v1/sessions",
        json={"type": "meditation", "duration_min": 30, "title": "t", "participant_mode": "one_on_one",
              "max_participants": 1},
        headers=host["h"],
    )
    assert solo.status_code == 201, solo.text
    assert solo.json()["max_participants"] == 1
