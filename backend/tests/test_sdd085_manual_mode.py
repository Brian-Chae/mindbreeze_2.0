"""SDD-085 — 마이크 오프(수동 기록 모드) + AI 파이프라인 가드 QA

기획서 `docs/camera-mic-off-ai-analysis-기획.md` §9 QA 체크리스트 기반:
- consent_audio=false → status='manual' + 200 (400 아님)
- manual 세션: 청크 업로드 차단, STT/요약 미실행, 스텁 가짜 전사 미저장 (G5)
- manual → consent_audio=true 재시작 시 recording 전이 허용
- 청크 0개 recording 세션: 스텁 저장 금지 (failed 처리)
- 리포트 ai_record 계약: manual → not_available/mic_off, 정상 → available
"""

import io

from tests.test_audio_record import _register, _create_session, _upload_chunk


def test_01_동의없음_manual_선언_200(client):
    host = _register(client, "sdd085a@test.com")
    sid = _create_session(client, host)
    res = client.post(
        f"/api/v1/sessions/{sid}/audio/start",
        json={"consent_audio": False},
        headers=host["auth"],
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "manual"
    assert body["started_at"] is None

    # 기록 조회에도 manual 이 그대로 내려간다 (FE 분기 근거)
    rec = client.get(f"/api/v1/sessions/{sid}/record", headers=host["auth"]).json()
    assert rec["status"] == "manual"


def test_02_manual_상태_청크업로드_400(client):
    host = _register(client, "sdd085b@test.com")
    sid = _create_session(client, host)
    client.post(
        f"/api/v1/sessions/{sid}/audio/start",
        json={"consent_audio": False},
        headers=host["auth"],
    )
    file_data = {"file": ("c0.webm", io.BytesIO(b"x" * 50), "audio/webm")}
    res = client.post(
        f"/api/v1/sessions/{sid}/audio/chunk",
        data={"chunk_index": "0"},
        files=file_data,
        headers=host["auth"],
    )
    assert res.status_code == 400


def test_03_manual_세션_종료시_스텁_전사_미저장(client):
    # QA-6 (G5 회귀 방지): OPENAI_API_KEY 미설정 환경에서 마이크 오프 세션 종료 →
    # 가짜 전사·요약이 저장되지 않아야 한다
    host = _register(client, "sdd085c@test.com")
    sid = _create_session(client, host)
    client.post(
        f"/api/v1/sessions/{sid}/audio/start",
        json={"consent_audio": False},
        headers=host["auth"],
    )
    r = client.post(f"/api/v1/sessions/{sid}/end", headers=host["auth"])
    assert r.status_code == 200

    rec = client.get(f"/api/v1/sessions/{sid}/record", headers=host["auth"]).json()
    assert rec["status"] == "manual"
    assert rec["transcript"] is None
    assert "headline" not in rec["ai_summary"]


def test_04_manual_상태_stop은_noop(client):
    host = _register(client, "sdd085d@test.com")
    sid = _create_session(client, host)
    client.post(
        f"/api/v1/sessions/{sid}/audio/start",
        json={"consent_audio": False},
        headers=host["auth"],
    )
    res = client.post(f"/api/v1/sessions/{sid}/audio/stop", headers=host["auth"])
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "manual"
    assert res.json()["total_chunks"] == 0

    rec = client.get(f"/api/v1/sessions/{sid}/record", headers=host["auth"]).json()
    assert rec["transcript"] is None


def test_05_manual에서_동의재시작_recording_전이(client):
    host = _register(client, "sdd085e@test.com")
    sid = _create_session(client, host)
    client.post(
        f"/api/v1/sessions/{sid}/audio/start",
        json={"consent_audio": False},
        headers=host["auth"],
    )
    res = client.post(
        f"/api/v1/sessions/{sid}/audio/start",
        json={"consent_audio": True},
        headers=host["auth"],
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "recording"


def test_06_recording중_동의철회는_400(client):
    # recording/processing/completed 상태를 manual 로 강등하지 않는다
    host = _register(client, "sdd085f@test.com")
    sid = _create_session(client, host)
    client.post(
        f"/api/v1/sessions/{sid}/audio/start",
        json={"consent_audio": True},
        headers=host["auth"],
    )
    res = client.post(
        f"/api/v1/sessions/{sid}/audio/start",
        json={"consent_audio": False},
        headers=host["auth"],
    )
    assert res.status_code == 400


def test_07_청크0개_recording_세션_스텁_금지(client):
    # 녹음을 시작했지만 청크가 하나도 없으면 스텁 가짜 전사 대신 failed 처리
    host = _register(client, "sdd085g@test.com")
    sid = _create_session(client, host)
    client.post(
        f"/api/v1/sessions/{sid}/audio/start",
        json={"consent_audio": True},
        headers=host["auth"],
    )
    client.post(f"/api/v1/sessions/{sid}/audio/stop", headers=host["auth"])

    rec = client.get(f"/api/v1/sessions/{sid}/record", headers=host["auth"]).json()
    assert rec["status"] == "failed"
    assert rec["transcript"] is None
    assert "headline" not in rec["ai_summary"]


def test_08_리포트_ai_record_mic_off_계약(client):
    # QA-1/QA-5: manual 세션의 리포트 → ai_record.not_available + reason=mic_off
    host = _register(client, "sdd085h@test.com")
    sid = _create_session(client, host)
    client.post(
        f"/api/v1/sessions/{sid}/audio/start",
        json={"consent_audio": False},
        headers=host["auth"],
    )
    client.post(f"/api/v1/sessions/{sid}/end", headers=host["auth"])

    gen = client.post(
        f"/api/v1/reports/generate/{sid}",
        json={"type": "counselor"},
        headers=host["auth"],
    )
    assert gen.status_code == 200, gen.text
    content = gen.json()["content"]
    assert content["ai_record"] == {"status": "not_available", "reason": "mic_off"}


def test_09_리포트_ai_record_정상세션_available(client):
    # QA-4 (하위 호환): 마이크 ON 세션은 ai_record.status=available
    host = _register(client, "sdd085i@test.com")
    sid = _create_session(client, host)
    client.post(
        f"/api/v1/sessions/{sid}/audio/start",
        json={"consent_audio": True},
        headers=host["auth"],
    )
    _upload_chunk(client, sid, host)
    client.post(f"/api/v1/sessions/{sid}/end", headers=host["auth"])

    rec = client.get(f"/api/v1/sessions/{sid}/record", headers=host["auth"]).json()
    assert rec["status"] == "completed"
    assert rec["transcript"]

    gen = client.post(
        f"/api/v1/reports/generate/{sid}",
        json={"type": "counselor"},
        headers=host["auth"],
    )
    assert gen.status_code == 200, gen.text
    assert gen.json()["content"]["ai_record"] == {"status": "available"}


def test_10_수동노트_마커는_manual에서도_정상(client):
    # QA-5: 수동 기록 모드의 핵심 수단 — counselor_notes 작성 정상 동작
    host = _register(client, "sdd085j@test.com")
    sid = _create_session(client, host)
    client.post(
        f"/api/v1/sessions/{sid}/audio/start",
        json={"consent_audio": False},
        headers=host["auth"],
    )
    res = client.put(
        f"/api/v1/sessions/{sid}/record",
        json={"counselor_notes": "수동 기록 모드 상담사 노트"},
        headers=host["auth"],
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["counselor_notes"] == "수동 기록 모드 상담사 노트"
    assert body["status"] == "manual"
