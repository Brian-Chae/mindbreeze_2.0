"""F6 채팅 QA — REST API 검증"""

from datetime import datetime, timedelta, timezone

VALID_PASSWORD = "Passw0rd!"


def _register(client, email: str, role: str = "counselor") -> dict:
    from app.services import email_verify_service
    from tests.conftest import create_test_org

    payload = {
        # SDD-015: 상담사 가입에 유효한 기관 코드 필수 (client 가입에서는 무시됨)
        "org_code": create_test_org(),
        "email": email,
        "password": VALID_PASSWORD,
        "name": "테스트",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": {"tos": True, "privacy": True, "sensitive": True},
    }
    from tests.conftest import post_register
    res = post_register(client, role, payload)
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


# ── Phase 3a: 읽음/안읽음 백엔드 테스트 ──

def test_11_메시지_recipient_count_설정(client):
    """메시지 발송 시 recipient_count가 올바르게 설정되는지 확인"""
    host = _register(client, "chat11host@test.com")
    participant = _register(client, "chat11p@test.com", role="client")
    s = _create_session(
        client, host["auth"],
        type="meditation", max_participants=5,
    )
    client.post(
        f"/api/v1/sessions/{s['id']}/invite",
        json={"user_id": participant["id"]},
        headers=host["auth"],
    )
    room_id = _room_for_session(client, host["auth"], s["id"])
    # 메시지 발송
    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/messages",
        json={"content": "안녕하세요", "type": "text"},
        headers=host["auth"],
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["recipient_count"] >= 1
    # 발신자는 자동 읽음 (read_by에 포함)
    assert host["id"] in body["read_by"]


def test_12_batch_메시지_읽음_처리(client):
    """POST /messages/read로 여러 메시지를 한 번에 읽음 처리"""
    host = _register(client, "chat12host@test.com")
    participant = _register(client, "chat12p@test.com", role="client")
    s = _create_session(
        client, host["auth"],
        type="meditation", max_participants=5,
    )
    client.post(
        f"/api/v1/sessions/{s['id']}/invite",
        json={"user_id": participant["id"]},
        headers=host["auth"],
    )
    room_id = _room_for_session(client, host["auth"], s["id"])
    # 여러 메시지 발송
    msg_ids = []
    for i in range(3):
        res = client.post(
            f"/api/v1/chat/rooms/{room_id}/messages",
            json={"content": f"메시지 {i+1}", "type": "text"},
            headers=host["auth"],
        )
        assert res.status_code == 201
        msg_ids.append(res.json()["id"])

    # 참여자가 batch 읽음 처리
    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/messages/read",
        json={"message_ids": msg_ids},
        headers=participant["auth"],
    )
    assert res.status_code == 204

    # unread-counts 확인
    counts_res = client.get(
        f"/api/v1/chat/rooms/{room_id}/unread-counts",
        headers=participant["auth"],
    )
    assert counts_res.status_code == 200
    counts = counts_res.json()["unread_counts"]
    # 참여자가 모두 읽었으므로 모든 메시지의 unread_count가 0
    for mid in msg_ids:
        assert counts[mid] == 0, f"메시지 {mid}의 unread_count가 0이어야 함"


def test_13_unread_counts_권한_없는_사용자_403(client):
    """권한 없는 사용자가 unread-counts 호출 시 403"""
    host = _register(client, "chat13host@test.com")
    other = _register(client, "chat13other@test.com")
    s = _create_session(client, host["auth"])
    room_id = _room_for_session(client, host["auth"], s["id"])
    res = client.get(
        f"/api/v1/chat/rooms/{room_id}/unread-counts",
        headers=other["auth"],
    )
    assert res.status_code == 403


def test_14_mark_messages_read_빈_목록(client):
    """빈 message_ids로 읽음 처리 시도"""
    host = _register(client, "chat14host@test.com")
    s = _create_session(client, host["auth"])
    room_id = _room_for_session(client, host["auth"], s["id"])
    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/messages/read",
        json={"message_ids": []},
        headers=host["auth"],
    )
    # 빈 목록은 422 (min_length=1)
    assert res.status_code == 422


def test_15_messages_read_없는_메시지_ID(client):
    """존재하지 않는 message_id를 포함한 읽음 처리"""
    host = _register(client, "chat15host@test.com")
    s = _create_session(client, host["auth"])
    room_id = _room_for_session(client, host["auth"], s["id"])
    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/messages/read",
        json={"message_ids": ["00000000-0000-0000-0000-000000000000"]},
        headers=host["auth"],
    )
    # 존재하지 않는 메시지여도 204 반환 (조용히 무시)
    assert res.status_code == 204


