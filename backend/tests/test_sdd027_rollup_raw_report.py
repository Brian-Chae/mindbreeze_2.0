"""SDD-027 P1 — 60초 롤업 · raw S3 manifest · 리포트 상태머신 QA

검증 항목(verify.md):
1. 60초 롤업: valid_count/coverage/시간 범위, null 0치환 없음, 유효 샘플 가중 평균
2. raw chunk manifest + presigned PUT/ack, 게스트 raw(participant_id, nullable user_id), 소유 검증
3. 리포트 상태머신 4단계(pending_analysis→pending_review→completed/error), data_credibility 파생
"""

from app.services import email_verify_service
from tests.conftest import create_test_org

VALID_PASSWORD = "Passw0rd!"


def _register(client, email: str, role: str = "counselor", org_code: str | None = None) -> dict:
    payload = {
        "email": email,
        "password": VALID_PASSWORD,
        "name": f"{role}-{email.split('@')[0]}",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": {"tos": True, "privacy": True, "sensitive": True},
    }
    if role == "counselor":
        payload["org_code"] = org_code if org_code is not None else create_test_org()
    res = client.post(f"/api/v1/auth/register/{role}", json=payload)
    assert res.status_code == 201, res.text
    body = res.json()
    return {"id": body["user"]["id"], "h": {"Authorization": f"Bearer {body['access_token']}"}}


