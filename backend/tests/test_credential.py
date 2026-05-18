"""F3 자격 증빙 — 업로드/목록/삭제/관리자 검증"""

import io

VALID_PASSWORD = "Passw0rd!"


def _consents():
    return {"tos": True, "privacy": True, "sensitive": True}


def _register_counselor(client, email="counselor@test.com"):
    from app.services import email_verify_service

    payload = {
        "email": email,
        "password": VALID_PASSWORD,
        "name": "상담사",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": _consents(),
    }
    res = client.post("/api/v1/auth/register/counselor", json=payload)
    assert res.status_code == 201, res.text
    return res.json()["tokens"]["access_token"]


def _headers(token):
    return {"Authorization": f"Bearer {token}"}


def _png_bytes(size: int = 100) -> bytes:
    # 더미 PNG 페이로드 — 확장자 기반 검증이므로 실제 디코딩은 불필요
    return b"\x89PNG\r\n\x1a\n" + b"0" * max(0, size - 8)


def _upload(client, token, file_bytes, filename, cred_type, content_type="image/png"):
    return client.post(
        "/api/v1/credentials/upload",
        headers=_headers(token),
        files={"file": (filename, io.BytesIO(file_bytes), content_type)},
        data={"type": cred_type},
    )


def test_id_card_업로드_성공(client):
    token = _register_counselor(client, "c-idcard@test.com")
    res = _upload(client, token, _png_bytes(), "id.png", "id_card")
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["type"] == "id_card"
    assert body["status"] == "pending"
    assert body["file_name"] == "id.png"


def test_license_업로드_성공(client):
    token = _register_counselor(client, "c-license@test.com")
    res = _upload(client, token, _png_bytes(), "lic.pdf", "license", content_type="application/pdf")
    assert res.status_code == 201, res.text
    assert res.json()["type"] == "license"


def test_id_card_중복_409(client):
    token = _register_counselor(client, "c-dup@test.com")
    r1 = _upload(client, token, _png_bytes(), "id1.png", "id_card")
    assert r1.status_code == 201
    r2 = _upload(client, token, _png_bytes(), "id2.png", "id_card")
    assert r2.status_code == 409
    assert "신분증" in r2.json()["detail"]


def test_지원되지_않는_형식_422(client):
    token = _register_counselor(client, "c-badformat@test.com")
    res = _upload(client, token, b"hello", "doc.txt", "id_card", content_type="text/plain")
    assert res.status_code == 422
    assert "PDF" in res.json()["detail"]


def test_파일_크기_초과_413(client):
    token = _register_counselor(client, "c-big@test.com")
    big = b"\x89PNG\r\n\x1a\n" + b"x" * (10 * 1024 * 1024 + 1)
    res = _upload(client, token, big, "big.png", "id_card")
    assert res.status_code == 413
    assert "10MB" in res.json()["detail"]


def test_목록_조회_및_verified_tier(client):
    token = _register_counselor(client, "c-list@test.com")
    _upload(client, token, _png_bytes(), "id.png", "id_card")
    _upload(client, token, _png_bytes(), "lic.png", "license")

    res = client.get("/api/v1/credentials", headers=_headers(token))
    assert res.status_code == 200
    body = res.json()
    assert len(body["credentials"]) == 2
    # 미승인 상태 → verified_tier는 가입 기본값
    assert body["verified_tier"] in ("unverified", "email")
    # 부족 안내 — 승인 전이므로 둘 다 표시
    assert len(body["missing"]) == 2


def test_관리자_승인_시_verified_tier_갱신(client):
    token = _register_counselor(client, "c-admin@test.com")
    h = _headers(token)
    r1 = _upload(client, token, _png_bytes(), "id.png", "id_card")
    r2 = _upload(client, token, _png_bytes(), "lic.png", "license")
    id1 = r1.json()["id"]
    id2 = r2.json()["id"]

    # 두 건 모두 승인
    for cid in (id1, id2):
        r = client.put(
            f"/api/v1/credentials/admin/{cid}",
            json={"status": "approved"},
        )
        assert r.status_code == 200, r.text

    res = client.get("/api/v1/credentials", headers=h)
    assert res.status_code == 200
    body = res.json()
    assert body["verified_tier"] == "verified"
    assert body["missing"] == []


def test_pending_증빙_삭제_성공(client):
    token = _register_counselor(client, "c-del@test.com")
    h = _headers(token)
    r = _upload(client, token, _png_bytes(), "id.png", "id_card")
    cid = r.json()["id"]

    res = client.delete(f"/api/v1/credentials/{cid}", headers=h)
    assert res.status_code == 204

    res = client.get("/api/v1/credentials", headers=h)
    assert res.status_code == 200
    assert res.json()["credentials"] == []
