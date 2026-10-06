"""SDD-084 세션 영상 녹화 QA — video start/chunk/stop + 세션 end 자동 종료"""

import io
from datetime import datetime, timedelta, timezone

VALID_PASSWORD = "Passw0rd!"


def _register(client, email: str, role: str = "counselor") -> dict:
    from app.services import email_verify_service
    from tests.conftest import create_test_org, post_register

    payload = {
        "org_code": create_test_org(),
        "email": email,
        "password": VALID_PASSWORD,
        "name": "테스트",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": {"tos": True, "privacy": True, "sensitive": True},
    }
    res = post_register(client, role, payload)
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
        json={"type": "clinical", "scheduled_at": _future(60), "duration_min": 50, "title": "영상테스트"},
        headers=host["auth"],
    )
    assert res.status_code == 201, res.text
    sid = res.json()["id"]
    if started:
        r = client.post(f"/api/v1/sessions/{sid}/start", headers=host["auth"])
        assert r.status_code == 200, r.text
    return sid


def _upload_chunk(client, sid: str, auth: dict, index: int = 0, payload: bytes = b"fake-video-bytes" * 100):
    file_data = {"file": (f"chunk{index}.webm", io.BytesIO(payload), "video/webm")}
    return client.post(
        f"/api/v1/sessions/{sid}/video/chunk",
        data={"chunk_index": str(index)},
        files=file_data,
        headers=auth,
    )


def test_01_영상녹화_시작_동의없음_400(client):
    host = _register(client, "vid01@test.com")
    sid = _create_session(client, host)
    res = client.post(
        f"/api/v1/sessions/{sid}/video/start",
        json={"consent_video": False},
        headers=host["auth"],
    )
    assert res.status_code == 400
    assert "동의" in res.json()["detail"]


