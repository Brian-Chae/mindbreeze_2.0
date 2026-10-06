"""SDD-024 — 클래스별 뇌파 실시간 WebSocket `/session-live` (백엔드) QA

검증 항목:
- connect token 인증 → user_id 세션 보관 (무토큰 허용, 게스트는 participant_id)
- join/leave 로 room(`session:{id}`) 진입/퇴장
- feature emit → EEGFeatureWindow 저장 + room broadcast(eeg_feature)
- 룸 격리: 브로드캐스트 room 이 해당 세션 room 으로 한정
- 멱등: 동일 window_index 재전송 시 저장 skip(saved=0)
- 인증: 비참가자 feature 는 저장 실패 → 브로드캐스트 안 함

Socket.IO 핸들러를 FakeSio 로 잡아 직접 호출하고, DB 는 REST 와 동일한
인메모리 세션을 공유하도록 `_open_db` / `_get_sio` 를 monkeypatch 한다.
"""

import asyncio

import app.ws.session_live_namespace as ns
from app.services import email_verify_service
from tests.conftest import create_test_org

VALID_PASSWORD = "Passw0rd!"


# ---------------------------------------------------------------------------
# FakeSio — AsyncServer 인터페이스 최소 모사 (핸들러 캡처 + emit/room 기록)
# ---------------------------------------------------------------------------


class FakeSio:
    def __init__(self):
        self.handlers = {}          # (namespace, event) -> fn
        self.sessions = {}          # sid -> dict
        self.rooms = {}             # (namespace, sid) -> set(rooms)
        self.emits = []             # 기록된 emit 목록

    def event(self, namespace=None):
        def deco(fn):
            self.handlers[(namespace, fn.__name__)] = fn
            return fn
        return deco

    def on(self, event, namespace=None):
        def deco(fn):
            self.handlers[(namespace, event)] = fn
            return fn
        return deco

    async def save_session(self, sid, data, namespace=None):
        self.sessions[sid] = data

    async def get_session(self, sid, namespace=None):
        return self.sessions.get(sid, {})

    async def enter_room(self, sid, room, namespace=None):
        self.rooms.setdefault((namespace, sid), set()).add(room)

    async def leave_room(self, sid, room, namespace=None):
        self.rooms.get((namespace, sid), set()).discard(room)

    async def emit(self, event, data=None, room=None, to=None, namespace=None):
        self.emits.append(
            {"event": event, "data": data, "room": room, "to": to, "namespace": namespace}
        )

    # 테스트 편의 헬퍼
    def call(self, event, *args):
        fn = self.handlers[("/session-live", event)]
        return asyncio.run(fn(*args))

    def eeg_emits(self):
        return [e for e in self.emits if e["event"] == "eeg_feature"]

    def feature_ack_emits(self):
        return [e for e in self.emits if e["event"] == "feature_ack"]


# ---------------------------------------------------------------------------
# 공통 셋업
# ---------------------------------------------------------------------------


def _register(client, email: str, role: str = "counselor", org_code: str | None = None) -> dict:
    payload = {
        "email": email,
        "password": VALID_PASSWORD,
        "name": f"{role}-{email.split('@')[0]}",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": {"tos": True, "privacy": True, "sensitive": True},
    }
    if role == "counselor":
        payload["org_code"] = org_code if org_code is not None else create_test_org()
    from tests.conftest import post_register
    res = post_register(client, role, payload)
    assert res.status_code == 201, res.text
    body = res.json()
    return {
        "id": body["user"]["id"],
        "token": body["access_token"],
        "h": {"Authorization": f"Bearer {body['access_token']}"},
    }


def _create_group_class(client, headers: dict, **overrides) -> dict:
    payload = {
        "type": "meditation",
        "duration_min": 30,
        "title": "그룹 명상 클래스",
        "participant_mode": "group",
        "max_participants": 10,
    }
    payload.update(overrides)
    res = client.post("/api/v1/sessions", json=payload, headers=headers)
    assert res.status_code == 201, res.text
    session = res.json()
    # SDD-088: 회원/게스트 입장은 오픈(open) 이후 허용 — 테스트 기본은 오픈까지 진행
    opened = client.post(f"/api/v1/sessions/{session['id']}/open", headers=headers)
    assert opened.status_code == 200, opened.text
    return opened.json()


def _join_guest(client, code: str, name: str) -> str:
    res = client.post(f"/api/v1/sessions/by-code/{code}/join", json={"name": name})
    assert res.status_code == 200, res.text
    return res.json()["participant_id"]


def _feature(second_offset: int, **over) -> dict:
    base = {"second_offset": second_offset}
    base.update(over)
    return base


