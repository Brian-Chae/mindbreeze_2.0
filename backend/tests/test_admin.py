"""F11 어드민 검토 큐 + 사용자 관리 QA"""

import uuid

VALID_PASSWORD = "Passw0rd!"


def _consents():
    return {"tos": True, "privacy": True, "sensitive": True}


def _register(client, email: str, role: str = "counselor"):
    from app.services import email_verify_service

    payload = {
        "email": email,
        "password": VALID_PASSWORD,
        "name": f"테스트{role}",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": _consents(),
    }
    res = client.post(f"/api/v1/auth/register/{role}", json=payload)
    assert res.status_code == 201, res.text
    body = res.json()
    token = body.get("access_token") or body.get("tokens", {}).get("access_token")
    return {
        "id": body["user"]["id"],
        "token": token,
        "h": {"Authorization": f"Bearer {token}"},
    }


def _make_admin(client):
    """platform_admin 사용자 생성 (counselor 로 등록 후 role 강제 변경)."""
    from app.core.database import get_db
    from app.models.user import User

    admin = _register(client, "admin@test.com", "counselor")
    # DB 직접 변경
    db = next(client.app.dependency_overrides[get_db]())
    user = db.query(User).filter(User.id == uuid.UUID(admin["id"])).first()
    user.role = "platform_admin"
    db.add(user)
    db.commit()
    db.close()
    return admin


def _seed_credential(client, user_id: str, status: str = "needs_review", risk: float = 0.8):
    from app.core.database import get_db
    from app.models.credential import Credential

    db = next(client.app.dependency_overrides[get_db]())
    cred = Credential(
        user_id=uuid.UUID(user_id),
        type="license",
        s3_key=f"/tmp/{uuid.uuid4()}.png",
        file_name="lic.png",
        status=status,
        ai_verdict={"risk_score": risk, "extracted": {"name": "홍길동"}},
    )
    db.add(cred)
    db.commit()
    db.refresh(cred)
    cid = str(cred.id)
    db.close()
    return cid


