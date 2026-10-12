"""WS 기능상 오류(중) 4건 회귀 검증 — 2026-10 기능오류.

검증 대상:
  [1] WS-02 `/session-live`·`/record` connect 토큰 type=access 검증(비-access 거부).
  [2] WS-03 정지(suspended)/대기(pending)/삭제 계정의 소켓 connect·join 차단.
  [3] WS-06 `on_leave` 가 payload session_id 를 소켓 세션 컨텍스트와 대조(위조 차단).
  [4] WS-08 async WS 핸들러의 동기 SQLAlchemy 조회가 이벤트 루프를 블로킹하지 않도록
           `asyncio.to_thread` 로 격리되었는지 확인.

핸들러는 FakeSio 로 직접 호출하고, DB 는 REST 와 동일한 인메모리 세션을 공유하도록
`_open_db`/`_get_sio` 를 monkeypatch 한다.
"""

import asyncio
import threading
import uuid

import pytest
from socketio.exceptions import ConnectionRefusedError

from app.core.database import get_db
from app.core.security import create_access_token, create_refresh_token
from app.main import app
from app.models.user import User

VALID_PASSWORD = "Passw0rd!"


def _db():
    provider = app.dependency_overrides[get_db]()
    return next(provider), provider


def _set_user_status(user_id, status):
    db, provider = _db()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        assert user is not None
        user.status = status
        db.commit()
    finally:
        provider.close()


# ---------------------------------------------------------------------------
# WS-02 — 토큰 type=access 검증
# ---------------------------------------------------------------------------


def test_ws02_session_live_refresh_token_refused(client, monkeypatch):
    from tests.test_sdd026_live_session_p0 import _register, _wire

    counselor = _register(client, "ws02-live-refresh@test.com")
    fake = _wire(monkeypatch)
    refresh = create_refresh_token(subject=counselor["id"])
    with pytest.raises(ConnectionRefusedError) as exc:
        fake.call("connect", "sidR", {}, {"token": refresh})
    assert "invalid_token_type" in str(exc.value)


def test_ws02_session_live_access_token_allowed(client, monkeypatch):
    from tests.test_sdd026_live_session_p0 import _register, _wire

    counselor = _register(client, "ws02-live-access@test.com")
    fake = _wire(monkeypatch)
    assert fake.call("connect", "sidA", {}, {"token": counselor["token"]}) is True


class _RecordFakeSio:
    """register_record_namespace 등록용 최소 모사 — 핸들러 캡처 + room/emit 기록."""

    def __init__(self):
        self.handlers = {}
        self.sessions = {}
        self.rooms = {}
        self.emits = []

    def event(self, namespace=None):
        def deco(fn):
            self.handlers[(namespace, fn.__name__)] = fn
            return fn

        return deco

    def on(self, name, namespace=None):
        def deco(fn):
            self.handlers[(namespace, name)] = fn
            return fn

        return deco

    async def save_session(self, sid, data, namespace=None):
        self.sessions[sid] = data

    async def get_session(self, sid, namespace=None):
        return self.sessions.get(sid, {})

    async def enter_room(self, sid, room, namespace=None):
        self.rooms.setdefault(sid, set()).add(room)

    async def leave_room(self, sid, room, namespace=None):
        self.rooms.get(sid, set()).discard(room)

    async def emit(self, event, data=None, room=None, to=None, namespace=None):
        self.emits.append({"event": event, "data": data, "room": room, "to": to})


def _record_fake():
    from app.ws import record_namespace

    fake = _RecordFakeSio()
    record_namespace.register_record_namespace(fake)
    return fake


def _record_connect(fake, sid, auth):
    return asyncio.run(fake.handlers[("/record", "connect")](sid, {}, auth))


def test_ws02_record_refresh_token_refused():
    fake = _record_fake()
    refresh = create_refresh_token(subject=str(uuid.uuid4()))
    assert _record_connect(fake, "sidR", {"token": refresh}) is False


def test_ws02_record_invalid_token_refused():
    fake = _record_fake()
    assert _record_connect(fake, "sidB", {"token": "not-a-valid-jwt"}) is False


def test_ws02_record_access_token_allowed(client):
    from tests.test_sdd026_live_session_p0 import _register

    counselor = _register(client, "ws02-rec-access@test.com")
    fake = _record_fake()
    assert _record_connect(fake, "sidA", {"token": counselor["token"]}) is True


# ---------------------------------------------------------------------------
# WS-03 — 계정 상태(비활성) 차단
# ---------------------------------------------------------------------------


def test_ws03_session_live_suspended_refused(client, monkeypatch):
    from tests.test_sdd026_live_session_p0 import _register, _wire

    counselor = _register(client, "ws03-live-susp@test.com")
    _set_user_status(counselor["id"], "suspended")
    fake = _wire(monkeypatch)
    with pytest.raises(ConnectionRefusedError) as exc:
        fake.call("connect", "sidS", {}, {"token": counselor["token"]})
    assert "account_inactive" in str(exc.value)


def test_ws03_session_live_pending_refused(client, monkeypatch):
    from tests.test_sdd026_live_session_p0 import _register, _wire

    counselor = _register(client, "ws03-live-pend@test.com")
    _set_user_status(counselor["id"], "pending")
    fake = _wire(monkeypatch)
    with pytest.raises(ConnectionRefusedError):
        fake.call("connect", "sidP", {}, {"token": counselor["token"]})


