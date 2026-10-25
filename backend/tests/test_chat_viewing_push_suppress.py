"""보고 있는 채팅방은 푸시 억제 — presence(room_viewing) + 발송 직전 확인."""
import asyncio
import logging

from app.models.notification_outbox import NotificationOutbox
from app.services import chat_presence_service as presence
from app.ws import chat_namespace as chat


def _push_rows():
    from tests.test_chat import _test_db, _close_db

    gen, db = _test_db()
    try:
        return [(str(r.user_id)) for r in db.query(NotificationOutbox).filter(NotificationOutbox.channel == "push").all()]
    finally:
        _close_db(gen)


def _setup(client, email):
    from tests.test_chat import _register, _direct_room
    from app.models.user import User
    from tests.test_chat import _test_db, _close_db

    host = _register(client, email, role="counselor")
    room_id = _direct_room(client, host, email)
    gen, db = _test_db()
    try:
        recipient = str(db.query(User).filter(User.email == email.replace("@", "+m@")).first().id)
    finally:
        _close_db(gen)
    return host, room_id, recipient


def _send(client, host, room_id):
    res = client.post(f"/api/v1/chat/rooms/{room_id}/messages", json={"content": "hi", "type": "text"}, headers=host["auth"])
    assert res.status_code == 201, res.text


def test_보고있는_방이면_푸시_적재하지_않고_사유_로그(client, caplog):
    host, room_id, rcpt = _setup(client, "view1@test.com")
    presence.set_viewing(room_id, rcpt, "sid-a", True)
    with caplog.at_level(logging.INFO, logger="uvicorn.error.push"):
        _send(client, host, room_id)
    assert _push_rows() == []
    assert "reason=viewing_room" in caplog.text


def test_다른_방을_보고_있으면_푸시_적재(client):
    host, room_id, rcpt = _setup(client, "view2@test.com")
    presence.set_viewing("other-room", rcpt, "sid-a", True)
    _send(client, host, room_id)
    assert _push_rows() == [rcpt]


def test_이탈_false_후에는_푸시_적재(client):
    host, room_id, rcpt = _setup(client, "view3@test.com")
    presence.set_viewing(room_id, rcpt, "sid-a", True)
    presence.set_viewing(room_id, rcpt, "sid-a", False)
    _send(client, host, room_id)
    assert _push_rows() == [rcpt]


def test_TTL_만료_후에는_푸시_적재(client, monkeypatch):
    host, room_id, rcpt = _setup(client, "view4@test.com")
    presence.set_viewing(room_id, rcpt, "sid-a", True, now=1000.0)
    assert presence.is_viewing(room_id, rcpt, now=1000.0 + presence.VIEWING_TTL_SECONDS - 1) is True
    import time
    monkeypatch.setattr(time, "time", lambda: 1000.0 + presence.VIEWING_TTL_SECONDS + 1)
    _send(client, host, room_id)
    assert _push_rows() == [rcpt]


def test_멀티탭_한쪽만_닫으면_계속_보고있음(client):
    host, room_id, rcpt = _setup(client, "view5@test.com")
    presence.set_viewing(room_id, rcpt, "sid-a", True)
    presence.set_viewing(room_id, rcpt, "sid-b", True)
    presence.set_viewing(room_id, rcpt, "sid-a", False)
    assert presence.is_viewing(room_id, rcpt) is True
    presence.set_viewing(room_id, rcpt, "sid-b", False)
    assert presence.is_viewing(room_id, rcpt) is False


def test_redis_오류는_fail_open(client, monkeypatch):
    host, room_id, rcpt = _setup(client, "view6@test.com")

    def boom():
        raise RuntimeError("redis down")

    monkeypatch.setattr(presence, "get_client", boom)
    _send(client, host, room_id)
    assert _push_rows() == [rcpt]


def test_소켓_핸들러_멤버만_등록_이탈_disconnect_정리(monkeypatch):
    monkeypatch.setattr(chat, "sio", type("S", (), {"leave_room": staticmethod(lambda *a, **k: asyncio.sleep(0))})())
    chat._sid_users.clear(); chat._sid_viewing.clear()
    chat._sid_users["s1"] = "u1"

    async def member(sid, room):
        return room == "r1"

    monkeypatch.setattr(chat, "_is_room_member", member)
    assert asyncio.run(chat.on_room_viewing("s1", {"room_id": "r2", "viewing": True})) == {"ok": False}
    assert presence.is_viewing("r2", "u1") is False
    assert asyncio.run(chat.on_room_viewing("s1", {"room_id": "r1", "viewing": True})) == {"ok": True}
    assert presence.is_viewing("r1", "u1") is True
    asyncio.run(chat.on_leave_room("s1", {"room_id": "r1"}))
    assert presence.is_viewing("r1", "u1") is False
    asyncio.run(chat.on_room_viewing("s1", {"room_id": "r1", "viewing": True}))
    asyncio.run(chat.disconnect("s1"))
    assert presence.is_viewing("r1", "u1") is False
