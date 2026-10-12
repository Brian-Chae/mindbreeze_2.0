"""FUNC-02/03/04/06 회귀 테스트.

- FUNC-02: client 리포트는 participant_id 를 명시해야 하고(미지정 400), 요청한 참가자에
  정확히 귀속된다(first_participant 오귀속·다른 참가자 리포트 재사용 방지).
- FUNC-03: 정원이 찬 클래스에 새로 참여하면 대기열에 등록된다.
- FUNC-04: 비동기 리포트 생성 완료 시 신청된 내담자에게 메일 발송이 예약된다.
- FUNC-06: _build_eeg_content 는 참여자 지정 시 해당 참여자만, session_wide=True 면 세션 전체를 집계한다.
"""

from unittest.mock import Mock
from uuid import UUID, uuid4

from app.core.database import get_db
from app.main import app
from app.models.record import Report
from app.models.session import SessionParticipant
from app.services import email_verify_service

VALID_PASSWORD = "Passw0rd!"


def _db():
    return next(app.dependency_overrides[get_db]())


def _register(client, email: str, role: str = "counselor") -> dict:
    from tests.conftest import create_test_org, post_register

    payload = {
        "email": email,
        "password": VALID_PASSWORD,
        "name": "테스트",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": {"tos": True, "privacy": True, "sensitive": True},
    }
    if role == "counselor":
        payload["org_code"] = create_test_org()
    res = post_register(client, role, payload)
    assert res.status_code == 201, res.text
    body = res.json()
    token = body.get("access_token") or body.get("tokens", {}).get("access_token")
    return {"id": body["user"]["id"], "h": {"Authorization": f"Bearer {token}"}}


def _create_session(client, host, **overrides) -> str:
    payload = {"type": "clinical", "duration_min": 50, "title": "FUNC 테스트"}
    payload.update(overrides)
    res = client.post("/api/v1/sessions", json=payload, headers=host["h"])
    assert res.status_code == 201, res.text
    sid = res.json()["id"]
    started = client.post(f"/api/v1/sessions/{sid}/start", headers=host["h"])
    assert started.status_code == 200, started.text
    return sid


# ── FUNC-02 ──────────────────────────────────────────────────────────


def test_func02_client_report_requires_participant_id(client):
    host = _register(client, "func02a@test.com")
    sid = _create_session(client, host)
    res = client.post(
        f"/api/v1/reports/generate/{sid}", json={"type": "client"}, headers=host["h"]
    )
    assert res.status_code == 400, res.text


def test_func02_client_report_targets_requested_participant(client):
    host = _register(client, "func02b@test.com")
    sid = _create_session(client, host)
    db = _db()
    try:
        p1 = SessionParticipant(session_id=UUID(sid), guest_name="첫째")
        p2 = SessionParticipant(session_id=UUID(sid), guest_name="둘째")
        db.add_all([p1, p2])
        db.commit()
        p1_id, p2_id = str(p1.id), str(p2.id)
    finally:
        db.close()

    res2 = client.post(
        f"/api/v1/reports/generate/{sid}",
        json={"type": "client", "participant_id": p2_id},
        headers=host["h"],
    )
    assert res2.status_code == 200, res2.text
    body2 = res2.json()
    # first_participant(p1) 가 아니라 요청한 p2 에 귀속된다.
    assert body2["participant_id"] == p2_id

    res1 = client.post(
        f"/api/v1/reports/generate/{sid}",
        json={"type": "client", "participant_id": p1_id},
        headers=host["h"],
    )
    assert res1.status_code == 200, res1.text
    # 참가자별로 별도 리포트 — 서로 재사용하지 않는다.
    assert res1.json()["id"] != body2["id"]
    assert res1.json()["participant_id"] == p1_id


def test_func02_client_report_unknown_participant_404(client):
    host = _register(client, "func02c@test.com")
    sid = _create_session(client, host)
    res = client.post(
        f"/api/v1/reports/generate/{sid}",
        json={"type": "client", "participant_id": str(uuid4())},
        headers=host["h"],
    )
    assert res.status_code == 404, res.text


