"""채팅 도착 시 푸시 Outbox 적재 + 네이티브 refresh 헤더."""
from app.models.notification_outbox import NotificationOutbox


def test_chat_deeplink_by_role():
    from types import SimpleNamespace
    from app.services.chat_service import _chat_push_deeplink

    assert _chat_push_deeplink("r1", SimpleNamespace(role="client")) == "/app/chat/r1"
    assert _chat_push_deeplink("r1", SimpleNamespace(role="counselor")) == "/chat/r1"
    assert _chat_push_deeplink("r1", None) == "/chat/r1"


def test_outbox_model_has_push_channel():
    assert NotificationOutbox.__tablename__


def test_채팅_전송시_수신자_푸시_outbox_적재(client):
    from tests.test_chat import _register, _direct_room, _test_db, _close_db

    host = _register(client, "pushhost@test.com", role="counselor")
    room_id = _direct_room(client, host, "pushhost@test.com")
    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/messages",
        json={"content": "비밀 상담 내용입니다", "type": "text"},
        headers=host["auth"],
    )
    assert res.status_code == 201, res.text
    db_gen, db = _test_db()
    try:
        rows = db.query(NotificationOutbox).filter(NotificationOutbox.channel == "push").all()
        assert len(rows) == 1
        payload = rows[0].payload
        assert payload["deeplink"] == f"/app/chat/{room_id}"  # 수신자=내담자
        assert "비밀 상담" not in str(payload)  # 상담 내용은 푸시에 싣지 않는다
        assert payload["body"].endswith("메시지를 보냈어요")
        assert str(rows[0].user_id) != host["id"]  # 발신자에게는 보내지 않는다
    finally:
        _close_db(db_gen)


def test_네이티브_로그인은_refresh_헤더를_노출하고_웹은_노출하지_않는다(client):
    from tests.test_auth_login import _register

    _register(client)
    body = {"email": "user@test.com", "password": "Passw0rd!"}
    web = client.post("/api/v1/auth/login", json=body)
    assert "x-mb-refresh-token" not in web.headers
    app = client.post("/api/v1/auth/login", json=body, headers={"X-MB-Native": "capacitor"})
    token = app.headers.get("x-mb-refresh-token")
    assert token
    # 쿠키 없이 본문 토큰만으로 refresh 가능 + 회전된 새 토큰 헤더 반환
    client.cookies.clear()
    rf = client.post("/api/v1/auth/refresh", json={"refresh_token": token}, headers={"X-MB-Native": "capacitor"})
    assert rf.status_code == 200, rf.text
    assert rf.headers.get("x-mb-refresh-token") and rf.headers["x-mb-refresh-token"] != token
