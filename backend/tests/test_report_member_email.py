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