def _wire(monkeypatch) -> FakeSio:
    """FakeSio 에 `/session-live` 네임스페이스 등록 + DB/sio monkeypatch."""
    from app.core.database import get_db
    from app.main import app as fastapi_app

    fake = FakeSio()
    ns.register_session_live_namespace(fake)

    # 브로드캐스트 헬퍼가 FakeSio 를 쓰도록
    monkeypatch.setattr(ns, "_get_sio", lambda: fake)

    # WS 저장이 REST 와 동일한 인메모리 DB(StaticPool 공유 커넥션)를 쓰도록
    override = fastapi_app.dependency_overrides[get_db]
    monkeypatch.setattr(ns, "_open_db", lambda: next(override()))
    return fake


# ---------------------------------------------------------------------------
# 1. join / leave
# ---------------------------------------------------------------------------


def test_01_join_room_진입_joined_emit(client, monkeypatch):
    counselor = _register(client, "s024c01@test.com")
    cls = _create_group_class(client, counselor["h"])
    fake = _wire(monkeypatch)

    fake.call("connect", "sidA", {}, {"token": counselor["token"]})
    fake.call("join", "sidA", {"session_id": cls["id"]})

    assert f"session:{cls['id']}" in fake.rooms[("/session-live", "sidA")]
    joined = [e for e in fake.emits if e["event"] == "joined"]
    assert joined and joined[0]["data"]["session_id"] == cls["id"]


def test_02_leave_room_퇴장(client, monkeypatch):
    counselor = _register(client, "s024c02@test.com")
    cls = _create_group_class(client, counselor["h"])
    fake = _wire(monkeypatch)

    fake.call("connect", "sidA", {}, {"token": counselor["token"]})
    fake.call("join", "sidA", {"session_id": cls["id"]})
    fake.call("leave", "sidA", {"session_id": cls["id"]})

    assert f"session:{cls['id']}" not in fake.rooms[("/session-live", "sidA")]


# ---------------------------------------------------------------------------
# 2. feature 저장 + broadcast
# ---------------------------------------------------------------------------


