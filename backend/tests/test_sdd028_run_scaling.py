"""SDD-028 P2 — 반복 실행(run_id) + 규모 확장(조회 최적화·인덱스) QA

검증 항목(verify.md):
1. run_id: 기본값 = session_id, 새 실행(명시적) → 새 run_id, pause/resume → 기존 run_id 유지,
   completed 세션 즉시 재시작 차단
2. 조회 최적화: EEGFeatureWindow batch key(window_index 범위) 조회가 전체 스캔과 동일 결과,
   최신값 LIMIT 1 조회, 복합 인덱스 존재
3. 회귀: 기존 라이브·롤업 동작 유지
"""

from sqlalchemy import inspect as sa_inspect

from app.services import email_verify_service, eeg_query
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
# 1. run_id (경량 SessionRun)
# ---------------------------------------------------------------------------


def test_01_run_id_기본값은_session_id(client):
    counselor = _register(client, "s028c01@test.com")
    cls = _create_group_class(client, counselor["h"])
    # 기본 run_id = session_id
    assert cls["run_id"] == cls["id"]

    # 조회(get) 응답에서도 동일하게 유지
    res = client.get(f"/api/v1/sessions/{cls['id']}", headers=counselor["h"])
    assert res.status_code == 200, res.text
    assert res.json()["run_id"] == cls["id"]


def test_02_새_실행은_새_run_id를_발급한다(client):
    counselor = _register(client, "s028c02@test.com")
    cls = _create_group_class(client, counselor["h"])
    _join_guest(client, cls["access_code"], "회차게스트")

    res = client.post(f"/api/v1/sessions/{cls['id']}/new-run", headers=counselor["h"])
    assert res.status_code == 200, res.text
    body = res.json()
    # 새 실행 → run_id 가 session_id 및 이전 run_id 와 달라진다
    assert body["run_id"] != cls["id"]
    assert body["id"] == cls["id"]  # 같은 세션(정의) 유지


def test_03_pause_resume는_run_id를_유지한다(client):
    counselor = _register(client, "s028c03@test.com")
    cls = _create_group_class(client, counselor["h"])
    _join_guest(client, cls["access_code"], "유지게스트")

    # 명시적 새 실행으로 run_id 를 한 번 바꿔 "이어하기가 유지하는" 대상을 명확히 한다
    run_id = client.post(
        f"/api/v1/sessions/{cls['id']}/new-run", headers=counselor["h"]
    ).json()["run_id"]
    assert run_id != cls["id"]

    started = client.post(f"/api/v1/sessions/{cls['id']}/start", headers=counselor["h"])
    assert started.status_code == 200, started.text
    assert started.json()["run_id"] == run_id

    paused = client.post(f"/api/v1/sessions/{cls['id']}/pause", headers=counselor["h"])
    assert paused.status_code == 200, paused.text
    assert paused.json()["run_id"] == run_id

    resumed = client.post(f"/api/v1/sessions/{cls['id']}/resume", headers=counselor["h"])
    assert resumed.status_code == 200, resumed.text
    # 이어하기(resume) → 기존 run_id 유지(새 회차 아님)
    assert resumed.json()["run_id"] == run_id


def test_04_completed_세션은_즉시_재시작할_수_없다(client):
    counselor = _register(client, "s028c04@test.com")
    cls = _create_group_class(client, counselor["h"])
    _join_guest(client, cls["access_code"], "종료게스트")

    client.post(f"/api/v1/sessions/{cls['id']}/start", headers=counselor["h"])
    ended = client.post(f"/api/v1/sessions/{cls['id']}/end", headers=counselor["h"])
    assert ended.status_code == 200, ended.text
    assert ended.json()["status"] == "completed"

    # completed 세션 즉시 재시작(새 실행) 차단
    res = client.post(f"/api/v1/sessions/{cls['id']}/new-run", headers=counselor["h"])
    assert res.status_code == 400, res.text


def test_05_new_run은_host만_가능하다(client):
    counselor = _register(client, "s028c05a@test.com")
    other = _register(client, "s028c05b@test.com")
    cls = _create_group_class(client, counselor["h"])

    res = client.post(f"/api/v1/sessions/{cls['id']}/new-run", headers=other["h"])
    assert res.status_code == 403, res.text


# ---------------------------------------------------------------------------
# 2. 조회 최적화 (batch key)
# ---------------------------------------------------------------------------


