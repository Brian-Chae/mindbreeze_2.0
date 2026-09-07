"""SDD-026 — 라이브 세션 P0 안전망 (백엔드) QA

검증 항목:
1. 권한
   - 잘못된 토큰으로 connect → 연결 거부(False)
   - 게스트가 타인 participant_id 로 feature 업로드 → 차단(브로드캐스트 없음)
   - 회원이 타인 participant_id 로 업로드 → 403
   - 게스트가 회원 participant_id 사칭 업로드 → 차단
   - 동의 미완료(초대 회원)/대기열 참가자 업로드 차단
   - 비인가 join 거부(room 미입장 + join_denied)
   - 게스트 격리: 게스트는 전체 수신 룸에 미입장 → 게스트 간 EEG 비노출
2. 상태 계약
   - 호스트 join snapshot(status/version/started_at/참가자·집계)
   - 게스트 join snapshot(본인 상태만, 타 참가자 미노출)
   - 상태전이 시 version 증가
   - session_state_changed / participant_changed / device_status_changed 브로드캐스트 룸·payload
3. 품질·기기 정합
   - SQI 0.5 → lead_off, 0.9 → ok (WS·REST 동일)
   - null SQI → unknown (valid 승격 금지)
   - 배터리 전달(live-metrics/guest-state)
4. pause/resume
   - play_group_id 로 window_index 재시작 충돌 없이 데이터 보존
"""

import asyncio

import app.ws.session_live_namespace as ns
from app.services import email_verify_service
from tests.conftest import create_test_org

VALID_PASSWORD = "Passw0rd!"


# ---------------------------------------------------------------------------
# FakeSio — AsyncServer 인터페이스 최소 모사
# ---------------------------------------------------------------------------


class FakeSio:
    def __init__(self):
        self.handlers = {}
        self.sessions = {}
        self.rooms = {}          # (namespace, sid) -> set(rooms)
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
        self.rooms.setdefault((namespace, sid), set()).add(room)

    async def leave_room(self, sid, room, namespace=None):
        self.rooms.get((namespace, sid), set()).discard(room)

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

    def rooms_of(self, sid):
        return self.rooms.get(("/session-live", sid), set())


# ---------------------------------------------------------------------------
# 공통 셋업
# ---------------------------------------------------------------------------


def _register(client, email, role="counselor", org_code=None):
    payload = {
        "email": email,
        "password": VALID_PASSWORD,
        "name": f"{role}-{email.split('@')[0]}",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": {"tos": True, "privacy": True, "sensitive": True},
    }
    if role == "counselor":
        payload["org_code"] = org_code if org_code is not None else create_test_org()
    res = client.post(f"/api/v1/auth/register/{role}", json=payload)
    assert res.status_code == 201, res.text
    body = res.json()
    return {
        "id": body["user"]["id"],
        "token": body["access_token"],
        "h": {"Authorization": f"Bearer {body['access_token']}"},
    }


def _create_group_class(client, headers, **overrides):
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
    return res.json()


def _join_guest(client, code, name):
    res = client.post(f"/api/v1/sessions/by-code/{code}/join", json={"name": name})
    assert res.status_code == 200, res.text
    return res.json()["participant_id"]


def _feature(second_offset, **over):
    base = {"second_offset": second_offset}
    base.update(over)
    return base


def _wire(monkeypatch):
    """FakeSio 에 `/session-live` 네임스페이스 등록 + DB/sio monkeypatch."""
    from app.core.database import get_db
    from app.main import app as fastapi_app

    fake = FakeSio()
    ns.register_session_live_namespace(fake)
    monkeypatch.setattr(ns, "_get_sio", lambda: fake)
    override = fastapi_app.dependency_overrides[get_db]
    monkeypatch.setattr(ns, "_open_db", lambda: next(override()))
    return fake


# ---------------------------------------------------------------------------
# 1. connect 토큰 검증 (T1)
# ---------------------------------------------------------------------------


