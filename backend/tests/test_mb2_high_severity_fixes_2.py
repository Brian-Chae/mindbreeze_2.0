"""MB2 상(上) 기능 오류 3건 회귀 테스트 (2차).

[1] REC-PRIV-001 — 기록지/전사문 조회가 비host(참여자)에게 상담사 내부 메모·
    세션 전체 전사문·AI 요약을 노출하지 않는다(본인 슬롯만). 호스트는 전체 열람.
[2] SEC-LIVEKIT-PUBLISH-BYPASS — POST /sessions/{id}/livekit-token 은 host 전용.
    참여자에게 can_publish=True 토큰을 발급해 SDD-094 발언권 게이트를 우회하지 못하게 한다.
[3] RPT-EMAIL-SEND-002 — 승인(completed 전이) 시 신청된 내담자 리포트 메일을 (재)예약한다.
"""

from uuid import UUID, uuid4
from unittest.mock import Mock

from tests.test_sdd015_class_code import _create_class, _db, _register


# ─────────────────────────────────────────────────────────────────────────────
# [1] REC-PRIV-001
# ─────────────────────────────────────────────────────────────────────────────


def _seed_record_with_secrets(client):
    """호스트 + 참여자 2명 + 비밀 필드가 든 SessionRecord 를 준비한다."""
    from app.models.record import SessionRecord
    from app.models.session import SessionParticipant

    host = _register(client, "recpriv-host@test.com")
    member = _register(client, "recpriv-self@test.com", role="client")
    other = _register(client, "recpriv-other@test.com", role="client")
    sid = _create_class(client, host["h"])["id"]

    db = _db()
    try:
        p_self = SessionParticipant(session_id=UUID(sid), user_id=UUID(member["id"]))
        p_other = SessionParticipant(session_id=UUID(sid), user_id=UUID(other["id"]))
        db.add_all([p_self, p_other])
        db.flush()
        db.add(
            SessionRecord(
                session_id=UUID(sid),
                status="completed",
                transcript="상담사-내담자 전체 전사문",
                ai_summary={
                    "summary": "세션 전체 AI 요약",
                    "segments": [{"speaker": "그룹", "text": "타 참여자 비밀 발화", "start": 0.0, "end": 1.0}],
                },
                counselor_notes="상담사 내부 메모",
                markers=[],
                edit_history=[],
                subjective_state={
                    "participants": {
                        str(p_self.id): {
                            "after": {"arousal": 3, "valence": 4, "emotion": 2, "note": "내 소감",
                                      "recorded_at": "2026-01-01T00:00:00+00:00"}
                        },
                        str(p_other.id): {
                            "after": {"arousal": 1, "valence": 1, "emotion": 1, "note": "타인 소감",
                                      "recorded_at": "2026-01-01T00:00:00+00:00"}
                        },
                    }
                },
            )
        )
        db.commit()
    finally:
        db.close()
    return host, member, sid