# ── FUNC-03 ──────────────────────────────────────────────────────────


def test_func03_new_joiner_over_capacity_is_waitlisted(client):
    host = _register(client, "func03@test.com")
    res = client.post(
        "/api/v1/sessions",
        json={"type": "meditation", "duration_min": 30, "participant_mode": "group",
              "max_participants": 1, "title": "정원 테스트"},
        headers=host["h"],
    )
    assert res.status_code == 201, res.text
    cls = res.json()
    opened = client.post(f"/api/v1/sessions/{cls['id']}/open", headers=host["h"])
    assert opened.status_code == 200, opened.text

    first = client.post(
        f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={"name": "먼저온게스트"}
    )
    assert first.status_code == 200, first.text

    member = _register(client, "func03-m@test.com", role="client")
    joined = client.post(
        f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={}, headers=member["h"]
    )
    assert joined.status_code == 200, joined.text

    detail = client.get(f"/api/v1/sessions/{cls['id']}", headers=host["h"]).json()
    row = next(p for p in detail["participants"] if p["user_id"] == member["id"])
    assert row["is_waitlisted"] is True
    assert row["waitlist_position"] == 1


# ── FUNC-04 ──────────────────────────────────────────────────────────


def test_func04_completion_enqueues_report_email(client, monkeypatch):
    from app.services import report_email_service
    from app.tasks import report_task as rt

    host = _register(client, "func04@test.com")
    sid = _create_session(client, host)
    db = _db()
    try:
        participant = SessionParticipant(
            session_id=UUID(sid), guest_name="내담자", report_email="guest@example.com"
        )
        db.add(participant)
        db.commit()
        report = Report(
            session_id=UUID(sid), participant_id=participant.id, user_id=None,
            type="client", status="pending_analysis", content={},
        )
        db.add(report)
        db.commit()
        report_id = str(report.id)

        called: list[str] = []
        monkeypatch.setattr(
            report_email_service, "enqueue_report_email", lambda rid: called.append(rid)
        )
        rt.generate_report_inline(report_id, db)
        db.refresh(report)
        assert report.status == "pending_review"
        assert called == [report_id]
    finally:
        db.close()


def test_func04_no_email_without_report_email(client, monkeypatch):
    from app.services import report_email_service
    from app.tasks import report_task as rt

    host = _register(client, "func04b@test.com")
    sid = _create_session(client, host)
    db = _db()
    try:
        participant = SessionParticipant(session_id=UUID(sid), guest_name="내담자")
        db.add(participant)
        db.commit()
        report = Report(
            session_id=UUID(sid), participant_id=participant.id, user_id=None,
            type="client", status="pending_analysis", content={},
        )
        db.add(report)
        db.commit()
        report_id = str(report.id)

        enqueue = Mock()
        monkeypatch.setattr(report_email_service, "enqueue_report_email", enqueue)
        rt.generate_report_inline(report_id, db)
        enqueue.assert_not_called()
    finally:
        db.close()


# ── FUNC-06 ──────────────────────────────────────────────────────────


def test_func06_eeg_scoped_to_participant_and_session_wide_flag(client):
    from app.models.eeg_feature import EEGFeatureWindow
    from app.tasks.report_task import _build_eeg_content

    host = _register(client, "func06@test.com")
    sid = _create_session(client, host)
    db = _db()
    try:
        p1, p2 = uuid4(), uuid4()
        db.add(EEGFeatureWindow(
            session_id=UUID(sid), participant_id=p1, window_index=0,
            quality="valid", relaxation_index=0.9,
        ))
        db.add(EEGFeatureWindow(
            session_id=UUID(sid), participant_id=p2, window_index=1,
            quality="valid", relaxation_index=0.1,
        ))
        db.commit()

        scoped = _build_eeg_content(UUID(sid), db, p1)
        assert len(scoped["timeline"]) == 1
        # 참여자 미지정 + session_wide 명시 → 세션 전체 집계
        wide = _build_eeg_content(UUID(sid), db, None, session_wide=True)
        assert len(wide["timeline"]) == 2
    finally:
        db.close()