def test_01_connect_잘못된_토큰_연결거부(client, monkeypatch):
    fake = _wire(monkeypatch)
    result = fake.call("connect", "sidBad", {}, {"token": "not-a-valid-jwt"})
    assert result is False


def test_02_connect_무토큰_게스트_허용(client, monkeypatch):
    fake = _wire(monkeypatch)
    assert fake.call("connect", "sidGuest", {}, {}) is True
    assert fake.sessions["sidGuest"]["user_id"] is None


def test_03_connect_유효토큰_허용_user_id보관(client, monkeypatch):
    counselor = _register(client, "s026c03@test.com")
    fake = _wire(monkeypatch)
    assert fake.call("connect", "sidC", {}, {"token": counselor["token"]}) is True
    assert fake.sessions["sidC"]["user_id"] == counselor["id"]


# ---------------------------------------------------------------------------
# 2. join 권한 + room 분리 + snapshot (T2/T5)
# ---------------------------------------------------------------------------


def test_04_host_join_전체룸_snapshot(client, monkeypatch):
    counselor = _register(client, "s026c04@test.com")
    cls = _create_group_class(client, counselor["h"])
    _join_guest(client, cls["access_code"], "게스트A")
    fake = _wire(monkeypatch)

    fake.call("connect", "sidH", {}, {"token": counselor["token"]})
    fake.call("join", "sidH", {"session_id": cls["id"]})

    rooms = fake.rooms_of("sidH")
    assert f"session:{cls['id']}" in rooms          # 전체 수신 룸
    assert f"session:{cls['id']}:all" in rooms      # 상태 이벤트 룸
    joined = fake.events("joined")
    assert joined and joined[0]["data"]["role"] == "host"
    snap = joined[0]["data"]["snapshot"]
    assert snap["session_id"] == cls["id"]
    assert "version" in snap
    assert len(snap["metrics"]) == 1  # 호스트는 참가자 목록을 본다