def test_rec_priv_001_참여자_기록지_내부필드_미노출(client):
    host, member, sid = _seed_record_with_secrets(client)

    res = client.get(f"/api/v1/sessions/{sid}/record", headers=member["h"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["counselor_notes"] is None
    assert body["transcript"] is None
    assert body["ai_summary"] == {}
    # 본인 슬롯만 노출 — 타 참여자 소감은 응답 어디에도 없다
    assert body["subjective_state"]["scope"] == "participant"
    assert "타인 소감" not in res.text
    assert "내 소감" in res.text


def test_rec_priv_001_호스트_기록지_전체열람(client):
    host, member, sid = _seed_record_with_secrets(client)

    res = client.get(f"/api/v1/sessions/{sid}/record", headers=host["h"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["counselor_notes"] == "상담사 내부 메모"
    assert body["transcript"] == "상담사-내담자 전체 전사문"
    assert body["ai_summary"]["summary"] == "세션 전체 AI 요약"


def test_rec_priv_001_참여자_전사문_미노출(client):
    host, member, sid = _seed_record_with_secrets(client)

    res = client.get(f"/api/v1/sessions/{sid}/transcript", headers=member["h"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["raw_text"] is None
    assert body["segments"] == []
    assert "비밀 발화" not in res.text


def test_rec_priv_001_호스트_전사문_열람(client):
    host, member, sid = _seed_record_with_secrets(client)

    res = client.get(f"/api/v1/sessions/{sid}/transcript", headers=host["h"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["raw_text"] == "상담사-내담자 전체 전사문"
    assert len(body["segments"]) == 1


# ─────────────────────────────────────────────────────────────────────────────
# [2] SEC-LIVEKIT-PUBLISH-BYPASS
# ─────────────────────────────────────────────────────────────────────────────


def _start_online_class(client, counselor, **overrides):
    from tests.test_member_livekit_token import _set_room_id, _start_online_class as _start

    cls = _start(client, counselor, **overrides)
    _set_room_id(cls, uuid4())
    return cls


def test_sec_livekit_publish_bypass_호스트_200(client):
    counselor = _register(client, "seclk-host@test.com")
    cls = _start_online_class(client, counselor)

    res = client.post(f"/api/v1/sessions/{cls['id']}/livekit-token", headers=counselor["h"])
    assert res.status_code == 200, res.text
    assert res.json()["livekit_token"]


def test_sec_livekit_publish_bypass_참여자_403(client):
    counselor = _register(client, "seclk-p-host@test.com")
    member = _register(client, "seclk-member@test.com", role="client")
    cls = _start_online_class(client, counselor, max_participants=10)

    joined = client.post(
        f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={}, headers=member["h"]
    )
    assert joined.status_code == 200, joined.text

    # 비host 참여자 → host 전용 엔드포인트 차단(403). can_publish=True 우회 불가.
    res = client.post(f"/api/v1/sessions/{cls['id']}/livekit-token", headers=member["h"])
    assert res.status_code == 403


def test_sec_livekit_publish_bypass_비참여자_403(client):
    counselor = _register(client, "seclk-x-host@test.com")
    stranger = _register(client, "seclk-stranger@test.com", role="client")
    cls = _start_online_class(client, counselor)

    res = client.post(f"/api/v1/sessions/{cls['id']}/livekit-token", headers=stranger["h"])
    assert res.status_code == 403


# ─────────────────────────────────────────────────────────────────────────────
# [3] RPT-EMAIL-SEND-002
# ─────────────────────────────────────────────────────────────────────────────


def _seed_client_report(client, *, report_email: str | None = "client@example.com", status="pending_review"):
    from app.models.record import Report
    from app.models.session import Session, SessionParticipant
    from tests.conftest import create_test_counselor

    host = create_test_counselor(f"rpt002-{uuid4().hex[:8]}@test.com")
    db = _db()
    session = Session(host_id=UUID(host["id"]), type="meditation", status="completed", duration_min=10)
    db.add(session)
    db.flush()
    participant = SessionParticipant(
        session_id=session.id, guest_name="내담자", report_email=report_email
    )
    db.add(participant)
    db.flush()
    report = Report(
        session_id=session.id,
        participant_id=participant.id,
        type="client",
        content={},
        status=status,
    )
    db.add(report)
    db.commit()
    return db, host, session, participant, report


def test_rpt_email_send_002_승인시_내담자_메일_발송(client, monkeypatch):
    """승인으로 completed 전이 → 메일 재예약 → 워커가 실제 발송까지 이어진다."""
    from app.services import report_email_service, report_service

    db, host, session, participant, report = _seed_client_report(client)
    try:
        sender = Mock(return_value=True)
        monkeypatch.setattr(report_email_service, "send_report_email", sender)

        enqueued = {}

        def _enqueue_and_deliver(rid):
            enqueued["report_id"] = rid
            report_email_service.deliver_report_email(rid, db)

        monkeypatch.setattr(report_email_service, "enqueue_report_email", _enqueue_and_deliver)

        report_service.approve_report(str(report.id), host["id"], db)

        assert report.status == "completed"
        assert enqueued.get("report_id") == str(report.id)
        db.refresh(participant)
        assert participant.report_email_sent_at is not None
        assert sender.call_count == 1
        assert sender.call_args.args[0] == "client@example.com"
    finally:
        db.close()


def test_rpt_email_send_002_미신청_참여자는_예약안함(client, monkeypatch):
    from app.services import report_email_service, report_service

    db, host, session, participant, report = _seed_client_report(client, report_email=None)
    try:
        enqueue = Mock()
        monkeypatch.setattr(report_email_service, "enqueue_report_email", enqueue)
        report_service.approve_report(str(report.id), host["id"], db)
        assert report.status == "completed"
        enqueue.assert_not_called()
    finally:
        db.close()


def test_rpt_email_send_002_재승인은_중복예약안함(client, monkeypatch):
    from app.services import report_email_service, report_service

    db, host, session, participant, report = _seed_client_report(client, status="completed")
    try:
        enqueue = Mock()
        monkeypatch.setattr(report_email_service, "enqueue_report_email", enqueue)
        report_service.approve_report(str(report.id), host["id"], db)
        assert report.status == "completed"
        enqueue.assert_not_called()
    finally:
        db.close()
