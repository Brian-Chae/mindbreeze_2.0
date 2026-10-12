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


# ---------------------------------------------------------------------------
# SDD-189: 상담사 채널 헬퍼
# ---------------------------------------------------------------------------


def link_client(
    counselor_id: str,
    client_id: str,
    *,
    status: str = "active",
    matched_days_ago: int | None = None,
) -> str:
    """ClientCounselorLink 직접 생성 — 담당 내담자 경계 검증용."""
    from app.models.client_counselor_link import ClientCounselorLink

    conn = db()
    try:
        link = ClientCounselorLink(
            client_id=_uuid(client_id), counselor_id=_uuid(counselor_id), status=status
        )
        if matched_days_ago is not None:
            # "가장 최근 매칭 상담사" 선택을 결정적으로 만들기 위한 시각 고정.
            link.matched_at = datetime.now(timezone.utc) - timedelta(days=matched_days_ago)
        conn.add(link)
        conn.commit()
        conn.refresh(link)
        return str(link.id)
    finally:
        conn.close()


def set_ai_summary(session_id: str, summary: dict | None, *, status: str = "completed") -> None:
    """SessionRecord 를 만들거나 갱신해 AI 요약을 심는다. summary=None 이면 기록 없음 상태."""
    from app.models.record import SessionRecord

    conn = db()
    try:
        record = (
            conn.query(SessionRecord)
            .filter(SessionRecord.session_id == _uuid(session_id))
            .first()
        )
        if record is None:
            record = SessionRecord(
                session_id=_uuid(session_id), markers=[], edit_history=[], ai_summary={}
            )
            conn.add(record)
        record.status = status
        record.ai_summary = summary if summary is not None else {}
        conn.commit()
    finally:
        conn.close()


def set_joined_at(session_id: str, user_id: str, when=None) -> None:
    """참여 행의 joined_at 을 바꾼다 — None 이면 불참(참석 기록 없음)으로 본다."""
    from app.models.session import SessionParticipant

    conn = db()
    try:
        row = (
            conn.query(SessionParticipant)
            .filter(
                SessionParticipant.session_id == _uuid(session_id),
                SessionParticipant.user_id == _uuid(user_id),
            )
            .first()
        )
        row.joined_at = when
        conn.commit()
    finally:
        conn.close()


