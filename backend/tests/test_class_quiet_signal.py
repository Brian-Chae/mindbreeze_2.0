"""개선 5: 무음 시그널(비언어적 상태 신호) — `/session-live` `class:signal` WS QA.

검증 시나리오:
- TS1: 게스트 신호 → 상담사(호스트) 룸으로만 브로드캐스트 + payload 계약(집계 카운트 포함).
- TS2: 참여자별 최신 1건으로 집계(신호 유형 변경 시 이전 신호는 빠진다).
- TS3: 여러 참여자의 신호가 유형별로 집계된다.
- TS4: 잘못된/누락된 signal_type 은 무시(브로드캐스트 없음).
- TS5: 비참가자·미식별·타인 participant_id 사칭 → 브로드캐스트 없음.
- TS6: 로그인 회원 본인 신호 허용(표시 이름 포함).
- TS7: 발언권과 독립 — 기본 뮤트(온라인 그룹)에서도 신호 가능하고 발언권 상태는 불변.
- TS8: 진행 단계(open/in_progress/paused)가 아니면 무시(완료 세션).
- TS9: TTL(QUIET_SIGNAL_TTL_SEC) 만료 신호는 집계에서 제외.

Socket.IO 핸들러는 SDD-024 테스트와 동일하게 FakeSio 로 직접 호출하고,
`_open_db` / `_get_sio` 를 monkeypatch 해 REST 와 같은 인메모리 DB 를 공유한다.
"""

from uuid import uuid4

import pytest

import app.ws.session_live_namespace as ns
from tests.test_member_livekit_token import _guest_token_body, _start_group_class
from tests.test_sdd024_session_live_ws import (
    _create_group_class,
    _join_guest,
    _register,
    _wire,
)


@pytest.fixture(autouse=True)
def _clean_quiet_signals():
    """활성 신호 맵은 모듈 전역이므로 테스트 간 격리를 보장한다."""
    ns.clear_quiet_signals()
    yield
    ns.clear_quiet_signals()


def _signals(fake):
    """기록된 `class:signal` 브로드캐스트만 추린다."""
    return [e for e in fake.emits if e["event"] == ns.QUIET_SIGNAL_EVENT]


def _join_member(client, cls: dict, member: dict) -> str:
    res = client.post(
        f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={}, headers=member["h"]
    )
    assert res.status_code == 200, res.text
    return res.json()["participant_id"]


def _participant_row(client, counselor: dict, session_id: str, participant_id: str) -> dict:
    """세션 상세의 참가자 행 — 발언권(raise_hand/speaking) 상태는 여기서만 노출된다."""
    res = client.get(f"/api/v1/sessions/{session_id}", headers=counselor["h"])
    assert res.status_code == 200, res.text
    for row in res.json()["participants"]:
        if row["participant_id"] == participant_id:
            return row
    raise AssertionError("참가자 행을 찾을 수 없습니다")


# ---------------------------------------------------------------------------
# TS1 — 게스트 신호 → 호스트 룸 브로드캐스트 + payload 계약
# ---------------------------------------------------------------------------