def test_ws03_session_live_deleted_or_unknown_user_refused(client, monkeypatch):
    """행이 없는(삭제된) 계정의 유효 토큰도 연결을 거부한다."""
    from tests.test_sdd026_live_session_p0 import _wire

    fake = _wire(monkeypatch)
    token = create_access_token(subject=str(uuid.uuid4()))
    with pytest.raises(ConnectionRefusedError):
        fake.call("connect", "sidD", {}, {"token": token})


def test_ws03_session_live_guest_without_token_still_allowed(client, monkeypatch):
    from tests.test_sdd026_live_session_p0 import _wire

    fake = _wire(monkeypatch)
    assert fake.call("connect", "sidG", {}, {}) is True


def test_ws03_session_live_join_denied_when_account_inactive(client, monkeypatch):
    """connect 이후 정지된 계정의 join 도 거부한다(join 시점 상태 재확인)."""
    from tests.test_sdd026_live_session_p0 import _create_group_class, _register, _wire

    counselor = _register(client, "ws03-live-join@test.com")
    cls = _create_group_class(client, counselor["h"])
    fake = _wire(monkeypatch)

    fake.call("connect", "sidH", {}, {"token": counselor["token"]})
    _set_user_status(counselor["id"], "suspended")
    fake.call("join", "sidH", {"session_id": cls["id"]})

    assert fake.events("join_denied"), "비활성 계정 join 이 거부되지 않았다"
    assert fake.rooms_of("sidH") == set()


def test_ws03_record_suspended_refused(client):
    from tests.test_sdd026_live_session_p0 import _register

    counselor = _register(client, "ws03-rec-susp@test.com")
    _set_user_status(counselor["id"], "suspended")
    fake = _record_fake()
    assert _record_connect(fake, "sidS", {"token": counselor["token"]}) is False


# ---------------------------------------------------------------------------
# WS-06 — on_leave session_id 대조
# ---------------------------------------------------------------------------


def test_ws06_leave_ignores_mismatched_session_id(client, monkeypatch):
    from tests.test_sdd026_live_session_p0 import _create_group_class, _register, _wire

    counselor = _register(client, "ws06-leave@test.com")
    cls_a = _create_group_class(client, counselor["h"], title="WS06-A")
    cls_b = _create_group_class(client, counselor["h"], title="WS06-B")
    fake = _wire(monkeypatch)

    fake.call("connect", "sidH", {}, {"token": counselor["token"]})
    fake.call("join", "sidH", {"session_id": cls_a["id"]})

    # 타 세션 id 로 leave → 무시(room 유지)
    fake.call("leave", "sidH", {"session_id": cls_b["id"]})
    rooms = fake.rooms_of("sidH")
    assert f"session:{cls_a['id']}" in rooms
    assert f"session:{cls_a['id']}:all" in rooms

    # 올바른(join 한) 세션 id 로 leave → 퇴장
    fake.call("leave", "sidH", {"session_id": cls_a["id"]})
    rooms = fake.rooms_of("sidH")
    assert f"session:{cls_a['id']}" not in rooms
    assert f"session:{cls_a['id']}:all" not in rooms


# ---------------------------------------------------------------------------
# WS-08 — 동기 DB 조회의 이벤트 루프 격리(asyncio.to_thread)
# ---------------------------------------------------------------------------


def test_ws08_chat_room_membership_runs_off_loop(monkeypatch):
    import app.ws.chat_namespace as chat

    seen: dict = {}

    def fake_check(user_id, room_id):
        seen["thread"] = threading.get_ident()
        return True

    monkeypatch.setattr(chat, "_room_membership_check", fake_check)
    monkeypatch.setitem(chat._sid_users, "sid-x", "user-1")
    loop_thread = threading.get_ident()
    try:
        assert asyncio.run(chat._is_room_member("sid-x", "room-1")) is True
    finally:
        chat._sid_users.pop("sid-x", None)
    assert seen.get("thread") not in (None, loop_thread), "멤버십 조회가 이벤트 루프 스레드에서 실행됨"


def test_ws08_chat_get_user_active_runs_off_loop(monkeypatch):
    import app.ws.chat_namespace as chat
    from tests.test_ws_chat_multitab import _wire

    _wire(monkeypatch)
    seen: dict = {}

    def fake_active(user_id):
        seen["thread"] = threading.get_ident()
        return True

    monkeypatch.setattr(chat, "_user_is_active", fake_active)
    loop_thread = threading.get_ident()
    asyncio.run(chat.connect("sid-c", {}, {"token": "t"}))
    assert seen.get("thread") not in (None, loop_thread), "계정 상태 조회가 이벤트 루프 스레드에서 실행됨"
    chat._sid_users.pop("sid-c", None)
    chat._user_sids.pop("user-1", None)


def test_ws08_record_subscribe_runs_off_loop(monkeypatch):
    from app.ws import record_namespace

    fake = _record_fake()
    fake.sessions["sid-s"] = {"user_id": "user-1"}
    seen: dict = {}

    def fake_authz(session_id, user_id):
        seen["thread"] = threading.get_ident()

    monkeypatch.setattr(record_namespace, "_authorize_subscribe", fake_authz)
    loop_thread = threading.get_ident()
    asyncio.run(fake.handlers[("/record", "subscribe")]("sid-s", {"session_id": "sess-1"}))

    assert seen.get("thread") not in (None, loop_thread), "구독 권한 DB 조회가 이벤트 루프에서 실행됨"
    assert "session:sess-1" in fake.rooms.get("sid-s", set())
