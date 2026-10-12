"""클래스(세션) 실시간 채팅 — 세션 채팅방 자동 개설 · chat_enabled 토글 · 참여자 접근 검증.

기존 채팅(room_type="session", /chat 네임스페이스) 을 그대로 재활용하고,
세션 방 권한은 ChatRoom.host_id 가 아니라 Session.host_id / SessionParticipant 기준이다.
"""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

VALID_PASSWORD = "Passw0rd!"


def _register(client, email: str, role: str = "counselor") -> dict:
    from app.services import email_verify_service
    from tests.conftest import create_test_org, post_register

    payload = {
        "org_code": create_test_org(),
        "email": email,
        "password": VALID_PASSWORD,
        "name": "테스트",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": {"tos": True, "privacy": True, "sensitive": True},
    }
    res = post_register(client, role, payload)
    assert res.status_code == 201, res.text
    body = res.json()
    token = body.get("access_token") or body.get("tokens", {}).get("access_token")
    return {"id": body["user"]["id"], "auth": {"Authorization": f"Bearer {token}"}}


def _future(minutes: int = 60) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


def _create_session(client, host_auth: dict, **overrides) -> dict:
    payload = {
        "type": "clinical",
        "scheduled_at": _future(60),
        "duration_min": 50,
        "title": "클래스 채팅",
    }
    payload.update(overrides)
    res = client.post("/api/v1/sessions", json=payload, headers=host_auth)
    assert res.status_code == 201, res.text
    return res.json()


def _test_db():
    """테스트 DB 세션 획득 (test_chat.py 패턴). (generator, session) 반환."""
    from app.core.database import get_db
    from app.main import app as fastapi_app

    db_gen = fastapi_app.dependency_overrides[get_db]()
    return db_gen, next(db_gen)


def _close_db(db_gen):
    try:
        next(db_gen)
    except StopIteration:
        pass


# ── 1. 세션 생성 시 세션 채팅방 자동 개설 ──


def test_01_세션생성시_세션방_자동개설_및_멱등(client):
    from app.models.chat import ChatRoom

    host = _register(client, "sesschat01@test.com")
    member = _register(client, "sesschat01m@test.com", role="client")
    s = _create_session(client, host["auth"], participant_ids=[member["id"]])

    # 응답에 채팅 사용 여부 + 채팅방 ID 가 함께 내려온다
    assert s["chat_enabled"] is False  # 기본 off
    assert s["chat_room_id"]

    db_gen, db = _test_db()
    try:
        rooms = db.query(ChatRoom).filter(ChatRoom.session_id == s["id"]).all()
        assert len(rooms) == 1  # 세션당 1개 (unique)
        assert rooms[0].room_type == "session"
        assert str(rooms[0].host_id) == host["id"]
        room_id = str(rooms[0].id)
    finally:
        _close_db(db_gen)
    assert room_id == s["chat_room_id"]

    # 멱등: 재조회해도 같은 방 (새로 만들지 않는다)
    res = client.get(f"/api/v1/sessions/{s['id']}/chat-room", headers=host["auth"])
    assert res.status_code == 200, res.text
    assert res.json()["room_id"] == room_id
    assert res.json()["room_type"] == "session"

    db_gen, db = _test_db()
    try:
        assert db.query(ChatRoom).filter(ChatRoom.session_id == s["id"]).count() == 1
    finally:
        _close_db(db_gen)


def test_02_참여자없는_1대1_세션도_방_자동개설(client):
    host = _register(client, "sesschat02@test.com")
    s = _create_session(client, host["auth"])
    assert s["chat_room_id"]
    res = client.get(f"/api/v1/sessions/{s['id']}/chat-room", headers=host["auth"])
    assert res.status_code == 200
    assert res.json()["room_id"] == s["chat_room_id"]


def test_03_세션오픈시에도_방_보장(client):
    """open 전이 후에도 채팅방을 조회할 수 있다(멱등 개설 경로 회귀)."""
    host = _register(client, "sesschat03@test.com")
    member = _register(client, "sesschat03m@test.com", role="client")
    s = _create_session(client, host["auth"], participant_ids=[member["id"]])

    res = client.post(f"/api/v1/sessions/{s['id']}/open", headers=host["auth"])
    assert res.status_code == 200, res.text
    assert res.json()["chat_room_id"] == s["chat_room_id"]


def test_04_기존세션_방없음_host조회시_개설(client):
    """마이그레이션 이전 생성된(방 없는) 세션도 host 조회 시 멱등 개설된다."""
    from app.models.chat import ChatRoom
    from app.models.session import Session as SessionModel

    host = _register(client, "sesschat04@test.com")
    db_gen, db = _test_db()
    try:
        legacy = SessionModel(
            type="clinical",
            status="ready",
            host_id=host["id"],
            duration_min=30,
            title="레거시 세션",
        )
        db.add(legacy)
        db.commit()
        db.refresh(legacy)
        session_id = str(legacy.id)
        assert db.query(ChatRoom).filter(ChatRoom.session_id == legacy.id).count() == 0
    finally:
        _close_db(db_gen)

    res = client.get(f"/api/v1/sessions/{session_id}/chat-room", headers=host["auth"])
    assert res.status_code == 200, res.text
    assert res.json()["room_id"] is not None

    db_gen, db = _test_db()
    try:
        assert db.query(ChatRoom).filter(ChatRoom.session_id == session_id).count() == 1
    finally:
        _close_db(db_gen)


