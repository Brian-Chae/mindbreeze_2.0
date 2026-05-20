"""F7 AI 자동 기록 QA — 12개 항목 검증"""

import io
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


def _create_session(client, host, started: bool = True) -> str:
    res = client.post(
        "/api/v1/sessions",
        json={"type": "clinical", "scheduled_at": _future(60), "duration_min": 50, "title": "녹음테스트"},
        headers=host["auth"],
    )
    assert res.status_code == 201, res.text
    sid = res.json()["id"]
    if started:
        r = client.post(f"/api/v1/sessions/{sid}/start", headers=host["auth"])
        assert r.status_code == 200, r.text
    return sid


def test_01_녹음_시작_동의없음_400(client):
    host = _register(client, "rec01@test.com")
    sid = _create_session(client, host)
    res = client.post(
        f"/api/v1/sessions/{sid}/audio/start",
        json={"consent_audio": False},
        headers=host["auth"],
    )
    assert res.status_code == 400
    assert "동의" in res.json()["detail"]


def test_02_녹음_시작_성공(client):
    host = _register(client, "rec02@test.com")
    sid = _create_session(client, host)
    res = client.post(
        f"/api/v1/sessions/{sid}/audio/start",
        json={"consent_audio": True},
        headers=host["auth"],
    )
    assert res.status_code == 200
    assert res.json()["status"] == "recording"


def test_03_녹음_시작_비로그인_401(client):
    host = _register(client, "rec03@test.com")
    sid = _create_session(client, host)
    res = client.post(f"/api/v1/sessions/{sid}/audio/start", json={"consent_audio": True})
    assert res.status_code == 401


def test_04_녹음_시작_타인_403(client):
    host = _register(client, "rec04a@test.com")
    other = _register(client, "rec04b@test.com")
    sid = _create_session(client, host)
    res = client.post(
        f"/api/v1/sessions/{sid}/audio/start",
        json={"consent_audio": True},
        headers=other["auth"],
    )
    assert res.status_code == 403


def test_05_청크_업로드_성공(client):
    host = _register(client, "rec05@test.com")
    sid = _create_session(client, host)
    client.post(f"/api/v1/sessions/{sid}/audio/start", json={"consent_audio": True}, headers=host["auth"])

    file_data = {"file": ("chunk0.webm", io.BytesIO(b"fake-audio-bytes" * 100), "audio/webm")}
    res = client.post(
        f"/api/v1/sessions/{sid}/audio/chunk",
        data={"chunk_index": "0"},
        files=file_data,
        headers=host["auth"],
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["chunk_index"] == 0
    assert body["received_bytes"] > 0
    assert body["total_chunks"] == 1


def test_06_녹음_종료_파이프라인_트리거(client):
    host = _register(client, "rec06@test.com")
    sid = _create_session(client, host)
    client.post(f"/api/v1/sessions/{sid}/audio/start", json={"consent_audio": True}, headers=host["auth"])
    file_data = {"file": ("c0.webm", io.BytesIO(b"x" * 50), "audio/webm")}
    client.post(
        f"/api/v1/sessions/{sid}/audio/chunk",
        data={"chunk_index": "0"},
        files=file_data,
        headers=host["auth"],
    )
    res = client.post(f"/api/v1/sessions/{sid}/audio/stop", headers=host["auth"])
    assert res.status_code == 200, res.text
    # 인라인 실행이라 status는 completed (summary_task가 마지막에 completed로 변경)
    assert res.json()["status"] in ("processing", "completed")


def test_07_기록지_조회_파이프라인후(client):
    host = _register(client, "rec07@test.com")
    sid = _create_session(client, host)
    client.post(f"/api/v1/sessions/{sid}/audio/start", json={"consent_audio": True}, headers=host["auth"])
    client.post(f"/api/v1/sessions/{sid}/audio/stop", headers=host["auth"])

    res = client.get(f"/api/v1/sessions/{sid}/record", headers=host["auth"])
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "completed"
    assert body["transcript"] is not None
    assert "headline" in body["ai_summary"]


def test_08_전사문_조회(client):
    host = _register(client, "rec08@test.com")
    sid = _create_session(client, host)
    client.post(f"/api/v1/sessions/{sid}/audio/start", json={"consent_audio": True}, headers=host["auth"])
    client.post(f"/api/v1/sessions/{sid}/audio/stop", headers=host["auth"])

    res = client.get(f"/api/v1/sessions/{sid}/transcript", headers=host["auth"])
    assert res.status_code == 200
    body = res.json()
    assert len(body["segments"]) >= 1
    assert body["raw_text"]


def test_09_기록지_편집_is_edited_true(client):
    host = _register(client, "rec09@test.com")
    sid = _create_session(client, host)
    client.post(f"/api/v1/sessions/{sid}/audio/start", json={"consent_audio": True}, headers=host["auth"])
    client.post(f"/api/v1/sessions/{sid}/audio/stop", headers=host["auth"])

    res = client.put(
        f"/api/v1/sessions/{sid}/record",
        json={"counselor_notes": "상담사 메모 추가"},
        headers=host["auth"],
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["is_edited"] is True
    assert body["counselor_notes"] == "상담사 메모 추가"
    assert len(body["edit_history"]) == 1


def test_10_기록지_미생성_상태_조회(client):
    host = _register(client, "rec10@test.com")
    sid = _create_session(client, host)
    res = client.get(f"/api/v1/sessions/{sid}/record", headers=host["auth"])
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "idle"
    assert body["transcript"] is None


def test_11_존재하지않는_세션_404(client):
    host = _register(client, "rec11@test.com")
    fake_id = "00000000-0000-0000-0000-000000000000"
    res = client.get(f"/api/v1/sessions/{fake_id}/record", headers=host["auth"])
    assert res.status_code == 404


def test_12_세션_end_시_자동_finalize(client):
    host = _register(client, "rec12@test.com")
    sid = _create_session(client, host)
    client.post(f"/api/v1/sessions/{sid}/audio/start", json={"consent_audio": True}, headers=host["auth"])
    # /end 호출 → audio_service.finalize_on_session_end 자동 트리거
    r = client.post(f"/api/v1/sessions/{sid}/end", headers=host["auth"])
    assert r.status_code == 200
    rec = client.get(f"/api/v1/sessions/{sid}/record", headers=host["auth"]).json()
    assert rec["status"] == "completed"
    assert rec["transcript"]