def test_01_게스트_신호_호스트룸으로만_브로드캐스트(client, monkeypatch):
    counselor = _register(client, "qs01c@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "조용한게스트")
    fake = _wire(monkeypatch)

    fake.call("connect", "sidG", {}, {})  # 게스트: 무토큰
    fake.call(
        "class:signal",
        "sidG",
        {"session_id": cls["id"], "participant_id": pid, "signal_type": "following"},
    )

    emits = _signals(fake)
    assert len(emits) == 1
    e = emits[0]
    # 상담사 전체 수신 룸으로만 — 공용 룸/본인 룸으로는 나가지 않는다(참여자 간 비노출)
    assert e["room"] == f"session:{cls['id']}"
    assert e["room"] != f"session:{cls['id']}:all"
    assert e["room"] != f"session:{cls['id']}:self:{pid}"
    assert e["namespace"] == "/session-live"
    assert e["data"]["session_id"] == cls["id"]
    assert e["data"]["participant_id"] == pid
    assert e["data"]["signal_type"] == "following"
    assert e["data"]["display_name"] == "조용한게스트"
    assert e["data"]["counts"] == {"following": 1, "difficult": 0, "resting": 0, "total": 1}
    # at 은 WS 직렬화 가능한 ISO 문자열
    assert isinstance(e["data"]["at"], str) and "T" in e["data"]["at"]


# ---------------------------------------------------------------------------
# TS2 / TS3 — 집계 카운트
# ---------------------------------------------------------------------------


def test_02_같은_참여자_신호변경_최신만_집계(client, monkeypatch):
    counselor = _register(client, "qs02c@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "신호변경게스트")
    fake = _wire(monkeypatch)

    fake.call("connect", "sidG", {}, {})
    fake.call(
        "class:signal",
        "sidG",
        {"session_id": cls["id"], "participant_id": pid, "signal_type": "following"},
    )
    fake.call(
        "class:signal",
        "sidG",
        {"session_id": cls["id"], "participant_id": pid, "signal_type": "resting"},
    )

    emits = _signals(fake)
    assert len(emits) == 2
    assert emits[0]["data"]["counts"]["following"] == 1
    # 같은 참여자가 바꾸면 이전 신호는 사라지고 최신 1건만 남는다
    assert emits[1]["data"]["counts"] == {
        "following": 0,
        "difficult": 0,
        "resting": 1,
        "total": 1,
    }


def test_03_여러_참여자_유형별_집계(client, monkeypatch):
    counselor = _register(client, "qs03c@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid_a = _join_guest(client, cls["access_code"], "게스트A")
    pid_b = _join_guest(client, cls["access_code"], "게스트B")
    fake = _wire(monkeypatch)

    fake.call("connect", "sidA", {}, {})
    fake.call("connect", "sidB", {}, {})
    fake.call(
        "class:signal",
        "sidA",
        {"session_id": cls["id"], "participant_id": pid_a, "signal_type": "following"},
    )
    fake.call(
        "class:signal",
        "sidB",
        {"session_id": cls["id"], "participant_id": pid_b, "signal_type": "difficult"},
    )

    counts = _signals(fake)[-1]["data"]["counts"]
    assert counts == {"following": 1, "difficult": 1, "resting": 0, "total": 2}


# ---------------------------------------------------------------------------
# TS4 — 입력 검증
# ---------------------------------------------------------------------------


def test_04_잘못된_유형이나_세션누락은_무시(client, monkeypatch):
    counselor = _register(client, "qs04c@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "잘못된신호게스트")
    fake = _wire(monkeypatch)

    fake.call("connect", "sidG", {}, {})
    fake.call(
        "class:signal",
        "sidG",
        {"session_id": cls["id"], "participant_id": pid, "signal_type": "happy"},  # 미정의 유형
    )
    fake.call(
        "class:signal",
        "sidG",
        {"session_id": cls["id"], "participant_id": pid},  # signal_type 누락
    )
    fake.call("class:signal", "sidG", {"participant_id": pid, "signal_type": "resting"})  # 세션 누락
    fake.call("class:signal", "sidG", None)

    assert _signals(fake) == []


# ---------------------------------------------------------------------------
# TS5 / TS6 — 권한
# ---------------------------------------------------------------------------


def test_05_비참가자_신호_브로드캐스트_없음(client, monkeypatch):
    counselor = _register(client, "qs05c@test.com")
    other = _register(client, "qs05o@test.com", role="client")  # 세션 미참여
    cls = _create_group_class(client, counselor["h"])
    fake = _wire(monkeypatch)

    fake.call("connect", "sidX", {}, {"token": other["token"]})
    fake.call("class:signal", "sidX", {"session_id": cls["id"], "signal_type": "following"})

    assert _signals(fake) == []


def test_06_로그인회원_본인신호_허용_타인사칭은_차단(client, monkeypatch):
    counselor = _register(client, "qs06c@test.com")
    member_a = _register(client, "qs06a@test.com", role="client")
    member_b = _register(client, "qs06b@test.com", role="client")
    cls = _create_group_class(client, counselor["h"])
    pid_a = _join_member(client, cls, member_a)
    pid_b = _join_member(client, cls, member_b)
    fake = _wire(monkeypatch)

    # 본인 신호 — participant_id 를 생략해도 토큰의 user_id 로 해석된다
    fake.call("connect", "sidA", {}, {"token": member_a["token"]})
    fake.call("class:signal", "sidA", {"session_id": cls["id"], "signal_type": "difficult"})
    emits = _signals(fake)
    assert len(emits) == 1
    assert emits[0]["data"]["participant_id"] == pid_a
    assert emits[0]["data"]["display_name"] == "client-qs06a"

    # 타인 participant_id 사칭 → 브로드캐스트 없음
    fake.call("connect", "sidB", {}, {"token": member_b["token"]})
    fake.call(
        "class:signal",
        "sidB",
        {"session_id": cls["id"], "participant_id": pid_a, "signal_type": "resting"},
    )
    assert len(_signals(fake)) == 1


def test_07_게스트가_회원참여자_사칭하면_차단(client, monkeypatch):
    counselor = _register(client, "qs07c@test.com")
    member = _register(client, "qs07m@test.com", role="client")
    cls = _create_group_class(client, counselor["h"])
    pid_member = _join_member(client, cls, member)
    fake = _wire(monkeypatch)

    fake.call("connect", "sidG", {}, {})  # 무토큰 게스트가 회원 participant_id 사용
    fake.call(
        "class:signal",
        "sidG",
        {"session_id": cls["id"], "participant_id": pid_member, "signal_type": "following"},
    )

    assert _signals(fake) == []


# ---------------------------------------------------------------------------
# TS7 — 발언권과 독립
# ---------------------------------------------------------------------------


def test_08_기본뮤트_참여자_신호가능_발언권상태_불변(client, monkeypatch):
    counselor = _register(client, "qs08c@test.com")
    # 온라인 그룹(≤20) = 기본 뮤트 대상 — 발언권을 부여받지 않은 회원
    cls, joined = _start_group_class(client, counselor, participant_mode="group", max_participants=20)
    pid = joined["participant_id"]

    # 기본 뮤트 — 발언권(송출) 없음
    assert _guest_token_body(client, cls, joined)["can_publish"] is False
    before = _participant_row(client, counselor, cls["id"], pid)
    assert before["speaking"] is False and before["raise_hand"] is False

    fake = _wire(monkeypatch)
    fake.call("connect", "sidG", {}, {})
    fake.call(
        "class:signal",
        "sidG",
        {"session_id": cls["id"], "participant_id": pid, "signal_type": "difficult"},
    )

    # 신호는 발언권 부여 없이 전달된다
    assert len(_signals(fake)) == 1
    # speaking_changed 를 유발하지 않는다(발언권과 독립)
    assert [e for e in fake.emits if e["event"] == "speaking_changed"] == []

    after = _participant_row(client, counselor, cls["id"], pid)
    assert after["speaking"] is False and after["raise_hand"] is False


# ---------------------------------------------------------------------------
# TS8 — 진행 단계가 아니면 무시
# ---------------------------------------------------------------------------


def test_09_완료된_세션_신호는_무시(client, monkeypatch):
    counselor = _register(client, "qs09c@test.com")
    cls, joined = _start_group_class(client, counselor)
    pid = joined["participant_id"]

    ended = client.post(f"/api/v1/sessions/{cls['id']}/end", headers=counselor["h"])
    assert ended.status_code == 200, ended.text
    assert ended.json()["status"] == "completed"

    fake = _wire(monkeypatch)
    fake.call("connect", "sidG", {}, {})
    fake.call(
        "class:signal",
        "sidG",
        {"session_id": cls["id"], "participant_id": pid, "signal_type": "following"},
    )

    assert _signals(fake) == []


# ---------------------------------------------------------------------------
# TS9 — TTL 만료 (순수 집계 로직)
# ---------------------------------------------------------------------------


def test_10_TTL_만료_신호는_집계에서_제외():
    sid = str(uuid4())
    ns.build_quiet_signal_payload(sid, "p1", "following", "게스트A", at=100.0)

    # TTL 이 지난 시점의 두 번째 신호 → 첫 신호는 만료로 집계에서 빠진다
    later = 100.0 + ns.QUIET_SIGNAL_TTL_SEC + 0.1
    payload = ns.build_quiet_signal_payload(sid, "p2", "difficult", "게스트B", at=later)
    assert payload["counts"] == {"following": 0, "difficult": 1, "resting": 0, "total": 1}

    # 만료 후 세션 키도 정리된다(메모리 누수 방지)
    assert ns.quiet_signal_counts(sid, now=later)["total"] == 1
    assert ns._active_signals.get(sid) is None or len(ns._active_signals[sid]) == 1


def test_11_유형_상수는_3종_계약():
    assert ns.QUIET_SIGNAL_TYPES == ("following", "difficult", "resting")
    assert ns.QUIET_SIGNAL_EVENT == "class:signal"
