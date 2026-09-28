"""SDD-094 발언권 관리 — 손들기 → 상담사 부여/해제 + can_publish 발언권 반영.

검증 시나리오(verify.md):
- TS1: 온라인 1:1 → can_publish=True (speaking 무관).
- TS2: 온라인 그룹≤20 → 기본 can_publish=False (뮤트).
- TS3: 손들기 → 발언권 부여 → can_publish=True (raise_hand 자동 해제).
- TS4: 발언권 해제 → can_publish=False.
- TS5: 오프라인/온라인 그룹>20 → 발언권 부여해도 can_publish=False.
- 권한: speaking 부여/해제는 호스트만, 손들기는 본인/게스트 토큰만.
"""

from uuid import uuid4

from tests.test_member_livekit_token import (
    _guest_token_body,
    _join_guest,
    _set_room_id,
    _start_group_class,
    _start_online_class,
)
from tests.test_sdd015_class_code import _create_class, _register


# ---------------------------------------------------------------------------
# 헬퍼
# ---------------------------------------------------------------------------


def _join_member(client, cls: dict, member: dict) -> str:
    res = client.post(
        f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={}, headers=member["h"]
    )
    assert res.status_code == 200, res.text
    return res.json()["participant_id"]


def _raise_hand_url(cls: dict, pid: str) -> str:
    return f"/api/v1/sessions/{cls['id']}/participants/{pid}/raise-hand"


def _speaking_url(cls: dict, pid: str) -> str:
    return f"/api/v1/sessions/{cls['id']}/participants/{pid}/speaking"


def _raise_hand(client, cls, pid, *, token=None, headers=None):
    body = {"participant_token": token} if token else None
    return client.post(_raise_hand_url(cls, pid), json=body, headers=headers or {})


def _set_speaking(client, cls, pid, granted: bool, headers=None):
    return client.post(
        _speaking_url(cls, pid), json={"granted": granted}, headers=headers or {}
    )


def _grant_group_guest(client, counselor, **overrides):
    """온라인 그룹(기본 20) 클래스 + 게스트 참여 → (cls, joined)."""
    overrides.setdefault("participant_mode", "group")
    overrides.setdefault("max_participants", 20)
    cls, joined = _start_group_class(client, counselor, **overrides)
    return cls, joined


# ---------------------------------------------------------------------------
# TS1 — 온라인 1:1 상시 송출
# ---------------------------------------------------------------------------


def test_01_온라인1대1_상시송출_true(client):
    counselor = _register(client, "s094c01@test.com")
    cls = _start_online_class(client, counselor, participant_mode="one_on_one")
    _set_room_id(cls, uuid4())

    joined = _join_guest(client, cls)
    body = _guest_token_body(client, cls, joined)
    # speaking=False 이지만 1:1 은 상시 송출
    assert body["can_publish"] is True


# ---------------------------------------------------------------------------
# TS2 — 온라인 그룹≤20 기본 뮤트
# ---------------------------------------------------------------------------


def test_02_온라인그룹20_기본뮤트_false(client):
    counselor = _register(client, "s094c02@test.com")
    cls, joined = _grant_group_guest(client, counselor)
    body = _guest_token_body(client, cls, joined)
    assert body["can_publish"] is False


# ---------------------------------------------------------------------------
# TS3 — 손들기 → 발언권 부여 → 송출
# ---------------------------------------------------------------------------


