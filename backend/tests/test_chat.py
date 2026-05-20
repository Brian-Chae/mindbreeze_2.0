"""F6 채팅 QA — REST API 검증"""

from datetime import datetime, timedelta, timezone

VALID_PASSWORD = "Passw0rd!"


def _register(client, email: str, role: str = "counselor") -> dict:
    from app.services import email_verify_service

    payload = {
        "email": email,
        "password": VALID_PASSWORD,
        "name": "테스트",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": {"tos": True, "privacy": True, "sensitive": True},
    }
    res = client.post(f"/api/v1/auth/register/{role}", json=payload)
    assert res.status_code == 201, res.text
    body = res.json()
    token = body.get("access_token") or body.get("tokens", {}).get("access_token")
    return {
        "id": body["user"]["id"],
        "auth": {"Authorization": f"Bearer {token}"},
    }


def _future(minutes: int = 60) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


def _create_session(client, host_auth: dict, **overrides) -> dict:
    payload = {
        "type": "clinical",
        "scheduled_at": _future(60),
        "duration_min": 50,
        "title": "테스트",
    }
    payload.update(overrides)
    res = client.post("/api/v1/sessions", json=payload, headers=host_auth)
    assert res.status_code == 201, res.text
    return res.json()


def _room_for_session(client, host_auth: dict, session_id: str) -> str:
    """세션의 채팅방 id 추출 (rooms 목록에서 검색)."""
    rooms = client.get("/api/v1/chat/rooms", headers=host_auth).json()["rooms"]
    for r in rooms:
        if r["session_id"] == session_id:
            return r["id"]
    raise AssertionError("채팅방을 찾을 수 없음")


def test_01_비로그인_방목록_401(client):
    res = client.get("/api/v1/chat/rooms")
    assert res.status_code == 401


def test_02_방목록_조회_성공(client):
    host = _register(client, "chat02@test.com")
    s = _create_session(client, host["auth"])
    res = client.get("/api/v1/chat/rooms", headers=host["auth"])
    assert res.status_code == 200
    rooms = res.json()["rooms"]
    assert any(r["session_id"] == s["id"] for r in rooms)


def test_03_메시지_전송_REST(client):
    host = _register(client, "chat03@test.com")
    s = _create_session(client, host["auth"])
    room_id = _room_for_session(client, host["auth"], s["id"])
    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/messages",
        json={"content": "안녕하세요", "type": "text"},
        headers=host["auth"],
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["content"] == "안녕하세요"
    assert body["id"]


def test_04_메시지_내역_조회(client):
    host = _register(client, "chat04@test.com")
    s = _create_session(client, host["auth"])
    room_id = _room_for_session(client, host["auth"], s["id"])
    client.post(
        f"/api/v1/chat/rooms/{room_id}/messages",
        json={"content": "첫번째"},
        headers=host["auth"],
    )
    client.post(
        f"/api/v1/chat/rooms/{room_id}/messages",
        json={"content": "두번째"},
        headers=host["auth"],
    )
    res = client.get(
        f"/api/v1/chat/rooms/{room_id}/messages?limit=50", headers=host["auth"]
    )
    assert res.status_code == 200
    msgs = res.json()["messages"]
    assert len(msgs) >= 2


def test_05_빈_메시지_422(client):
    host = _register(client, "chat05@test.com")
    s = _create_session(client, host["auth"])
    room_id = _room_for_session(client, host["auth"], s["id"])
    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/messages",
        json={"content": "   "},
        headers=host["auth"],
    )
    assert res.status_code == 422


def test_06_타인_방_접근_403(client):
    host = _register(client, "chat06host@test.com")
    other = _register(client, "chat06other@test.com")
    s = _create_session(client, host["auth"])
    room_id = _room_for_session(client, host["auth"], s["id"])
    res = client.get(
        f"/api/v1/chat/rooms/{room_id}/messages", headers=other["auth"]
    )
    assert res.status_code == 403


def test_07_읽음_처리(client):
    host = _register(client, "chat07host@test.com")
    participant = _register(client, "chat07p@test.com", role="client")
    s = _create_session(
        client,
        host["auth"],
        type="meditation",
        max_participants=5,
    )
    client.post(
        f"/api/v1/sessions/{s['id']}/invite",
        json={"user_id": participant["id"]},
        headers=host["auth"],
    )
    room_id = _room_for_session(client, host["auth"], s["id"])
    client.post(
        f"/api/v1/chat/rooms/{room_id}/messages",
        json={"content": "안내드립니다"},
        headers=host["auth"],
    )
    # 참여자는 미수신 1개
    rooms = client.get("/api/v1/chat/rooms", headers=participant["auth"]).json()[
        "rooms"
    ]
    target = next(r for r in rooms if r["session_id"] == s["id"])
    assert target["unread_count"] >= 1
    # 읽음 처리
    res = client.put(
        f"/api/v1/chat/rooms/{room_id}/read", headers=participant["auth"]
    )
    assert res.status_code == 204
    rooms2 = client.get("/api/v1/chat/rooms", headers=participant["auth"]).json()[
        "rooms"
    ]
    target2 = next(r for r in rooms2 if r["session_id"] == s["id"])
    assert target2["unread_count"] == 0


def test_08_잘못된_room_id_400(client):
    host = _register(client, "chat08@test.com")
    res = client.get(
        "/api/v1/chat/rooms/not-a-uuid/messages", headers=host["auth"]
    )
    assert res.status_code == 400


def test_09_없는_room_404(client):
    host = _register(client, "chat09@test.com")
    res = client.get(
        "/api/v1/chat/rooms/00000000-0000-0000-0000-000000000000/messages",
        headers=host["auth"],
    )
    assert res.status_code == 404


def test_10_시스템_메시지_저장(client, app_client):
    from uuid import UUID

    from app.services.system_message_service import send_system_message
    from app.core.database import get_db
    from app.main import app as fastapi_app

    host = _register(client, "chat10@test.com")
    s = _create_session(client, host["auth"])

    # 테스트 DB 세션을 직접 획득
    db_gen = fastapi_app.dependency_overrides[get_db]()
    db = next(db_gen)
    try:
        msg = send_system_message(
            session_id=UUID(s["id"]),
            content="세션이 예약되었습니다",
            event_type="session_scheduled",
            db=db,
        )
        assert msg.sender_id is None
        assert msg.type == "system"
        assert msg.event_type == "session_scheduled"
    finally:
        try:
            next(db_gen)
        except StopIteration:
            pass
