"""개선 3 — 대기실 인원(입장 전 준비) 브로드캐스트 QA

검증 항목:
1. join 컨텍스트 기반 신원 판정
   - 참가자(회원/게스트)의 waiting_room join/leave → 호스트 룸에만 브로드캐스트
   - 클라이언트가 보낸 participant_id 는 무시한다(사칭 차단)
2. 위조·오발 차단
   - join 하지 않은 소켓(세션 컨텍스트 없음) → 무시
   - 다른 세션 id 로 emit → 무시
   - 호스트(role="host") → 무시(대기 인원이 아니다)
   - 잘못된 action → 무시
3. 표시용 닉네임 정리
   - 공백 정리·길이 제한·비문자열은 None
"""

import asyncio

import app.ws.session_live_namespace as ns

HOST_ROOM = "session:sess-1"


# ---------------------------------------------------------------------------
# FakeSio — AsyncServer 인터페이스 최소 모사(SDD-026 테스트와 동일 규약)
# ---------------------------------------------------------------------------


class FakeSio:
    def __init__(self):
        self.handlers = {}
        self.sessions = {}
        self.emits = []

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
        pass

    async def leave_room(self, sid, room, namespace=None):
        pass

    async def emit(self, event, data=None, room=None, to=None, namespace=None):
        self.emits.append(
            {"event": event, "data": data, "room": room, "to": to, "namespace": namespace}
        )

    # 헬퍼
    def call(self, event, *args):
        fn = self.handlers[("/session-live", event)]
        return asyncio.run(fn(*args))

    def events(self, name):
        return [e for e in self.emits if e["event"] == name]


def _wire(monkeypatch, sessions=None) -> FakeSio:
    """네임스페이스 핸들러를 등록한 FakeSio 를 sio 브로드캐스트 대상으로 주입한다."""
    fake = FakeSio()
    ns.register_session_live_namespace(fake)
    if sessions:
        fake.sessions.update(sessions)
    monkeypatch.setattr(ns, "_get_sio", lambda: fake)
    return fake


def _participant_session(session_id="sess-1", participant_id="p-1"):
    return {
        "user_id": None,
        "role": "participant",
        "participant_id": participant_id,
        "session_id": str(session_id),
    }


# ---------------------------------------------------------------------------
# 1. 브로드캐스트 룸
# ---------------------------------------------------------------------------


def test_broadcast_waiting_room_호스트룸_전용(monkeypatch):
    fake = _wire(monkeypatch)
    asyncio.run(
        ns.broadcast_waiting_room(
            "sess-1", {"participant_id": "p-1", "action": "join", "nickname": "민지"}
        )
    )
    e = fake.events("waiting_room_changed")
    assert len(e) == 1
    assert e[0]["room"] == HOST_ROOM
    assert e[0]["namespace"] == "/session-live"
    assert e[0]["data"]["session_id"] == "sess-1"
    assert e[0]["data"]["action"] == "join"
    assert e[0]["data"]["nickname"] == "민지"


def test_참가자_join_브로드캐스트_participant_id는_컨텍스트에서만(monkeypatch):
    fake = _wire(monkeypatch, {"sid-1": _participant_session()})
    fake.call("waiting_room", "sid-1", {"session_id": "sess-1", "action": "join", "nickname": "민지"})
    e = fake.events("waiting_room_changed")
    assert len(e) == 1
    assert e[0]["data"]["participant_id"] == "p-1"
    assert e[0]["data"]["action"] == "join"


def test_클라이언트가_보낸_participant_id는_무시한다(monkeypatch):
    """사칭 차단 — 컨텍스트의 participant_id 만 신뢰한다."""
    fake = _wire(monkeypatch, {"sid-1": _participant_session(participant_id="p-1")})
    fake.call(
        "waiting_room",
        "sid-1",
        {"session_id": "sess-1", "action": "join", "participant_id": "victim-p"},
    )
    e = fake.events("waiting_room_changed")
    assert len(e) == 1
    assert e[0]["data"]["participant_id"] == "p-1"


def test_leave_도_브로드캐스트한다(monkeypatch):
    fake = _wire(monkeypatch, {"sid-1": _participant_session()})
    fake.call("waiting_room", "sid-1", {"session_id": "sess-1", "action": "leave"})
    e = fake.events("waiting_room_changed")
    assert len(e) == 1
    assert e[0]["data"]["action"] == "leave"
    assert e[0]["data"]["nickname"] is None


# ---------------------------------------------------------------------------
# 2. 위조·오발 차단
# ---------------------------------------------------------------------------


def test_join하지_않은_소켓은_무시한다(monkeypatch):
    fake = _wire(monkeypatch)  # 세션 컨텍스트 없음(비인가)
    fake.call("waiting_room", "sid-x", {"session_id": "sess-1", "action": "join"})
    assert fake.events("waiting_room_changed") == []


def test_다른_세션_id로_보내면_무시한다(monkeypatch):
    fake = _wire(monkeypatch, {"sid-1": _participant_session("sess-1")})
    fake.call("waiting_room", "sid-1", {"session_id": "sess-999", "action": "join"})
    assert fake.events("waiting_room_changed") == []


def test_호스트는_대기_인원이_아니다(monkeypatch):
    fake = _wire(
        monkeypatch,
        {"sid-h": {"user_id": "u-host", "role": "host", "participant_id": None, "session_id": "sess-1"}},
    )
    fake.call("waiting_room", "sid-h", {"session_id": "sess-1", "action": "join"})
    assert fake.events("waiting_room_changed") == []


