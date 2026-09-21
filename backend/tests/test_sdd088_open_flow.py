"""SDD-088 — 클래스 오픈(open) 상태 머신 + 조인 게이트 + 리포트 EEG 구간 필터.

- open: ready/scheduled → open, opened_at 최초 1회 기록
- start: open → in_progress (+과도기: ready/scheduled 직행 유지)
- cancel: open → cancelled (오픈된 방 닫기)
- end: open 에서 불가 (진행중/일시정지에서만)
- join_session_by_code: ready/scheduled 거부("아직 오픈 전"), open 부터 허용
- 리포트 EEG 집계: started_at ~ ended_at 구간 밖(대기 중) 윈도우 제외
"""

from datetime import datetime, timedelta, timezone

from tests.test_sdd015_class_code import _create_class, _db, _register


def _open(client, cls, headers):
    return client.post(f"/api/v1/sessions/{cls['id']}/open", headers=headers)


# ---------------------------------------------------------------------------
# 상태 머신
# ---------------------------------------------------------------------------


def test_01_ready에서_open_전이_및_opened_at_기록(client):
    counselor = _register(client, "s088c01@test.com")
    cls = _create_class(client, counselor["h"])
    assert cls["status"] == "ready"

    res = _open(client, cls, counselor["h"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "open"
    assert body["opened_at"] is not None
    assert body["started_at"] is None


def test_02_open에서_start_전이(client):
    counselor = _register(client, "s088c02@test.com")
    cls = _create_class(client, counselor["h"])
    _open(client, cls, counselor["h"])

    res = client.post(f"/api/v1/sessions/{cls['id']}/start", headers=counselor["h"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "in_progress"
    assert body["started_at"] is not None
    assert body["opened_at"] is not None


def test_03_과도기_ready에서_start_직행_유지(client):
    counselor = _register(client, "s088c03@test.com")
    cls = _create_class(client, counselor["h"])
    res = client.post(f"/api/v1/sessions/{cls['id']}/start", headers=counselor["h"])
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "in_progress"


def test_04_open에서_cancel_클래스닫기(client):
    counselor = _register(client, "s088c04@test.com")
    cls = _create_class(client, counselor["h"])
    _open(client, cls, counselor["h"])

    res = client.post(f"/api/v1/sessions/{cls['id']}/cancel", headers=counselor["h"])
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "cancelled"


def test_05_open에서_end_불가(client):
    counselor = _register(client, "s088c05@test.com")
    cls = _create_class(client, counselor["h"])
    _open(client, cls, counselor["h"])

    res = client.post(f"/api/v1/sessions/{cls['id']}/end", headers=counselor["h"])
    assert res.status_code == 400


def test_06_in_progress에서_open_불가(client):
    counselor = _register(client, "s088c06@test.com")
    cls = _create_class(client, counselor["h"])
    client.post(f"/api/v1/sessions/{cls['id']}/start", headers=counselor["h"])

    res = _open(client, cls, counselor["h"])
    assert res.status_code == 400


def test_07_open_중복_전이_불가_opened_at_보존(client):
    counselor = _register(client, "s088c07@test.com")
    cls = _create_class(client, counselor["h"])
    first = _open(client, cls, counselor["h"])
    opened_at = first.json()["opened_at"]

    res = _open(client, cls, counselor["h"])
    assert res.status_code == 400

    detail = client.get(f"/api/v1/sessions/{cls['id']}", headers=counselor["h"])
    assert detail.json()["opened_at"] == opened_at


def test_08_host_아니면_open_불가_403(client):
    counselor = _register(client, "s088c08@test.com")
    other = _register(client, "s088c08b@test.com")
    cls = _create_class(client, counselor["h"])

    res = _open(client, cls, other["h"])
    assert res.status_code == 403


def test_09_1대1_즉석세션_오픈_시작_연타_허용(client):
    """Brian 결정 3: 1:1도 오픈 단계를 거치되 오픈→시작 연타(강제 대기 없음) 허용."""
    counselor = _register(client, "s088c09@test.com")
    cls = _create_class(client, counselor["h"], type="clinical", participant_mode="one_on_one")

    opened = _open(client, cls, counselor["h"])
    assert opened.status_code == 200
    started = client.post(f"/api/v1/sessions/{cls['id']}/start", headers=counselor["h"])
    assert started.status_code == 200, started.text
    assert started.json()["status"] == "in_progress"


def test_10_state_version_open_전이마다_증가(client):
    counselor = _register(client, "s088c10@test.com")
    cls = _create_class(client, counselor["h"])
    res = _open(client, cls, counselor["h"])
    # 생성 직후 0 → open 전이로 +1
    detail = client.get(f"/api/v1/sessions/by-code/{cls['access_code']}/state")
    assert detail.status_code == 200
    assert detail.json()["version"] >= 1
    assert detail.json()["status"] == "open"
    assert res.status_code == 200


# ---------------------------------------------------------------------------
# 조인 게이트
# ---------------------------------------------------------------------------


def test_11_ready_클래스는_아직_오픈전_참여거부(client):
    counselor = _register(client, "s088c11@test.com")
    cls = _create_class(client, counselor["h"])

    res = client.post(
        f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={"name": "성급한게스트"}
    )
    assert res.status_code == 400
    assert "오픈 전" in res.json()["detail"]


def test_12_open_클래스는_게스트_참여허용(client):
    counselor = _register(client, "s088c12@test.com")
    cls = _create_class(client, counselor["h"], max_participants=10)
    _open(client, cls, counselor["h"])

    res = client.post(
        f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={"name": "대기실게스트"}
    )
    assert res.status_code == 200, res.text
    assert res.json()["participant_id"]


def test_13_in_progress_참여는_기존대로_허용(client):
    counselor = _register(client, "s088c13@test.com")
    cls = _create_class(client, counselor["h"], max_participants=10)
    _open(client, cls, counselor["h"])
    client.post(f"/api/v1/sessions/{cls['id']}/start", headers=counselor["h"])

    res = client.post(
        f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={"name": "지각게스트"}
    )
    assert res.status_code == 200, res.text


def test_14_로그인_회원도_오픈전_참여거부(client):
    counselor = _register(client, "s088c14@test.com")
    member = _register(client, "s088m14@test.com", role="client")
    cls = _create_class(client, counselor["h"], max_participants=10)

    res = client.post(
        f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={}, headers=member["h"]
    )
    assert res.status_code == 400
    assert "오픈 전" in res.json()["detail"]


def test_15_host는_오픈전에도_참여처리_noop_허용(client):
    counselor = _register(client, "s088c15@test.com")
    cls = _create_class(client, counselor["h"])

    res = client.post(
        f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={}, headers=counselor["h"]
    )
    assert res.status_code == 200, res.text
    assert res.json()["participant_id"] is None


# ---------------------------------------------------------------------------
# 리포트 EEG 구간 필터 (대기 중 EEG 제외)
# ---------------------------------------------------------------------------


def test_16_리포트_EEG는_started_ended_구간만_집계(client):
    from uuid import UUID

    from app.models.eeg_feature import EEGFeatureWindow
    from app.models.session import Session as SessionModel

    counselor = _register(client, "s088c16@test.com")
    cls = _create_class(client, counselor["h"], max_participants=10)
    _open(client, cls, counselor["h"])
    joined = client.post(
        f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={"name": "구간게스트"}
    )
    pid = UUID(joined.json()["participant_id"])
    client.post(f"/api/v1/sessions/{cls['id']}/start", headers=counselor["h"])
    client.post(f"/api/v1/sessions/{cls['id']}/end", headers=counselor["h"])

    db = _db()
    try:
        s = db.get(SessionModel, UUID(cls["id"]))
        started_at = s.started_at
        ended_at = s.ended_at
        # 대기 중(시작 전) 윈도우 3건 + 진행 중 윈도우 5건을 created_at 으로 구분해 삽입
        before = started_at - timedelta(seconds=30)
        during = started_at + (ended_at - started_at) / 2
        for i in range(3):
            db.add(EEGFeatureWindow(
                session_id=s.id, participant_id=pid, window_index=i,
                quality="valid", relaxation_index=0.9, created_at=before,
            ))
        for i in range(5):
            db.add(EEGFeatureWindow(
                session_id=s.id, participant_id=pid, window_index=100 + i,
                quality="valid", relaxation_index=0.5, created_at=during,
            ))
        db.commit()
    finally:
        db.close()

    from app.tasks.report_task import _build_eeg_content

    db = _db()
    try:
        s = db.get(SessionModel, UUID(cls["id"]))
        block = _build_eeg_content(
            s.id, db, pid, started_at=s.started_at, ended_at=s.ended_at
        )
        # 진행 중 5건만 집계 — 타임라인 t 는 진행 중 window_index(100~104)만 포함
        ts = [p["t"] for p in block["timeline"]]
        assert ts == [100, 101, 102, 103, 104]
        # 경계 미전달(레거시) 시 전체 8건 유지 — 하위 호환
        legacy = _build_eeg_content(s.id, db, pid)
        assert len(legacy["timeline"]) == 8
    finally:
        db.close()


def test_17_구간_경계가_없는_레거시_세션은_전체_집계(client):
    from uuid import UUID

    from app.models.eeg_feature import EEGFeatureWindow
    from app.models.session import Session as SessionModel

    counselor = _register(client, "s088c17@test.com")
    cls = _create_class(client, counselor["h"], max_participants=10)
    _open(client, cls, counselor["h"])
    joined = client.post(
        f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={"name": "레거시게스트"}
    )
    pid = UUID(joined.json()["participant_id"])

    db = _db()
    try:
        s = db.get(SessionModel, UUID(cls["id"]))
        now = datetime.now(timezone.utc)
        for i in range(4):
            db.add(EEGFeatureWindow(
                session_id=s.id, participant_id=pid, window_index=i,
                quality="valid", relaxation_index=0.4, created_at=now,
            ))
        db.commit()
    finally:
        db.close()

    from app.tasks.report_task import _build_eeg_content

    db = _db()
    try:
        s = db.get(SessionModel, UUID(cls["id"]))
        # started_at/ended_at 이 None 이면 필터 없이 전체 집계
        block = _build_eeg_content(s.id, db, pid, started_at=s.started_at, ended_at=s.ended_at)
        assert len(block["timeline"]) == 4
    finally:
        db.close()
