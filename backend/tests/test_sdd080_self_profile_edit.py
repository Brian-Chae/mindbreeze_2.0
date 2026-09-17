"""SDD-080 역할별 자기 정보 수정 — org_admin 상담사 프로필 경로 + client /users/me 계약."""

from app.models.client_profile import ClientProfile
from app.models.counselor_profile import CounselorProfile
from tests.test_sdd074_admin_org_detail import org_data, headers  # noqa: F401


def test_org_admin_me_profile_get_and_basic_patch(client, org_data):  # noqa: F811
    """순수 기관 관리자(상담사 프로필 없음)도 본인 조회 + 기본 정보(이름/전화) 수정 가능."""
    db, _, _, users = org_data
    admin = users[1]

    r = client.get("/api/v1/auth/counselors/me/profile", headers=headers(admin))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["role"] == "org_admin"
    assert body["counselor_code"] is None  # 프로필 미보유
    assert body["version"] == 1

    r = client.patch(
        "/api/v1/auth/counselors/me/profile",
        headers=headers(admin),
        json={"name": "관리자수정", "phone": "010-9999-0000", "version": body["version"]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "관리자수정"
    assert r.json()["phone"] == "010-9999-0000"

    # 기본 정보(User 필드) 수정은 상담사 프로필을 생성하지 않는다 (counselor_code 미발급)
    assert db.query(CounselorProfile).filter(CounselorProfile.user_id == admin.id).first() is None
    db.refresh(admin)
    assert admin.email == "u1@test.com" and admin.role == "org_admin"  # 이메일/역할 불변


def test_client_users_me_patch_preserves_unsent_fields(client, org_data):  # noqa: F811
    """client 자기 정보 수정 — 미전송 필드는 유지(null 보존), 이메일/역할 불변."""
    db, _, _, users = org_data
    me = users[3]

    r = client.patch(
        "/api/v1/auth/users/me",
        headers=headers(me),
        json={"name": "회원수정", "phone": "010-1111-2222", "gender": "female", "birth_date": "1995-05-05"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "회원수정" and r.json()["role"] == "client"

    profile = db.query(ClientProfile).filter(ClientProfile.user_id == me.id).first()
    assert profile is not None
    assert profile.gender == "female" and str(profile.birth_date) == "1995-05-05"

    # 일부 필드만 전송 → 나머지 값 유지
    r = client.patch("/api/v1/auth/users/me", headers=headers(me), json={"name": "회원재수정"})
    assert r.status_code == 200, r.text
    db.expire_all()
    profile = db.query(ClientProfile).filter(ClientProfile.user_id == me.id).first()
    assert profile.gender == "female" and str(profile.birth_date) == "1995-05-05"
    db.refresh(me)
    assert me.phone == "010-1111-2222"
    assert me.email == "u3@test.com" and me.role == "client"


def test_users_me_rejects_invalid_values(client, org_data):  # noqa: F811
    """성별 패턴/생년월일 형식 검증."""
    _, _, _, users = org_data
    me = users[3]
    assert client.patch(
        "/api/v1/auth/users/me", headers=headers(me), json={"gender": "unknown"}
    ).status_code == 422
    assert client.patch(
        "/api/v1/auth/users/me", headers=headers(me), json={"birth_date": "1990-13-40"}
    ).status_code == 422
