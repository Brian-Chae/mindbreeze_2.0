"""F5 세션 관리 QA — 15개 항목 검증"""

from datetime import datetime, timedelta, timezone

VALID_PASSWORD = "Passw0rd!"


def _register(client, email: str, role: str = "counselor") -> dict:
    from app.services import email_verify_service

    payload = {
        "email": email,
        "password": VALID_PASSWORD,
        "name": "테스트",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": {"tos": True, "privacy": True, "sensitive": True},
    }
    res = client.post(f"/api/v1/auth/register/{role}", json=payload)
    assert res.status_code == 201, res.text
    body = res.json()
    token = body.get("access_token") or body.get("tokens", {}).get("access_token")
    return {
        "id": body["user"]["id"],
        "access_token": token,
        "auth": {"Authorization": f"Bearer {token}"},
    }


def _future(minutes: int = 60) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


def _past(minutes: int = 60) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()


def _create_payload(**overrides):
    payload = {
        "type": "clinical",
        "scheduled_at": _future(60),
        "duration_min": 50,
        "title": "테스트 상담",
    }
    payload.update(overrides)
    return payload


def test_01_상담사_세션_생성_성공(client):
    host = _register(client, "host01@test.com")
    res = client.post("/api/v1/sessions", json=_create_payload(), headers=host["auth"])
    assert res.status_code == 201, res.text
    assert res.json()["status"] == "scheduled"


def test_02_비로그인_세션_생성_401(client):
    res = client.post("/api/v1/sessions", json=_create_payload())
    assert res.status_code == 401


def test_03_과거_일시_생성_차단(client):
    host = _register(client, "host03@test.com")
    res = client.post(
        "/api/v1/sessions",
        json=_create_payload(scheduled_at=_past(120)),
        headers=host["auth"],
    )
    assert res.status_code == 400
    assert "과거" in res.json()["detail"]


def test_04_시간_충돌_409(client):
    host = _register(client, "host04@test.com")
    when = _future(120)
    r1 = client.post("/api/v1/sessions", json=_create_payload(scheduled_at=when, duration_min=60), headers=host["auth"])
    assert r1.status_code == 201
    r2 = client.post("/api/v1/sessions", json=_create_payload(scheduled_at=when, duration_min=30), headers=host["auth"])
    assert r2.status_code == 409


def test_05_시간_충돌_force_허용(client):
    host = _register(client, "host05@test.com")
    when = _future(120)
    client.post("/api/v1/sessions", json=_create_payload(scheduled_at=when, duration_min=60), headers=host["auth"])
    r2 = client.post(
        "/api/v1/sessions",
        json=_create_payload(scheduled_at=when, duration_min=30, force=True),
        headers=host["auth"],
    )
    assert r2.status_code == 201


def test_06_host_세션_조회(client):
    host = _register(client, "host06@test.com")
    created = client.post("/api/v1/sessions", json=_create_payload(), headers=host["auth"]).json()
    res = client.get(f"/api/v1/sessions/{created['id']}", headers=host["auth"])
    assert res.status_code == 200
    assert res.json()["id"] == created["id"]


def test_07_타인_수정_삭제_403(client):
    host = _register(client, "host07@test.com")
    other = _register(client, "other07@test.com")
    created = client.post("/api/v1/sessions", json=_create_payload(), headers=host["auth"]).json()
    r_put = client.put(
        f"/api/v1/sessions/{created['id']}",
        json={"title": "변경"},
        headers=other["auth"],
    )
    assert r_put.status_code == 403
    r_del = client.delete(f"/api/v1/sessions/{created['id']}", headers=other["auth"])
    assert r_del.status_code == 403


def test_08_start_전이(client):
    host = _register(client, "host08@test.com")
    s = client.post("/api/v1/sessions", json=_create_payload(), headers=host["auth"]).json()
    res = client.post(f"/api/v1/sessions/{s['id']}/start", headers=host["auth"])
    assert res.status_code == 200
    assert res.json()["status"] == "in_progress"


