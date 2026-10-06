"""통합 검증(1축: 파이프라인 dry-run)에서 발견된 결함 2건 회귀 테스트.

- INT-VERIFY-01: 녹음 미시작(idle) 세션 종료 시 manual 마감 (idle 영구 정지 방지)
- INT-VERIFY-02: Gemini 전사 maxOutputTokens 상한 확보 (긴 한글 전사 잘림 방지)
"""

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


def _create_session(client, host) -> str:
    res = client.post(
        "/api/v1/sessions",
        json={"type": "clinical", "scheduled_at": _future(60), "duration_min": 50, "title": "검증"},
        headers=host["auth"],
    )
    assert res.status_code == 201, res.text
    sid = res.json()["id"]
    r = client.post(f"/api/v1/sessions/{sid}/start", headers=host["auth"])
    assert r.status_code == 200, r.text
    return sid


def test_01_녹음미시작_세션_종료_manual_마감(client, celery_eager):
    """INT-VERIFY-01: idle 세션이 종료되면 manual 로 마감되어 '처리 중'으로 영구 정지하지 않는다."""
    host = _register(client, "intv01@test.com")
    sid = _create_session(client, host)  # start 만 하고 audio/start(녹음)는 안 함 → record.idle

    # 종료 전 record.status 는 idle
    rec = client.get(f"/api/v1/sessions/{sid}/record", headers=host["auth"]).json()
    assert rec["status"] == "idle"

    # /end → finalize_on_session_end 가 idle → manual 마감
    r = client.post(f"/api/v1/sessions/{sid}/end", headers=host["auth"])
    assert r.status_code == 200, r.text

    rec = client.get(f"/api/v1/sessions/{sid}/record", headers=host["auth"]).json()
    assert rec["status"] == "manual"


def test_02_녹음_정상_경로는_completed_유지(client, monkeypatch, celery_eager):
    """회귀 방지: 녹음이 있는 정상 세션은 여전히 completed 로 마감된다."""
    from app.tasks import stt_task, summary_task

    segs = [{"speaker": "counselor", "text": "안녕하세요", "start": 0.0, "end": 2.0}]

    def fake_transcribe(chunk_paths, session_type, audio_duration_sec=None):
        return {"segments": segs, "raw_text": "[counselor] 안녕하세요"}

    def fake_summary(session_type, transcript):
        return {"headline": "요약", "sections": {"요약": "내용"}, "keywords": [], "risk_flags": [], "transcript_present": True}

    monkeypatch.setattr(stt_task, "_call_gemini_transcribe", fake_transcribe)
    monkeypatch.setattr(summary_task, "_call_gemini_summary", fake_summary)

    host = _register(client, "intv02@test.com")
    sid = _create_session(client, host)
    client.post(f"/api/v1/sessions/{sid}/audio/start", json={"consent_audio": True}, headers=host["auth"])
    file_data = {"file": ("c0.webm", io.BytesIO(b"fake-audio" * 50), "audio/webm")}
    client.post(f"/api/v1/sessions/{sid}/audio/chunk", data={"chunk_index": "0"}, files=file_data, headers=host["auth"])
    client.post(f"/api/v1/sessions/{sid}/audio/stop", headers=host["auth"])
    client.post(f"/api/v1/sessions/{sid}/end", headers=host["auth"])

    rec = client.get(f"/api/v1/sessions/{sid}/record", headers=host["auth"]).json()
    assert rec["status"] == "completed"


def test_03_gemini_전사_maxOutputTokens_설정(client, monkeypatch, tmp_path):
    """INT-VERIFY-02: _transcribe_batch 가 maxOutputTokens 를 명시해 긴 한글 전사가 잘리지 않게 한다."""
    from app.tasks import stt_task

    p = tmp_path / "c0.webm"
    p.write_bytes(b"fake-audio-bytes")

    captured = {}

    def fake_post(url, headers, body, timeout):
        captured["body"] = body
        return {"candidates": [{"content": {"parts": [{"text": '[{"speaker":"speaker_0","text":"안녕","start":0.0,"end":1.0}]'}]}}]}

    monkeypatch.setattr(stt_task, "_gemini_post_with_retry", fake_post)

    segs, raw, missing = stt_task._transcribe_batch([str(p)], "clinical")

    gc = captured["body"]["generationConfig"]
    assert gc.get("responseMimeType") == "application/json"
    assert gc.get("maxOutputTokens") == 32768
    assert len(segs) == 1
    assert raw == "[speaker_0] 안녕"
