"""SDD-086 — 세션 종료 시 리포트 2종류(counselor + client) 자동 생성 QA

specs/086-auto-report-generation/spec.md 기반:
- 세션 종료 시 counselor 리포트 + 각 내담자(client) 리포트 자동 생성
- client 리포트는 participant별 (게스트 user_id None 허용, 대기열 제외)
- 멱등: 재호출 시 중복 생성 없음 (existing 체크)
- 마이크 오프 세션: ai_record not_available/mic_off + 몸·마음(eeg) 블록 정상 포함
- 기존 report_email(리포트 신청) 플로우와 충돌 없음 (동일 리포트 재사용)
"""

from uuid import UUID

from app.core.database import get_db
from app.main import app
from app.models.record import Report
from app.models.session import SessionParticipant

from tests.test_audio_record import _register, _create_session, _upload_chunk


def _db():
    provider = app.dependency_overrides[get_db]()
    return next(provider)


def _add_participant(db, sid: str, user_id=None, guest_name=None, is_waitlisted=False):
    participant = SessionParticipant(
        session_id=UUID(sid),
        user_id=UUID(user_id) if user_id else None,
        guest_name=guest_name,
        is_waitlisted=is_waitlisted,
    )
    db.add(participant)
    db.commit()
    return participant


def _reports(db, sid: str) -> list[Report]:
    return db.query(Report).filter(Report.session_id == UUID(sid)).all()


def test_01_세션종료시_counselor_리포트_자동생성(client):
    host = _register(client, "sdd086a@test.com")
    sid = _create_session(client, host)

    r = client.post(f"/api/v1/sessions/{sid}/end", headers=host["auth"])
    assert r.status_code == 200, r.text

    db = _db()
    counselor_reports = [rp for rp in _reports(db, sid) if rp.type == "counselor"]
    assert len(counselor_reports) == 1
    report = counselor_reports[0]
    # 분석 완료 → 승인 게이트(pending_review) 진입 (auto_approve OFF 기본값)
    assert report.status == "pending_review"
    assert report.user_id == UUID(host["id"])


def test_02_세션종료시_participant별_client_리포트_자동생성(client):
    host = _register(client, "sdd086b@test.com")
    member = _register(client, "sdd086b-member@test.com", role="client")
    sid = _create_session(client, host)

    db = _db()
    p_member = _add_participant(db, sid, user_id=member["id"])
    p_guest = _add_participant(db, sid, guest_name="게스트")

    r = client.post(f"/api/v1/sessions/{sid}/end", headers=host["auth"])
    assert r.status_code == 200, r.text

    db.expire_all()
    client_reports = [rp for rp in _reports(db, sid) if rp.type == "client"]
    assert len(client_reports) == 2
    by_participant = {rp.participant_id: rp for rp in client_reports}
    # 회원 participant → user_id 소유
    assert by_participant[p_member.id].user_id == UUID(member["id"])
    # 게스트 participant → user_id None, participant_id 로 소유 (SDD-027)
    assert by_participant[p_guest.id].user_id is None
    # 승인/발송 정책: client 리포트는 상담사 승인 대기 (pending_review)
    assert all(rp.status == "pending_review" for rp in client_reports)


def test_03_대기열_participant는_리포트_생성_제외(client):
    host = _register(client, "sdd086c@test.com")
    sid = _create_session(client, host)

    db = _db()
    _add_participant(db, sid, guest_name="참여자")
    p_wait = _add_participant(db, sid, guest_name="대기자", is_waitlisted=True)

    client.post(f"/api/v1/sessions/{sid}/end", headers=host["auth"])

    db.expire_all()
    client_reports = [rp for rp in _reports(db, sid) if rp.type == "client"]
    assert len(client_reports) == 1
    assert client_reports[0].participant_id != p_wait.id


def test_04_재호출시_중복생성_없음_멱등(client):
    from app.services import report_service

    host = _register(client, "sdd086d@test.com")
    sid = _create_session(client, host)

    db = _db()
    _add_participant(db, sid, guest_name="게스트")

    client.post(f"/api/v1/sessions/{sid}/end", headers=host["auth"])

    db.expire_all()
    before = {rp.id for rp in _reports(db, sid)}
    assert len(before) == 2  # counselor 1 + client 1

    # 재호출(세션 재종료/트리거 재실행 시나리오) → 기존 리포트 재사용, 신규 생성 없음
    report_service.generate_client_reports_for_session(sid, db)
    report_service.generate_report(sid, host["id"], "counselor", db)

    db.expire_all()
    after = {rp.id for rp in _reports(db, sid)}
    assert after == before