def test_03_게스트_feature_emit_저장_broadcast(client, monkeypatch):
    counselor = _register(client, "s024c03@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "게스트A")
    fake = _wire(monkeypatch)

    fake.call("connect", "sidG", {}, {})  # 게스트: 무토큰
    fake.call(
        "feature",
        "sidG",
        {
            "session_id": cls["id"],
            "participant_id": pid,
            "feature": _feature(0, relaxation_index=0.6, signal_quality=0.9),
        },
    )

    # (a) broadcast
    emits = fake.eeg_emits()
    assert len(emits) == 1
    e = emits[0]
    assert e["room"] == f"session:{cls['id']}"
    assert e["namespace"] == "/session-live"
    assert e["data"]["session_id"] == cls["id"]
    assert e["data"]["participant_id"] == pid
    assert e["data"]["saved"] == 1
    assert abs(e["data"]["feature"]["relaxation_index"] - 0.6) < 1e-6

    # (b) 저장 — live-metrics 로 확인
    res = client.get(f"/api/v1/sessions/{cls['id']}/live-metrics", headers=counselor["h"])
    m = res.json()["metrics"][0]
    assert abs(m["current_efficiency"] - 0.6) < 1e-6
    assert m["device_status"] == "ok"


def test_03b_feature_ack_저장성공_발신자에게_emit(client, monkeypatch):
    counselor = _register(client, "s024c03b@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "게스트Ack")
    fake = _wire(monkeypatch)

    fake.call("connect", "sidG", {}, {})  # 게스트: 무토큰
    fake.call(
        "feature",
        "sidG",
        {
            "session_id": cls["id"],
            "participant_id": pid,
            "stream_id": "stream-1",
            "sequence": 3,
            "feature": _feature(3, relaxation_index=0.6, signal_quality=0.9),
        },
    )

    acks = fake.feature_ack_emits()
    assert len(acks) == 1
    a = acks[0]
    assert a["to"] == "sidG"
    assert a["namespace"] == "/session-live"
    assert a["data"]["session_id"] == cls["id"]
    assert a["data"]["stream_id"] == "stream-1"
    assert a["data"]["sequence"] == 3
    assert a["data"]["participant_id"] == pid
    assert a["data"]["second_offset"] == 3
    assert a["data"]["saved"] == 1


def test_03c_feature_ack_저장실패_saved_0(client, monkeypatch):
    counselor = _register(client, "s024c03c@test.com")
    other = _register(client, "s024o03c@test.com", role="client")  # 세션 미참여
    cls = _create_group_class(client, counselor["h"])
    fake = _wire(monkeypatch)

    fake.call("connect", "sidX", {}, {"token": other["token"]})
    fake.call(
        "feature",
        "sidX",
        {
            "session_id": cls["id"],
            "stream_id": "stream-2",
            "sequence": 1,
            "feature": _feature(1, relaxation_index=0.5),
        },
    )

    acks = fake.feature_ack_emits()
    assert len(acks) == 1
    assert acks[0]["to"] == "sidX"
    assert acks[0]["data"]["saved"] == 0
    # 저장 실패 시 호스트 브로드캐스트 없음
    assert fake.eeg_emits() == []


def test_04_로그인_참가자_토큰_user_id로_저장(client, monkeypatch):
    counselor = _register(client, "s024c04@test.com")
    cls = _create_group_class(client, counselor["h"])
    member = _register(client, "s024m04@test.com", role="client")
    client.post(f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={}, headers=member["h"])
    fake = _wire(monkeypatch)

    fake.call("connect", "sidM", {}, {"token": member["token"]})
    # participant_id 없이 토큰의 user_id 로 참가자 해석
    fake.call(
        "feature",
        "sidM",
        {"session_id": cls["id"], "feature": _feature(0, relaxation_index=0.5, signal_quality=0.9)},
    )

    emits = fake.eeg_emits()
    assert len(emits) == 1 and emits[0]["data"]["saved"] == 1


# ---------------------------------------------------------------------------
# 3. 룸 격리
# ---------------------------------------------------------------------------


def test_05_룸_격리_다른세션_broadcast_안섞임(client, monkeypatch):
    counselor = _register(client, "s024c05@test.com")
    cls_a = _create_group_class(client, counselor["h"], title="A반")
    cls_b = _create_group_class(client, counselor["h"], title="B반")
    pid_b = _join_guest(client, cls_b["access_code"], "B반게스트")
    fake = _wire(monkeypatch)

    fake.call("connect", "sidG", {}, {})
    fake.call(
        "feature",
        "sidG",
        {"session_id": cls_b["id"], "participant_id": pid_b, "feature": _feature(0, relaxation_index=0.7, signal_quality=0.9)},
    )

    emits = fake.eeg_emits()
    assert len(emits) == 1
    # B반 룸으로만 브로드캐스트 — A반 room 으로는 나가지 않는다
    assert emits[0]["room"] == f"session:{cls_b['id']}"
    assert emits[0]["room"] != f"session:{cls_a['id']}"


# ---------------------------------------------------------------------------
# 4. 인증 (비참가자 저장 실패 → broadcast 안 함)
# ---------------------------------------------------------------------------


def test_06_비참가자_feature_저장실패_broadcast_안함(client, monkeypatch):
    counselor = _register(client, "s024c06@test.com")
    other = _register(client, "s024o06@test.com", role="client")  # 세션 미참여
    cls = _create_group_class(client, counselor["h"])
    fake = _wire(monkeypatch)

    fake.call("connect", "sidX", {}, {"token": other["token"]})
    fake.call(
        "feature",
        "sidX",
        {"session_id": cls["id"], "feature": _feature(0, relaxation_index=0.5, signal_quality=0.9)},
    )

    assert fake.eeg_emits() == []


def test_07_participant도_토큰도_없으면_broadcast_안함(client, monkeypatch):
    counselor = _register(client, "s024c07@test.com")
    cls = _create_group_class(client, counselor["h"])
    fake = _wire(monkeypatch)

    fake.call("connect", "sidX", {}, {})  # 무토큰 + participant_id 없음
    fake.call(
        "feature",
        "sidX",
        {"session_id": cls["id"], "feature": _feature(0, relaxation_index=0.5)},
    )

    assert fake.eeg_emits() == []


# ---------------------------------------------------------------------------
# 5. 멱등 (동일 window_index 재전송 skip)
# ---------------------------------------------------------------------------


def test_08_동일_window_index_재전송_멱등_skip(client, monkeypatch):
    counselor = _register(client, "s024c08@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "재전송게스트")
    fake = _wire(monkeypatch)

    fake.call("connect", "sidG", {}, {})
    data = {
        "session_id": cls["id"],
        "participant_id": pid,
        "feature": _feature(0, relaxation_index=0.6, signal_quality=0.9),
    }
    fake.call("feature", "sidG", data)
    fake.call("feature", "sidG", data)  # 동일 초 인덱스 재전송

    emits = fake.eeg_emits()
    assert len(emits) == 2
    assert emits[0]["data"]["saved"] == 1  # 최초 저장
    assert emits[1]["data"]["saved"] == 0  # 중복 → skip


def test_09_REST_배치후_WS_동일인덱스_재전송_과거값_발행안함(client, monkeypatch):
    """REST 5초 배치로 0~2 저장 후, WS 로 초 1 재전송 → 멱등 skip(saved=0) + 과거값 미발행.

    WS-FEATURE-DUP: 이미 더 새로운 창(초 2)이 저장돼 있으므로 재전송된 초 1 은 실시간
    브로드캐스트하지 않는다(상담사 화면이 과거로 되돌아가지 않게).
    """
    counselor = _register(client, "s024c09@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "이중저장게스트")

    client.post(
        f"/api/v1/sessions/{cls['id']}/features",
        json={"participant_id": pid, "features": [_feature(i, relaxation_index=0.5, signal_quality=0.9) for i in range(3)]},
    )

    fake = _wire(monkeypatch)
    fake.call("connect", "sidG", {}, {})
    fake.call(
        "feature",
        "sidG",
        {"session_id": cls["id"], "participant_id": pid, "feature": _feature(1, relaxation_index=0.9, signal_quality=0.9)},
    )

    # 중복 재전송(saved=0)이라 저장은 skip, 더 새로운 초 2 가 있으므로 eeg_feature 미발행
    assert fake.eeg_emits() == []
    ack = fake.feature_ack_emits()
    assert len(ack) == 1 and ack[0]["data"]["saved"] == 0


def test_10_WS_뒤늦은_과거오프셋_재전송_발행안함(client, monkeypatch):
    """WS-FEATURE-DUP: 과거 오프셋이 뒤늦게 도착해도(신규 저장) 최신보다 과거면 발행 안 함."""
    counselor = _register(client, "s024c10@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "뒤늦은게스트")
    fake = _wire(monkeypatch)

    fake.call("connect", "sidG", {}, {})
    # 최신 초 5 먼저 저장 → 브로드캐스트됨
    fake.call(
        "feature", "sidG",
        {"session_id": cls["id"], "participant_id": pid, "feature": _feature(5, relaxation_index=0.7, signal_quality=0.9)},
    )
    # 뒤늦게 도착한 과거 초 2(신규 저장이지만 더 새로운 초 5 가 있음) → 발행 생략
    fake.call(
        "feature", "sidG",
        {"session_id": cls["id"], "participant_id": pid, "feature": _feature(2, relaxation_index=0.1, signal_quality=0.9)},
    )

    emits = fake.eeg_emits()
    assert len(emits) == 1
    assert emits[0]["data"]["feature"]["second_offset"] == 5
    # 과거값(초 2)은 어떤 eeg_feature 로도 나가지 않는다
    assert all(e["data"]["feature"]["second_offset"] != 2 for e in emits)


def test_11_재join_다른세션_이전룸_이탈(client, monkeypatch):
    """WS-JOIN-STALE-ROOM: 같은 소켓이 다른 세션으로 join 하면 이전 세션 룸에서 이탈한다."""
    counselor = _register(client, "s024c11@test.com")
    cls_a = _create_group_class(client, counselor["h"], title="A반")
    cls_b = _create_group_class(client, counselor["h"], title="B반")
    fake = _wire(monkeypatch)

    fake.call("connect", "sidH", {}, {"token": counselor["token"]})
    fake.call("join", "sidH", {"session_id": cls_a["id"]})
    assert f"session:{cls_a['id']}" in fake.rooms[("/session-live", "sidH")]

    fake.call("join", "sidH", {"session_id": cls_b["id"]})
    rooms = fake.rooms[("/session-live", "sidH")]
    assert f"session:{cls_b['id']}" in rooms
    assert f"session:{cls_b['id']}:all" in rooms
    # 이전 세션 룸(호스트 + 공용)은 남아 있지 않다
    assert f"session:{cls_a['id']}" not in rooms
    assert f"session:{cls_a['id']}:all" not in rooms


def test_12_같은세션_재join_룸_유지(client, monkeypatch):
    """같은 세션 재-join 은 이전 룸 이탈 로직을 타지 않고 룸을 그대로 유지한다."""
    counselor = _register(client, "s024c12@test.com")
    cls = _create_group_class(client, counselor["h"])
    fake = _wire(monkeypatch)

    fake.call("connect", "sidH", {}, {"token": counselor["token"]})
    fake.call("join", "sidH", {"session_id": cls["id"]})
    fake.call("join", "sidH", {"session_id": cls["id"]})

    rooms = fake.rooms[("/session-live", "sidH")]
    assert f"session:{cls['id']}" in rooms
    assert f"session:{cls['id']}:all" in rooms