def test_16_unread_counts_빈_방(client):
    """메시지가 없는 방의 unread-counts"""
    host = _register(client, "chat16@test.com")
    s = _create_session(client, host["auth"])
    room_id = _room_for_session(client, host["auth"], s["id"])
    res = client.get(
        f"/api/v1/chat/rooms/{room_id}/unread-counts",
        headers=host["auth"],
    )
    assert res.status_code == 200
    counts = res.json()["unread_counts"]
    assert counts == {}


def test_17_발신자_자동읽음_확인(client):
    """메시지 발신자는 자동으로 read_by에 포함되는지 확인"""
    host = _register(client, "chat17host@test.com")
    s = _create_session(client, host["auth"])
    room_id = _room_for_session(client, host["auth"], s["id"])
    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/messages",
        json={"content": "테스트", "type": "text"},
        headers=host["auth"],
    )
    assert res.status_code == 201
    body = res.json()
    assert body["unread_count"] == 0  # 발신자는 자동 읽음이므로 unread=0
    assert host["id"] in body["read_by"]
    assert body["recipient_count"] >= 1


# ── SDD-090: 채팅방 정렬 · 설정(이름 변경) · 그룹 참여자 관리 ──


def _test_db():
    """테스트 DB 세션 획득 (test_10 패턴). (generator, session) 반환."""
    from app.core.database import get_db
    from app.main import app as fastapi_app

    db_gen = fastapi_app.dependency_overrides[get_db]()
    return db_gen, next(db_gen)


def _close_db(db_gen):
    try:
        next(db_gen)
    except StopIteration:
        pass


def _link(counselor_id: str, client_id: str):
    """상담사-내담자 연결(ClientCounselorLink) 직접 생성."""
    from app.models.client_counselor_link import ClientCounselorLink

    db_gen, db = _test_db()
    try:
        db.add(ClientCounselorLink(client_id=client_id, counselor_id=counselor_id))
        db.commit()
    finally:
        _close_db(db_gen)


def _bump_last_message(room_id: str, minutes: int):
    """방의 마지막 메시지 created_at을 미래로 이동 (SQLite 초 단위 동률 회피)."""
    from datetime import datetime as dt, timedelta as td
    from app.models.chat import ChatMessage

    db_gen, db = _test_db()
    try:
        msg = (
            db.query(ChatMessage)
            .filter(ChatMessage.room_id == room_id)
            .order_by(ChatMessage.created_at.desc())
            .first()
        )
        assert msg is not None
        msg.created_at = dt.utcnow() + td(minutes=minutes)
        db.commit()
    finally:
        _close_db(db_gen)


def test_18_방목록_last_message_정렬(client):
    """마지막 메시지가 최신인 방이 목록 최상단 + last_message 미리보기 포함"""
    host = _register(client, "chat18@test.com")
    s1 = _create_session(client, host["auth"], title="첫 세션")
    s2 = _create_session(client, host["auth"], title="둘째 세션", scheduled_at=_future(240))
    room1 = _room_for_session(client, host["auth"], s1["id"])
    res = client.post(
        f"/api/v1/chat/rooms/{room1}/messages",
        json={"content": "정렬 테스트", "type": "text"},
        headers=host["auth"],
    )
    assert res.status_code == 201
    _bump_last_message(room1, minutes=10)

    rooms = client.get("/api/v1/chat/rooms", headers=host["auth"]).json()["rooms"]
    assert rooms[0]["id"] == room1  # 최근 대화 방이 최상단
    assert rooms[0]["last_message"]["content"] == "정렬 테스트"
    assert rooms[0]["last_message_at"] is not None
    # 메시지 없는 방은 last_message null (하위 호환 필드 유지)
    room2 = next(r for r in rooms if r["session_id"] == s2["id"])
    assert room2["last_message"] is None
    assert room2["last_message_at"] is None


def test_19_last_message_이미지_대체문구(client):
    """마지막 메시지가 image면 미리보기 content는 '사진'"""
    host = _register(client, "chat19@test.com")
    s = _create_session(client, host["auth"])
    room_id = _room_for_session(client, host["auth"], s["id"])
    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/messages",
        json={"content": "cat.png", "type": "image", "file_url": "https://x/cat.png"},
        headers=host["auth"],
    )
    assert res.status_code == 201
    rooms = client.get("/api/v1/chat/rooms", headers=host["auth"]).json()["rooms"]
    target = next(r for r in rooms if r["id"] == room_id)
    assert target["last_message"]["content"] == "사진"


