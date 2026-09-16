"""F8 AI 리포트 QA"""

import io
from datetime import datetime, timedelta, timezone

VALID_PASSWORD = "Passw0rd!"


def _register(client, email: str, role: str = "counselor") -> dict:
    from app.services import email_verify_service
    from tests.conftest import create_test_org

    payload = {
        # SDD-015: 상담사 가입에 유효한 기관 코드 필수 (client 가입에서는 무시됨)
        "org_code": create_test_org(),
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


def _create_session(client, host, minutes: int = 60) -> str:
    res = client.post(
        "/api/v1/sessions",
        json={"type": "clinical", "scheduled_at": _future(minutes), "duration_min": 50, "title": "리포트 테스트"},
        headers=host["auth"],
    )
    assert res.status_code == 201, res.text
    sid = res.json()["id"]
    r = client.post(f"/api/v1/sessions/{sid}/start", headers=host["auth"])
    assert r.status_code == 200, r.text
    return sid


def _run_pipeline(client, host, sid: str) -> None:
    client.post(f"/api/v1/sessions/{sid}/audio/start", json={"consent_audio": True}, headers=host["auth"])
    file_data = {"file": ("c0.webm", io.BytesIO(b"x" * 50), "audio/webm")}
    client.post(
        f"/api/v1/sessions/{sid}/audio/chunk",
        data={"chunk_index": "0"},
        files=file_data,
        headers=host["auth"],
    )
    client.post(f"/api/v1/sessions/{sid}/audio/stop", headers=host["auth"])


def test_report_01_생성_상담사용(client):
    host = _register(client, "rep01@test.com")
    sid = _create_session(client, host)
    _run_pipeline(client, host, sid)
    res = client.post(
        f"/api/v1/reports/generate/{sid}",
        json={"type": "counselor"},
        headers=host["auth"],
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["type"] == "counselor"
    assert "headline" in body["content"]


def test_report_02_생성_내담자용(client):
    host = _register(client, "rep02@test.com")
    sid = _create_session(client, host)
    _run_pipeline(client, host, sid)
    res = client.post(
        f"/api/v1/reports/generate/{sid}",
        json={"type": "client"},
        headers=host["auth"],
    )
    assert res.status_code == 200, res.text
    assert res.json()["type"] == "client"


def test_report_03_생성_타인_403(client):
    host = _register(client, "rep03a@test.com")
    other = _register(client, "rep03b@test.com")
    sid = _create_session(client, host)
    res = client.post(
        f"/api/v1/reports/generate/{sid}",
        json={"type": "counselor"},
        headers=other["auth"],
    )
    assert res.status_code == 403


def test_report_04_목록_조회(client):
    host = _register(client, "rep04@test.com")
    sid = _create_session(client, host)
    client.post(f"/api/v1/reports/generate/{sid}", json={"type": "counselor"}, headers=host["auth"])
    res = client.get("/api/v1/reports", headers=host["auth"])
    assert res.status_code == 200
    body = res.json()
    assert body["total"] >= 1
    assert body["reports"][0]["session_id"] == sid
    # SDD-058 페이지네이션: page/limit 미지정 시 None으로 직렬화됨 (스키마 Optional 필드)
    assert body.get("page") is None
    assert body.get("limit") is None


def test_report_04_목록_페이지네이션(client):
    host = _register(client, "rep04-pagination@test.com")
    session_ids = []
    for minutes in (60, 120, 180):
        sid = _create_session(client, host, minutes)
        session_ids.append(sid)
        generated = client.post(
            f"/api/v1/reports/generate/{sid}",
            json={"type": "counselor"},
            headers=host["auth"],
        )
        assert generated.status_code == 200, generated.text

    first_res = client.get(
        "/api/v1/reports",
        params={"page": 1, "limit": 2},
        headers=host["auth"],
    )
    res = client.get(
        "/api/v1/reports",
        params={"page": 2, "limit": 2},
        headers=host["auth"],
    )

    assert first_res.status_code == 200, first_res.text
    assert res.status_code == 200, res.text
    first_body = first_res.json()
    body = res.json()
    assert body["total"] == 3
    assert body["page"] == 2
    assert body["limit"] == 2
    assert len(body["reports"]) == 1
    paged_session_ids = {
        report["session_id"]
        for report in first_body["reports"] + body["reports"]
    }
    assert paged_session_ids == set(session_ids)


def test_report_05_상세_조회(client):
    host = _register(client, "rep05@test.com")
    sid = _create_session(client, host)
    gen = client.post(f"/api/v1/reports/generate/{sid}", json={"type": "counselor"}, headers=host["auth"]).json()
    rid = gen["id"]
    res = client.get(f"/api/v1/reports/{rid}", headers=host["auth"])
    assert res.status_code == 200
    assert res.json()["id"] == rid


def test_report_06_수정_상담사전용(client):
    host = _register(client, "rep06@test.com")
    sid = _create_session(client, host)
    gen = client.post(f"/api/v1/reports/generate/{sid}", json={"type": "counselor"}, headers=host["auth"]).json()
    rid = gen["id"]
    res = client.put(
        f"/api/v1/reports/{rid}",
        json={"content": {"headline": "수정됨", "sections": {}}},
        headers=host["auth"],
    )
    assert res.status_code == 200
    assert res.json()["content"]["headline"] == "수정됨"


def test_report_07_승인_알림이벤트(client):
    host = _register(client, "rep07@test.com")
    sid = _create_session(client, host)
    gen = client.post(f"/api/v1/reports/generate/{sid}", json={"type": "client"}, headers=host["auth"]).json()
    rid = gen["id"]
    res = client.post(f"/api/v1/reports/{rid}/approve", json={}, headers=host["auth"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["sent_at"] is not None
    assert body["content"]["approved"] is True


def test_report_08_비로그인_401(client):
    res = client.get("/api/v1/reports")
    assert res.status_code == 401


def test_report_09_자동승인_설정_조회와_변경(client):
    host = _register(client, "rep09@test.com")

    initial = client.get("/api/v1/reports/auto-approve", headers=host["auth"])
    assert initial.status_code == 200, initial.text
    assert initial.json() == {"enabled": False}

    updated = client.patch(
        "/api/v1/reports/auto-approve",
        json={"enabled": True},
        headers=host["auth"],
    )
    assert updated.status_code == 200, updated.text
    assert updated.json() == {"enabled": True}

    persisted = client.get("/api/v1/reports/auto-approve", headers=host["auth"])
    assert persisted.json() == {"enabled": True}


def test_report_10_자동승인_설정은_상담사만_변경(client):
    participant = _register(client, "rep10@test.com", role="client")

    get_res = client.get("/api/v1/reports/auto-approve", headers=participant["auth"])
    patch_res = client.patch(
        "/api/v1/reports/auto-approve",
        json={"enabled": True},
        headers=participant["auth"],
    )

    assert get_res.status_code == 403
    assert patch_res.status_code == 403


def test_report_11_자동승인_ON이면_생성_직후_발행(client):
    host = _register(client, "rep11@test.com")
    setting = client.patch(
        "/api/v1/reports/auto-approve",
        json={"enabled": True},
        headers=host["auth"],
    )
    assert setting.status_code == 200, setting.text
    sid = _create_session(client, host)

    generated = client.post(
        f"/api/v1/reports/generate/{sid}",
        json={"type": "counselor"},
        headers=host["auth"],
    )

    assert generated.status_code == 200, generated.text
    body = generated.json()
    assert body["status"] == "completed"
    assert body["sent_at"] is not None
    assert body["content"]["approved"] is True


def test_report_12_자동승인_OFF이면_기존_수동승인_상태_유지(client):
    host = _register(client, "rep12@test.com")
    sid = _create_session(client, host)

    generated = client.post(
        f"/api/v1/reports/generate/{sid}",
        json={"type": "counselor"},
        headers=host["auth"],
    )

    assert generated.status_code == 200, generated.text
    body = generated.json()
    assert body["status"] == "pending_review"
    assert body["sent_at"] is None
    assert body["content"].get("approved") is not True
