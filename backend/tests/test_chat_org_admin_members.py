"""기관관리자 → 자기 기관 회원 채팅 (연결 링크 없이도 관리 기관 회원이면 허용, 타 기관은 403)"""

from tests.test_chat_invite_member import (
    _create_org_admin,
    _link,
    _register_client,
    _register_counselor,
)


def _setup(client, tag: str):
    """기관 A: 상담사+연결된 회원+기관관리자 / 기관 B: 기관관리자."""
    from tests.conftest import create_test_org

    org_a = create_test_org()
    org_b = create_test_org()
    counselor = _register_counselor(f"{tag}c@test.com", org_a)
    member = _register_client(client, f"{tag}m@test.com")
    _link(counselor["id"], member["id"])  # 상담사 연결로 기관 A 회원이 된다
    admin_a = _create_org_admin(f"{tag}a@test.com", org_a)
    admin_b = _create_org_admin(f"{tag}b@test.com", org_b)
    return member, admin_a, admin_b


def test_기관관리자_자기기관_회원_1대1_생성_201(client):
    member, admin_a, _ = _setup(client, "oa1")
    res = client.post(
        "/api/v1/chat/rooms",
        json={"room_type": "direct", "client_id": member["id"]},
        headers=admin_a["auth"],
    )
    assert res.status_code == 201, res.text
    room_id = res.json()["id"]
    # 회원도 방에 접근 가능하고 본인 방 목록에 보인다
    assert client.get(f"/api/v1/chat/rooms/{room_id}", headers=member["auth"]).status_code == 200
    rooms = client.get("/api/v1/chat/rooms", headers=member["auth"]).json()["rooms"]
    assert room_id in [r["id"] for r in rooms]
    admin_rooms = client.get("/api/v1/chat/rooms", headers=admin_a["auth"]).json()["rooms"]
    assert room_id in [r["id"] for r in admin_rooms]


def test_기관관리자_타기관_회원_1대1_403(client):
    member, _, admin_b = _setup(client, "oa2")
    res = client.post(
        "/api/v1/chat/rooms",
        json={"room_type": "direct", "client_id": member["id"]},
        headers=admin_b["auth"],
    )
    assert res.status_code == 403, res.text


def test_기관관리자_자기기관_회원_그룹_생성_201_타기관_403(client):
    member, admin_a, admin_b = _setup(client, "oa3")
    ok = client.post(
        "/api/v1/chat/rooms",
        json={"room_type": "group", "participant_ids": [member["id"]], "name": "g"},
        headers=admin_a["auth"],
    )
    assert ok.status_code == 201, ok.text
    bad = client.post(
        "/api/v1/chat/rooms",
        json={"room_type": "group", "participant_ids": [member["id"]], "name": "g"},
        headers=admin_b["auth"],
    )
    assert bad.status_code == 403, bad.text