def test_03_게스트_손들기_부여_송출(client):
    counselor = _register(client, "s094c03@test.com")
    cls, joined = _grant_group_guest(client, counselor)
    pid = joined["participant_id"]

    # 1) 게스트 손들기(participant_token 소유 증명) → raise_hand=True
    res = _raise_hand(client, cls, pid, token=joined["participant_token"])
    assert res.status_code == 200, res.text
    assert res.json()["raise_hand"] is True
    assert res.json()["speaking"] is False

    # 2) 상담사 발언권 부여 → speaking=True, raise_hand 자동 해제
    res = _set_speaking(client, cls, pid, True, headers=counselor["h"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["speaking"] is True
    assert body["raise_hand"] is False
    assert body["can_publish"] is True

    # 3) 회원 토큰 재호출 → can_publish=True
    token_body = _guest_token_body(client, cls, joined)
    assert token_body["can_publish"] is True


def test_04_발언권부여_토큰재발급_true(client):
    counselor = _register(client, "s094c04@test.com")
    cls, joined = _grant_group_guest(client, counselor)
    pid = joined["participant_id"]

    assert _set_speaking(client, cls, pid, True, headers=counselor["h"]).status_code == 200
    assert _guest_token_body(client, cls, joined)["can_publish"] is True

    # TS4 — 해제 → can_publish=False
    res = _set_speaking(client, cls, pid, False, headers=counselor["h"])
    assert res.status_code == 200, res.text
    assert res.json()["speaking"] is False
    assert res.json()["can_publish"] is False
    assert _guest_token_body(client, cls, joined)["can_publish"] is False


# ---------------------------------------------------------------------------
# TS5 — 오프라인 / 온라인 그룹>20 은 발언권 무관 False
# ---------------------------------------------------------------------------


def test_05_오프라인그룹_발언권부여해도_false(client):
    counselor = _register(client, "s094c05@test.com")
    cls, joined = _grant_group_guest(client, counselor, location_type="offline")
    pid = joined["participant_id"]

    res = _set_speaking(client, cls, pid, True, headers=counselor["h"])
    assert res.status_code == 200, res.text
    assert res.json()["speaking"] is True  # 상태는 부여되지만
    assert res.json()["can_publish"] is False  # 오프라인 → 송출 불가
    assert _guest_token_body(client, cls, joined)["can_publish"] is False


def test_06_온라인그룹21_발언권부여해도_false(client):
    counselor = _register(client, "s094c06@test.com")
    cls, joined = _grant_group_guest(client, counselor, max_participants=21)
    pid = joined["participant_id"]

    res = _set_speaking(client, cls, pid, True, headers=counselor["h"])
    assert res.status_code == 200, res.text
    assert res.json()["speaking"] is True
    assert res.json()["can_publish"] is False
    assert _guest_token_body(client, cls, joined)["can_publish"] is False


# ---------------------------------------------------------------------------
# 권한 — speaking 은 호스트만, 손들기는 본인/게스트 토큰만
# ---------------------------------------------------------------------------


def test_07_손들기_토큰없으면_403(client):
    counselor = _register(client, "s094c07@test.com")
    cls, joined = _grant_group_guest(client, counselor)

    # 게스트인데 participant_token 누락 → 403
    res = _raise_hand(client, cls, joined["participant_id"])
    assert res.status_code == 403


def test_08_손들기_잘못된토큰_403(client):
    counselor = _register(client, "s094c08@test.com")
    cls, joined = _grant_group_guest(client, counselor)

    res = _raise_hand(client, cls, joined["participant_id"], token="잘못된토큰")
    assert res.status_code == 403


def test_09_로그인회원_본인손들기_200_타인_403(client):
    counselor = _register(client, "s094c09@test.com")
    member_a = _register(client, "s094m09a@test.com", role="client")
    member_b = _register(client, "s094m09b@test.com", role="client")
    cls, _ = _grant_group_guest(client, counselor)

    pid_a = _join_member(client, cls, member_a)
    pid_b = _join_member(client, cls, member_b)

    # 본인 → 200
    res = _raise_hand(client, cls, pid_a, headers=member_a["h"])
    assert res.status_code == 200, res.text
    assert res.json()["raise_hand"] is True

    # 타인(다른 회원) participant_id 로 대리 손들기 → 403
    res = _raise_hand(client, cls, pid_a, headers=member_b["h"])
    assert res.status_code == 403


def test_10_발언권부여_참여자는_403(client):
    counselor = _register(client, "s094c10@test.com")
    member = _register(client, "s094m10@test.com", role="client")
    cls, joined = _grant_group_guest(client, counselor)
    pid = joined["participant_id"]

    # 참여자(비호스트)가 발언권 부여 시도 → 403
    res = _set_speaking(client, cls, pid, True, headers=member["h"])
    assert res.status_code == 403


def test_11_발언권부여_게스트무인증_401(client):
    counselor = _register(client, "s094c11@test.com")
    cls, joined = _grant_group_guest(client, counselor)

    # 인증 헤더 없음 → get_current_user 401
    res = _set_speaking(client, cls, joined["participant_id"], True)
    assert res.status_code == 401


def test_12_손들기_세션불일치_404(client):
    counselor = _register(client, "s094c12@test.com")
    cls, joined = _grant_group_guest(client, counselor)
    other = _create_class(client, counselor["h"], participant_mode="group", max_participants=20)

    # 다른 세션 ID 로 손들기 → 참여자 미존재 404
    res = _raise_hand(client, other, joined["participant_id"], token=joined["participant_token"])
    assert res.status_code == 404
