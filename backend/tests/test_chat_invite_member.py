"""SDD-092 — 채팅방 회원 초대 QA (상담사 초대 + org_admin 권한 + fork + 후보 조회)"""

VALID_PASSWORD = "Passw0rd!"


# ── 테스트 헬퍼 ──


def _test_db():
    """테스트 DB 세션 획득 (test_chat.py 패턴). (generator, session) 반환."""
    from app.core.database import get_db
    from app.main import app as fastapi_app

    db_gen = fastapi_app.dependency_overrides[get_db]()
    return db_gen, next(db_gen)


def _close_db(db_gen):
    try:
        next(db_gen)
    except StopIteration:
        pass


def _register_client(client, email: str) -> dict:
    """내담자 실제 가입 API 호출."""
    from app.services import email_verify_service
    from tests.conftest import create_test_org, post_register

    payload = {
        "org_code": create_test_org(),
        "email": email,
        "password": VALID_PASSWORD,
        "name": "내담자",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": {"tos": True, "privacy": True, "sensitive": True},
    }
    res = post_register(client, "client", payload)
    assert res.status_code == 201, res.text
    body = res.json()
    token = body.get("access_token") or body.get("tokens", {}).get("access_token")
    return {"id": body["user"]["id"], "auth": {"Authorization": f"Bearer {token}"}}


def _register_counselor(email: str, org_code: str, name: str = "상담사") -> dict:
    """기관 소속(active 멤버십) 상담사 생성."""
    from tests.conftest import create_test_counselor

    created = create_test_counselor(email, name=name, org_code=org_code)
    return {
        "id": created["id"],
        "auth": {"Authorization": f"Bearer {created['access_token']}"},
    }


def _create_org_admin(email: str, org_code: str, name: str = "기관관리자") -> dict:
    """기관 관리자(org_admin) 계정 + active 멤버십 직접 생성."""
    from app.core.security import create_access_token, hash_password
    from app.models.organization import Organization
    from app.models.user import User
    from app.services import membership_service

    db_gen, db = _test_db()
    try:
        org = db.query(Organization).filter(Organization.org_code == org_code).first()
        assert org is not None
        user = User(
            email=email,
            password_hash=hash_password(VALID_PASSWORD),
            name=name,
            role="org_admin",
            status="active",
            verified_tier="email",
            org_id=org.id,
        )
        db.add(user)
        db.flush()
        membership_service.add_membership(db, user, org.id, status_="active", role="org_admin")
        db.commit()
        db.refresh(user)
        return {
            "id": str(user.id),
            "auth": {"Authorization": f"Bearer {create_access_token(subject=str(user.id))}"},
        }
    finally:
        _close_db(db_gen)


def _link(counselor_id: str, client_id: str):
    """상담사-내담자 연결(ClientCounselorLink) 직접 생성."""
    from app.models.client_counselor_link import ClientCounselorLink

    db_gen, db = _test_db()
    try:
        db.add(ClientCounselorLink(client_id=client_id, counselor_id=counselor_id))
        db.commit()
    finally:
        _close_db(db_gen)


def _set_membership_status(user_id: str, status: str):
    """대상 사용자의 모든 멤버십 상태 변경 (left/invited 시나리오)."""
    from app.models.user_org_membership import UserOrgMembership

    db_gen, db = _test_db()
    try:
        for m in (
            db.query(UserOrgMembership)
            .filter(UserOrgMembership.user_id == user_id)
            .all()
        ):
            m.status = status
            m.is_primary = False
        db.commit()
    finally:
        _close_db(db_gen)


def _set_user_status(user_id: str, status: str):
    """대상 계정 상태 변경 (suspended 시나리오)."""
    from app.models.user import User

    db_gen, db = _test_db()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        user.status = status
        db.commit()
    finally:
        _close_db(db_gen)


