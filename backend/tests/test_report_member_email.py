"""[MB261022][FIX] 회원 리포트 이메일 — 로그인 회원이 코드 입장하면 report_email 이 비어
상담사 리포트 상세에 이메일이 안 남던 문제.

이메일은 아이디라 회원·비회원 모두 리포트에 남아야 한다.
- 비회원: 입장 때 입력한 report_email
- 회원: report_email 이 없으면 계정 이메일
"""

from uuid import UUID, uuid4

from tests.test_sdd015_class_code import _db, _register


def _seed(client, *, member_email: str | None, guest_email: str | None):
    from app.models.record import Report
    from app.models.session import Session, SessionParticipant

    host = _register(client, f"host-{uuid4().hex[:8]}@test.com")
    member_id = None
    if member_email:
        member = _register(client, member_email, role="client")
        member_id = UUID(member["id"])
    db = _db()
    session = Session(host_id=UUID(host["id"]), type="meditation", status="completed", duration_min=10)
    db.add(session)
    db.flush()
    participant = SessionParticipant(
        session_id=session.id,
        user_id=member_id,
        guest_name=None if member_id else "비회원",
        report_email=guest_email,
        report_included=True,
    )
    db.add(participant)
    db.flush()
    report = Report(
        session_id=session.id,
        participant_id=participant.id,
        user_id=member_id,
        type="client",
        content={},
        status="completed",
        generation_status="ready",
    )
    db.add(report)
    db.commit()
    return host, participant.id, report.id


def _get(client, host, report_id):
    return client.get(f"/api/v1/reports/{report_id}", headers={"Authorization": f"Bearer {host['token']}"})


def test_회원_코드입장_리포트에_계정_이메일(client):
    email = f"member-{uuid4().hex[:8]}@test.com"
    host, _, report = _seed(client, member_email=email, guest_email=None)
    res = _get(client, host, report)
    assert res.status_code == 200, res.text
    assert res.json()["report_email"] == email


def test_비회원_리포트는_입력한_이메일_유지(client):
    host, _, report = _seed(client, member_email=None, guest_email="guest@example.com")
    res = _get(client, host, report)
    assert res.status_code == 200, res.text
    assert res.json()["report_email"] == "guest@example.com"


def test_회원이_따로_입력한_수신_이메일이_있으면_우선(client):
    email = f"member-{uuid4().hex[:8]}@test.com"
    host, _, report = _seed(client, member_email=email, guest_email="other@example.com")
    res = _get(client, host, report)
    assert res.json()["report_email"] == "other@example.com"


def test_개인정보_파기된_참여자는_비움(client):
    from datetime import datetime, timezone

    from app.models.session import SessionParticipant

    email = f"member-{uuid4().hex[:8]}@test.com"
    host, participant, report = _seed(client, member_email=email, guest_email=None)
    db = _db()
    row = db.get(SessionParticipant, participant)
    row.pii_scrubbed_at = datetime.now(timezone.utc)
    db.commit()
    res = _get(client, host, report)
    assert res.json()["report_email"] is None


def test_회원_리포트_승인시_계정_이메일로_자동_발송(client, monkeypatch):
    """회원도 이메일(아이디)로 리포트 메일을 받는다 — 승인 → 예약 → 계정 이메일로 발송."""
    from unittest.mock import Mock

    from app.models.record import Report
    from app.models.session import SessionParticipant
    from app.services import report_email_service, report_service

    email = f"Member-{uuid4().hex[:8]}@test.com"
    host, pid, rid = _seed(client, member_email=email, guest_email=None)
    db = _db()
    try:
        report = db.get(Report, rid)
        report.status = "pending_review"
        db.commit()
        sender = Mock(return_value=True)
        monkeypatch.setattr(report_email_service, "send_report_email", sender)
        monkeypatch.setattr(
            report_email_service, "enqueue_report_email", lambda r: report_email_service.deliver_report_email(r, db)
        )
        report_service.approve_report(str(rid), host["id"], db)
        participant = db.get(SessionParticipant, pid)
        db.refresh(participant)
        assert sender.call_count == 1
        assert sender.call_args.args[0] == email.lower()
        assert participant.report_email == email.lower()
        assert participant.report_email_sent_at is not None
    finally:
        db.close()


def test_리포트_제외한_회원에게는_발송_안함(client, monkeypatch):
    from unittest.mock import Mock

    from app.models.record import Report
    from app.models.session import SessionParticipant
    from app.services import report_email_service, report_service

    email = f"member-{uuid4().hex[:8]}@test.com"
    host, pid, rid = _seed(client, member_email=email, guest_email=None)
    db = _db()
    try:
        db.get(SessionParticipant, pid).report_included = False
        db.get(Report, rid).status = "pending_review"
        db.commit()
        sender = Mock(return_value=True)
        monkeypatch.setattr(report_email_service, "send_report_email", sender)
        monkeypatch.setattr(
            report_email_service, "enqueue_report_email", lambda r: report_email_service.deliver_report_email(r, db)
        )
        report_service.approve_report(str(rid), host["id"], db)
        sender.assert_not_called()
    finally:
        db.close()
