"""SDD-077 상담사 정보 관리 — 3자 권한(본인/플랫폼/기관) 조회·수정 계약."""
from datetime import datetime, timezone

import pytest

from app.core.database import get_db
from app.main import app
from app.models.counselor_profile import CounselorProfile
from app.models.credential import VerificationAudit
from app.models.notification import Notification
from app.models.user import User
from tests.test_sdd074_admin_org_detail import org_data, headers


@pytest.fixture
def solo_counselor(org_data):
    """미소속 상담사 — 플랫폼 관리자 목록/수정 경계 검증용."""
    db, _, _, _ = org_data
    user = User(name="미소속", email="solo@test.com", password_hash="secret",
                role="counselor", org_id=None, status="active",
                created_at=datetime(2026, 2, 1, tzinfo=timezone.utc))
    db.add(user)
    db.flush()
    db.add(CounselorProfile(user_id=user.id, counselor_code="ZZZ999"))
    db.commit()
    return user


# ---------------------------------------------------------------------------
# A. 본인 (상담사)
# ---------------------------------------------------------------------------


def test_me_profile_new_fields_and_version_roundtrip(client, org_data):
    db, _, _, users = org_data
    me = users[2]
    r = client.get("/api/v1/auth/counselors/me/profile", headers=headers(me))
    assert r.status_code == 200
    body = r.json()
    assert body["email"] == me.email
    assert body["version"] == 1
    for field in ("gender", "birth_date", "postal_code", "address_line1", "address_line2"):
        assert body[field] is None

    r = client.patch("/api/v1/auth/counselors/me/profile", headers=headers(me), json={
        "gender": "female", "birth_date": "1990-03-01",
        "postal_code": "06236", "address_line1": "서울시 강남구", "address_line2": "101호",
        "version": 1,
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["gender"] == "female" and body["birth_date"] == "1990-03-01"
    assert body["address_line1"] == "서울시 강남구" and body["version"] == 2

    # 낡은 버전 → 409, null 전송 → 삭제(미입력 보존)
    stale = client.patch("/api/v1/auth/counselors/me/profile", headers=headers(me),
                         json={"gender": "male", "version": 1})
    assert stale.status_code == 409
    r = client.patch("/api/v1/auth/counselors/me/profile", headers=headers(me),
                     json={"birth_date": None, "gender": None, "version": 2})
    assert r.status_code == 200
    assert r.json()["birth_date"] is None and r.json()["gender"] is None
    # 본인 수정은 감사/알림을 만들지 않는다
    assert db.query(VerificationAudit).count() == 0
    assert db.query(Notification).count() == 0


@pytest.mark.parametrize("body,code", [
    ({"email": "new@test.com"}, 403),
    ({"role": "platform_admin"}, 403),
    ({"org_id": None}, 403),
    ({"verified_tier": "verified"}, 403),
    ({"status": "active"}, 403),
    ({"counselor_code": "AAAAAA"}, 403),
    ({"unknown_field": 1}, 422),
    ({"birth_date": "1990-13-40"}, 422),
    ({"birth_date": "2999-01-01"}, 422),
    ({"gender": "unknown"}, 422),
    ({"years_of_experience": -1}, 422),
])
def test_me_profile_rejects_forbidden_and_invalid(client, org_data, body, code):
    db, _, _, users = org_data
    r = client.patch("/api/v1/auth/counselors/me/profile", headers=headers(users[2]), json=body)
    assert r.status_code == code, r.text
    db.refresh(users[2])
    assert users[2].email == "u2@test.com"  # 이메일은 어떤 경로로도 불변


# ---------------------------------------------------------------------------
# B. 플랫폼 관리자
# ---------------------------------------------------------------------------


def test_admin_list_counselors_with_filters(client, org_data, solo_counselor):
    _, org, _, users = org_data
    admin = headers(users[0])
    body = client.get("/api/v1/admin/counselors", headers=admin).json()
    ids = [item["id"] for item in body["items"]]
    assert str(solo_counselor.id) in ids and str(users[2].id) in ids and str(users[1].id) in ids
    assert str(users[3].id) not in ids  # client 제외

    unassigned = client.get("/api/v1/admin/counselors?org_id=none", headers=admin).json()
    assert [item["id"] for item in unassigned["items"]] == [str(solo_counselor.id)]

    by_org = client.get(f"/api/v1/admin/counselors?org_id={org.id}", headers=admin).json()
    assert all(item["org_id"] == str(org.id) for item in by_org["items"])

    by_code = client.get("/api/v1/admin/counselors?q=ZZZ999", headers=admin).json()
    assert [item["id"] for item in by_code["items"]] == [str(solo_counselor.id)]

    by_status = client.get("/api/v1/admin/counselors?status=suspended", headers=admin).json()
    assert [item["id"] for item in by_status["items"]] == [str(users[2].id)]

    assert client.get("/api/v1/admin/counselors", headers=headers(users[1])).status_code == 403
    assert client.get("/api/v1/admin/counselors").status_code == 401


def test_admin_patch_requires_reason_and_records_audit_notification(client, org_data, solo_counselor):
    db, _, _, users = org_data
    admin = headers(users[0])
    url = f"/api/v1/admin/counselors/{solo_counselor.id}/profile"

    assert client.patch(url, headers=admin, json={"phone": "010-9999-0000"}).status_code == 422

    r = client.patch(url, headers=admin, json={
        "phone": "010-9999-0000", "gender": "male", "birth_date": "1985-05-05",
        "address_line1": "부산시", "reason": "본인 요청 정정", "version": 1,
    })
    assert r.status_code == 200, r.text
    assert r.json()["gender"] == "male" and r.json()["version"] == 2

    audit = db.query(VerificationAudit).one()
    assert audit.action == "counselor_profile_updated" and audit.admin_id == users[0].id
    assert audit.reason == "본인 요청 정정"
    assert set(audit.extra["changed_fields"]) == {"phone", "gender", "birth_date", "address_line1"}
    # 감사 전후값에 개인정보 원문 미포함
    for snapshot in (audit.extra["before"], audit.extra["after"]):
        assert "gender" not in snapshot and "birth_date" not in snapshot and "address_line1" not in snapshot
    assert audit.extra["after"]["phone"] == "010-9999-0000"

    notif = db.query(Notification).one()
    assert notif.user_id == solo_counselor.id
    assert "1985" not in (notif.body or "") and "부산" not in (notif.body or "")
    assert "생년월일" in (notif.body or "")


def test_admin_profile_target_boundaries(client, org_data):
    _, _, _, users = org_data
    admin = headers(users[0])
    # client/platform_admin 계정은 상담사 프로필 대상이 아니다
    assert client.get(f"/api/v1/admin/counselors/{users[3].id}/profile", headers=admin).status_code == 404
    assert client.patch(f"/api/v1/admin/counselors/{users[3].id}/profile", headers=admin,
                        json={"name": "x", "reason": "r"}).status_code == 404
    # 비관리자 차단
    assert client.get(f"/api/v1/admin/counselors/{users[2].id}/profile",
                      headers=headers(users[1])).status_code == 403


def test_admin_career_validation(client, org_data):
    _, _, _, users = org_data
    r = client.patch(f"/api/v1/admin/counselors/{users[2].id}/profile", headers=headers(users[0]), json={
        "reason": "정정",
        "careers": [{"organization": "센터", "started_at": "2024-01-01", "ended_at": "2023-01-01", "is_current": False}],
    })
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# C. 기관 관리자 — 개인정보 포함 전부 조회+수정 (정책 확정)
# ---------------------------------------------------------------------------


def test_org_admin_full_access_same_org(client, org_data):
    db, org, _, users = org_data
    org_admin = headers(users[1])
    url = f"/api/v1/org/{org.id}/counselors/{users[2].id}/profile"

    r = client.get(url, headers=org_admin)
    assert r.status_code == 200
    assert "gender" in r.json() and "birth_date" in r.json() and "address_line1" in r.json()

    r = client.patch(url, headers=org_admin, json={
        "gender": "other", "birth_date": "1992-12-12", "phone": "010-2222-3333",
        "postal_code": "12345", "address_line1": "대구시", "reason": "정보 갱신", "version": 1,
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["gender"] == "other" and body["birth_date"] == "1992-12-12"
    assert body["phone"] == "010-2222-3333" and body["address_line1"] == "대구시"
    assert body["version"] == 2

    audit = db.query(VerificationAudit).one()
    assert audit.extra["actor_kind"] == "org_admin" and audit.admin_id == users[1].id
    assert db.query(Notification).filter(Notification.user_id == users[2].id).count() == 1


def test_org_admin_boundaries(client, org_data):
    db, org, other, users = org_data
    org_admin = headers(users[1])
    # 타 기관 URL → 403 (본인 기관 아님)
    assert client.get(f"/api/v1/org/{other.id}/counselors/{users[4].id}/profile",
                      headers=org_admin).status_code == 403
    # 본인 기관 URL + 타 기관 소속 대상 → 404
    assert client.get(f"/api/v1/org/{org.id}/counselors/{users[4].id}/profile",
                      headers=org_admin).status_code == 404
    # 일반 상담사 행위자 → 403
    assert client.get(f"/api/v1/org/{org.id}/counselors/{users[2].id}/profile",
                      headers=headers(users[2])).status_code == 403
    # 대상이 기관 관리자면 수정 403 (조회는 허용)
    assert client.get(f"/api/v1/org/{org.id}/counselors/{users[1].id}/profile",
                      headers=org_admin).status_code == 200
    assert client.patch(f"/api/v1/org/{org.id}/counselors/{users[1].id}/profile",
                        headers=org_admin, json={"name": "x", "reason": "r"}).status_code == 403
    # 사유 누락 422
    assert client.patch(f"/api/v1/org/{org.id}/counselors/{users[2].id}/profile",
                        headers=org_admin, json={"name": "x"}).status_code == 422
    # 비활성화 기관 → 409
    org.deactivated_at = datetime.now(timezone.utc)
    db.commit()
    assert client.patch(f"/api/v1/org/{org.id}/counselors/{users[2].id}/profile",
                        headers=org_admin, json={"name": "x", "reason": "r"}).status_code == 409


# ---------------------------------------------------------------------------
# D. 주 담당자 이름/전화 수정 (교체 아님)
# ---------------------------------------------------------------------------


def test_primary_admin_profile_patch(client, org_data):
    db, org, other, users = org_data
    admin = headers(users[0])
    url = f"/api/v1/admin/orgs/{org.id}/primary-admin/profile"
    org_phone_before = org.phone

    assert client.patch(url, headers=admin, json={"name": "새담당자"}).status_code == 422  # 사유 필수

    r = client.patch(url, headers=admin, json={
        "name": "새담당자", "phone": "010-7777-8888", "reason": "오기재 정정",
        "expected_user_id": str(users[1].id),
    })
    assert r.status_code == 200, r.text
    db.refresh(users[1]); db.refresh(org)
    assert users[1].name == "새담당자" and users[1].phone == "010-7777-8888"
    # 담당자 지정·기관 연락처·역할 불변, 상담사 프로필 미생성
    assert org.primary_admin_id == users[1].id and org.phone == org_phone_before
    assert users[1].role == "org_admin"
    assert db.query(CounselorProfile).filter_by(user_id=users[1].id).count() == 0
    audit = db.query(VerificationAudit).one()
    assert audit.action == "primary_admin_profile_updated"

    # 저장 중 담당자 교체 감지 → 409
    assert client.patch(url, headers=admin, json={
        "name": "x", "reason": "r", "expected_user_id": str(users[2].id),
    }).status_code == 409
    # 담당자 미지정 기관 → 404
    assert client.patch(f"/api/v1/admin/orgs/{other.id}/primary-admin/profile", headers=admin,
                        json={"name": "x", "reason": "r"}).status_code == 404
    # 비관리자 403
    assert client.patch(url, headers=headers(users[1]),
                        json={"name": "x", "reason": "r"}).status_code == 403