def test_20_그룹방_이름변경_host_성공(client):
    host = _register(client, "chat20host@test.com")
    member = _register(client, "chat20c@test.com", role="client")
    _link(host["id"], member["id"])
    res = client.post(
        "/api/v1/chat/rooms",
        json={"room_type": "group", "participant_ids": [member["id"]], "name": "원래 이름"},
        headers=host["auth"],
    )
    assert res.status_code == 201, res.text
    room_id = res.json()["id"]
    res = client.patch(
        f"/api/v1/chat/rooms/{room_id}",
        json={"name": "  새 그룹 이름  "},
        headers=host["auth"],
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["name"] == "새 그룹 이름"  # group은 name 갱신 (trim 적용)
    assert body["custom_name"] == "새 그룹 이름"
    assert body["display_name"] == "새 그룹 이름"
    assert body["can_rename"] is True
    assert body["rename_disabled_reason"] is None


def test_21_direct_이름변경_name필드_보존(client):
    """direct 방 이름 변경 시 name(=내담자 ID)은 보존, display_name에만 저장"""
    host = _register(client, "chat21host@test.com")
    member = _register(client, "chat21c@test.com", role="client")
    _link(host["id"], member["id"])
    res = client.post(
        "/api/v1/chat/rooms",
        json={"room_type": "direct", "client_id": member["id"]},
        headers=host["auth"],
    )
    assert res.status_code == 201, res.text
    room_id = res.json()["id"]
    res = client.patch(
        f"/api/v1/chat/rooms/{room_id}",
        json={"name": "우리 상담방"},
        headers=host["auth"],
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["name"] == member["id"]  # 내담자 ID 저장소 보존
    assert body["custom_name"] == "우리 상담방"
    assert body["display_name"] == "우리 상담방"
    # 방 재사용 생성 요청이 이름을 덮어쓰지 않는지 회귀 확인
    res2 = client.post(
        "/api/v1/chat/rooms",
        json={"room_type": "direct", "client_id": member["id"], "name": "다른이름"},
        headers=host["auth"],
    )
    assert res2.status_code == 201
    assert res2.json()["id"] == room_id
    assert res2.json()["custom_name"] == "우리 상담방"


def test_22_비host_이름변경_403(client):
    """내담자(비 host)는 direct 방 이름 변경 불가 + can_rename 필드 확인"""
    host = _register(client, "chat22host@test.com")
    member = _register(client, "chat22c@test.com", role="client")
    _link(host["id"], member["id"])
    res = client.post(
        "/api/v1/chat/rooms",
        json={"room_type": "direct", "client_id": member["id"]},
        headers=host["auth"],
    )
    room_id = res.json()["id"]
    res = client.patch(
        f"/api/v1/chat/rooms/{room_id}",
        json={"name": "내 마음대로"},
        headers=member["auth"],
    )
    assert res.status_code == 403
    # 내담자 조회 시 can_rename=false / not_host
    info = client.get(f"/api/v1/chat/rooms/{room_id}", headers=member["auth"]).json()
    assert info["can_rename"] is False
    assert info["rename_disabled_reason"] == "not_host"


def test_23_session방_이름변경_403(client):
    """session 방은 host여도 이름 변경 403 (세션 제목을 따름)"""
    host = _register(client, "chat23@test.com")
    s = _create_session(client, host["auth"])
    room_id = _room_for_session(client, host["auth"], s["id"])
    res = client.patch(
        f"/api/v1/chat/rooms/{room_id}",
        json={"name": "바꿔보기"},
        headers=host["auth"],
    )
    assert res.status_code == 403
    info = client.get(f"/api/v1/chat/rooms/{room_id}", headers=host["auth"]).json()
    assert info["can_rename"] is False
    assert info["rename_disabled_reason"] == "session_managed"


def test_24_이름_유효성_422(client):
    host = _register(client, "chat24host@test.com")
    member = _register(client, "chat24c@test.com", role="client")
    _link(host["id"], member["id"])
    res = client.post(
        "/api/v1/chat/rooms",
        json={"room_type": "group", "participant_ids": [member["id"]], "name": "그룹"},
        headers=host["auth"],
    )
    room_id = res.json()["id"]
    # 공백만
    assert client.patch(
        f"/api/v1/chat/rooms/{room_id}", json={"name": "   "}, headers=host["auth"]
    ).status_code == 422
    # 121자
    assert client.patch(
        f"/api/v1/chat/rooms/{room_id}", json={"name": "가" * 121}, headers=host["auth"]
    ).status_code == 422
    # 줄바꿈 포함
    assert client.patch(
        f"/api/v1/chat/rooms/{room_id}", json={"name": "줄\n바꿈"}, headers=host["auth"]
    ).status_code == 422
    # 허용하지 않은 필드
    assert client.patch(
        f"/api/v1/chat/rooms/{room_id}",
        json={"name": "정상", "host_id": host["id"]},
        headers=host["auth"],
    ).status_code == 422
    # 120자는 성공
    assert client.patch(
        f"/api/v1/chat/rooms/{room_id}", json={"name": "가" * 120}, headers=host["auth"]
    ).status_code == 200


def test_25_그룹_참여자_추가(client):
    host = _register(client, "chat25host@test.com")
    m1 = _register(client, "chat25c1@test.com", role="client")
    m2 = _register(client, "chat25c2@test.com", role="client")
    _link(host["id"], m1["id"])
    _link(host["id"], m2["id"])
    res = client.post(
        "/api/v1/chat/rooms",
        json={"room_type": "group", "participant_ids": [m1["id"]], "name": "그룹"},
        headers=host["auth"],
    )
    room_id = res.json()["id"]
    assert res.json()["participant_count"] == 2  # m1 + host

    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/participants",
        json={"participant_ids": [m2["id"]]},
        headers=host["auth"],
    )
    assert res.status_code == 200, res.text
    assert res.json()["participant_count"] == 3
    # 추가된 참여자는 방 접근 가능
    res = client.get(f"/api/v1/chat/rooms/{room_id}/messages", headers=m2["auth"])
    assert res.status_code == 200
    # 중복 추가는 무시 (참여자 수 불변)
    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/participants",
        json={"participant_ids": [m2["id"]]},
        headers=host["auth"],
    )
    assert res.status_code == 200
    assert res.json()["participant_count"] == 3