def test_02_영상녹화_시작_성공(client):
    host = _register(client, "vid02@test.com")
    sid = _create_session(client, host)
    res = client.post(
        f"/api/v1/sessions/{sid}/video/start",
        json={"consent_video": True},
        headers=host["auth"],
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "recording"


def test_03_영상녹화_시작_비로그인_401(client):
    host = _register(client, "vid03@test.com")
    sid = _create_session(client, host)
    res = client.post(f"/api/v1/sessions/{sid}/video/start", json={"consent_video": True})
    assert res.status_code == 401


def test_04_영상녹화_시작_타인_403(client):
    host = _register(client, "vid04a@test.com")
    other = _register(client, "vid04b@test.com")
    sid = _create_session(client, host)
    res = client.post(
        f"/api/v1/sessions/{sid}/video/start",
        json={"consent_video": True},
        headers=other["auth"],
    )
    assert res.status_code == 403


def test_05_청크_업로드_성공(client):
    host = _register(client, "vid05@test.com")
    sid = _create_session(client, host)
    client.post(f"/api/v1/sessions/{sid}/video/start", json={"consent_video": True}, headers=host["auth"])

    res = _upload_chunk(client, sid, host["auth"], index=0)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["chunk_index"] == 0
    assert body["received_bytes"] > 0
    assert body["total_chunks"] == 1


def test_06_청크_업로드_녹화시작전_400(client):
    host = _register(client, "vid06@test.com")
    sid = _create_session(client, host)
    res = _upload_chunk(client, sid, host["auth"], index=0)
    assert res.status_code == 400
    assert "시작" in res.json()["detail"]


def test_07_청크_업로드_타인_403(client):
    host = _register(client, "vid07a@test.com")
    other = _register(client, "vid07b@test.com")
    sid = _create_session(client, host)
    client.post(f"/api/v1/sessions/{sid}/video/start", json={"consent_video": True}, headers=host["auth"])
    res = _upload_chunk(client, sid, other["auth"], index=0)
    assert res.status_code == 403


def test_08_영상녹화_종료_total_chunks(client):
    host = _register(client, "vid08@test.com")
    sid = _create_session(client, host)
    client.post(f"/api/v1/sessions/{sid}/video/start", json={"consent_video": True}, headers=host["auth"])
    _upload_chunk(client, sid, host["auth"], index=0)
    _upload_chunk(client, sid, host["auth"], index=1)

    res = client.post(f"/api/v1/sessions/{sid}/video/stop", headers=host["auth"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "completed"
    assert body["total_chunks"] == 2
    assert body["ended_at"] is not None


def test_09_영상녹화_종료_멱등(client):
    host = _register(client, "vid09@test.com")
    sid = _create_session(client, host)
    # 시작하지 않은 상태에서 stop — 오류 없이 idle 유지
    res = client.post(f"/api/v1/sessions/{sid}/video/stop", headers=host["auth"])
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "idle"


def test_10_종료후_청크_업로드_400(client):
    host = _register(client, "vid10@test.com")
    sid = _create_session(client, host)
    client.post(f"/api/v1/sessions/{sid}/video/start", json={"consent_video": True}, headers=host["auth"])
    client.post(f"/api/v1/sessions/{sid}/video/stop", headers=host["auth"])
    res = _upload_chunk(client, sid, host["auth"], index=1)
    assert res.status_code == 400


def test_11_세션_end_시_자동_종료(client):
    host = _register(client, "vid11@test.com")
    sid = _create_session(client, host)
    client.post(f"/api/v1/sessions/{sid}/video/start", json={"consent_video": True}, headers=host["auth"])
    r = client.post(f"/api/v1/sessions/{sid}/end", headers=host["auth"])
    assert r.status_code == 200, r.text
    # /end 로 video finalize 완료 → 이후 청크 업로드는 거부
    res = _upload_chunk(client, sid, host["auth"], index=1)
    assert res.status_code == 400


def test_12_오디오_상태와_분리(client):
    """영상 녹화 시작이 오디오 record.status 에 영향을 주지 않는다."""
    host = _register(client, "vid12@test.com")
    sid = _create_session(client, host)
    client.post(f"/api/v1/sessions/{sid}/video/start", json={"consent_video": True}, headers=host["auth"])
    res = client.get(f"/api/v1/sessions/{sid}/record", headers=host["auth"])
    assert res.status_code == 200
    assert res.json()["status"] == "idle"


def test_13_영상_presigned_url은_video_webm으로_발급(client, monkeypatch):
    """영상 리플레이 presigned GET은 video/webm(attachment 아님)으로 발급돼야 한다.

    generate_presigned_get 을 zip export(application/zip + attachment) 기본값으로
    재사용하면 <video> 태그가 재생하지 못하고 다운로드를 시도한다 — 회귀 방지.
    """
    from uuid import UUID

    from app.core.database import get_db
    from app.main import app as fastapi_app
    from app.models.record import SessionRecord
    from app.services import storage_service, video_service

    host = _register(client, "vid13@test.com")
    sid = _create_session(client, host)
    sid_uuid = UUID(sid)

    db = next(fastapi_app.dependency_overrides[get_db]())
    try:
        record = db.query(SessionRecord).filter(SessionRecord.session_id == sid_uuid).first()
        if record is None:
            record = SessionRecord(session_id=sid_uuid, status="idle", markers=[], edit_history=[], ai_summary={})
            db.add(record)
            db.flush()
        record.video_s3_key = f"video/{sid}/merged.webm"
        db.commit()

        captured = {}

        def fake_presigned_get(
            key,
            *,
            expires_in=300,
            expires_at=None,
            content_type="application/zip",
            content_disposition='attachment; filename="mindbreeze-data.zip"',
        ):
            captured["content_type"] = content_type
            captured["content_disposition"] = content_disposition
            return "https://s3.example/video-url"

        monkeypatch.setattr(storage_service, "generate_presigned_get", fake_presigned_get)
        url = video_service.get_presigned_video_url(sid_uuid, db)

        assert url == "https://s3.example/video-url"
        assert captured["content_type"] == "video/webm"
        assert captured["content_disposition"] is None
    finally:
        db.close()


def test_14_영상_url_형식오류_sessionid_400(client):
    """VIDEO-UUID-500: 형식 오류 session_id 는 500 대신 400 을 반환한다."""
    host = _register(client, "vid14@test.com")
    for path in ("url", "stream"):
        res = client.get(f"/api/v1/sessions/not-a-uuid/video/{path}", headers=host["auth"])
        assert res.status_code == 400, (path, res.text)