def test_09_pause_resume_전이(client):
    host = _register(client, "host09@test.com")
    s = client.post("/api/v1/sessions", json=_create_payload(), headers=host["auth"]).json()
    client.post(f"/api/v1/sessions/{s['id']}/start", headers=host["auth"])
    r1 = client.post(f"/api/v1/sessions/{s['id']}/pause", headers=host["auth"])
    assert r1.status_code == 200 and r1.json()["status"] == "paused"
    r2 = client.post(f"/api/v1/sessions/{s['id']}/resume", headers=host["auth"])
    assert r2.status_code == 200 and r2.json()["status"] == "in_progress"


def test_10_end_전이(client):
    host = _register(client, "host10@test.com")
    s = client.post("/api/v1/sessions", json=_create_payload(), headers=host["auth"]).json()
    client.post(f"/api/v1/sessions/{s['id']}/start", headers=host["auth"])
    res = client.post(f"/api/v1/sessions/{s['id']}/end", headers=host["auth"])
    assert res.status_code == 200 and res.json()["status"] == "completed"


def test_11_completed_에서_start_재시도_400(client):
    host = _register(client, "host11@test.com")
    s = client.post("/api/v1/sessions", json=_create_payload(), headers=host["auth"]).json()
    client.post(f"/api/v1/sessions/{s['id']}/start", headers=host["auth"])
    client.post(f"/api/v1/sessions/{s['id']}/end", headers=host["auth"])
    res = client.post(f"/api/v1/sessions/{s['id']}/start", headers=host["auth"])
    assert res.status_code == 400


def test_12_scheduled_취소(client):
    host = _register(client, "host12@test.com")
    s = client.post("/api/v1/sessions", json=_create_payload(), headers=host["auth"]).json()
    res = client.post(f"/api/v1/sessions/{s['id']}/cancel", headers=host["auth"])
    assert res.status_code == 200 and res.json()["status"] == "cancelled"


def test_13_meditation_정원_초과(client):
    host = _register(client, "host13@test.com")
    participants = [_register(client, f"part13_{i}@test.com", role="client") for i in range(6)]
    s = client.post(
        "/api/v1/sessions",
        json=_create_payload(type="meditation", max_participants=5),
        headers=host["auth"],
    ).json()
    for p in participants[:5]:
        r = client.post(
            f"/api/v1/sessions/{s['id']}/invite",
            json={"user_id": p["id"]},
            headers=host["auth"],
        )
        assert r.status_code == 200, r.text
    r6 = client.post(
        f"/api/v1/sessions/{s['id']}/invite",
        json={"user_id": participants[5]["id"]},
        headers=host["auth"],
    )
    assert r6.status_code == 400


def test_14_세션_목록_host와_participant_포함(client):
    host = _register(client, "host14@test.com")
    participant = _register(client, "part14@test.com", role="client")
    s = client.post(
        "/api/v1/sessions",
        json=_create_payload(type="meditation", max_participants=5),
        headers=host["auth"],
    ).json()
    client.post(
        f"/api/v1/sessions/{s['id']}/invite",
        json={"user_id": participant["id"]},
        headers=host["auth"],
    )
    res_host = client.get("/api/v1/sessions", headers=host["auth"]).json()
    assert res_host["total"] >= 1
    res_part = client.get("/api/v1/sessions", headers=participant["auth"]).json()
    assert any(sess["id"] == s["id"] for sess in res_part["sessions"])


def test_15_세션_삭제(client):
    host = _register(client, "host15@test.com")
    s = client.post("/api/v1/sessions", json=_create_payload(), headers=host["auth"]).json()
    r_del = client.delete(f"/api/v1/sessions/{s['id']}", headers=host["auth"])
    assert r_del.status_code == 204
    r_get = client.get(f"/api/v1/sessions/{s['id']}", headers=host["auth"])
    assert r_get.status_code == 404