def test_06_batch_key_범위조회는_전체스캔과_동일하다(client):
    counselor = _register(client, "s028c06@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "batch게스트")

    feats = [_feature(i, relaxation_index=0.1 * i, signal_quality=0.9) for i in range(150)]
    r = client.post(
        f"/api/v1/sessions/{cls['id']}/features",
        json={"participant_id": pid, "features": feats},
    )
    assert r.json()["saved"] == 150

    db = _db()
    try:
        from uuid import UUID

        sid = UUID(cls["id"])
        ppid = UUID(pid)
        full = eeg_query.feature_windows_in_range(db, sid, participant_ids=[ppid])
        full_idx = [w.window_index for w in full]
        assert full_idx == list(range(150))  # 전체 정렬 스캔

        # 범위 조회들의 합집합 == 전체 스캔 (동일 결과)
        r1 = eeg_query.feature_windows_in_range(
            db, sid, participant_ids=[ppid], start_index=0, end_index=60
        )
        r2 = eeg_query.feature_windows_in_range(
            db, sid, participant_ids=[ppid], start_index=60, end_index=120
        )
        r3 = eeg_query.feature_windows_in_range(
            db, sid, participant_ids=[ppid], start_index=120
        )
        union_idx = [w.window_index for w in (r1 + r2 + r3)]
        assert union_idx == full_idx
        # 반열린 구간 경계 정확성
        assert [w.window_index for w in r1] == list(range(0, 60))
        assert [w.window_index for w in r2] == list(range(60, 120))
    finally:
        db.close()


def test_07_latest_feature_window는_최신1건만_반환한다(client):
    counselor = _register(client, "s028c07@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "latest게스트")

    feats = [_feature(i, relaxation_index=0.5) for i in range(10)]
    client.post(
        f"/api/v1/sessions/{cls['id']}/features",
        json={"participant_id": pid, "features": feats},
    )

    db = _db()
    try:
        from uuid import UUID

        latest = eeg_query.latest_feature_window(db, UUID(cls["id"]), UUID(pid))
        assert latest is not None
        # created_at 동률이면 window_index 최대(=9)가 최신
        assert latest.window_index == 9
    finally:
        db.close()


def test_08_rollup_batch_key_범위는_전체와_정합한다(client):
    counselor = _register(client, "s028c08@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "rollup게스트")

    feats = [_feature(i, relaxation_index=0.5, signal_quality=0.9) for i in range(180)]
    client.post(
        f"/api/v1/sessions/{cls['id']}/features",
        json={"participant_id": pid, "features": feats},
    )

    # 전체(회귀 확인): 3버킷
    full = client.get(
        f"/api/v1/sessions/{cls['id']}/eeg-rollup", headers=counselor["h"]
    ).json()
    assert full["bucket_count"] == 3

    # batch key: 버킷 [1, 2) 만 조회 → 60~119초 구간, 1버킷
    ranged = client.get(
        f"/api/v1/sessions/{cls['id']}/eeg-rollup",
        params={"start_bucket": 1, "end_bucket": 2},
        headers=counselor["h"],
    ).json()
    assert ranged["bucket_count"] == 1
    rb = ranged["buckets"][0]
    fb = full["buckets"][1]
    # 동일 버킷의 시간 범위·샘플 수가 전체 결과와 일치
    assert (rb["start_sec"], rb["end_sec"]) == (fb["start_sec"], fb["end_sec"]) == (60, 120)
    assert rb["sample_count"] == fb["sample_count"] == 60


# ---------------------------------------------------------------------------
# 3. 복합 인덱스 존재
# ---------------------------------------------------------------------------


def _index_column_sets(bind, table: str) -> list[tuple]:
    insp = sa_inspect(bind)
    return [tuple(ix["column_names"]) for ix in insp.get_indexes(table)]


def test_09_복합_인덱스가_존재한다(client):
    # create_all 로 만들어진 테스트 DB 스키마에서 인덱스를 검사한다.
    counselor = _register(client, "s028c09@test.com")
    _create_group_class(client, counselor["h"])

    db = _db()
    try:
        bind = db.get_bind()
        feat_ix = _index_column_sets(bind, "eeg_feature_windows")
        assert ("session_id", "participant_id", "window_index") in feat_ix

        raw_ix = _index_column_sets(bind, "eeg_raw_chunks")
        assert ("session_id", "participant_id", "chunk_index") in raw_ix

        sess_ix = _index_column_sets(bind, "sessions")
        assert ("run_id",) in sess_ix
    finally:
        db.close()