# ── 2. 세션 방 조회 · 접근 권한 ──


def test_05_세션방_조회_host_참여자_동일_비참여자403(client):
    host = _register(client, "sesschat05@test.com")
    member = _register(client, "sesschat05m@test.com", role="client")
    stranger = _register(client, "sesschat05s@test.com", role="client")
    s = _create_session(client, host["auth"], participant_ids=[member["id"]])

    host_room = client.get(f"/api/v1/sessions/{s['id']}/chat-room", headers=host["auth"])
    member_room = client.get(f"/api/v1/sessions/{s['id']}/chat-room", headers=member["auth"])
    assert host_room.status_code == 200 and member_room.status_code == 200
    assert host_room.json()["room_id"] == member_room.json()["room_id"] == s["chat_room_id"]

    # 비참여자·미인증
    assert client.get(
        f"/api/v1/sessions/{s['id']}/chat-room", headers=stranger["auth"]
    ).status_code == 403
    assert client.get(f"/api/v1/sessions/{s['id']}/chat-room").status_code == 401
    # 잘못된 ID 형식
    assert client.get("/api/v1/sessions/not-a-uuid/chat-room", headers=host["auth"]).status_code == 400


def test_06_참여자는_세션방_메시지_조회_가능(client):
    """세션 방 권한이 SessionParticipant 기반으로 동작하는지 확인(기존 direct 방과 별개 로직)."""
    host = _register(client, "sesschat06@test.com")
    member = _register(client, "sesschat06m@test.com", role="client")
    stranger = _register(client, "sesschat06s@test.com", role="client")
    s = _create_session(client, host["auth"], participant_ids=[member["id"]])
    room_id = s["chat_room_id"]

    assert client.post(
        f"/api/v1/chat/rooms/{room_id}/messages",
        json={"content": "안녕하세요"},
        headers=host["auth"],
    ).status_code == 201
    res = client.get(f"/api/v1/chat/rooms/{room_id}/messages", headers=member["auth"])
    assert res.status_code == 200, res.text
    assert res.json()["messages"][0]["content"] == "안녕하세요"
    # 비참여자는 방 자체에 접근할 수 없다
    assert client.get(
        f"/api/v1/chat/rooms/{room_id}/messages", headers=stranger["auth"]
    ).status_code == 403


def test_07_ws_멤버십에_세션방_포함(client):
    """실시간(/chat WS) join 은 get_user_chat_room_ids 기반 — 참여자/ host 모두 포함돼야 한다."""
    from app.services import chat_service

    host = _register(client, "sesschat07@test.com")
    member = _register(client, "sesschat07m@test.com", role="client")
    stranger = _register(client, "sesschat07s@test.com", role="client")
    s = _create_session(client, host["auth"], participant_ids=[member["id"]])

    db_gen, db = _test_db()
    try:
        assert s["chat_room_id"] in chat_service.get_user_chat_room_ids(host["id"], db)
        assert s["chat_room_id"] in chat_service.get_user_chat_room_ids(member["id"], db)
        # 비참여자에게는 노출되지 않는다
        assert s["chat_room_id"] not in chat_service.get_user_chat_room_ids(stranger["id"], db)
    finally:
        _close_db(db_gen)


# ── 3. 채팅 켜기/끄기 토글 ──


