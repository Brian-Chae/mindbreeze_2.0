"""SDD-188 테스트 공용 헬퍼 — 상담사/내담자 계정, 1:1 예약 세션, 리포트 생성.

파일명이 test_ 로 시작하지 않으므로 pytest 수집 대상이 아니다.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

VALID_PASSWORD = "Passw0rd!"


def db():
    from app.core.database import SessionLocal

    return SessionLocal()


def register_counselor(email: str, *, name: str = "김상담", org_code: str | None = None) -> dict:
    from tests.conftest import create_test_counselor, create_test_org

    created = create_test_counselor(
        email, name=name, org_code=org_code if org_code is not None else create_test_org()
    )
    return {
        "id": created["id"],
        "h": {"Authorization": f"Bearer {created['access_token']}"},
    }


def register_client(client, email: str, *, name: str = "박내담") -> dict:
    from app.services import email_verify_service
    from tests.conftest import post_register

    payload = {
        "email": email,
        "password": VALID_PASSWORD,
        "name": name,
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": {"tos": True, "privacy": True, "sensitive": True},
    }
    res = post_register(client, "client", payload)
    assert res.status_code == 201, res.text
    body = res.json()
    return {
        "id": body["user"]["id"],
        "h": {"Authorization": f"Bearer {body['access_token']}"},
    }


def create_session(
    client,
    host_headers: dict,
    member_ids: list[str],
    *,
    minutes_from_now: int = 200,
    **overrides,
) -> dict:
    """1:1 예약 세션 생성. ETA 리마인더 발행은 mock 으로 막는다(SDD-097 경로 격리)."""
    scheduled = datetime.now(timezone.utc) + timedelta(minutes=minutes_from_now)
    payload = {
        "type": "clinical",
        "duration_min": 50,
        "title": "정기 상담",
        "scheduled_at": scheduled.isoformat(),
        "max_participants": 1,
        "participant_mode": "one_on_one",
        "location_type": "offline",
        "participant_ids": member_ids,
        "reminder_offsets": [],
        "force": True,
    }
    payload.update(overrides)
    with patch("app.tasks.reminder_task.send_session_reminder_task.apply_async"):
        res = client.post("/api/v1/sessions", json=payload, headers=host_headers)
    assert res.status_code == 201, res.text
    return res.json()


def agree_consent(client, headers: dict) -> dict:
    res = client.post("/api/v1/agent/consent", json={"agreed": True}, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


def set_scheduled_at(session_id: str, when: datetime) -> None:
    """일정 변경을 DB 직접 반영(수정 API 의 충돌·과거 검증을 우회)."""
    from app.models.session import Session as SessionModel

    conn = db()
    try:
        s = conn.get(SessionModel, _uuid(session_id))
        s.scheduled_at = when
        conn.commit()
    finally:
        conn.close()


def set_session_status(session_id: str, status: str) -> None:
    from app.models.session import Session as SessionModel

    conn = db()
    try:
        s = conn.get(SessionModel, _uuid(session_id))
        s.status = status
        conn.commit()
    finally:
        conn.close()


def create_report(
    session_id: str,
    *,
    user_id: str | None,
    participant_id: str | None = None,
    report_type: str = "client",
    status: str = "pending_review",
    content: dict | None = None,
) -> str:
    """리포트 행 직접 생성 — 승인 훅/정책 경계 검증용."""
    from app.models.record import Report

    conn = db()
    try:
        report = Report(
            session_id=_uuid(session_id),
            user_id=_uuid(user_id) if user_id else None,
            participant_id=_uuid(participant_id) if participant_id else None,
            type=report_type,
            status=status,
            content=content if content is not None else {"headline": "기본 본문"},
        )
        conn.add(report)
        conn.commit()
        conn.refresh(report)
        return str(report.id)
    finally:
        conn.close()


def participant_id_of(session: dict, user_id: str) -> str:
    for part in session.get("participants") or []:
        if part.get("user_id") == user_id:
            return part["participant_id"]
    raise AssertionError("참여자를 찾을 수 없습니다")


def run_sweep(now: datetime | None = None) -> dict:
    from app.services import agent_reminder

    conn = db()
    try:
        return agent_reminder.sweep(conn, now=now)
    finally:
        conn.close()


def messages_of(user_id: str, *, kind: str | None = None) -> list:
    from app.models.agent import AgentConversation, AgentMessage

    conn = db()
    try:
        conversation = (
            conn.query(AgentConversation)
            .filter(
                AgentConversation.user_id == _uuid(user_id),
                AgentConversation.channel == "client",
            )
            .first()
        )
        if conversation is None:
            return []
        query = conn.query(AgentMessage).filter(
            AgentMessage.conversation_id == conversation.id
        )
        if kind is not None:
            query = query.filter(AgentMessage.kind == kind)
        rows = query.order_by(AgentMessage.created_at.asc()).all()
        # 세션 종료 후에도 쓸 수 있도록 값만 떼어 돌려준다.
        return [
            {
                "id": str(m.id),
                "sender": m.sender,
                "kind": m.kind,
                "content": m.content,
                "cta": list(m.cta or []),
                "ref_type": m.ref_type,
                "ref_id": str(m.ref_id) if m.ref_id else None,
            }
            for m in rows
        ]
    finally:
        conn.close()


def relay_events(kind: str | None = None) -> list[dict]:
    from app.models.agent import AgentRelayEvent

    conn = db()
    try:
        query = conn.query(AgentRelayEvent)
        if kind is not None:
            query = query.filter(AgentRelayEvent.kind == kind)
        rows = query.order_by(AgentRelayEvent.created_at.asc()).all()
        return [
            {
                "kind": e.kind,
                "source_user_id": str(e.source_user_id),
                "target_user_id": str(e.target_user_id) if e.target_user_id else None,
                "session_id": str(e.session_id) if e.session_id else None,
                "payload": dict(e.payload or {}),
                "status": e.status,
            }
            for e in rows
        ]
    finally:
        conn.close()


def delivery_logs(kind: str | None = None) -> list[dict]:
    from app.models.agent import AgentDeliveryLog

    conn = db()
    try:
        query = conn.query(AgentDeliveryLog)
        if kind is not None:
            query = query.filter(AgentDeliveryLog.kind == kind)
        rows = query.all()
        return [
            {"kind": r.kind, "ref_id": str(r.ref_id), "offset_min": r.offset_min}
            for r in rows
        ]
    finally:
        conn.close()


def outbox_rows(channel: str) -> list[dict]:
    from app.models.notification_outbox import NotificationOutbox

    conn = db()
    try:
        rows = (
            conn.query(NotificationOutbox)
            .filter(NotificationOutbox.channel == channel)
            .all()
        )
        return [{"status": r.status, "payload": dict(r.payload or {})} for r in rows]
    finally:
        conn.close()


def cta_ids(message: dict) -> set[str]:
    return {c.get("action") for c in (message.get("cta") or [])}


def _uuid(value):
    import uuid

    return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))