def _seed_org_document(client, status: str = "needs_review", risk: float = 0.5):
    from app.core.database import get_db
    from app.models.org_document import OrgDocument
    from app.models.organization import Organization

    db = next(client.app.dependency_overrides[get_db]())
    org = Organization(
        name="테스트센터",
        ceo_name="홍대표",
        biz_number=str(uuid.uuid4().int)[:10],
        address="서울",
        phone="0212345678",
    )
    db.add(org)
    db.commit()
    db.refresh(org)
    doc = OrgDocument(
        org_id=org.id,
        type="biz_registration",
        s3_key=f"/tmp/{uuid.uuid4()}.pdf",
        file_name="biz.pdf",
        status=status,
        ai_verdict={"risk_score": risk},
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    did = str(doc.id)
    db.close()
    return did


def test_admin_review_queue_통합목록(client):
    admin = _make_admin(client)
    submitter = _register(client, "sub1@test.com")
    _seed_credential(client, submitter["id"], "needs_review", 0.9)
    _seed_org_document(client, "needs_review", 0.5)

    res = client.get("/api/v1/admin/reviews", headers=admin["h"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 2
    assert body["items"][0]["risk_score"] >= body["items"][1]["risk_score"]
    types = {it["target_type"] for it in body["items"]}
    assert types == {"credential", "org_document"}


def test_admin_review_queue_위험도_필터(client):
    admin = _make_admin(client)
    submitter = _register(client, "sub2@test.com")
    _seed_credential(client, submitter["id"], "needs_review", 0.9)
    _seed_org_document(client, "needs_review", 0.2)

    res = client.get("/api/v1/admin/reviews?risk_level=high", headers=admin["h"])
    assert res.status_code == 200
    body = res.json()
    assert all(it["risk_score"] >= 0.7 for it in body["items"])


def test_credential_상세조회(client):
    admin = _make_admin(client)
    submitter = _register(client, "sub3@test.com")
    cid = _seed_credential(client, submitter["id"])

    res = client.get(f"/api/v1/admin/reviews/credentials/{cid}", headers=admin["h"])
    assert res.status_code == 200
    body = res.json()
    assert body["id"] == cid
    assert body["submitter"]["email"] == "sub3@test.com"
    assert body["risk_level"] in ("low", "medium", "high")


def test_org_document_상세조회(client):
    admin = _make_admin(client)
    did = _seed_org_document(client)

    res = client.get(f"/api/v1/admin/reviews/org-documents/{did}", headers=admin["h"])
    assert res.status_code == 200
    body = res.json()
    assert body["id"] == did
    assert body["org"]["name"] == "테스트센터"


def test_credential_승인_및_audit기록(client):
    admin = _make_admin(client)
    submitter = _register(client, "sub4@test.com")
    cid = _seed_credential(client, submitter["id"])

    res = client.post(
        f"/api/v1/admin/reviews/credential/{cid}/action",
        json={"action": "approve", "reason": "검증 완료"},
        headers=admin["h"],
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "approved"

    detail = client.get(f"/api/v1/admin/reviews/credentials/{cid}", headers=admin["h"]).json()
    assert len(detail["audits"]) >= 1
    assert detail["audits"][0]["action"] == "approve"


def test_org_document_반려(client):
    admin = _make_admin(client)
    did = _seed_org_document(client)

    res = client.post(
        f"/api/v1/admin/reviews/org_document/{did}/action",
        json={"action": "reject", "reason": "위변조 의심"},
        headers=admin["h"],
    )
    assert res.status_code == 200
    assert res.json()["status"] == "rejected"


def test_추가자료_요청(client):
    admin = _make_admin(client)
    submitter = _register(client, "sub5@test.com")
    cid = _seed_credential(client, submitter["id"], status="pending")

    res = client.post(
        f"/api/v1/admin/reviews/credential/{cid}/action",
        json={"action": "request_more", "reason": "선명한 사진 필요"},
        headers=admin["h"],
    )
    assert res.status_code == 200
    assert res.json()["status"] == "needs_review"


def test_일괄처리(client):
    admin = _make_admin(client)
    submitter = _register(client, "sub6@test.com")
    c1 = _seed_credential(client, submitter["id"])
    c2 = _seed_credential(client, submitter["id"])

    res = client.post(
        "/api/v1/admin/reviews/batch",
        json={
            "items": [
                {"target_type": "credential", "target_id": c1, "action": "approve", "reason": "ok"},
                {"target_type": "credential", "target_id": c2, "action": "reject", "reason": "ng"},
            ]
        },
        headers=admin["h"],
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 2
    assert all(r["ok"] for r in body["results"])


def test_사용자_목록_및_검색(client):
    admin = _make_admin(client)
    _register(client, "find-me@test.com")
    res = client.get("/api/v1/admin/users?q=find-me", headers=admin["h"])
    assert res.status_code == 200
    body = res.json()
    assert body["total"] >= 1
    assert any(it["email"] == "find-me@test.com" for it in body["items"])


def test_사용자_정지_및_해제(client):
    admin = _make_admin(client)
    sub = _register(client, "suspend@test.com")

    r = client.post(
        f"/api/v1/admin/users/{sub['id']}/suspend",
        json={"reason": "약관 위반"},
        headers=admin["h"],
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "suspended"

    r2 = client.post(f"/api/v1/admin/users/{sub['id']}/unsuspend", headers=admin["h"])
    assert r2.status_code == 200
    assert r2.json()["status"] == "active"


def test_정지사유_누락_422(client):
    admin = _make_admin(client)
    sub = _register(client, "nosus@test.com")
    r = client.post(
        f"/api/v1/admin/users/{sub['id']}/suspend",
        json={"reason": ""},
        headers=admin["h"],
    )
    assert r.status_code == 422


def test_counselor_admin_API_403(client):
    counselor = _register(client, "regular@test.com")
    res = client.get("/api/v1/admin/reviews", headers=counselor["h"])
    assert res.status_code == 403


def test_미인증_admin_API_401(client):
    res = client.get("/api/v1/admin/reviews")
    assert res.status_code == 401