def _group_room(client, host: dict, member: dict, name: str = "그룹") -> str:
    """host + 내담자 member 로 그룹방 생성 → room_id."""
    _link(host["id"], member["id"])
    res = client.post(
        "/api/v1/chat/rooms",
        json={"room_type": "group", "participant_ids": [member["id"]], "name": name},
        headers=host["auth"],
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _direct_room(client, host: dict, member: dict) -> str:
    """host ↔ member 1:1 방 생성 → room_id."""
    _link(host["id"], member["id"])
    res = client.post(
        "/api/v1/chat/rooms",
        json={"room_type": "direct", "client_id": member["id"]},
        headers=host["auth"],
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


# ── TS1~TS6: 초대 대상·권한 ──


def test_ts01_host가_같은기관_상담사_초대_200(client):
    from tests.conftest import create_test_org

    org = create_test_org()
    host = _register_counselor("ts01host@test.com", org)
    peer = _register_counselor("ts01peer@test.com", org)
    member = _register_client(client, "ts01c@test.com")
    room_id = _group_room(client, host, member)

    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/participants",
        json={"participant_ids": [peer["id"]]},
        headers=host["auth"],
    )
    assert res.status_code == 200, res.text
    assert res.json()["participant_count"] == 3  # host + member + peer
    # 초대된 상담사는 즉시 방 접근 가능
    assert (
        client.get(f"/api/v1/chat/rooms/{room_id}/messages", headers=peer["auth"]).status_code
        == 200
    )


def test_ts02_기관관리자가_초대_200(client):
    from tests.conftest import create_test_org

    org = create_test_org()
    host = _register_counselor("ts02host@test.com", org)
    admin = _create_org_admin("ts02admin@test.com", org)
    peer = _register_counselor("ts02peer@test.com", org)
    member = _register_client(client, "ts02c@test.com")
    room_id = _group_room(client, host, member)

    # host 가 아닌 기관 관리자(같은 기관)가 초대 → 200
    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/participants",
        json={"participant_ids": [peer["id"]]},
        headers=admin["auth"],
    )
    assert res.status_code == 200, res.text
    assert (
        client.get(f"/api/v1/chat/rooms/{room_id}/messages", headers=peer["auth"]).status_code
        == 200
    )


def test_ts03_다른기관_상담사_초대_403(client):
    from tests.conftest import create_test_org

    org_a = create_test_org("기관A")
    org_b = create_test_org("기관B")
    host = _register_counselor("ts03host@test.com", org_a)
    other = _register_counselor("ts03other@test.com", org_b)
    member = _register_client(client, "ts03c@test.com")
    room_id = _group_room(client, host, member)

    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/participants",
        json={"participant_ids": [other["id"]]},
        headers=host["auth"],
    )
    assert res.status_code == 403
    # 다른 기관의 org_admin 도 초대 권한 없음 (host 와 기관 미공유)
    other_admin = _create_org_admin("ts03admin@test.com", org_b)
    peer = _register_counselor("ts03peer@test.com", org_a)
    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/participants",
        json={"participant_ids": [peer["id"]]},
        headers=other_admin["auth"],
    )
    assert res.status_code == 403


def test_ts04_내담자가_초대시도_403(client):
    from tests.conftest import create_test_org

    org = create_test_org()
    host = _register_counselor("ts04host@test.com", org)
    peer = _register_counselor("ts04peer@test.com", org)
    member = _register_client(client, "ts04c@test.com")
    room_id = _group_room(client, host, member)

    # 방 참여자(내담자)가 초대 시도 → 403
    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/participants",
        json={"participant_ids": [peer["id"]]},
        headers=member["auth"],
    )
    assert res.status_code == 403


def test_ts05_left멤버십_suspended계정_상담사_403(client):
    from tests.conftest import create_test_org

    org = create_test_org()
    host = _register_counselor("ts05host@test.com", org)
    member = _register_client(client, "ts05c@test.com")
    room_id = _group_room(client, host, member)

    # 기관 탈퇴(left) 멤버십 상담사 → 403
    left = _register_counselor("ts05left@test.com", org)
    _set_membership_status(left["id"], "left")
    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/participants",
        json={"participant_ids": [left["id"]]},
        headers=host["auth"],
    )
    assert res.status_code == 403

    # 초대 수락 전(invited) 멤버십 상담사 → 403
    invited = _register_counselor("ts05invited@test.com", org)
    _set_membership_status(invited["id"], "invited")
    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/participants",
        json={"participant_ids": [invited["id"]]},
        headers=host["auth"],
    )
    assert res.status_code == 403

    # suspended 계정 상담사 → 403 (멤버십은 active 여도 계정 상태로 차단)
    suspended = _register_counselor("ts05susp@test.com", org)
    _set_user_status(suspended["id"], "suspended")
    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/participants",
        json={"participant_ids": [suspended["id"]]},
        headers=host["auth"],
    )
    assert res.status_code == 403


