"""SDD-093 채팅 딥링크와 메시지별 알림 읽음 회귀 검증."""
from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest

from app.api.deps import get_current_user
from app.core.database import get_db
from app.main import app
from app.models.chat import ChatMessage, ChatRoom, ChatRoomParticipant
from app.models.notification import Notification
from app.models.user import User
from app.services.notification_service import build_standard_extra


@pytest.fixture
def chat_data(client):
    gen = app.dependency_overrides[get_db]()
    db = next(gen)
    host = User(id=uuid4(), email="host093@test.com", name="상담사", role="counselor", status="active", password_hash="unused")
    member = User(id=uuid4(), email="member093@test.com", name="내담자", role="client", status="active", password_hash="unused")
    db.add_all([host, member])
    db.flush()
    room = ChatRoom(room_type="group", host_id=host.id, name=str(member.id))
    other = ChatRoom(room_type="group", host_id=host.id, name=str(member.id))
    db.add_all([room, other])
    db.flush()
    db.add_all([ChatRoomParticipant(room_id=r.id, user_id=member.id) for r in (room, other)])
    # 동일 시각에서도 UUID 순서로 안정적인 구간을 보장해야 한다.
    messages = [ChatMessage(id=UUID(int=i + 1), room_id=room.id, sender_id=host.id,
                            content=str(i), type="text", created_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
                for i in range(65)]
    foreign = ChatMessage(room_id=other.id, sender_id=host.id, content="다른 방", type="text")
    db.add_all([*messages, foreign])
    db.commit()
    app.dependency_overrides[get_current_user] = lambda: {"id": str(member.id), "role": "client"}
    yield db, host, member, room, other, messages, foreign
    app.dependency_overrides.pop(get_current_user, None)
    gen.close()


def test_주변조회_오래된_메시지_동일시각_커서(client, chat_data):
    db, host, member, room, other, messages, foreign = chat_data
    url = f"/api/v1/chat/rooms/{room.id}/messages/{messages[5].id}/context"
    res = client.get(url, params={"before": 2, "after": 3})
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["message"]["id"] == str(messages[5].id)
    assert [m["id"] for m in data["before"]] == [str(m.id) for m in messages[3:5]]
    assert [m["id"] for m in data["after"]] == [str(m.id) for m in messages[6:9]]
    assert data["before_cursor"] == str(messages[3].id)
    assert data["after_cursor"] == str(messages[8].id)
    assert client.get(url, params={"before": 51}).status_code == 422
    # 반환된 커서를 앵커로 삼아 이전 구간을 계속 조회한다.
    page = client.get(f"/api/v1/chat/rooms/{room.id}/messages/{data['before_cursor']}/context", params={"before": 3, "after": 0}).json()
    assert [m["id"] for m in page["before"]] == [str(m.id) for m in messages[:3]]
    assert page["before_cursor"] is None


def test_주변조회_권한우선_방불일치_없는메시지(client, chat_data):
    db, host, member, room, other, messages, foreign = chat_data
    prefix = f"/api/v1/chat/rooms/{room.id}/messages"
    assert client.get(f"{prefix}/{foreign.id}/context").status_code == 404
    assert client.get(f"{prefix}/{uuid4()}/context").status_code == 404
    assert client.get(f"{prefix}/invalid/context").status_code == 400
    app.dependency_overrides[get_current_user] = lambda: {"id": str(uuid4()), "role": "client"}
    assert client.get(f"{prefix}/{messages[0].id}/context").status_code == 403
    assert client.get(f"{prefix}/{uuid4()}/context").status_code == 403


@pytest.mark.parametrize("whole_room", [False, True])
def test_읽음은_사용자_방_메시지가_일치한_알림만(client, chat_data, whole_room):
    db, host, member, room, other, messages, foreign = chat_data
    def add(user, rid, mid=None, event="chat_message"):
        extra = build_standard_extra(event, "chat_room", str(rid),
                                     params={"message_id": str(mid)} if mid else {}, legacy={"room_id": str(rid)})
        n = Notification(user_id=user.id, type="chat", title="알림", extra=extra)
        db.add(n)
        return n
    matched = add(member, room.id, messages[0].id)
    later = add(member, room.id, messages[1].id)
    excluded = [add(host, room.id, messages[0].id), add(member, other.id, messages[0].id),
                add(member, room.id, foreign.id), add(member, room.id),
                add(member, room.id, messages[0].id, "chat_room_invited")]
    db.commit()
    if whole_room:
        res = client.put(f"/api/v1/chat/rooms/{room.id}/read")
    else:
        res = client.post(f"/api/v1/chat/rooms/{room.id}/messages/read", json={"message_ids": [str(messages[0].id), str(foreign.id)]})
    assert res.status_code == 204, res.text
    db.expire_all()
    assert matched.is_read
    assert later.is_read == whole_room
    assert all(not n.is_read for n in excluded)


def test_프론트_주변조회_계약_최신순(client, chat_data):
    db, host, member, room, other, messages, foreign = chat_data
    res = client.get(f"/api/v1/chat/rooms/{room.id}/messages-around", params={"message_id": str(messages[5].id), "before": 2, "after": 3})
    assert res.status_code == 200, res.text
    data = res.json()
    assert [m["id"] for m in data["messages"]] == [str(m.id) for m in reversed(messages[3:9])]
    assert data["next_cursor"] == str(messages[3].id)


def test_주변조회_동일상담사의_다른내담자_차단(client, chat_data):
    from app.models.client_counselor_link import ClientCounselorLink

    db, host, member, room, other, messages, foreign = chat_data
    room.room_type = "direct"
    room.name = str(uuid4())
    db.add(ClientCounselorLink(counselor_id=host.id, client_id=member.id))
    db.commit()
    res = client.get(f"/api/v1/chat/rooms/{room.id}/messages/{messages[0].id}/context")
    assert res.status_code == 403