def test_05_마이크오프_세션도_리포트_자동생성_ai_record_mic_off(client):
    host = _register(client, "sdd086e@test.com")
    sid = _create_session(client, host)

    db = _db()
    _add_participant(db, sid, guest_name="게스트")

    # 마이크 오프(수동 기록 모드) 선언 후 종료
    res = client.post(
        f"/api/v1/sessions/{sid}/audio/start",
        json={"consent_audio": False},
        headers=host["auth"],
    )
    assert res.status_code == 200 and res.json()["status"] == "manual"
    client.post(f"/api/v1/sessions/{sid}/end", headers=host["auth"])

    db.expire_all()
    reports = {rp.type: rp for rp in _reports(db, sid)}
    assert set(reports) == {"counselor", "client"}
    for rp in reports.values():
        # AI 기록(전사·요약) 제외 — mic_off 사유 계약 (SDD-085)
        assert rp.content["ai_record"] == {"status": "not_available", "reason": "mic_off"}
        # 몸·마음(EEG/PPG/ACC) 블록은 정상 생성 — 미측정이면 not_measured (회귀 없음)
        assert rp.content["eeg"] == {"status": "not_measured"}
        assert rp.status == "pending_review"


def test_06_마이크온_세션_counselor_리포트_ai_record_available(client):
    host = _register(client, "sdd086f@test.com")
    sid = _create_session(client, host)
    client.post(
        f"/api/v1/sessions/{sid}/audio/start",
        json={"consent_audio": True},
        headers=host["auth"],
    )
    _upload_chunk(client, sid, host)

    client.post(f"/api/v1/sessions/{sid}/end", headers=host["auth"])

    db = _db()
    reports = {rp.type: rp for rp in _reports(db, sid)}
    assert reports["counselor"].content["ai_record"] == {"status": "available"}


def test_07_자동승인_ON이면_client_리포트_생성직후_completed(client):
    host = _register(client, "sdd086g@test.com")
    res = client.patch(
        "/api/v1/reports/auto-approve",
        json={"enabled": True},
        headers=host["auth"],
    )
    assert res.status_code == 200, res.text

    sid = _create_session(client, host)
    db = _db()
    _add_participant(db, sid, guest_name="게스트")

    client.post(f"/api/v1/sessions/{sid}/end", headers=host["auth"])

    db.expire_all()
    reports = {rp.type: rp for rp in _reports(db, sid)}
    assert reports["counselor"].status == "completed"
    assert reports["client"].status == "completed"


def test_08_자동생성된_리포트와_리포트신청_플로우_충돌없음(client):
    from app.services.report_email_service import participant_token
    from app.services.email_verify_service import generate_email_verify_token

    host = _register(client, "sdd086h@test.com")
    sid = _create_session(client, host)

    db = _db()
    participant = _add_participant(db, sid, guest_name="게스트")

    client.post(f"/api/v1/sessions/{sid}/end", headers=host["auth"])

    db.expire_all()
    auto_report = (
        db.query(Report)
        .filter(Report.session_id == UUID(sid), Report.type == "client")
        .one()
    )

    # 내담자가 완료 화면에서 리포트 신청 → 자동 생성된 리포트를 재사용해야 한다
    body = {
        "participant_id": str(participant.id),
        "participant_token": participant_token(participant),
        "email": "guest86@example.com",
        "email_verify_token": generate_email_verify_token("guest86@example.com"),
    }
    res = client.post(f"/api/v1/sessions/{sid}/report-email", json=body)
    assert res.status_code == 202, res.text
    assert res.json()["status"] == "pending_review"

    db.expire_all()
    client_reports = (
        db.query(Report)
        .filter(Report.session_id == UUID(sid), Report.type == "client")
        .all()
    )
    assert len(client_reports) == 1
    assert client_reports[0].id == auto_report.id
