"""개선 10: 명상 가이드·BGM 동기 재생 — `/session-live` `class:audio_sync` WS QA + 트랙 목록 REST.

검증 시나리오:
- TS1: 상담사 play → 세션 공용 룸(호스트+참여자) 브로드캐스트 + payload 계약
       (action/track_id/position_sec/server_ts/server_ts_ms/revision).
- TS2: 회원(게스트)이 올린 재생 제어는 무시 — 아무나 클래스 BGM 을 멈출 수 없다.
- TS3: 미등록 track_id play / 잘못된 action / 잘못된 위치 값은 무시.
- TS4: pause·seek·stop 각 액션 계약 + stop 뒤에는 늦은 입장자에게 replay 하지 않는다.
- TS5: 호스트가 join 하지 않은 다른 세션 id 로 emit 하면 무시(타 세션 위조 차단).
- TS6: 진행 중 클래스에 늦게 입장한 회원은 같은 트랙·같은 위치로 replay 받는다.
- TS7: 진행 단계(open/in_progress/paused)가 아니면 무시(완료 세션).
- TS8: 위치 정규화·상태 TTL 순수 로직.
- TS9: GET /class/audio-tracks — 무인증 목록 + 트랙 계약(url 트랙/톤 트랙).
- TS10: 운영 URL 트랙(환경변수) 검증 — 깨진 항목은 조용히 제외.

Socket.IO 핸들러는 SDD-024 테스트와 동일하게 FakeSio 로 직접 호출하고,
`_open_db` / `_get_sio` 를 monkeypatch 해 REST 와 같은 인메모리 DB 를 공유한다.
"""

import pytest

import app.ws.session_live_namespace as ns
from app.services import class_audio_service
from tests.test_member_livekit_token import _start_group_class
from tests.test_sdd024_session_live_ws import (
    _create_group_class,
    _join_guest,
    _register,
    _wire,
)

# 내장 카탈로그의 실제 트랙 id — 테스트가 상수를 복제하지 않고 카탈로그에서 얻는다
TRACK_ID = "bgm-calm-drone-432"


@pytest.fixture(autouse=True)
def _clean_audio_states():
    """재생 상태·순번은 모듈 전역이므로 테스트 간 격리를 보장한다."""
    ns.clear_audio_states()
    yield
    ns.clear_audio_states()


def _audio_emits(fake):
    """기록된 `class:audio_sync` 브로드캐스트만 추린다."""
    return [e for e in fake.emits if e["event"] == ns.AUDIO_SYNC_EVENT]


def _join_host(fake, counselor, session_id: str, sid: str = "sidH") -> None:
    """상담사(호스트) 소켓을 토큰으로 연결하고 join 시킨다 — role=host 가 session 에 저장된다."""
    assert fake.call("connect", sid, {}, {"token": counselor["token"]}) is True
    fake.call("join", sid, {"session_id": session_id})


def _host_play(
    fake,
    session_id: str,
    *,
    track_id: str | None = TRACK_ID,
    position: float = 0.0,
    action: str = "play",
    sid: str = "sidH",
) -> None:
    fake.call(
        ns.AUDIO_SYNC_EVENT,
        sid,
        {
            "session_id": session_id,
            "action": action,
            "track_id": track_id,
            "position_sec": position,
        },
    )


# ---------------------------------------------------------------------------
# TS1 — 상담사 play → 세션 공용 룸 브로드캐스트 + payload 계약
# ---------------------------------------------------------------------------


