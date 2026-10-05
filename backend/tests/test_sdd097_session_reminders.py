"""SDD-097 — 클래스 예약 사전 안내(리마인더) QA

verify 시나리오:
- 예약 클래스에 리마인더 시점(reminder_offsets)을 저장/직렬화한다.
- 사전 안내 본문에 참여코드·준비물·브라우저 안내가 담긴다.
- ETA 발송 로직이 인앱+이메일로 보내고, 재실행 시 중복 발송하지 않는다.
- 취소/즉석 클래스는 발송하지 않는다.
- 워커 유실 대비 스윕이 누락분을 보정한다.
"""

from unittest.mock import patch

import pytest

from app.services import email_verify_service, reminder_service
from tests.conftest import create_test_org

VALID_PASSWORD = "Passw0rd!"


def _db():
    from app.core.database import SessionLocal

    return SessionLocal()


def _consents() -> dict:
    return {"tos": True, "privacy": True, "sensitive": True}


def _register(client, email: str, role: str = "counselor", org_code: str | None = None) -> dict:
    if role == "counselor":
        from tests.conftest import create_test_counselor

        created = create_test_counselor(
            email,
            name=f"상담사-{email.split('@')[0]}",
            org_code=org_code if org_code is not None else create_test_org(),
        )
        return {"id": created["id"], "h": {"Authorization": f"Bearer {created['access_token']}"}}

    payload = {
        "email": email,
        "password": VALID_PASSWORD,
        "name": f"회원-{email.split('@')[0]}",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": _consents(),
    }
    from tests.conftest import post_register

    res = post_register(client, role, payload)
    assert res.status_code == 201, res.text
    body = res.json()
    return {"id": body["user"]["id"], "h": {"Authorization": f"Bearer {body['access_token']}"}}


def _create_scheduled_class(client, host_headers, member_ids, *, offsets, minutes_from_now=200,
                            **overrides) -> dict:
    """예약 클래스 생성 — 리마인더 시점을 함께 지정한다."""
    from datetime import datetime, timedelta, timezone

    scheduled = datetime.now(timezone.utc) + timedelta(minutes=minutes_from_now)
    payload = {
        "type": "meditation",
        "duration_min": 30,
        "title": "저녁 명상 클래스",
        "scheduled_at": scheduled.isoformat(),
        "max_participants": 10,
        "participant_ids": member_ids,
        "reminder_offsets": offsets,
        "force": True,
    }
    payload.update(overrides)
    # SDD-101: eager 모드에서 ETA 예약 리마인더가 즉시 발송되지 않도록 스케줄 발행을 mock.
    # (테스트는 run_reminder 를 직접 호출해 발송/중복방지를 검증한다)
    with patch("app.tasks.report_email_task.notification_email_task.apply_async"), \
         patch("app.tasks.reminder_task.send_session_reminder_task.apply_async"):
        res = client.post("/api/v1/sessions", json=payload, headers=host_headers)
    assert res.status_code == 201, res.text
    return res.json()


# ── 1. 저장 · 직렬화 ──────────────────────────────────────────────


def test_예약클래스_리마인더시점_저장_직렬화(client):
    host = _register(client, "rem-host1@test.com")
    member = _register(client, "rem-mem1@test.com", role="client")

    created = _create_scheduled_class(
        client, host["h"], [member["id"]], offsets=[1440, 60]
    )
    assert created["reminder_offsets"] == [1440, 60]
    assert created["status"] == "scheduled"

    # DB 원본 확인
    import uuid

    from app.models.session import Session

    db = _db()
    try:
        row = db.query(Session).filter(Session.id == uuid.UUID(created["id"])).first()
        assert row is not None
        assert list(row.reminder_offsets) == [1440, 60]
    finally:
        db.close()


def test_리마인더시점_정규화_무효값제거(client):
    host = _register(client, "rem-host2@test.com")
    member = _register(client, "rem-mem2@test.com", role="client")

    created = _create_scheduled_class(
        client, host["h"], [member["id"]], offsets=[60, 1440, 1440, -5, 0, 999999]
    )
    # 5분~14일 범위 밖/중복은 제거되고 큰 간격 우선으로 정렬된다.
    assert created["reminder_offsets"] == [1440, 60]


def test_즉석클래스_리마인더시점_저장되나_일정없음(client):
    host = _register(client, "rem-host3@test.com")
    with patch("app.tasks.report_email_task.notification_email_task.apply_async"):
        res = client.post(
            "/api/v1/sessions",
            json={"type": "meditation", "duration_min": 30, "title": "즉석",
                  "reminder_offsets": [60]},
            headers=host["h"],
        )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "ready"
    assert body["reminder_offsets"] == [60]


# ── 2. 사전 안내 본문 ─────────────────────────────────────────────