def counselor_messages(user_id: str, *, kind: str | None = None) -> list:
    """상담사 채널(channel="counselor") 메시지만 — 내담자 채널과 섞이지 않는지도 검증한다."""
    from app.models.agent import AgentConversation, AgentMessage

    conn = db()
    try:
        conversation = (
            conn.query(AgentConversation)
            .filter(
                AgentConversation.user_id == _uuid(user_id),
                AgentConversation.channel == "counselor",
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
        return [
            {
                "id": str(m.id),
                "sender": m.sender,
                "kind": m.kind,
                "content": m.content,
                "cta": list(m.cta or []),
            }
            for m in rows
        ]
    finally:
        conn.close()


def briefing_logs(user_id: str | None = None) -> list[dict]:
    from app.models.agent import AgentBriefingLog

    conn = db()
    try:
        query = conn.query(AgentBriefingLog)
        if user_id is not None:
            query = query.filter(AgentBriefingLog.user_id == _uuid(user_id))
        rows = query.all()
        return [
            {"user_id": str(r.user_id), "kind": r.kind, "briefing_date": r.briefing_date}
            for r in rows
        ]
    finally:
        conn.close()


def run_briefing_sweep(now: datetime | None = None) -> dict:
    from app.services import agent_briefing

    conn = db()
    try:
        return agent_briefing.sweep(conn, now=now)
    finally:
        conn.close()


def kst_at(hour: int, minute: int = 0, *, day_offset: int = 0) -> datetime:
    """KST 기준 시각을 aware UTC datetime 으로 — 브리핑 시각 윈도우 테스트용."""
    from zoneinfo import ZoneInfo

    kst = ZoneInfo("Asia/Seoul")
    base = (datetime.now(timezone.utc).astimezone(kst) + timedelta(days=day_offset)).replace(
        hour=hour, minute=minute, second=0, microsecond=0
    )
    return base.astimezone(timezone.utc)


def set_counselor_settings(user_id: str, **fields) -> None:
    from app.services import agent_counselor_service

    conn = db()
    try:
        settings = agent_counselor_service.get_settings(conn, user_id)
        for key, value in fields.items():
            setattr(settings, key, value)
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# SDD-191: 안부 대화 · 프로파일 · 위험 신호 헬퍼
# ---------------------------------------------------------------------------


def set_checkin_enabled(counselor_id: str, client_id: str, enabled: bool = True) -> None:
    """상담사의 내담자별 안부 스위치를 직접 설정한다(D5=②)."""
    from app.services import agent_checkin

    conn = db()
    try:
        agent_checkin.set_enabled(conn, _uuid(counselor_id), _uuid(client_id), enabled)
    finally:
        conn.close()


def set_checkin_paused(client_id: str, paused: bool = True) -> None:
    from app.services import agent_checkin

    conn = db()
    try:
        agent_checkin.set_paused(conn, _uuid(client_id), paused)
    finally:
        conn.close()


def run_checkin_sweep(now: datetime | None = None) -> dict:
    from app.services import agent_checkin

    conn = db()
    try:
        return agent_checkin.sweep(conn, now=now)
    finally:
        conn.close()


def checkins(client_id: str) -> list[dict]:
    from app.models.agent import AgentCheckin

    conn = db()
    try:
        rows = (
            conn.query(AgentCheckin)
            .filter(AgentCheckin.client_id == _uuid(client_id))
            .order_by(AgentCheckin.started_at.asc())
            .all()
        )
        return [
            {
                "id": str(r.id),
                "counselor_id": str(r.counselor_id),
                "trigger": r.trigger,
                "turn_count": r.turn_count,
                "closed_at": r.closed_at,
                "summary": r.summary,
                "mood_direction": r.mood_direction,
            }
            for r in rows
        ]
    finally:
        conn.close()


def close_open_checkin(client_id: str, *, mood_direction: str | None = None, days_ago: int = 0) -> None:
    """열린 체크인을 과거 시점에 마무리된 상태로 만든다 — 트리거·제한 검증용."""
    from app.models.agent import AgentCheckin

    conn = db()
    try:
        row = (
            conn.query(AgentCheckin)
            .filter(AgentCheckin.client_id == _uuid(client_id))
            .order_by(AgentCheckin.started_at.desc())
            .first()
        )
        when = datetime.now(timezone.utc) - timedelta(days=days_ago)
        row.started_at = when
        row.closed_at = when
        if mood_direction is not None:
            row.mood_direction = mood_direction
        conn.commit()
    finally:
        conn.close()


def risk_signals(counselor_id: str | None = None) -> list[dict]:
    from app.models.agent import AgentRiskSignal

    conn = db()
    try:
        query = conn.query(AgentRiskSignal)
        if counselor_id is not None:
            query = query.filter(AgentRiskSignal.counselor_id == _uuid(counselor_id))
        rows = query.order_by(AgentRiskSignal.created_at.asc()).all()
        return [
            {
                "id": str(r.id),
                "client_id": str(r.client_id),
                "counselor_id": str(r.counselor_id),
                "level": r.level,
                "excerpt": r.excerpt,
                "status": r.status,
                "handled_at": r.handled_at,
                "message_id": str(r.message_id) if r.message_id else None,
            }
            for r in rows
        ]
    finally:
        conn.close()


def age_risk_signals(client_id: str, minutes: int) -> None:
    """위험 신호 생성 시각을 과거로 밀어 중복 억제 창을 벗어나게 한다(TS10)."""
    from app.models.agent import AgentRiskSignal

    conn = db()
    try:
        rows = (
            conn.query(AgentRiskSignal)
            .filter(AgentRiskSignal.client_id == _uuid(client_id))
            .all()
        )
        for row in rows:
            row.created_at = datetime.now(timezone.utc) - timedelta(minutes=minutes)
        conn.commit()
    finally:
        conn.close()


def profile_items(counselor_id: str, client_id: str) -> list[dict]:
    from app.models.agent import AgentProfileItem

    conn = db()
    try:
        rows = (
            conn.query(AgentProfileItem)
            .filter(
                AgentProfileItem.counselor_id == _uuid(counselor_id),
                AgentProfileItem.client_id == _uuid(client_id),
            )
            .order_by(AgentProfileItem.created_at.asc())
            .all()
        )
        return [
            {
                "id": str(r.id),
                "category": r.category,
                "text": r.text,
                "status": r.status,
                "evidence": list(r.evidence or []),
            }
            for r in rows
        ]
    finally:
        conn.close()


def send_client_message(client, headers: dict, text: str) -> dict:
    """내담자 자유 메시지 전송 — 200 을 보장하고 본문을 돌려준다."""
    res = client.post("/api/v1/agent/messages", json={"content": text}, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


def age_last_user_message(client_id: str, days: int) -> None:
    """내담자 발화 시각을 과거로 밀어 "무응답 N일" 트리거를 만든다."""
    from app.models.agent import AgentConversation, AgentMessage

    conn = db()
    try:
        conversation = (
            conn.query(AgentConversation)
            .filter(
                AgentConversation.user_id == _uuid(client_id),
                AgentConversation.channel == "client",
            )
            .first()
        )
        if conversation is None:
            return
        when = datetime.now(timezone.utc) - timedelta(days=days)
        rows = (
            conn.query(AgentMessage)
            .filter(AgentMessage.conversation_id == conversation.id)
            .all()
        )
        for row in rows:
            row.created_at = when
        conn.commit()
    finally:
        conn.close()


def notifications_of(user_id: str, *, title: str | None = None) -> list[dict]:
    """인앱 알림 행 — 위험 알림 이벤트 적재·비식별 검증용(SDD-191)."""
    from app.models.notification import Notification

    conn = db()
    try:
        query = conn.query(Notification).filter(Notification.user_id == _uuid(user_id))
        if title is not None:
            query = query.filter(Notification.title == title)
        rows = query.order_by(Notification.created_at.asc()).all()
        return [
            {
                "type": r.type,
                "title": r.title,
                "body": r.body,
                "extra": dict(r.extra or {}),
            }
            for r in rows
        ]
    finally:
        conn.close()


def direct_room_id(counselor_id: str, client_id: str) -> str | None:
    """상담사-내담자 direct 채팅방 id — CTA payload.room_id 대조용."""
    from app.models.chat import ChatRoom

    conn = db()
    try:
        room = (
            conn.query(ChatRoom)
            .filter(
                ChatRoom.room_type == "direct",
                ChatRoom.host_id == _uuid(counselor_id),
                ChatRoom.name == str(client_id),
            )
            .first()
        )
        return str(room.id) if room else None
    finally:
        conn.close()
