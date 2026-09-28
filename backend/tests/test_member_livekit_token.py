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