def test_ts06_내담자_초대_기존경로_하위호환_200(client):
    from tests.conftest import create_test_org

    org = create_test_org()
    host = _register_counselor("ts06host@test.com", org)
    member = _register_client(client, "ts06c1@test.com")
    room_id = _group_room(client, host, member)

    # Link 연결된 내담자 추가 (기존 경로) → 200
    m2 = _register_client(client, "ts06c2@test.com")
    _link(host["id"], m2["id"])
    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/participants",
        json={"participant_ids": [m2["id"]]},
        headers=host["auth"],
    )
    assert res.status_code == 200, res.text
    assert res.json()["participant_count"] == 3  # host + member + m2

    # 미연결 내담자 → 403 + 기존 에러 메시지 유지
    stranger = _register_client(client, "ts06s@test.com")
    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/participants",
        json={"participant_ids": [stranger["id"]]},
        headers=host["auth"],
    )
    assert res.status_code == 403
    assert res.json()["detail"] == "연결되지 않은 내담자가 포함되어 있습니다"


# ── TS7~TS11: 기존 방 추가 vs 새 방(fork) ──


def test_ts07_기존방_추가시_이력유지_role노출(client):
    from tests.conftest import create_test_org

    org = create_test_org()
    host = _register_counselor("ts07host@test.com", org)
    peer = _register_counselor("ts07peer@test.com", org)
    member = _register_client(client, "ts07c@test.com")
    room_id = _group_room(client, host, member)

    # 초대 전 대화
    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/messages",
        json={"content": "이전 대화", "type": "text"},
        headers=host["auth"],
    )
    assert res.status_code == 201

    # 상담사 추가 후에도 대화 이력 유지 — 새 참여자가 과거 메시지 조회 가능
    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/participants",
        json={"participant_ids": [peer["id"]]},
        headers=host["auth"],
    )
    assert res.status_code == 200, res.text
    msgs = client.get(
        f"/api/v1/chat/rooms/{room_id}/messages", headers=peer["auth"]
    ).json()["messages"]
    assert any(m["content"] == "이전 대화" for m in msgs)

    # 참여자 명단에 role 노출 (내담자/상담사 구분)
    parts = client.get(
        f"/api/v1/chat/rooms/{room_id}/participants", headers=host["auth"]
    ).json()["participants"]
    roles = {p["user_id"]: p["role"] for p in parts}
    assert roles[member["id"]] == "client"
    assert roles[peer["id"]] == "counselor"


def test_ts08_fork_승계_이력미복사_기존방유지(client):
    from tests.conftest import create_test_org

    org = create_test_org()
    host = _register_counselor("ts08host@test.com", org)
    peer = _register_counselor("ts08peer@test.com", org)
    member = _register_client(client, "ts08c@test.com")
    room_id = _group_room(client, host, member, name="원본 그룹")

    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/messages",
        json={"content": "원본 메시지", "type": "text"},
        headers=host["auth"],
    )
    assert res.status_code == 201

    # fork → 새 group 방 (기존 참여자 승계 + 새 참여자)
    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/fork",
        json={"participant_ids": [peer["id"]], "name": "새 그룹"},
        headers=host["auth"],
    )
    assert res.status_code == 201, res.text
    new_room = res.json()
    assert new_room["id"] != room_id
    assert new_room["room_type"] == "group"
    assert new_room["name"] == "새 그룹"
    assert new_room["participant_count"] == 3  # host + member(승계) + peer(신규)

    # 대화 이력 미복사 — 새 방은 메시지 0건
    msgs = client.get(
        f"/api/v1/chat/rooms/{new_room['id']}/messages", headers=host["auth"]
    ).json()["messages"]
    assert msgs == []

    # 기존 방 유지 — 원본 메시지 그대로, host 접근 정상
    old_msgs = client.get(
        f"/api/v1/chat/rooms/{room_id}/messages", headers=host["auth"]
    ).json()["messages"]
    assert any(m["content"] == "원본 메시지" for m in old_msgs)

    # 승계 참여자·새 참여자는 새 방 접근 가능, 새 참여자는 기존 방 접근 불가
    assert (
        client.get(f"/api/v1/chat/rooms/{new_room['id']}/messages", headers=member["auth"]).status_code
        == 200
    )
    assert (
        client.get(f"/api/v1/chat/rooms/{new_room['id']}/messages", headers=peer["auth"]).status_code
        == 200
    )
    assert (
        client.get(f"/api/v1/chat/rooms/{room_id}/messages", headers=peer["auth"]).status_code
        == 403
    )