def test_08_채팅토글_host성공_응답계약(client):
    host = _register(client, "sesschat08@test.com")
    member = _register(client, "sesschat08m@test.com", role="client")
    s = _create_session(client, host["auth"], participant_ids=[member["id"]])
    assert s["chat_enabled"] is False

    res = client.post(
        f"/api/v1/sessions/{s['id']}/chat-enabled",
        json={"enabled": True},
        headers=host["auth"],
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["chat_enabled"] is True
    assert body["room_id"] == s["chat_room_id"]
    assert body["session_id"] == s["id"]
    assert body["room_type"] == "session"

    # 세션 단건 조회/코드 조회에도 반영된다
    detail = client.get(f"/api/v1/sessions/{s['id']}", headers=host["auth"]).json()
    assert detail["chat_enabled"] is True
    by_code = client.get(f"/api/v1/sessions/by-code/{detail['access_code']}").json()
    assert by_code["chat_enabled"] is True
    # 게스트/회원 상태 조회(폴링)에도 동일 플래그가 내려간다
    state = client.get(f"/api/v1/sessions/by-code/{detail['access_code']}/state")
    assert state.status_code == 200, state.text
    assert state.json()["chat_enabled"] is True

    # 다시 끄기
    res = client.post(
        f"/api/v1/sessions/{s['id']}/chat-enabled",
        json={"enabled": False},
        headers=host["auth"],
    )
    assert res.status_code == 200
    assert res.json()["chat_enabled"] is False
    assert res.json()["room_id"] == s["chat_room_id"]  # 방은 유지(멱등)


def test_09_채팅토글_참여자403_비참여자403_미인증401(client):
    host = _register(client, "sesschat09@test.com")
    member = _register(client, "sesschat09m@test.com", role="client")
    stranger = _register(client, "sesschat09s@test.com", role="client")
    s = _create_session(client, host["auth"], participant_ids=[member["id"]])

    url = f"/api/v1/sessions/{s['id']}/chat-enabled"
    assert client.post(url, json={"enabled": True}, headers=member["auth"]).status_code == 403
    assert client.post(url, json={"enabled": True}, headers=stranger["auth"]).status_code == 403
    assert client.post(url, json={"enabled": True}).status_code == 401
    # 잘못된 ID 형식 / 없는 세션
    assert client.post(
        "/api/v1/sessions/not-a-uuid/chat-enabled", json={"enabled": True}, headers=host["auth"]
    ).status_code == 400
    assert client.post(
        f"/api/v1/sessions/{uuid4()}/chat-enabled", json={"enabled": True}, headers=host["auth"]
    ).status_code == 404
    # 토글은 상태전이 라우트로 해석되지 않는다(400 "알 수 없는 액션"이 아니어야 함)
    assert client.post(
        url, json={"enabled": True}, headers=host["auth"]
    ).status_code == 200


def test_10_채팅off면_참여자_발신403_host는_가능(client):
    host = _register(client, "sesschat10@test.com")
    member = _register(client, "sesschat10m@test.com", role="client")
    s = _create_session(client, host["auth"], participant_ids=[member["id"]])
    room_id = s["chat_room_id"]

    # 기본 off → 참여자 발신 차단
    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/messages",
        json={"content": "보내지나?"},
        headers=member["auth"],
    )
    assert res.status_code == 403
    assert res.json()["detail"] == "채팅이 꺼져 있는 클래스입니다"
    # host 는 off 여도 발신 가능(공지)
    assert client.post(
        f"/api/v1/chat/rooms/{room_id}/messages",
        json={"content": "공지입니다"},
        headers=host["auth"],
    ).status_code == 201

    # 켜면 참여자도 발신 가능
    assert client.post(
        f"/api/v1/sessions/{s['id']}/chat-enabled", json={"enabled": True}, headers=host["auth"]
    ).status_code == 200
    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/messages",
        json={"content": "질문 있습니다"},
        headers=member["auth"],
    )
    assert res.status_code == 201, res.text
    assert res.json()["sender_id"] == member["id"]

    # 다시 끄면 즉시 차단 (off → on → off 회귀)
    client.post(
        f"/api/v1/sessions/{s['id']}/chat-enabled", json={"enabled": False}, headers=host["auth"]
    )
    assert client.post(
        f"/api/v1/chat/rooms/{room_id}/messages",
        json={"content": "또?"},
        headers=member["auth"],
    ).status_code == 403


def test_11_세션수정API로도_채팅토글(client):
    """PUT /sessions/{id} (SessionUpdateRequest.chat_enabled) 경로도 동일하게 동작한다."""
    host = _register(client, "sesschat11@test.com")
    member = _register(client, "sesschat11m@test.com", role="client")
    s = _create_session(client, host["auth"], participant_ids=[member["id"]])

    res = client.put(
        f"/api/v1/sessions/{s['id']}", json={"chat_enabled": True}, headers=host["auth"]
    )
    assert res.status_code == 200, res.text
    assert res.json()["chat_enabled"] is True
    # 참여자는 수정 불가(회귀 확인)
    assert client.put(
        f"/api/v1/sessions/{s['id']}", json={"chat_enabled": False}, headers=member["auth"]
    ).status_code == 403


def test_12_채팅_켠_세션에서_읽음처리_동작(client):
    """기존 읽음 처리 흐름이 세션 방에서도 그대로 동작하는지(재활용 회귀)."""
    host = _register(client, "sesschat12@test.com")
    member = _register(client, "sesschat12m@test.com", role="client")
    s = _create_session(client, host["auth"], participant_ids=[member["id"]])
    room_id = s["chat_room_id"]
    client.post(
        f"/api/v1/sessions/{s['id']}/chat-enabled", json={"enabled": True}, headers=host["auth"]
    )

    msg = client.post(
        f"/api/v1/chat/rooms/{room_id}/messages",
        json={"content": "확인 부탁드려요"},
        headers=host["auth"],
    ).json()
    assert msg["recipient_count"] >= 2  # host + member

    counts = client.get(
        f"/api/v1/chat/rooms/{room_id}/unread-counts", headers=member["auth"]
    ).json()["unread_counts"]
    assert counts[msg["id"]] >= 1

    assert client.put(f"/api/v1/chat/rooms/{room_id}/read", headers=member["auth"]).status_code == 204
    counts = client.get(
        f"/api/v1/chat/rooms/{room_id}/unread-counts", headers=member["auth"]
    ).json()["unread_counts"]
    assert counts[msg["id"]] == 0
