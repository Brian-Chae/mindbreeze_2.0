"""회원/게스트 구독 전용 LiveKit 토큰 발급 — 상담사 영상·음성 라이브 수신(can_publish=False).

검증 시나리오:
- 게스트: participant_token 소유 증명으로 구독 토큰 발급
- 화상(room) 미시작 시 400
- 게스트 토큰 누락/불일치 시 403
- 로그인 회원: 본인 인증 시 발급, 미인증(게스트 경로) 시 403
"""

from uuid import UUID, uuid4

from tests.test_sdd015_class_code import _create_class, _db, _register


def _start_online_class(client, counselor, **overrides) -> dict:
    cls = _create_class(client, counselor["h"], location_type="online", **overrides)
    assert client.post(f"/api/v1/sessions/{cls['id']}/open", headers=counselor["h"]).status_code == 200
    assert client.post(f"/api/v1/sessions/{cls['id']}/start", headers=counselor["h"]).status_code == 200
    return cls


def _set_room_id(cls: dict, room_id: UUID | None) -> None:
    from app.models.session import Session as SessionModel

    db = _db()
    try:
        s = db.get(SessionModel, UUID(cls["id"]))
        s.webrtc_room_id = room_id
        db.commit()
    finally:
        db.close()


def _join_guest(client, cls: dict) -> dict:
    res = client.post(
        f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={"name": "라이브게스트"}
    )
    assert res.status_code == 200, res.text
    return res.json()


def _token_url(cls: dict) -> str:
    return f"/api/v1/sessions/by-code/{cls['access_code']}/livekit-token"


def _guest_token_body(client, cls: dict, joined: dict) -> dict:
    res = client.post(
        _token_url(cls),
        json={
            "participant_id": joined["participant_id"],
            "participant_token": joined["participant_token"],
        },
    )
    assert res.status_code == 200, res.text
    return res.json()


def _open_and_start(client, counselor, cls: dict) -> None:
    headers = counselor["h"]
    assert client.post(f"/api/v1/sessions/{cls['id']}/open", headers=headers).status_code == 200
    assert client.post(f"/api/v1/sessions/{cls['id']}/start", headers=headers).status_code == 200


def _start_group_class(client, counselor, **overrides):
    """그룹은 start 전에 active 참가자 1명 이상 필요 → 오픈 → 참여 → 시작 순서로 진행한다."""
    overrides.setdefault("location_type", "online")
    cls = _create_class(client, counselor["h"], **overrides)
    assert client.post(f"/api/v1/sessions/{cls['id']}/open", headers=counselor["h"]).status_code == 200
    joined = _join_guest(client, cls)
    assert client.post(f"/api/v1/sessions/{cls['id']}/start", headers=counselor["h"]).status_code == 200
    _set_room_id(cls, uuid4())
    return cls, joined