def test_잘못된_action은_무시한다(monkeypatch):
    fake = _wire(monkeypatch, {"sid-1": _participant_session()})
    fake.call("waiting_room", "sid-1", {"session_id": "sess-1", "action": "reset"})
    fake.call("waiting_room", "sid-1", {"action": "join"})  # session_id 누락
    fake.call("waiting_room", "sid-1", None)  # payload 없음
    assert fake.events("waiting_room_changed") == []


# ---------------------------------------------------------------------------
# 3. 표시용 닉네임 정리
# ---------------------------------------------------------------------------


def test_닉네임_정리_공백_길이_비문자열(monkeypatch):
    fake = _wire(monkeypatch, {"sid-1": _participant_session()})
    fake.call(
        "waiting_room", "sid-1", {"session_id": "sess-1", "action": "join", "nickname": "  김   민지  "}
    )
    fake.call(
        "waiting_room",
        "sid-1",
        {"session_id": "sess-1", "action": "join", "nickname": "가" * 40},
    )
    fake.call("waiting_room", "sid-1", {"session_id": "sess-1", "action": "join", "nickname": 123})
    names = [e["data"]["nickname"] for e in fake.events("waiting_room_changed")]
    assert names[0] == "김 민지"
    assert names[1] == "가" * ns._WAITING_ROOM_NICKNAME_MAX
    assert names[2] is None


def test_체크인_요약_정리_및_전달(monkeypatch):
    """입장 전 체크인(SAM 2축 + 메시지) 요약이 정리되어 전달된다. 전부 비면 None."""
    fake = _wire(monkeypatch, {"sid-1": _participant_session()})
    fake.call(
        "waiting_room",
        "sid-1",
        {
            "session_id": "sess-1",
            "action": "join",
            "nickname": "민지",
            "checkin": {"arousal": 4, "valence": 2, "note": "  목이   불편해요  "},
        },
    )
    e = fake.events("waiting_room_changed")[0]["data"]
    assert e["checkin"] == {"arousal": 4, "valence": 2, "note": "목이 불편해요"}

    # 범위 밖·비정상 값은 걸러내고, 세 값이 모두 비면 checkin 은 None 이 된다
    fake.call(
        "waiting_room",
        "sid-1",
        {"session_id": "sess-1", "action": "join", "checkin": {"arousal": 9, "valence": "x"}},
    )
    assert fake.events("waiting_room_changed")[-1]["data"]["checkin"] is None


def test_readiness_불리언만_전달(monkeypatch):
    fake = _wire(monkeypatch, {"sid-1": _participant_session()})
    ready = {"surveyDone": True, "bandDone": False, "deviceDone": True}
    fake.call("waiting_room", "sid-1", {"session_id": "sess-1", "action": "join", "readiness": ready})
    assert fake.events("waiting_room_changed")[-1]["data"]["readiness"] == ready
    fake.call("waiting_room", "sid-1", {"session_id": "sess-1", "action": "join", "readiness": {**ready, "bandDone": "true"}})
    assert fake.events("waiting_room_changed")[-1]["data"]["readiness"] is None


def test_reminder_호스트만_본인룸_전달(monkeypatch):
    fake = _wire(monkeypatch, {"host": {"role": "host", "session_id": "sess-1", "user_id": "host-1"}, "member": _participant_session()})
    monkeypatch.setattr(ns, "_resolve_join", lambda *args: {"role": "host", "snapshot": {"participants": [{"participant_id": "p-1"}]}})
    payload = {"session_id": "sess-1", "participant_ids": ["p-1"]}
    assert fake.call("waiting_room_remind", "member", payload)["ok"] is False
    assert fake.call("waiting_room_remind", "host", {**payload, "session_id": "other"})["ok"] is False
    assert fake.call("waiting_room_remind", "host", {**payload, "participant_ids": ["outsider"]})["ok"] is False
    assert fake.events("waiting_room_reminder") == []
    assert fake.call("waiting_room_remind", "host", payload) == {"ok": True, "sent": 1}
    event = fake.events("waiting_room_reminder")[0]
    assert event["room"] == "session:sess-1:self:p-1"
    assert "checkin" not in event["data"]


def test_reminder_권한회수_및_서버실패는_실패_ack(monkeypatch):
    fake = _wire(monkeypatch, {"host": {"role": "host", "session_id": "sess-1", "user_id": "host-1"}})
    payload = {"session_id": "sess-1", "participant_ids": ["p-1"]}
    monkeypatch.setattr(ns, "_resolve_join", lambda *args: None)
    assert fake.call("waiting_room_remind", "host", payload)["ok"] is False
    def failure(*args):
        raise RuntimeError("DB unavailable")
    monkeypatch.setattr(ns, "_resolve_join", failure)
    assert fake.call("waiting_room_remind", "host", payload)["ok"] is False
    assert fake.events("waiting_room_reminder") == []


def test_reminder_잘못된_입력과_중복대상(monkeypatch):
    fake = _wire(monkeypatch, {"host": {"role": "host", "session_id": "sess-1", "user_id": "host-1"}})
    monkeypatch.setattr(ns, "_resolve_join", lambda *args: {"role": "host", "snapshot": {"participants": [{"participant_id": "p-1"}]}})
    for targets in ([], "p-1", [None], ["p-1"] * 501):
        assert fake.call("waiting_room_remind", "host", {"session_id": "sess-1", "participant_ids": targets})["ok"] is False
    assert fake.call("waiting_room_remind", "host", {"session_id": "sess-1", "participant_ids": ["p-1", "p-1"]}) == {"ok": True, "sent": 1}