def test_26_참여자_추가_비host_403(client):
    host = _register(client, "chat26host@test.com")
    m1 = _register(client, "chat26c1@test.com", role="client")
    m2 = _register(client, "chat26c2@test.com", role="client")
    _link(host["id"], m1["id"])
    res = client.post(
        "/api/v1/chat/rooms",
        json={"room_type": "group", "participant_ids": [m1["id"]], "name": "그룹"},
        headers=host["auth"],
    )
    room_id = res.json()["id"]
    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/participants",
        json={"participant_ids": [m2["id"]]},
        headers=m1["auth"],
    )
    assert res.status_code == 403


def test_27_참여자_내보내기_접근회수(client):
    host = _register(client, "chat27host@test.com")
    m1 = _register(client, "chat27c1@test.com", role="client")
    _link(host["id"], m1["id"])
    res = client.post(
        "/api/v1/chat/rooms",
        json={"room_type": "group", "participant_ids": [m1["id"]], "name": "그룹"},
        headers=host["auth"],
    )
    room_id = res.json()["id"]
    assert client.get(f"/api/v1/chat/rooms/{room_id}/messages", headers=m1["auth"]).status_code == 200

    res = client.delete(
        f"/api/v1/chat/rooms/{room_id}/participants/{m1['id']}",
        headers=host["auth"],
    )
    assert res.status_code == 204
    # 내보낸 참여자는 즉시 접근 회수
    assert client.get(f"/api/v1/chat/rooms/{room_id}/messages", headers=m1["auth"]).status_code == 403
    # 이미 내보낸 참여자 재삭제는 404
    res = client.delete(
        f"/api/v1/chat/rooms/{room_id}/participants/{m1['id']}",
        headers=host["auth"],
    )
    assert res.status_code == 404


def test_28_direct방_참여자관리_403(client):
    """direct/session 방은 참여자 관리 제외 (group 전용)"""
    host = _register(client, "chat28host@test.com")
    member = _register(client, "chat28c@test.com", role="client")
    other = _register(client, "chat28o@test.com", role="client")
    _link(host["id"], member["id"])
    res = client.post(
        "/api/v1/chat/rooms",
        json={"room_type": "direct", "client_id": member["id"]},
        headers=host["auth"],
    )
    room_id = res.json()["id"]
    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/participants",
        json={"participant_ids": [other["id"]]},
        headers=host["auth"],
    )
    assert res.status_code == 403
    # session 방도 동일
    s = _create_session(client, host["auth"])
    session_room = _room_for_session(client, host["auth"], s["id"])
    res = client.post(
        f"/api/v1/chat/rooms/{session_room}/participants",
        json={"participant_ids": [other["id"]]},
        headers=host["auth"],
    )
    assert res.status_code == 403


def test_29_참여자_추가_미연결_403(client):
    """연결(Link)도 공유 기관도 없는 사용자 추가는 403"""
    host = _register(client, "chat29host@test.com")
    m1 = _register(client, "chat29c1@test.com", role="client")
    stranger = _register(client, "chat29s@test.com", role="client")
    _link(host["id"], m1["id"])
    res = client.post(
        "/api/v1/chat/rooms",
        json={"room_type": "group", "participant_ids": [m1["id"]], "name": "그룹"},
        headers=host["auth"],
    )
    room_id = res.json()["id"]
    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/participants",
        json={"participant_ids": [stranger["id"]]},
        headers=host["auth"],
    )
    assert res.status_code == 403