def test_01_게스트_구독토큰_발급(client):
    counselor = _register(client, "s089c01@test.com")
    cls = _start_online_class(client, counselor)
    _set_room_id(cls, uuid4())

    joined = _join_guest(client, cls)
    res = client.post(
        _token_url(cls),
        json={"participant_id": joined["participant_id"], "participant_token": joined["participant_token"]},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["livekit_token"]
    assert body["webrtc_room_id"]
    # 온라인 1:1 → 양방향 영상 송신 허용
    assert body["can_publish"] is True


def test_02_화상_미시작_400(client):
    counselor = _register(client, "s089c02@test.com")
    cls = _start_online_class(client, counselor)
    _set_room_id(cls, None)  # room_id 제거 = 화상 미시작 시뮬레이션

    joined = _join_guest(client, cls)
    res = client.post(
        _token_url(cls),
        json={"participant_id": joined["participant_id"], "participant_token": joined["participant_token"]},
    )
    assert res.status_code == 400
    assert "시작되지 않았" in res.json()["detail"]


def test_03_게스트_토큰누락_403(client):
    counselor = _register(client, "s089c03@test.com")
    cls = _start_online_class(client, counselor)
    _set_room_id(cls, uuid4())

    joined = _join_guest(client, cls)
    res = client.post(_token_url(cls), json={"participant_id": joined["participant_id"]})
    assert res.status_code == 403


def test_04_게스트_잘못된토큰_403(client):
    counselor = _register(client, "s089c04@test.com")
    cls = _start_online_class(client, counselor)
    _set_room_id(cls, uuid4())

    joined = _join_guest(client, cls)
    res = client.post(
        _token_url(cls),
        json={"participant_id": joined["participant_id"], "participant_token": "잘못된토큰"},
    )
    assert res.status_code == 403


def test_05_로그인회원_미인증_403(client):
    counselor = _register(client, "s089c05@test.com")
    member = _register(client, "s089m05@test.com", role="client")
    cls = _start_online_class(client, counselor, max_participants=10)
    _set_room_id(cls, uuid4())

    joined = client.post(
        f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={}, headers=member["h"]
    )
    assert joined.status_code == 200, joined.text
    pid = joined.json()["participant_id"]

    # 게스트 경로(인증 헤더 없음)로 요청 → 본인 확인 실패 403
    res = client.post(_token_url(cls), json={"participant_id": pid})
    assert res.status_code == 403


def test_06_로그인회원_본인인증_발급(client):
    counselor = _register(client, "s089c06@test.com")
    member = _register(client, "s089m06@test.com", role="client")
    cls = _start_online_class(client, counselor, max_participants=10)
    _set_room_id(cls, uuid4())

    joined = client.post(
        f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={}, headers=member["h"]
    )
    pid = joined.json()["participant_id"]

    res = client.post(_token_url(cls), json={"participant_id": pid}, headers=member["h"])
    assert res.status_code == 200, res.text
    assert res.json()["livekit_token"]
    # 온라인 1:1(로그인 회원) → 양방향 영상 송신 허용
    assert res.json()["can_publish"] is True


# ---------------------------------------------------------------------------
# SDD-094 발언권 기반 규칙: can_publish = online AND (one_on_one OR (그룹≤20 AND speaking))
# (구) 온라인 그룹≤20 무조건 True 는 발언권 부여 방식으로 대체됨 — 상세는 test_sdd094_speaking_rights.py
# ---------------------------------------------------------------------------


def test_07_온라인1대1_can_publish_True(client):
    counselor = _register(client, "s089c07@test.com")
    cls = _start_online_class(client, counselor, participant_mode="one_on_one")
    _set_room_id(cls, uuid4())

    joined = _join_guest(client, cls)
    body = _guest_token_body(client, cls, joined)
    assert body["can_publish"] is True


def test_08_온라인그룹_20명이하_기본뮤트_can_publish_False(client):
    """SDD-094: 온라인 그룹≤20 회원은 기본 뮤트 — 발언권(speaking) 부여 전에는 송출 불가."""
    counselor = _register(client, "s089c08@test.com")
    cls, joined = _start_group_class(
        client, counselor, participant_mode="group", max_participants=20, title="그룹 명상"
    )
    body = _guest_token_body(client, cls, joined)
    assert body["can_publish"] is False


def test_09_온라인그룹_21명_can_publish_False(client):
    counselor = _register(client, "s089c09@test.com")
    cls, joined = _start_group_class(
        client, counselor, participant_mode="group", max_participants=21, title="그룹 명상"
    )
    body = _guest_token_body(client, cls, joined)
    assert body["can_publish"] is False


def test_10_오프라인_can_publish_False(client):
    counselor = _register(client, "s089c10@test.com")
    cls = _create_class(client, counselor["h"], location_type="offline")
    _open_and_start(client, counselor, cls)
    _set_room_id(cls, uuid4())

    joined = _join_guest(client, cls)
    body = _guest_token_body(client, cls, joined)
    assert body["can_publish"] is False


def test_11_오프라인그룹_21명_can_publish_False(client):
    counselor = _register(client, "s089c11@test.com")
    cls, joined = _start_group_class(
        client, counselor, location_type="offline", participant_mode="group", max_participants=21
    )
    body = _guest_token_body(client, cls, joined)
    assert body["can_publish"] is False


def test_12_온라인그룹_50명_생성허용(client):
    counselor = _register(client, "s089c12@test.com")
    res = client.post(
        "/api/v1/sessions",
        json={
            "type": "meditation",
            "duration_min": 30,
            "title": "그룹 명상",
            "location_type": "online",
            "participant_mode": "group",
            "max_participants": 50,
        },
        headers=counselor["h"],
    )
    assert res.status_code == 201, res.text


def test_13_온라인그룹_51명_생성거부(client):
    counselor = _register(client, "s089c13@test.com")
    res = client.post(
        "/api/v1/sessions",
        json={
            "type": "meditation",
            "duration_min": 30,
            "title": "그룹 명상",
            "location_type": "online",
            "participant_mode": "group",
            "max_participants": 51,
        },
        headers=counselor["h"],
    )
    # 스키마 model_validator 위반 → FastAPI 422 (프로젝트 관례: test_session.py 의 custom_type 검증과 동일)
    assert res.status_code in (400, 422), res.text