def test_리마인더_본문에_참여코드_준비물_브라우저안내_포함(client):
    host = _register(client, "rem-host4@test.com")
    member = _register(client, "rem-mem4@test.com", role="client")
    created = _create_scheduled_class(
        client, host["h"], [member["id"]], offsets=[1440], linkband_mode="optional"
    )

    import uuid

    from app.models.session import Session

    db = _db()
    try:
        session = db.query(Session).filter(Session.id == uuid.UUID(created["id"])).first()
        assert session is not None
        msg = reminder_service.build_reminder_message(session, 1440)
    finally:
        db.close()

    body = msg["body_text"]
    assert created["access_code"] in body            # 참여코드
    assert "준비물" in body                            # 준비물 안내
    assert "조용" in body and "헤드셋" in body          # 조용한 공간·헤드셋
    assert "LINK BAND" in body                          # LINK BAND(선택)
    assert "Chrome" in body and "Edge" in body          # 브라우저 권장
    assert "Safari" in body and "Firefox" in body       # 미지원 안내
    assert created["access_code"] in msg["body_html"]
    assert "하루 전" in msg["subject"]


# ── 3. 발송 · 중복 방지 ───────────────────────────────────────────


def _run_reminder(session_id: str, offset_min: int) -> dict:
    db = _db()
    try:
        with patch("app.tasks.report_email_task.notification_email_task.apply_async"):
            return reminder_service.run_reminder(session_id, offset_min, db)
    finally:
        db.close()


def test_리마인더_발송_인앱이메일_그리고_중복방지(client):
    import uuid

    from app.models.notification_outbox import NotificationOutbox
    from app.models.session import SessionReminderLog

    host = _register(client, "rem-host5@test.com")
    member = _register(client, "rem-mem5@test.com", role="client")
    # FUNC-01: ETA(시작 60분 전)가 이미 도래한 클래스에서만 발송된다 — 시작까지 30분 남은 예약.
    created = _create_scheduled_class(
        client, host["h"], [member["id"]], offsets=[60], minutes_from_now=30
    )

    first = _run_reminder(created["id"], 60)
    assert first["status"] == "sent"
    assert first["recipients"] == 1
    assert first["delivered"] == 2  # ws + email

    db = _db()
    try:
        logs = db.query(SessionReminderLog).filter(
            SessionReminderLog.session_id == uuid.UUID(created["id"]),
            SessionReminderLog.offset_min == 60,
        ).all()
        assert {log.channel for log in logs} == {"ws", "email"}
        outbox = db.query(NotificationOutbox).filter(
            NotificationOutbox.user_id == uuid.UUID(member["id"]),
        ).all()
        assert any(o.channel == "email" for o in outbox)
        assert any(o.channel == "ws" for o in outbox)
    finally:
        db.close()

    # 같은 시점 재실행 → 중복 발송 차단
    second = _run_reminder(created["id"], 60)
    assert second["status"] == "duplicate"
    assert second["delivered"] == 0


def test_취소된_클래스는_발송하지_않는다(client):
    host = _register(client, "rem-host6@test.com")
    member = _register(client, "rem-mem6@test.com", role="client")
    created = _create_scheduled_class(client, host["h"], [member["id"]], offsets=[60])

    with patch("app.tasks.report_email_task.notification_email_task.apply_async"):
        res = client.post(f"/api/v1/sessions/{created['id']}/cancel", headers=host["h"])
    assert res.status_code == 200, res.text

    result = _run_reminder(created["id"], 60)
    assert result["status"] == "skipped"
    assert result["reason"] == "status_cancelled"


def test_스윕이_누락된_리마인더를_보정한다(client):
    """워커가 죽어 ETA 예약이 유실돼도, 시각이 지난 시점은 스윕이 발송한다."""
    host = _register(client, "rem-host7@test.com")
    member = _register(client, "rem-mem7@test.com", role="client")
    # 60분 뒤 시작 → offset 1440(하루 전)은 이미 발송 시각이 지났다.
    created = _create_scheduled_class(
        client, host["h"], [member["id"]], offsets=[1440], minutes_from_now=60
    )

    from app.tasks.reminder_task import sweep_session_reminders

    with patch("app.tasks.report_email_task.notification_email_task.apply_async"):
        summary = sweep_session_reminders()
    assert summary["dispatched"] >= 1

    import uuid

    from app.models.session import SessionReminderLog

    db = _db()
    try:
        logs = db.query(SessionReminderLog).filter(
            SessionReminderLog.session_id == uuid.UUID(created["id"]),
        ).all()
        assert logs, "스윕이 발송 로그를 남겨야 함"
    finally:
        db.close()


# ── 4. 수정 시 재예약 ────────────────────────────────────────────