def test_01_상담사_재생_세션공용룸_브로드캐스트(client, monkeypatch):
    counselor = _register(client, "ca01c@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "회원A")
    fake = _wire(monkeypatch)

    _join_host(fake, counselor, cls["id"])
    _host_play(fake, cls["id"], position=12.5)

    emits = _audio_emits(fake)
    # join replay 는 호스트 소켓에 나가지 않으므로(비참여자 아님) play 브로드캐스트만 남는다
    play_emits = [e for e in emits if e["data"]["action"] == "play"]
    assert len(play_emits) == 1
    e = play_emits[0]
    # 회원도 같은 소스를 받아야 동기 재생이 성립한다 — 공용 룸(`:all`)으로 내보낸다
    assert e["room"] == f"session:{cls['id']}:all"
    assert e["namespace"] == "/session-live"
    assert e["data"]["session_id"] == cls["id"]
    assert e["data"]["action"] == "play"
    assert e["data"]["track_id"] == TRACK_ID
    assert e["data"]["position_sec"] == 12.5
    # 서버가 시각을 찍는다 — 회원은 이 값으로 로컬 시계 오차를 보정한다
    assert isinstance(e["data"]["server_ts"], str) and "T" in e["data"]["server_ts"]
    assert isinstance(e["data"]["server_ts_ms"], int) and e["data"]["server_ts_ms"] > 0
    assert e["data"]["revision"] >= 1
    # 볼륨은 회원별 개별 설정 — payload 에 담지 않는다
    assert "volume" not in e["data"]
    # 회원 id 는 payload 에 없다(재생 제어는 상담사 → 서버 → 전체 방향 단방향)
    assert pid


# ---------------------------------------------------------------------------
# TS2 — 회원(게스트)이 올린 재생 제어는 무시
# ---------------------------------------------------------------------------


def test_02_회원_재생제어는_무시(client, monkeypatch):
    counselor = _register(client, "ca02c@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "회원B")
    fake = _wire(monkeypatch)

    fake.call("connect", "sidG", {}, {})  # 무토큰 게스트
    fake.call("join", "sidG", {"session_id": cls["id"], "participant_id": pid})
    fake.call(
        "class:audio_sync",
        "sidG",
        {"session_id": cls["id"], "action": "play", "track_id": TRACK_ID, "position_sec": 0},
    )

    assert _audio_emits(fake) == []


def test_03_로그인회원_재생제어는_무시(client, monkeypatch):
    """로그인 회원(참가자)도 재생 제어 권한이 없다 — 세션 호스트만 가능하다."""
    counselor = _register(client, "ca03c@test.com")
    cls = _create_group_class(client, counselor["h"])
    member = _register(client, "ca03m@test.com", role="client")
    res = client.post(
        f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={}, headers=member["h"]
    )
    assert res.status_code == 200, res.text
    pid = res.json()["participant_id"]
    fake = _wire(monkeypatch)

    fake.call("connect", "sidM", {}, {"token": member["token"]})
    fake.call("join", "sidM", {"session_id": cls["id"], "participant_id": pid})
    fake.call(
        "class:audio_sync",
        "sidM",
        {"session_id": cls["id"], "action": "stop", "track_id": TRACK_ID, "position_sec": 0},
    )

    assert _audio_emits(fake) == []


# ---------------------------------------------------------------------------
# TS3 — 부적합 입력은 무시
# ---------------------------------------------------------------------------


def test_04_미등록트랙_무시(client, monkeypatch):
    counselor = _register(client, "ca04c@test.com")
    cls = _create_group_class(client, counselor["h"])
    fake = _wire(monkeypatch)
    _join_host(fake, counselor, cls["id"])

    _host_play(fake, cls["id"], track_id="bgm-no-such-track")

    assert _audio_emits(fake) == []


def test_05_잘못된_action과_위치값_무시(client, monkeypatch):
    counselor = _register(client, "ca05c@test.com")
    cls = _create_group_class(client, counselor["h"])
    fake = _wire(monkeypatch)
    _join_host(fake, counselor, cls["id"])

    for payload in (
        {"session_id": cls["id"], "action": "rewind", "track_id": TRACK_ID, "position_sec": 0},
        {"session_id": cls["id"], "action": "play", "track_id": TRACK_ID, "position_sec": "abc"},
        {"session_id": cls["id"], "action": "play", "track_id": TRACK_ID, "position_sec": True},
        {"session_id": cls["id"], "action": "play", "track_id": 42, "position_sec": 1},
        {"action": "play", "track_id": TRACK_ID, "position_sec": 1},
    ):
        fake.call("class:audio_sync", "sidH", payload)

    assert _audio_emits(fake) == []


# ---------------------------------------------------------------------------
# TS4 — pause / seek / stop 계약
# ---------------------------------------------------------------------------


def test_06_pause_seek_stop_각_액션_브로드캐스트(client, monkeypatch):
    counselor = _register(client, "ca06c@test.com")
    cls = _create_group_class(client, counselor["h"])
    fake = _wire(monkeypatch)
    _join_host(fake, counselor, cls["id"])

    _host_play(fake, cls["id"], position=30.0)
    _host_play(fake, cls["id"], action="pause", position=42.25)
    _host_play(fake, cls["id"], action="seek", position=120.0)
    _host_play(fake, cls["id"], action="stop", position=0.0, track_id=None)

    emits = _audio_emits(fake)
    assert [e["data"]["action"] for e in emits] == ["play", "pause", "seek", "stop"]
    assert [e["data"]["position_sec"] for e in emits] == [30.0, 42.25, 120.0, 0.0]
    # revision 은 세션별로 단조 증가 — 회원이 역순 도착을 걸러낼 수 있다
    assert [e["data"]["revision"] for e in emits] == sorted(
        e["data"]["revision"] for e in emits
    )
    assert all(e["room"] == f"session:{cls['id']}:all" for e in emits)
    # stop 은 재생할 것이 없다 — 상태를 남기지 않는다
    assert ns.audio_state_for(cls["id"]) is None


def test_07_seek_만으로도_상태가_남는다(client, monkeypatch):
    """호스트 정기 재동기(heartbeat)는 seek 로 온다 — 늦은 입장자도 이 위치로 합류한다."""
    counselor = _register(client, "ca07c@test.com")
    cls = _create_group_class(client, counselor["h"])
    fake = _wire(monkeypatch)
    _join_host(fake, counselor, cls["id"])

    _host_play(fake, cls["id"], action="seek", position=75.5)

    state = ns.audio_state_for(cls["id"])
    assert state is not None
    assert state["action"] == "seek"
    assert state["position_sec"] == 75.5


# ---------------------------------------------------------------------------
# TS5 — 타 세션 위조 차단
# ---------------------------------------------------------------------------


def test_08_타세션_세션id로_emit하면_무시(client, monkeypatch):
    counselor = _register(client, "ca08c@test.com")
    cls = _create_group_class(client, counselor["h"])
    other = _create_group_class(client, counselor["h"], title="다른 클래스")
    fake = _wire(monkeypatch)
    _join_host(fake, counselor, cls["id"])

    _host_play(fake, other["id"])

    assert _audio_emits(fake) == []


def test_09_남의_세션_호스트가_아닌_상담사는_무시(client, monkeypatch):
    """세션 호스트가 아닌 상담사(다른 계정)는 재생을 제어할 수 없다(서비스 레이어 403)."""
    host = _register(client, "ca09host@test.com")
    other = _register(client, "ca09other@test.com")
    cls = _create_group_class(client, host["h"])
    fake = _wire(monkeypatch)

    # 다른 상담사 계정으로 join 은 거부되므로(비참가자), join 없이 위조 상태를 주입한다
    fake.sessions["sidX"] = {
        "user_id": other["id"],
        "role": "host",
        "participant_id": None,
        "session_id": cls["id"],
    }
    _host_play(fake, cls["id"], sid="sidX")

    assert _audio_emits(fake) == []


# ---------------------------------------------------------------------------
# TS6 — 늦은 입장자 replay
# ---------------------------------------------------------------------------


def test_10_늦게_입장한_회원은_같은_위치로_합류(client, monkeypatch):
    counselor = _register(client, "ca10c@test.com")
    cls = _create_group_class(client, counselor["h"])
    fake = _wire(monkeypatch)

    _join_host(fake, counselor, cls["id"])
    _host_play(fake, cls["id"], position=88.0)

    # 두 번째 회원이 뒤늦게 코드로 입장
    late_pid = _join_guest(client, cls["access_code"], "늦은회원")
    fake.call("connect", "sidLate", {}, {})
    fake.call("join", "sidLate", {"session_id": cls["id"], "participant_id": late_pid})

    replays = [e for e in _audio_emits(fake) if e["to"] == "sidLate"]
    assert len(replays) == 1
    replay = replays[0]
    assert replay["room"] is None
    assert replay["data"]["action"] == "play"
    assert replay["data"]["track_id"] == TRACK_ID
    assert replay["data"]["position_sec"] == 88.0
    # server_ts 가 그대로 남아 있어 회원이 "그때 이후 경과 시간"을 더해 현재 위치를 맞춘다
    stored = ns.audio_state_for(cls["id"])
    assert stored is not None
    assert replay["data"]["server_ts"] == stored["server_ts"]


def test_11_재생_상태가_없으면_입장시_replay_없음(client, monkeypatch):
    counselor = _register(client, "ca11c@test.com")
    cls = _create_group_class(client, counselor["h"])
    fake = _wire(monkeypatch)

    pid = _join_guest(client, cls["access_code"], "회원C")
    fake.call("connect", "sidG", {}, {})
    fake.call("join", "sidG", {"session_id": cls["id"], "participant_id": pid})

    assert _audio_emits(fake) == []


def test_12_호스트_join에는_replay하지_않는다(client, monkeypatch):
    """호스트 플레이어가 원본이므로 자기 명령을 되받지 않는다(불필요한 재시킹 방지)."""
    counselor = _register(client, "ca12c@test.com")
    cls = _create_group_class(client, counselor["h"])
    fake = _wire(monkeypatch)

    ns.record_audio_state(
        cls["id"],
        ns.build_audio_sync_payload(cls["id"], "play", TRACK_ID, 5.0),
    )
    _join_host(fake, counselor, cls["id"], sid="sidH2")

    assert [e for e in _audio_emits(fake) if e["to"] == "sidH2"] == []


# ---------------------------------------------------------------------------
# TS7 — 진행 단계가 아니면 무시
# ---------------------------------------------------------------------------


def test_13_완료된_세션_재생제어는_무시(client, monkeypatch):
    counselor = _register(client, "ca13c@test.com")
    cls, _joined = _start_group_class(client, counselor)
    ended = client.post(f"/api/v1/sessions/{cls['id']}/end", headers=counselor["h"])
    assert ended.status_code == 200, ended.text
    assert ended.json()["status"] == "completed"

    fake = _wire(monkeypatch)
    _join_host(fake, counselor, cls["id"])
    _host_play(fake, cls["id"], position=0.0)

    assert _audio_emits(fake) == []


# ---------------------------------------------------------------------------
# TS8 — 순수 로직
# ---------------------------------------------------------------------------


def test_14_위치_정규화():
    assert ns.normalize_audio_position(-5) == 0.0
    assert ns.normalize_audio_position(12.3456789) == 12.346
    assert ns.normalize_audio_position(ns.AUDIO_SYNC_MAX_POSITION_SEC + 100) == (
        ns.AUDIO_SYNC_MAX_POSITION_SEC
    )
    assert ns.normalize_audio_position(float("nan")) is None
    assert ns.normalize_audio_position("12.5") is None
    assert ns.normalize_audio_position(True) is None
    # 위치 필드 누락은 0(처음부터)으로 본다
    assert ns.audio_position_from_payload({"action": "play"}) == 0.0
    assert ns.audio_position_from_payload({"position_sec": 3.5}) == 3.5


def test_15_재생상태_TTL_만료():
    sid = "sess-ttl"
    ns.record_audio_state(
        sid,
        ns.build_audio_sync_payload(sid, "play", TRACK_ID, 1.0),
        at=100.0,
    )
    assert ns.audio_state_for(sid, now=100.0 + ns.AUDIO_SYNC_STATE_TTL_SEC - 1) is not None
    assert ns.audio_state_for(sid, now=100.0 + ns.AUDIO_SYNC_STATE_TTL_SEC) is None
    # 만료 후 상태 키는 정리된다(메모리 누수 방지)
    assert ns._audio_states.get(sid) is None


def test_16_액션_계약_상수():
    assert ns.AUDIO_SYNC_EVENT == "class:audio_sync"
    assert ns.AUDIO_SYNC_ACTIONS == ("play", "pause", "seek", "stop")
    assert ns.AUDIO_SYNC_SESSION_STATUSES == ("open", "in_progress", "paused")


def test_17_클래스_종료시_재생상태_정리(client, monkeypatch):
    """클래스가 끝나면 재생 상태를 비운다 — 상담사 브라우저가 닫혀 stop 이 못 와도
    늦게 입장한 회원이 끝난 클래스의 음악을 듣지 않게 한다(서비스 레이어 안전망)."""
    counselor = _register(client, "ca17c@test.com")
    cls, _joined = _start_group_class(client, counselor)
    fake = _wire(monkeypatch)
    _join_host(fake, counselor, cls["id"])
    _host_play(fake, cls["id"], position=12.0)
    assert ns.audio_state_for(cls["id"]) is not None

    ended = client.post(f"/api/v1/sessions/{cls['id']}/end", headers=counselor["h"])
    assert ended.status_code == 200, ended.text

    assert ns.audio_state_for(cls["id"]) is None


# ---------------------------------------------------------------------------
# TS9 — 트랙 목록 REST (무인증)
# ---------------------------------------------------------------------------


def test_17_트랙목록_무인증_조회(client):
    res = client.get("/api/v1/class/audio-tracks")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["count"] == len(body["tracks"]) >= 1
    ids = [t["track_id"] for t in body["tracks"]]
    assert TRACK_ID in ids
    assert len(ids) == len(set(ids))  # 중복 트랙 금지

    for track in body["tracks"]:
        # BGM만 제공 — 명상 가이드(나레이션) 트랙은 상담사 목소리(LiveKit)로만
        assert track["kind"] == "bgm"
        assert track["source"] in ("url", "tone")
        assert track["title"]
        assert isinstance(track["loop"], bool)
        if track["source"] == "tone":
            # 톤 트랙은 URL 없이도 재생된다(무자산 기본 카탈로그)
            assert track["url"] is None
            assert track["synth"] and track["synth"]["freq_hz"] > 0
        else:
            assert track["url"]
            assert track["synth"] is None


def test_18_카탈로그_조회_API():
    assert class_audio_service.is_known_track(TRACK_ID) is True
    assert class_audio_service.is_known_track("bgm-unknown") is False
    assert class_audio_service.is_known_track(None) is False
    builtin = class_audio_service.get_audio_track(TRACK_ID)
    assert builtin is not None and builtin["source"] == "tone"
    # 반환값은 복사본 — 호출측 변형이 카탈로그를 오염시키지 않는다
    tracks = class_audio_service.list_audio_tracks()
    tracks[0]["title"] = "변형"
    reread = class_audio_service.get_audio_track(tracks[0]["track_id"])
    assert reread is not None and reread["title"] != "변형"
    assert class_audio_service.track_duration_sec(TRACK_ID) is None  # 무한 드론


# ---------------------------------------------------------------------------
# TS10 — 운영 URL 트랙(환경변수)
# ---------------------------------------------------------------------------


def test_19_URL트랙_환경변수_등록(client, monkeypatch):
    import json as _json

    monkeypatch.setenv(
        class_audio_service.EXTRA_TRACKS_ENV,
        _json.dumps(
            [
                {
                    "track_id": "bgm-s3-rain",
                    "title": "빗소리 (S3)",
                    "kind": "bgm",
                    "url": "https://cdn.example.com/audio/rain.mp3",
                    "duration_sec": 600,
                },
                {"track_id": "", "title": "깨진 항목", "url": "https://x/y.mp3"},
                {"track_id": "bgm-bad-url", "title": "URL 없음", "url": "s3://bucket/key"},
                "not-a-dict",
            ]
        ),
    )

    res = client.get("/api/v1/class/audio-tracks")
    assert res.status_code == 200, res.text
    body = res.json()
    ids = [t["track_id"] for t in body["tracks"]]
    assert "bgm-s3-rain" in ids
    assert "bgm-bad-url" not in ids  # http(s)/상대경로가 아니면 제외
    external = next(t for t in body["tracks"] if t["track_id"] == "bgm-s3-rain")
    assert external["source"] == "url"
    assert external["duration_sec"] == 600.0
    # WS play 검증도 같은 카탈로그를 본다
    assert class_audio_service.is_known_track("bgm-s3-rain") is True


def test_20_URL트랙_JSON이_깨져도_기본_카탈로그는_유지(client, monkeypatch):
    monkeypatch.setenv(class_audio_service.EXTRA_TRACKS_ENV, "{not json")
    res = client.get("/api/v1/class/audio-tracks")
    assert res.status_code == 200, res.text
    assert res.json()["count"] >= 1