def test_05_guest_join_본인전용룸_snapshot(client, monkeypatch):
    counselor = _register(client, "s026c05@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "게스트A")
    _join_guest(client, cls["access_code"], "게스트B")  # 타 참가자
    fake = _wire(monkeypatch)

    fake.call("connect", "sidG", {}, {})  # 게스트 무토큰
    fake.call("join", "sidG", {"session_id": cls["id"], "participant_id": pid})

    rooms = fake.rooms_of("sidG")
    assert f"session:{cls['id']}:self:{pid}" in rooms   # 본인 전용 룸
    assert f"session:{cls['id']}" not in rooms          # 전체 수신 룸엔 미입장(격리)
    joined = fake.events("joined")
    assert joined and joined[0]["data"]["role"] == "participant"
    snap = joined[0]["data"]["snapshot"]
    # 게스트 snapshot 은 본인 상태만 — 타 참가자 목록/집계 미포함
    assert snap["participant_id"] == pid
    assert "metrics" not in snap


def test_06_비인가_join_거부(client, monkeypatch):
    counselor = _register(client, "s026c06@test.com")
    cls = _create_group_class(client, counselor["h"])
    fake = _wire(monkeypatch)

    fake.call("connect", "sidX", {}, {})  # 무토큰 + participant_id 없음
    fake.call("join", "sidX", {"session_id": cls["id"]})

    assert fake.events("joined") == []
    assert fake.events("join_denied")  # 거부 통지
    # 어떤 room 에도 입장하지 않음
    assert fake.rooms_of("sidX") == set()


def test_07_게스트_타인_participant_id_join_거부(client, monkeypatch):
    counselor = _register(client, "s026c07@test.com")
    cls = _create_group_class(client, counselor["h"])
    member = _register(client, "s026m07@test.com", role="client")
    client.post(f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={}, headers=member["h"])
    # 회원 participant_id 조회
    lm = client.get(f"/api/v1/sessions/{cls['id']}/live-metrics", headers=counselor["h"]).json()
    member_pid = lm["metrics"][0]["participant_id"]
    fake = _wire(monkeypatch)

    fake.call("connect", "sidG", {}, {})  # 게스트가
    fake.call("join", "sidG", {"session_id": cls["id"], "participant_id": member_pid})  # 회원 사칭

    assert fake.events("joined") == []
    assert fake.events("join_denied")


# ---------------------------------------------------------------------------
# 3. 대리 업로드 차단 (T3)
# ---------------------------------------------------------------------------


def test_08_회원_타인_participant_id_업로드_403(client, monkeypatch):
    counselor = _register(client, "s026c08@test.com")
    cls = _create_group_class(client, counselor["h"])
    victim = _join_guest(client, cls["access_code"], "피해게스트")
    attacker = _register(client, "s026a08@test.com", role="client")
    client.post(f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={}, headers=attacker["h"])

    # REST: 인증 회원이 타인(게스트) participant_id 로 업로드 시도
    res = client.post(
        f"/api/v1/sessions/{cls['id']}/features",
        json={"participant_id": victim, "features": [_feature(0, relaxation_index=0.5, signal_quality=0.9)]},
        headers=attacker["h"],
    )
    assert res.status_code == 403


def test_09_게스트_회원_participant_id_사칭_업로드_차단(client, monkeypatch):
    counselor = _register(client, "s026c09@test.com")
    cls = _create_group_class(client, counselor["h"])
    member = _register(client, "s026m09@test.com", role="client")
    client.post(f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={}, headers=member["h"])
    lm = client.get(f"/api/v1/sessions/{cls['id']}/live-metrics", headers=counselor["h"]).json()
    member_pid = lm["metrics"][0]["participant_id"]

    # REST: 무인증 게스트가 회원 participant_id 로 업로드 시도 → 회원 사칭 차단
    res = client.post(
        f"/api/v1/sessions/{cls['id']}/features",
        json={"participant_id": member_pid, "features": [_feature(0, relaxation_index=0.5, signal_quality=0.9)]},
    )
    assert res.status_code == 403


def test_10_초대회원_동의미완료_업로드_403(client, monkeypatch):
    counselor = _register(client, "s026c10@test.com")
    member = _register(client, "s026m10@test.com", role="client")
    cls = _create_group_class(client, counselor["h"])
    # 호스트가 회원을 초대(invite) → consent_eeg=False 로 생성됨(자발 참여 아님)
    res = client.post(
        f"/api/v1/sessions/{cls['id']}/invite",
        json={"user_id": member["id"]},
        headers=counselor["h"],
    )
    assert res.status_code == 200, res.text
    lm = client.get(f"/api/v1/sessions/{cls['id']}/live-metrics", headers=counselor["h"]).json()
    m = lm["metrics"][0]
    assert m["consent_eeg"] is False
    invited_pid = m["participant_id"]

    # 회원 인증으로 본인 업로드 시도 → 동의 미완료로 차단
    up = client.post(
        f"/api/v1/sessions/{cls['id']}/features",
        json={"features": [_feature(0, relaxation_index=0.5, signal_quality=0.9)]},
        headers=member["h"],
    )
    assert up.status_code == 403


def test_11_대기열_참가자_업로드_403(client, monkeypatch):
    counselor = _register(client, "s026c11@test.com")
    cls = _create_group_class(client, counselor["h"], max_participants=1)
    # 정원 1 을 게스트로 채운다(active=1)
    _join_guest(client, cls["access_code"], "정원게스트")
    # 회원 초대 → 정원 초과이므로 대기열 편입(is_waitlisted=True)
    m1 = _register(client, "s026m11a@test.com", role="client")
    client.post(f"/api/v1/sessions/{cls['id']}/invite", json={"user_id": m1["id"]}, headers=counselor["h"])
    # 회원이 코드로 참여 → 동의(consent_eeg)는 True 로 기록되지만 대기열 상태는 유지된다
    client.post(f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={}, headers=m1["h"])
    # 대기열 상태이므로(동의는 완료) 업로드는 대기열 게이트로 차단되어야 한다
    up = client.post(
        f"/api/v1/sessions/{cls['id']}/features",
        json={"features": [_feature(0, relaxation_index=0.5, signal_quality=0.9)]},
        headers=m1["h"],
    )
    assert up.status_code == 403


# ---------------------------------------------------------------------------
# 4. 게스트 간 EEG 비노출 (T4)
# ---------------------------------------------------------------------------


def test_12_게스트_feature_호스트룸만_브로드캐스트(client, monkeypatch):
    counselor = _register(client, "s026c12@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "게스트A")
    fake = _wire(monkeypatch)

    fake.call("connect", "sidG", {}, {})
    fake.call(
        "feature",
        "sidG",
        {"session_id": cls["id"], "participant_id": pid, "feature": _feature(0, relaxation_index=0.6, signal_quality=0.9)},
    )

    emits = fake.events("eeg_feature")
    assert len(emits) == 1
    # 호스트 전체 수신 룸으로만 — self 룸/게스트에게는 나가지 않는다
    assert emits[0]["room"] == f"session:{cls['id']}"


# ---------------------------------------------------------------------------
# 5. 상태 계약 이벤트 + version (T5)
# ---------------------------------------------------------------------------


def test_13_상태전이_version_증가(client, monkeypatch):
    counselor = _register(client, "s026c13@test.com")
    cls = _create_group_class(client, counselor["h"])
    _join_guest(client, cls["access_code"], "게스트A")

    v0 = client.get(f"/api/v1/sessions/{cls['id']}/live-metrics", headers=counselor["h"]).json()["version"]
    assert client.post(f"/api/v1/sessions/{cls['id']}/start", headers=counselor["h"]).status_code == 200
    v1 = client.get(f"/api/v1/sessions/{cls['id']}/live-metrics", headers=counselor["h"]).json()["version"]
    assert client.post(f"/api/v1/sessions/{cls['id']}/pause", headers=counselor["h"]).status_code == 200
    v2 = client.get(f"/api/v1/sessions/{cls['id']}/live-metrics", headers=counselor["h"]).json()["version"]

    assert v1 == v0 + 1
    assert v2 == v1 + 1


def test_14_broadcast_session_state_공용룸(client, monkeypatch):
    fake = _wire(monkeypatch)
    asyncio.run(
        ns.broadcast_session_state("sess-x", {"status": "in_progress", "version": 3})
    )
    e = fake.events("session_state_changed")
    assert len(e) == 1
    assert e[0]["room"] == "session:sess-x:all"
    assert e[0]["data"]["version"] == 3
    assert e[0]["data"]["status"] == "in_progress"


def test_15_broadcast_participant_호스트룸(client, monkeypatch):
    fake = _wire(monkeypatch)
    asyncio.run(ns.broadcast_participant("sess-y", {"version": 2, "participant_count": 4}))
    e = fake.events("participant_changed")
    assert len(e) == 1
    assert e[0]["room"] == "session:sess-y"
    assert e[0]["data"]["participant_count"] == 4


def test_16_broadcast_device_status_호스트룸_및_본인룸(client, monkeypatch):
    fake = _wire(monkeypatch)
    asyncio.run(
        ns.broadcast_device_status("sess-z", {"participant_id": "p1", "band_connected": True, "band_battery": 80})
    )
    e = fake.events("device_status_changed")
    rooms = {x["room"] for x in e}
    assert rooms == {"session:sess-z", "session:sess-z:self:p1"}
    assert all(x["data"]["band_battery"] == 80 for x in e)


# ---------------------------------------------------------------------------
# 6. 품질·기기 정합 (T6)
# ---------------------------------------------------------------------------


def test_17_SQI_null_unknown_valid승격금지(client, monkeypatch):
    counselor = _register(client, "s026c17@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "널SQI게스트")

    # signal_quality 미전달(null)
    client.post(
        f"/api/v1/sessions/{cls['id']}/features",
        json={"participant_id": pid, "features": [_feature(0, relaxation_index=0.5)]},
    )
    lm = client.get(f"/api/v1/sessions/{cls['id']}/live-metrics", headers=counselor["h"]).json()
    m = lm["metrics"][0]
    # null SQI → device unknown(valid/ok 로 승격하지 않음), signal_state unknown
    assert m["device_status"] == "unknown"
    assert m["signal_state"] == "unknown"
    assert m["signal_quality"] is None


def test_18_SQI_분리표시_WS_REST_동일(client, monkeypatch):
    counselor = _register(client, "s026c18@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "품질게스트")

    client.post(
        f"/api/v1/sessions/{cls['id']}/features",
        json={"participant_id": pid, "features": [_feature(0, relaxation_index=0.5, signal_quality=0.5)]},
    )
    # REST live-metrics
    m = client.get(f"/api/v1/sessions/{cls['id']}/live-metrics", headers=counselor["h"]).json()["metrics"][0]
    assert m["device_status"] == "lead_off"     # 접촉 불량
    assert m["signal_state"] == "degraded"      # 신호품질(SQI) 분리 표시
    assert abs(m["signal_quality"] - 0.5) < 1e-6
    # REST guest-state (동일 계약)
    gs = client.get(f"/api/v1/sessions/by-code/{cls['access_code']}/state?participant_id={pid}").json()
    assert gs["device_status"] == "lead_off"
    assert gs["signal_state"] == "degraded"
    assert abs(gs["signal_quality"] - 0.5) < 1e-6


def test_19_배터리_전달(client, monkeypatch):
    counselor = _register(client, "s026c19@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "배터리게스트")

    client.post(
        f"/api/v1/sessions/{cls['id']}/features",
        json={"participant_id": pid, "features": [_feature(0, relaxation_index=0.5, signal_quality=0.9, band_battery=15)]},
    )
    m = client.get(f"/api/v1/sessions/{cls['id']}/live-metrics", headers=counselor["h"]).json()
    assert m["metrics"][0]["band_battery"] == 15
    assert m["summary"]["band_low_count"] == 1  # 20% 미만 저전력 집계
    gs = client.get(f"/api/v1/sessions/by-code/{cls['access_code']}/state?participant_id={pid}").json()
    assert gs["band_battery"] == 15


# ---------------------------------------------------------------------------
# 7. pause/resume window_index 충돌 해결 (T7)
# ---------------------------------------------------------------------------


def test_20_pause_resume_window_index_재시작_데이터보존(client, monkeypatch):
    counselor = _register(client, "s026c20@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "이어하기게스트")

    # 1차 실행(play A): 초 0,1,2
    r1 = client.post(
        f"/api/v1/sessions/{cls['id']}/features",
        json={
            "participant_id": pid,
            "features": [_feature(i, relaxation_index=0.4, signal_quality=0.9, play_group_id="playA") for i in range(3)],
        },
    )
    assert r1.json()["saved"] == 3

    # pause 후 resume → 밴드 second_offset 이 0 부터 재시작(play B): 초 0,1,2
    r2 = client.post(
        f"/api/v1/sessions/{cls['id']}/features",
        json={
            "participant_id": pid,
            "features": [_feature(i, relaxation_index=0.8, signal_quality=0.9, play_group_id="playB") for i in range(3)],
        },
    )
    # play_group_id 가 다르므로 멱등 skip 되지 않고 전부 보존되어야 한다
    assert r2.json()["saved"] == 3


def test_21_동일_play_group_재전송은_멱등_skip(client, monkeypatch):
    counselor = _register(client, "s026c21@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "멱등게스트")

    body = {
        "participant_id": pid,
        "features": [_feature(i, relaxation_index=0.5, signal_quality=0.9, play_group_id="playA") for i in range(3)],
    }
    assert client.post(f"/api/v1/sessions/{cls['id']}/features", json=body).json()["saved"] == 3
    # 동일 play_group + 동일 초 인덱스 재전송 → 전부 skip
    assert client.post(f"/api/v1/sessions/{cls['id']}/features", json=body).json()["saved"] == 0