def _create_group_class(client, headers: dict, **overrides) -> dict:
    payload = {
        "type": "meditation",
        "duration_min": 30,
        "title": "그룹 명상 클래스",
        "participant_mode": "group",
        "max_participants": 10,
    }
    payload.update(overrides)
    res = client.post("/api/v1/sessions", json=payload, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


def _join_guest(client, code: str, name: str) -> str:
    res = client.post(f"/api/v1/sessions/by-code/{code}/join", json={"name": name})
    assert res.status_code == 200, res.text
    return res.json()["participant_id"]


def _feature(second_offset: int, **over) -> dict:
    base = {"second_offset": second_offset}
    base.update(over)
    return base


def _db():
    """테스트 인메모리 DB 세션(읽기 검증용)."""
    from app.core.database import get_db
    from app.main import app as fastapi_app

    return next(fastapi_app.dependency_overrides[get_db]())


# ---------------------------------------------------------------------------
# 1. 60초 롤업
# ---------------------------------------------------------------------------


def test_01_롤업_버킷_valid_count_coverage_시간범위(client):
    counselor = _register(client, "s027c01@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "롤업게스트")

    # 버킷0: 0~59초(60개) valid, 버킷1: 60~69초(10개) valid
    feats = [_feature(i, relaxation_index=0.5, signal_quality=0.9) for i in range(70)]
    r = client.post(f"/api/v1/sessions/{cls['id']}/features", json={"participant_id": pid, "features": feats})
    assert r.json()["saved"] == 70

    res = client.get(f"/api/v1/sessions/{cls['id']}/eeg-rollup", headers=counselor["h"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["resolution_sec"] == 60
    assert body["bucket_count"] == 2
    b0, b1 = body["buckets"]
    # 시간 범위
    assert (b0["start_sec"], b0["end_sec"]) == (0, 60)
    assert (b1["start_sec"], b1["end_sec"]) == (60, 120)
    # valid_count / coverage
    assert b0["sample_count"] == 60 and b0["valid_count"] == 60
    assert abs(b0["coverage"] - 1.0) < 1e-6
    assert b1["sample_count"] == 10 and b1["valid_count"] == 10
    assert abs(b1["coverage"] - round(10 / 60, 4)) < 1e-6


def test_02_롤업_유효샘플_가중평균(client):
    """전체 평균은 버킷 단순 평균(0.5)이 아니라 유효 샘플 가중(=0.1429)이어야 한다."""
    counselor = _register(client, "s027c02@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "가중게스트")

    feats = (
        [_feature(i, relaxation_index=0.0, signal_quality=0.9) for i in range(60)]  # 버킷0: 60개 0.0
        + [_feature(60 + i, relaxation_index=1.0, signal_quality=0.9) for i in range(10)]  # 버킷1: 10개 1.0
    )
    client.post(f"/api/v1/sessions/{cls['id']}/features", json={"participant_id": pid, "features": feats})

    body = client.get(f"/api/v1/sessions/{cls['id']}/eeg-rollup", headers=counselor["h"]).json()
    overall = body["overall"]["metrics"]["relaxation_index"]
    # 유효 샘플 가중 전역 평균 = (60*0 + 10*1)/70 = 0.142857 → 0.1429
    assert abs(overall - round(70 ** -1 * 10, 4)) < 1e-6
    # 버킷 단순 평균(0.5)이 아님을 명시적으로 확인
    assert abs(overall - 0.5) > 0.3
    # 버킷별 평균은 각각 0.0 / 1.0
    assert abs(body["buckets"][0]["metrics"]["relaxation_index"] - 0.0) < 1e-6
    assert abs(body["buckets"][1]["metrics"]["relaxation_index"] - 1.0) < 1e-6


def test_03_롤업_null_0치환_없음(client):
    counselor = _register(client, "s027c03@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "널롤업게스트")

    # relaxation: 0.4, 0.6, null → 평균은 (0.4+0.6)/2 = 0.5 (null 을 0 으로 치환하면 0.333)
    feats = [
        _feature(0, relaxation_index=0.4, focus_index=None, signal_quality=0.9),
        _feature(1, relaxation_index=0.6, focus_index=None, signal_quality=0.9),
        _feature(2, relaxation_index=None, focus_index=None, signal_quality=0.9),
    ]
    client.post(f"/api/v1/sessions/{cls['id']}/features", json={"participant_id": pid, "features": feats})

    body = client.get(f"/api/v1/sessions/{cls['id']}/eeg-rollup", headers=counselor["h"]).json()
    metrics = body["buckets"][0]["metrics"]
    assert abs(metrics["relaxation_index"] - 0.5) < 1e-6  # null 제외 평균
    # 전 구간 null 인 지표는 0 이 아니라 null 로 보존
    assert metrics["focus_index"] is None
    assert body["overall"]["metrics"]["focus_index"] is None


def test_04_롤업_참가자_필터(client):
    counselor = _register(client, "s027c04@test.com")
    cls = _create_group_class(client, counselor["h"])
    p1 = _join_guest(client, cls["access_code"], "게스트1")
    p2 = _join_guest(client, cls["access_code"], "게스트2")

    client.post(f"/api/v1/sessions/{cls['id']}/features",
                json={"participant_id": p1, "features": [_feature(0, relaxation_index=0.2, signal_quality=0.9)]})
    client.post(f"/api/v1/sessions/{cls['id']}/features",
                json={"participant_id": p2, "features": [_feature(0, relaxation_index=0.8, signal_quality=0.9)]})

    b1 = client.get(f"/api/v1/sessions/{cls['id']}/eeg-rollup?participant_id={p1}", headers=counselor["h"]).json()
    assert abs(b1["buckets"][0]["metrics"]["relaxation_index"] - 0.2) < 1e-6
    assert b1["window_count"] == 1


def test_05_롤업_비host_403(client):
    counselor = _register(client, "s027c05@test.com")
    other = _register(client, "s027o05@test.com", role="client")
    cls = _create_group_class(client, counselor["h"])
    res = client.get(f"/api/v1/sessions/{cls['id']}/eeg-rollup", headers=other["h"])
    assert res.status_code == 403, res.text


# ---------------------------------------------------------------------------
# 2. raw chunk manifest + presigned / ack
# ---------------------------------------------------------------------------


def _presign(client, sid, participant_id, indices, **extra):
    chunks = [{"stream_id": "s0", "chunk_index": i, "sample_rate": 250, "channel_count": 2} for i in indices]
    payload = {"participant_id": participant_id, "chunks": chunks}
    payload.update(extra)
    return client.post(f"/api/v1/sessions/{sid}/eeg-raw/presign", json=payload)


def test_06_게스트_presign_manifest_생성(client):
    counselor = _register(client, "s027c06@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "raw게스트")

    res = _presign(client, cls["id"], pid, range(3))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["participant_id"] == pid
    assert len(body["chunks"]) == 3
    for ch in body["chunks"]:
        assert ch["object_key"].startswith(f"eeg-raw/{cls['id']}/{pid}/")
        assert ch["upload_url"].startswith("https://")
        assert ch["upload_status"] == "pending"


def test_07_presign_멱등_동일_object_key(client):
    counselor = _register(client, "s027c07@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "멱등게스트")

    r1 = _presign(client, cls["id"], pid, [0, 1]).json()
    r2 = _presign(client, cls["id"], pid, [0, 1]).json()
    keys1 = {c["chunk_index"]: c["object_key"] for c in r1["chunks"]}
    keys2 = {c["chunk_index"]: c["object_key"] for c in r2["chunks"]}
    assert keys1 == keys2  # 재발급은 동일 키 재사용

    from app.models.record import EEGRawChunk
    db = _db()
    try:
        count = db.query(EEGRawChunk).filter(EEGRawChunk.session_id == cls["id"]).count()
        assert count == 2  # 중복 생성되지 않음
    finally:
        db.close()


def test_08_ack_업로드확인_file_count_갱신(client):
    counselor = _register(client, "s027c08@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "ack게스트")

    presigned = _presign(client, cls["id"], pid, range(3)).json()["chunks"]
    ack_chunks = [{"chunk_id": c["chunk_id"], "checksum": "abc", "size_bytes": 1024} for c in presigned]
    res = client.post(f"/api/v1/sessions/{cls['id']}/eeg-raw/ack",
                      json={"participant_id": pid, "chunks": ack_chunks})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["acked"] == 3
    assert body["file_count"] == 3
    assert body["eeg_record_id"] is not None

    # 재-ack 은 멱등(추가 acked 0), file_count 유지
    res2 = client.post(f"/api/v1/sessions/{cls['id']}/eeg-raw/ack",
                       json={"participant_id": pid, "chunks": ack_chunks})
    assert res2.json()["acked"] == 0
    assert res2.json()["file_count"] == 3

    from app.models.record import EEGRawChunk
    db = _db()
    try:
        uploaded = db.query(EEGRawChunk).filter(
            EEGRawChunk.session_id == cls["id"], EEGRawChunk.upload_status == "uploaded"
        ).count()
        assert uploaded == 3
    finally:
        db.close()


def test_09_게스트_raw_nullable_user_id(client):
    """게스트 raw 는 participant_id 로 소유되고 EEGRecord.user_id 는 None 이다."""
    counselor = _register(client, "s027c09@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "게스트raw소유")

    presigned = _presign(client, cls["id"], pid, [0]).json()["chunks"]
    client.post(f"/api/v1/sessions/{cls['id']}/eeg-raw/ack",
                json={"participant_id": pid, "chunks": [{"chunk_id": presigned[0]["chunk_id"]}]})

    from app.models.record import EEGRecord, EEGRawChunk
    db = _db()
    try:
        rec = db.query(EEGRecord).filter(EEGRecord.session_id == cls["id"]).first()
        assert rec is not None
        assert rec.user_id is None  # 게스트 — nullable user_id
        assert str(rec.participant_id) == pid
        chunk = db.query(EEGRawChunk).filter(EEGRawChunk.session_id == cls["id"]).first()
        assert chunk.user_id is None
    finally:
        db.close()


def test_10_로그인참가자_raw_JWT소유(client):
    counselor = _register(client, "s027c10@test.com")
    cls = _create_group_class(client, counselor["h"])
    member = _register(client, "s027m10@test.com", role="client")
    client.post(f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={}, headers=member["h"])

    # participant_id 없이 인증 토큰만으로 presign
    chunks = [{"stream_id": "s0", "chunk_index": 0}]
    res = client.post(f"/api/v1/sessions/{cls['id']}/eeg-raw/presign",
                      json={"chunks": chunks}, headers=member["h"])
    assert res.status_code == 200, res.text
    cid = res.json()["chunks"][0]["chunk_id"]
    ack = client.post(f"/api/v1/sessions/{cls['id']}/eeg-raw/ack",
                      json={"chunks": [{"chunk_id": cid}]}, headers=member["h"])
    assert ack.status_code == 200
    assert ack.json()["file_count"] == 1


def test_11_비참가자_presign_403(client):
    counselor = _register(client, "s027c11@test.com")
    other = _register(client, "s027o11@test.com", role="client")
    cls = _create_group_class(client, counselor["h"])
    res = client.post(f"/api/v1/sessions/{cls['id']}/eeg-raw/presign",
                      json={"chunks": [{"chunk_index": 0}]}, headers=other["h"])
    assert res.status_code == 403, res.text


def test_12_타인_chunk_ack_차단(client):
    """다른 게스트의 chunk_id 를 ack 하면 소유 위반으로 차단(404)."""
    counselor = _register(client, "s027c12@test.com")
    cls = _create_group_class(client, counselor["h"])
    p1 = _join_guest(client, cls["access_code"], "소유자")
    p2 = _join_guest(client, cls["access_code"], "침입자")

    presigned = _presign(client, cls["id"], p1, [0]).json()["chunks"]
    # p2 가 p1 의 chunk 를 ack 시도
    res = client.post(f"/api/v1/sessions/{cls['id']}/eeg-raw/ack",
                      json={"participant_id": p2, "chunks": [{"chunk_id": presigned[0]["chunk_id"]}]})
    assert res.status_code == 404, res.text


# ---------------------------------------------------------------------------
# 3. 리포트 상태머신
# ---------------------------------------------------------------------------


def _create_started_clinical(client, host) -> str:
    from datetime import datetime, timedelta, timezone

    scheduled = (datetime.now(timezone.utc) + timedelta(minutes=60)).isoformat()
    res = client.post("/api/v1/sessions",
                      json={"type": "clinical", "scheduled_at": scheduled, "duration_min": 50, "title": "상태머신"},
                      headers=host["h"])
    sid = res.json()["id"]
    client.post(f"/api/v1/sessions/{sid}/start", headers=host["h"])
    return sid


def test_13_generate_후_pending_review(client):
    host = _register(client, "s027c13@test.com")
    sid = _create_started_clinical(client, host)
    res = client.post(f"/api/v1/reports/generate/{sid}", json={"type": "counselor"}, headers=host["h"])
    assert res.status_code == 200, res.text
    body = res.json()
    # EEG 미측정이어도 분석 자체는 성공 → 승인 대기(pending_review)
    assert body["status"] == "pending_review"
    # EEG not_measured → 신뢰도 개념 없음(None, 0/low 치환 금지)
    assert body["data_credibility"] is None


def test_14_승인_게이트_completed(client):
    host = _register(client, "s027c14@test.com")
    sid = _create_started_clinical(client, host)
    gen = client.post(f"/api/v1/reports/generate/{sid}", json={"type": "counselor"}, headers=host["h"]).json()
    rid = gen["id"]
    res = client.post(f"/api/v1/reports/{rid}/approve", json={}, headers=host["h"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "completed"
    assert body["sent_at"] is not None
    assert body["content"]["approved"] is True


def test_15_pending_analysis_는_승인불가(client):
    host = _register(client, "s027c15@test.com")
    sid = _create_started_clinical(client, host)
    gen = client.post(f"/api/v1/reports/generate/{sid}", json={"type": "counselor"}, headers=host["h"]).json()
    rid = gen["id"]

    # 상태를 강제로 pending_analysis 로 되돌려(분석 미완 상황 재현) 승인 차단을 검증
    from app.models.record import Report
    import uuid as _uuid
    db = _db()
    try:
        rep = db.query(Report).filter(Report.id == _uuid.UUID(rid)).first()
        rep.status = "pending_analysis"
        db.commit()
    finally:
        db.close()

    res = client.post(f"/api/v1/reports/{rid}/approve", json={}, headers=host["h"])
    assert res.status_code == 400, res.text


def test_16_data_credibility_high_유효EEG(client):
    """유효(valid) EEG 윈도우가 충분하면 data_credibility=high 로 파생된다."""
    host = _register(client, "s027c16@test.com")
    cls = _create_group_class(client, host["h"])
    pid = _join_guest(client, cls["access_code"], "신뢰도게스트")

    # §A4.4 게이트: usable >= 40, reliability >= 0.70 → status valid
    feats = [_feature(i, focus_index=0.6, cognitive_load=0.4, relaxation_index=0.5,
                      stress_index=0.3, emotional_stability=0.55, total_neural_activity=0.5,
                      hemispheric_balance=0.1, signal_quality=0.95) for i in range(45)]
    client.post(f"/api/v1/sessions/{cls['id']}/features", json={"participant_id": pid, "features": feats})

    res = client.post(f"/api/v1/reports/generate/{cls['id']}", json={"type": "counselor"}, headers=host["h"])
    body = res.json()
    assert body["status"] == "pending_review"
    assert body["content"]["eeg"]["status"] == "valid"
    assert body["data_credibility"] == "high"


def test_17_게스트_client_report_nullable_user_id(client):
    """게스트만 참여한 세션의 내담자 리포트는 user_id 없이 participant_id 로 소유된다."""
    host = _register(client, "s027c17@test.com")
    cls = _create_group_class(client, host["h"])
    pid = _join_guest(client, cls["access_code"], "게스트내담자")

    res = client.post(f"/api/v1/reports/generate/{cls['id']}", json={"type": "client"}, headers=host["h"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["user_id"] is None
    assert body["participant_id"] == pid
    assert body["status"] == "pending_review"
