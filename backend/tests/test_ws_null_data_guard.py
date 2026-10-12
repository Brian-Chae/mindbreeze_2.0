"""WS-NO-DATA-GUARD — `data` 가 dict 가 아니어도(None·list·str) 핸들러가
AttributeError 로 죽지 않고 조용히 무시하는지 검증한다.

Socket.IO 핸들러는 클라이언트가 임의 페이로드를 보낼 수 있으므로 `data.get(...)`
직전에 dict 가드가 필요하다. 가드가 없으면 `None.get(...)` → 500/예외로 연결이 끊긴다.
"""

import asyncio

import app.ws.chat_namespace as chat


class FakeChatSio:
    """AsyncServer 인터페이스 최소 모사 — enter/leave room + emit 기록."""

    def __init__(self):
        self.rooms = {}
        self.emits = []
        self.sessions = {}

    async def enter_room(self, sid, room, namespace=None):
        self.rooms.setdefault(sid, set()).add(room)

    async def leave_room(self, sid, room, namespace=None):
        self.rooms.get(sid, set()).discard(room)

    async def emit(self, event, data=None, room=None, to=None, namespace=None):
        self.emits.append({"event": event, "data": data, "room": room, "to": to})

    async def save_session(self, sid, data, namespace=None):
        self.sessions[sid] = data

    async def get_session(self, sid, namespace=None):
        return self.sessions.get(sid, {})


def _wire_chat(monkeypatch):
    fake = FakeChatSio()
    monkeypatch.setattr(chat, "sio", fake)
    monkeypatch.setattr("app.core.security.decode_token", lambda token: {"sub": "user-1"})
    monkeypatch.setattr(
        "app.services.chat_service.get_user_chat_room_ids", lambda user_id, db: ["room-1"]
    )

    class _DB:
        def close(self):
            pass

    monkeypatch.setattr("app.core.database.SessionLocal", lambda: _DB())
    chat._sid_users.clear()
    chat._user_sids.clear()
    return fake


def test_chat_핸들러_비dict_data_무시(monkeypatch):
    fake = _wire_chat(monkeypatch)
    asyncio.run(chat.connect("sid1", {}, {"token": "t"}))

    for bad in (None, ["not", "dict"], "string", 123):
        asyncio.run(chat.on_join("sid1", bad))
        asyncio.run(chat.on_leave("sid1", bad))
        asyncio.run(chat.on_message("sid1", bad))

    # 어떤 방에도 입장/브로드캐스트하지 않는다
    assert "room-1" not in fake.rooms.get("sid1", set())
    assert not [e for e in fake.emits if e["event"] in ("joined", "new_message")]


class FakeRecordSio:
    """register_record_namespace 등록용 최소 모사."""

    def __init__(self):
        self.handlers = {}

    def event(self, namespace=None):
        def deco(fn):
            return fn

        return deco

    def on(self, name, namespace=None):
        def deco(fn):
            self.handlers[name] = fn
            return fn

        return deco

    async def enter_room(self, sid, room, namespace=None):
        pass

    async def leave_room(self, sid, room, namespace=None):
        pass

    async def emit(self, *args, **kwargs):
        pass

    async def save_session(self, sid, data, namespace=None):
        pass

    async def get_session(self, sid, namespace=None):
        return {}


def test_record_핸들러_비dict_data_무시():
    from app.ws import record_namespace

    fake = FakeRecordSio()
    record_namespace.register_record_namespace(fake)

    for bad in (None, ["x"], "str"):
        asyncio.run(fake.handlers["subscribe"]("sid1", bad))
        asyncio.run(fake.handlers["unsubscribe"]("sid1", bad))
