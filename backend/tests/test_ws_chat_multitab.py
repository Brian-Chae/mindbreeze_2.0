"""WS `/chat` 멀티탭 회귀 — sid→user_id 역추적(CHAT-MULTITAB).

같은 사용자가 탭을 2개 이상 열면 소켓 sid 는 여러 개지만 user_id 는 하나다.
`_user_sids`(user_id→latest sid) 만으로 sid 를 역추적하면 먼저 연 탭의 sid 가
해석되지 않아 방 입장/메시지 전송이 차단된다. `_sid_users`(sid→user_id) 매핑으로
모든 탭 sid 가 본인 user_id 로 정확히 해석되는지 검증한다.

핸들러를 직접 호출하고, 모듈 전역 `sio` 를 FakeChatSio 로, DB 멤버십 조회를
monkeypatch 로 격리한다.
"""

import asyncio

import app.ws.chat_namespace as chat


class FakeChatSio:
    """AsyncServer 인터페이스 최소 모사 — enter/leave room + emit 기록."""

    def __init__(self):
        self.rooms = {}          # sid -> set(room)
        self.emits = []          # 기록된 emit
        self.sessions = {}       # sid -> dict

    async def enter_room(self, sid, room, namespace=None):
        self.rooms.setdefault(sid, set()).add(room)

    async def leave_room(self, sid, room, namespace=None):
        self.rooms.get(sid, set()).discard(room)

    async def emit(self, event, data=None, room=None, to=None, namespace=None):
        self.emits.append(
            {"event": event, "data": data, "room": room, "to": to, "namespace": namespace}
        )

    async def save_session(self, sid, data, namespace=None):
        self.sessions[sid] = data

    async def get_session(self, sid, namespace=None):
        return self.sessions.get(sid, {})


def _wire(monkeypatch):
    """FakeChatSio + 토큰/멤버십 격리. (fake, seen) 반환."""
    fake = FakeChatSio()
    monkeypatch.setattr(chat, "sio", fake)
    monkeypatch.setattr("app.core.security.decode_token", lambda token: {"sub": "user-1"})

    seen: dict = {}

    def fake_room_ids(user_id, db):
        seen["last_user"] = user_id
        return ["room-1"]

    monkeypatch.setattr("app.services.chat_service.get_user_chat_room_ids", fake_room_ids)

    class _DB:
        def close(self):
            pass

    monkeypatch.setattr("app.core.database.SessionLocal", lambda: _DB())

    chat._sid_users.clear()
    chat._user_sids.clear()
    return fake, seen


def test_멀티탭_두탭_모두_본인_user로_역추적(monkeypatch):
    _fake, seen = _wire(monkeypatch)

    asyncio.run(chat.connect("sid1", {}, {"token": "t"}))
    asyncio.run(chat.connect("sid2", {}, {"token": "t"}))

    # 두 sid 모두 본인 user_id 로 매핑된다(latest sid 만 남기지 않는다)
    assert chat._sid_users == {"sid1": "user-1", "sid2": "user-1"}

    # 먼저 연 탭 sid1 도 멤버십 판정이 통과한다(수정 전엔 차단됨)
    assert asyncio.run(chat._is_room_member("sid1", "room-1")) is True
    assert seen["last_user"] == "user-1"
    assert asyncio.run(chat._is_room_member("sid2", "room-1")) is True


def test_멀티탭_먼저연탭_입장_메시지_허용(monkeypatch):
    fake, _seen = _wire(monkeypatch)

    asyncio.run(chat.connect("sid1", {}, {"token": "t"}))
    asyncio.run(chat.connect("sid2", {}, {"token": "t"}))

    # 먼저 연 탭(sid1)의 join → joined emit (수정 전엔 비멤버로 차단)
    asyncio.run(chat.on_join("sid1", {"room_id": "room-1"}))
    assert [e for e in fake.emits if e["event"] == "joined" and e["to"] == "sid1"]

    # 먼저 연 탭(sid1)의 메시지 → room 브로드캐스트
    asyncio.run(chat.on_message("sid1", {"room_id": "room-1", "content": "안녕"}))
    assert [e for e in fake.emits if e["event"] == "new_message" and e["room"] == "room-1"]


def test_멀티탭_한탭_종료해도_다른탭_유지(monkeypatch):
    _fake, _seen = _wire(monkeypatch)

    asyncio.run(chat.connect("sid1", {}, {"token": "t"}))
    asyncio.run(chat.connect("sid2", {}, {"token": "t"}))

    asyncio.run(chat.disconnect("sid1"))
    assert "sid1" not in chat._sid_users
    assert chat._sid_users.get("sid2") == "user-1"
    assert asyncio.run(chat._is_room_member("sid2", "room-1")) is True
