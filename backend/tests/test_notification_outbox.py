"""SDD-093 후속 — 트랜잭셔널 outbox E2E (WS·이메일 채널 기록 + 워커 처리)"""

import asyncio
import uuid
from unittest.mock import AsyncMock, patch

from app.models.notification_outbox import NotificationOutbox
from app.services import notification_service
from tests.conftest import create_test_org, post_register


def _register(client, email: str, role: str = "counselor") -> dict:
    from app.services import email_verify_service

    payload = {
        "org_code": create_test_org(),
        "email": email,
        "password": "Passw0rd!",
        "name": "아웃박스테스트",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": {"tos": True, "privacy": True, "sensitive": True},
    }
    res = post_register(client, role, payload)
    assert res.status_code == 201, res.text
    body = res.json()
    token = body.get("access_token") or body.get("tokens", {}).get("access_token")
    return {"id": body["user"]["id"], "token": token}


def _db():
    from app.core.database import SessionLocal

    return SessionLocal()


def _notify(db, event_type, uid, title, body):
    """apply_async(브로커 연결)를 mock하고 notify_event 호출."""
    with patch("app.tasks.report_email_task.notification_email_task.apply_async"):
        return notification_service.notify_event(
            event_type, uid, {"title": title, "body": body}, db
        )


def test_notify_event_ws_outbox_기록(client):
    u = _register(client, "outbox1@test.com")
    db = _db()
    try:
        notif = _notify(db, "report_ready", u["id"], "리포트 준비", "리포트가 준비되었습니다.")
        assert notif is not None
        rows = db.query(NotificationOutbox).filter(
            NotificationOutbox.channel == "ws",
            NotificationOutbox.user_id == uuid.UUID(u["id"]),
        ).all()
        assert len(rows) >= 1
        assert rows[0].status == "pending"
        assert rows[0].payload["type"] == "report"
        assert rows[0].notification_id == notif.id
    finally:
        db.close()


def test_notify_event_email_outbox_기록(client):
    u = _register(client, "outbox2@test.com")
    db = _db()
    try:
        notif = _notify(db, "session_booked", u["id"], "세션 예약", "세션이 예약되었습니다.")
        assert notif is not None
        rows = db.query(NotificationOutbox).filter(
            NotificationOutbox.channel == "email",
            NotificationOutbox.user_id == uuid.UUID(u["id"]),
        ).all()
        assert len(rows) >= 1
        assert rows[0].status == "pending"
        assert rows[0].recipient  # 이메일 주소 존재
        assert "subject" in rows[0].payload
    finally:
        db.close()


def test_notification_email_task_발송성공(client):
    u = _register(client, "outbox3@test.com")
    db = _db()
    try:
        _notify(db, "session_booked", u["id"], "세션 예약", "세션이 예약되었습니다.")
        item = db.query(NotificationOutbox).filter(
            NotificationOutbox.channel == "email",
            NotificationOutbox.user_id == uuid.UUID(u["id"]),
        ).first()
        assert item is not None
        outbox_id = str(item.id)
    finally:
        db.close()

    from app.tasks.report_email_task import notification_email_task

    with patch.object(notification_service, "send_email_notification", return_value=True):
        notification_email_task(outbox_id)

    db = _db()
    try:
        item = db.query(NotificationOutbox).filter(
            NotificationOutbox.id == uuid.UUID(outbox_id),
        ).first()
        assert item is not None
        assert item.status == "sent"
    finally:
        db.close()


def test_notification_email_task_html_본문_전달(client):
    """FUNC-07: outbox payload['html'] 이 실제 발송 함수까지 전달된다."""
    u = _register(client, "outbox-html@test.com")
    db = _db()
    try:
        item = NotificationOutbox(
            user_id=uuid.UUID(u["id"]),
            channel="email",
            recipient="outbox-html@test.com",
            payload={
                "subject": "[MIND BREEZE] 클래스 안내",
                "body": "평문 본문",
                "html": "<p>HTML 본문</p>",
            },
            status="pending",
        )
        db.add(item)
        db.commit()
        outbox_id = str(item.id)
    finally:
        db.close()

    from app.tasks.report_email_task import notification_email_task

    with patch.object(
        notification_service, "send_email_notification", return_value=True
    ) as sender:
        notification_email_task(outbox_id)

    sender.assert_called_once()
    args = sender.call_args.args
    assert args[0] == "outbox-html@test.com"
    assert args[1] == "[MIND BREEZE] 클래스 안내"
    assert args[2] == "평문 본문"
    assert args[3] == "<p>HTML 본문</p>"


def test_poll_and_deliver_ws_전달성공(client):
    u = _register(client, "outbox4@test.com")
    db = _db()
    try:
        _notify(db, "report_ready", u["id"], "리포트 준비", "리포트가 준비되었습니다.")
    finally:
        db.close()

    from app.services.outbox_worker import poll_and_deliver_ws

    async def _run():
        from app.ws import chat_namespace

        with patch.object(
            chat_namespace, "broadcast_notification", new=AsyncMock(return_value=None)
        ):
            return await poll_and_deliver_ws()

    delivered = asyncio.run(_run())
    assert delivered >= 1

    db = _db()
    try:
        rows = db.query(NotificationOutbox).filter(
            NotificationOutbox.channel == "ws",
            NotificationOutbox.user_id == uuid.UUID(u["id"]),
        ).all()
        assert rows, "ws outbox 레코드가 있어야 함"
        assert all(r.status == "sent" for r in rows)
    finally:
        db.close()


def test_cleanup_notifications_보관정책(client):
    """보관·파기: 읽은 30일 / 전체 90일 경계 검증"""
    from datetime import datetime, timedelta, timezone

    from app.models.notification import Notification
    from app.tasks.outbox import cleanup_notifications

    u = _register(client, "cleanup@test.com")
    uid = uuid.UUID(u["id"])
    db = _db()
    try:
        now = datetime.now(timezone.utc)
        old_read = Notification(
            user_id=uid, type="system", title="old_read", body="",
            is_read=True, read_at=now - timedelta(days=31),
        )
        recent_read = Notification(
            user_id=uid, type="system", title="recent_read", body="",
            is_read=True, read_at=now - timedelta(days=29),
        )
        old_created = Notification(
            user_id=uid, type="system", title="old_created", body="",
            created_at=now - timedelta(days=91),
        )
        recent_created = Notification(
            user_id=uid, type="system", title="recent_created", body="",
            created_at=now - timedelta(days=89),
        )
        db.add_all([old_read, recent_read, old_created, recent_created])
        db.commit()
    finally:
        db.close()

    cleanup_notifications()

    db = _db()
    try:
        titles = {
            n.title for n in db.query(Notification).filter(Notification.user_id == uid).all()
        }
        assert "old_read" not in titles      # 읽은 31일 → 삭제
        assert "recent_read" in titles       # 읽은 29일 → 유지
        assert "old_created" not in titles   # 전체 91일 → 삭제
        assert "recent_created" in titles    # 전체 89일 → 유지
    finally:
        db.close()