def test_update_리마인더시점_재설정(client):
    host = _register(client, "rem-host8@test.com")
    member = _register(client, "rem-mem8@test.com", role="client")
    created = _create_scheduled_class(client, host["h"], [member["id"]], offsets=[1440])

    with patch("app.tasks.reminder_task.send_session_reminder_task.apply_async"), \
         patch("app.tasks.report_email_task.notification_email_task.apply_async"):
        res = client.put(
            f"/api/v1/sessions/{created['id']}",
            json={"reminder_offsets": [60]},
            headers=host["h"],
        )
    assert res.status_code == 200, res.text
    assert res.json()["reminder_offsets"] == [60]


def test_일정_과거면_eta_예약하지_않는다(client):
    """발송 시각이 이미 지난 시점은 ETA 로 예약하지 않는다(스윕 몫)."""
    host = _register(client, "rem-host9@test.com")
    member = _register(client, "rem-mem9@test.com", role="client")
    created = _create_scheduled_class(
        client, host["h"], [member["id"]], offsets=[1440], minutes_from_now=30
    )
    import uuid

    from app.models.session import Session

    db = _db()
    try:
        session = db.query(Session).filter(Session.id == uuid.UUID(created["id"])).first()
        assert session is not None
        jobs = reminder_service.schedule_session_reminders(session, db)
    finally:
        db.close()
    assert jobs == []


# ── 5. FUNC-01: 무효화 · 시점 검증 ───────────────────────────────


def test_run_reminder_아직_도래하지_않은_시점은_skip(client):
    """예정 시각(EtA)이 지나지 않은 offset 은 발송하지 않는다(옛 ETA 태스크 방어)."""
    host = _register(client, "rem-host10@test.com")
    member = _register(client, "rem-mem10@test.com", role="client")
    # 시작 200분 뒤 → offset 60(EtA = 140분 뒤)은 아직 도래하지 않음
    created = _create_scheduled_class(client, host["h"], [member["id"]], offsets=[60])

    result = _run_reminder(created["id"], 60)
    assert result["status"] == "skipped"
    assert result["reason"] == "not_due"


def test_run_reminder_예약에_없는_시점은_skip(client):
    """현재 reminder_offsets 에 없는 시점은 발송하지 않는다(해제된 시점 방어)."""
    host = _register(client, "rem-host11@test.com")
    member = _register(client, "rem-mem11@test.com", role="client")
    created = _create_scheduled_class(
        client, host["h"], [member["id"]], offsets=[60], minutes_from_now=30
    )

    result = _run_reminder(created["id"], 1440)
    assert result["status"] == "skipped"
    assert result["reason"] == "offset_not_scheduled"


def test_update_일정변경시_옛_ETA_revoke_후_재예약(client, monkeypatch):
    """일정이 바뀌면 옛 일정 기준 ETA task_id 를 취소하고 새로 예약한다."""
    host = _register(client, "rem-host12@test.com")
    member = _register(client, "rem-mem12@test.com", role="client")
    created = _create_scheduled_class(client, host["h"], [member["id"]], offsets=[1440])

    calls: list[dict] = []
    monkeypatch.setattr(
        reminder_service,
        "revoke_session_reminders",
        lambda session_id, offsets, scheduled_at: calls.append(
            {"offsets": list(offsets), "scheduled_at": scheduled_at}
        ),
    )

    import uuid

    from app.models.session import Session

    from datetime import datetime, timedelta, timezone

    db = _db()
    try:
        session = db.query(Session).filter(Session.id == uuid.UUID(created["id"])).first()
        assert session is not None
    finally:
        db.close()

    new_scheduled = datetime.now(timezone.utc) + timedelta(hours=5)
    with patch("app.tasks.reminder_task.send_session_reminder_task.apply_async"), \
         patch("app.tasks.report_email_task.notification_email_task.apply_async"):
        res = client.put(
            f"/api/v1/sessions/{created['id']}",
            json={"scheduled_at": new_scheduled.isoformat()},
            headers=host["h"],
        )
    assert res.status_code == 200, res.text
    assert len(calls) == 1
    assert calls[0]["offsets"] == [1440]
    assert calls[0]["scheduled_at"] is not None


def test_update_시점제거시_제거된_시점만_revoke(client, monkeypatch):
    """일정이 그대로면 제거된 시점의 옛 ETA 만 취소한다(남은 시점은 유지)."""
    host = _register(client, "rem-host13@test.com")
    member = _register(client, "rem-mem13@test.com", role="client")
    created = _create_scheduled_class(
        client, host["h"], [member["id"]], offsets=[1440, 60]
    )

    calls: list[list] = []
    monkeypatch.setattr(
        reminder_service,
        "revoke_session_reminders",
        lambda session_id, offsets, scheduled_at: calls.append(list(offsets)),
    )

    with patch("app.tasks.reminder_task.send_session_reminder_task.apply_async"), \
         patch("app.tasks.report_email_task.notification_email_task.apply_async"):
        res = client.put(
            f"/api/v1/sessions/{created['id']}",
            json={"reminder_offsets": [60]},
            headers=host["h"],
        )
    assert res.status_code == 200, res.text
    assert calls == [[1440]]