def test_ts09_direct방_fork_새그룹방(client):
    from tests.conftest import create_test_org

    org = create_test_org()
    host = _register_counselor("ts09host@test.com", org)
    peer = _register_counselor("ts09peer@test.com", org)
    member = _register_client(client, "ts09c@test.com")
    room_id = _direct_room(client, host, member)

    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/fork",
        json={"participant_ids": [peer["id"]]},
        headers=host["auth"],
    )
    assert res.status_code == 201, res.text
    new_room = res.json()
    assert new_room["room_type"] == "group"
    assert new_room["participant_count"] == 3  # host + 기존 상대(내담자) + peer
    # 기존 상대(내담자)와 새 상담사 모두 새 방 접근 가능
    assert (
        client.get(f"/api/v1/chat/rooms/{new_room['id']}/messages", headers=member["auth"]).status_code
        == 200
    )
    assert (
        client.get(f"/api/v1/chat/rooms/{new_room['id']}/messages", headers=peer["auth"]).status_code
        == 200
    )
    # 기존 direct 방은 그대로 유지
    assert (
        client.get(f"/api/v1/chat/rooms/{room_id}/messages", headers=host["auth"]).status_code
        == 200
    )


def test_ts10_direct방_기존방추가_403(client):
    from tests.conftest import create_test_org

    org = create_test_org()
    host = _register_counselor("ts10host@test.com", org)
    peer = _register_counselor("ts10peer@test.com", org)
    member = _register_client(client, "ts10c@test.com")
    room_id = _direct_room(client, host, member)

    # direct 방은 "기존 방에 추가" 불가 — fork 만 허용
    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/participants",
        json={"participant_ids": [peer["id"]]},
        headers=host["auth"],
    )
    assert res.status_code == 403


def test_ts11_fork_이름미지정_서버기본이름(client):
    from tests.conftest import create_test_org

    org = create_test_org()
    host = _register_counselor("ts11host@test.com", org)
    peer = _register_counselor("ts11peer@test.com", org)
    member = _register_client(client, "ts11c@test.com")
    room_id = _group_room(client, host, member, name="명상 A반")

    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/fork",
        json={"participant_ids": [peer["id"]]},
        headers=host["auth"],
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["name"] == "명상 A반 (새 채팅)"
    assert body["display_name"] == "명상 A반 (새 채팅)"

    # 새 참여자 없는 fork(전원 기존 참여자) → 422
    res = client.post(
        f"/api/v1/chat/rooms/{room_id}/fork",
        json={"participant_ids": [member["id"]]},
        headers=host["auth"],
    )
    assert res.status_code == 422


# ── TS12: 초대 후보 조회 ──


def test_ts12_초대후보_공유기관_active_상담사만(client):
    from tests.conftest import create_test_org

    org_a = create_test_org("기관A")
    org_b = create_test_org("기관B")
    me = _register_counselor("ts12me@test.com", org_a, name="나상담")
    peer = _register_counselor("ts12peer@test.com", org_a, name="김공유")
    admin = _create_org_admin("ts12admin@test.com", org_a, name="관리자A")
    _register_counselor("ts12other@test.com", org_b, name="박타기관")
    left = _register_counselor("ts12left@test.com", org_a, name="이탈퇴")
    _set_membership_status(left["id"], "left")

    res = client.get("/api/v1/chat/invitable-counselors", headers=me["auth"])
    assert res.status_code == 200, res.text
    counselors = res.json()["counselors"]
    ids = {c["user_id"] for c in counselors}
    # 공유 기관 active 상담사(+org_admin)만 — 본인·타기관·left 제외
    assert ids == {peer["id"], admin["id"]}
    peer_entry = next(c for c in counselors if c["user_id"] == peer["id"])
    assert peer_entry["role"] == "counselor"
    assert peer_entry["org_names"] == ["기관A"]

    # q 이름 검색
    res = client.get("/api/v1/chat/invitable-counselors?q=김공", headers=me["auth"])
    assert res.status_code == 200
    assert {c["user_id"] for c in res.json()["counselors"]} == {peer["id"]}

    # 내담자는 후보 조회 불가
    member = _register_client(client, "ts12c@test.com")
    res = client.get("/api/v1/chat/invitable-counselors", headers=member["auth"])
    assert res.status_code == 403
