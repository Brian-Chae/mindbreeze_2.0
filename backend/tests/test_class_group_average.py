"""SDD-124: 절대 그룹 평균(회원 노출용) — `/session-live` `class:group_average` QA.

검증 시나리오:
- TS1: 절대 평균 집계 — 6지표(마음 raw 0~1 / 몸 절대값)의 착용자 간 평균.
- TS2: 표본 부족(착용자 < MIN_WEARERS) 이면 mean 전부 null + sample_status="insufficient".
- TS3: 익명성 — payload 에 개인 식별자·개인 점수·순위가 없다.
- TS4: WS — feature 수신 시 공용 룸(:all)으로 `class:group_average` 발행.
- TS5: WS — 참가자 join 즉시 본인 소켓으로 1건 발행.
- TS6: 계약 — 이벤트명 + class:aggregate 와 독립 throttle.

Socket.IO 핸들러는 SDD-024 테스트와 동일하게 FakeSio 로 직접 호출하고,
`_open_db` / `_get_sio` 를 monkeypatch 해 REST 와 같은 인메모리 DB 를 공유한다.
"""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

import app.ws.session_live_namespace as ns
from app.services import group_aggregate as ga
from tests.test_sdd024_session_live_ws import (
    _create_group_class,
    _feature,
    _join_guest,
    _register,
    _wire,
)


@pytest.fixture(autouse=True)
def _clean_aggregate_state():
    """throttle 상태는 모듈 전역이므로 테스트 간 격리를 보장한다."""
    ns.clear_group_aggregates()
    yield
    ns.clear_group_aggregates()


# ---------------------------------------------------------------------------
# 헬퍼
# ---------------------------------------------------------------------------


def _db():
    """REST 와 동일한 인메모리 DB 세션을 연다(집계/시드 공용)."""
    from app.core.database import get_db
    from app.main import app as fastapi_app

    return next(fastapi_app.dependency_overrides[get_db]())


def _seed_full_windows(session_id: str, participant_id: str, *, count: int, **metrics: float):
    """6지표(마음 raw + 몸 절대값)를 가진 EEGFeatureWindow 를 직접 시드한다."""
    from app.models.eeg_feature import EEGFeatureWindow

    db = _db()
    try:
        for i in range(count):
            kwargs = dict(
                session_id=session_id,
                participant_id=participant_id,
                play_group_id="g1",
                window_index=i,
                quality="valid",
                signal_quality=0.95,
                created_at=datetime.now(timezone.utc) + timedelta(seconds=i),
            )
            for key, val in metrics.items():
                kwargs[key] = val
            db.add(EEGFeatureWindow(**kwargs))
        db.commit()
    finally:
        db.close()


def _group_average_emits(fake):
    return [e for e in fake.emits if e["event"] == ns.GROUP_AVERAGE_EVENT]


def _started_group_class(client, counselor: dict, **overrides) -> dict:
    cls = _create_group_class(client, counselor["h"], **overrides)
    _join_guest(client, cls["access_code"], "준비게스트")
    started = client.post(f"/api/v1/sessions/{cls['id']}/start", headers=counselor["h"])
    assert started.status_code == 200, started.text
    return started.json()


# ---------------------------------------------------------------------------
# TS1 / TS2 / TS3 — 순수 집계
# ---------------------------------------------------------------------------


def test_01_절대_6지표_평균(client):
    counselor = _register(client, "ga124a@test.com")
    cls = _started_group_class(client, counselor)
    pids = [
        _join_guest(client, cls["access_code"], f"착용자{i}") for i in range(3)
    ]

    for pid in pids:
        _seed_full_windows(
            cls["id"], pid, count=140,
            relaxation_index=0.25, focus_index=1.0, emotional_stability=0.5,
            heart_rate=70.0, respiratory_rate=12.0, sdnn=40.0,
        )

    db = _db()
    try:
        payload = ga.compute_group_average(cls["id"], db)
    finally:
        db.close()

    assert payload["session_id"] == cls["id"]
    assert payload["sample_status"] == "ok"
    assert payload["wearer_count"] == 3
    assert payload["min_wearers"] == ga.MIN_WEARERS

    m = payload["metrics"]
    assert set(m) == {
        "focus_index", "relaxation_index", "emotional_stability",
        "heart_rate", "respiratory_rate", "sdnn",
    }
    # 마음 raw(0~1) / 몸 절대값 — 착용자 간 평균이 원시값과 일치
    assert m["relaxation_index"]["mean"] == pytest.approx(0.25, abs=1e-6)
    assert m["focus_index"]["mean"] == pytest.approx(1.0, abs=1e-6)
    assert m["emotional_stability"]["mean"] == pytest.approx(0.5, abs=1e-6)
    assert m["heart_rate"]["mean"] == pytest.approx(70.0, abs=1e-6)
    assert m["respiratory_rate"]["mean"] == pytest.approx(12.0, abs=1e-6)
    assert m["sdnn"]["mean"] == pytest.approx(40.0, abs=1e-6)


def test_02_표본부족이면_mean_전부_null(client):
    counselor = _register(client, "ga124b@test.com")
    cls = _started_group_class(client, counselor)
    pid = _join_guest(client, cls["access_code"], "착용자1")
    _seed_full_windows(cls["id"], pid, count=140, relaxation_index=0.25, focus_index=1.0)

    db = _db()
    try:
        payload = ga.compute_group_average(cls["id"], db)
    finally:
        db.close()

    assert payload["sample_status"] == "insufficient"
    assert payload["wearer_count"] == 1
    for metric in payload["metrics"].values():
        assert metric["mean"] is None


def test_03_익명성_개인식별자_부재(client):
    counselor = _register(client, "ga124c@test.com")
    cls = _started_group_class(client, counselor)
    pids = [
        _join_guest(client, cls["access_code"], f"착용자{i}") for i in range(3)
    ]
    for pid in pids:
        _seed_full_windows(cls["id"], pid, count=140, relaxation_index=0.25, focus_index=1.0)

    db = _db()
    try:
        payload = ga.compute_group_average(cls["id"], db)
    finally:
        db.close()

    text = repr(payload)
    for forbidden in ("participant_id", "user_id", "display_name", "rank", "score"):
        assert forbidden not in text


# ---------------------------------------------------------------------------
# TS4 / TS5 — WS 발행
# ---------------------------------------------------------------------------


def test_04_공용룸으로_브로드캐스트(client, monkeypatch):
    counselor = _register(client, "ga124d@test.com")
    cls = _started_group_class(client, counselor)
    pid = _join_guest(client, cls["access_code"], "집계게스트")
    fake = _wire(monkeypatch)

    fake.call("connect", "sidG", {}, {})
    fake.call(
        "feature",
        "sidG",
        {"session_id": cls["id"], "participant_id": pid, "feature": _feature(0, relaxation_index=0.25)},
    )

    emits = _group_average_emits(fake)
    assert len(emits) == 1
    e = emits[0]
    # 공용 룸(:all)으로 — 호스트 전용 룸/본인 룸 단독이 아니다
    assert e["room"] == f"session:{cls['id']}:all"
    assert e["to"] is None
    assert e["namespace"] == "/session-live"
    data = e["data"]
    assert data["session_id"] == cls["id"]
    assert data["sample_status"] == "insufficient"  # 착용자 1명
    assert "metrics" in data
    assert isinstance(data["at"], str) and "T" in data["at"]

    # 두 번째 feature 는 주기(5초) 이내라 발행하지 않는다
    fake.call(
        "feature",
        "sidG",
        {"session_id": cls["id"], "participant_id": pid, "feature": _feature(1, relaxation_index=0.26)},
    )
    assert len(_group_average_emits(fake)) == 1


def test_05_참가자_join_즉시_본인소켓으로_1건(client, monkeypatch):
    counselor = _register(client, "ga124e@test.com")
    cls = _started_group_class(client, counselor)
    pid = _join_guest(client, cls["access_code"], "게스트참가")
    fake = _wire(monkeypatch)

    fake.call("connect", "sidP", {}, {})
    fake.call("join", "sidP", {"session_id": cls["id"], "participant_id": pid})

    emits = _group_average_emits(fake)
    assert len(emits) == 1
    assert emits[0]["to"] == "sidP"  # join 한 참가자 본인에게만
    assert emits[0]["room"] is None
    assert emits[0]["data"]["wearer_count"] == 0
    assert emits[0]["data"]["sample_status"] == "insufficient"


# ---------------------------------------------------------------------------
# TS6 — 계약 상수
# ---------------------------------------------------------------------------


def test_06_이벤트명과_throttle_계약():
    assert ns.GROUP_AVERAGE_EVENT == "class:group_average"
    # class:aggregate 와 독립 throttle — 같은 시각에 둘 다 발행 가능해야 한다
    sid = str(uuid4())
    assert ns.aggregate_due(sid, at=100.0) is True
    assert ns.group_average_due(sid, at=100.0) is True  # 독립 상태
    assert ns.group_average_due(sid, at=100.0 + ns.AGGREGATE_INTERVAL_SEC - 0.1) is False
    assert ns.group_average_due(sid, at=100.0 + ns.AGGREGATE_INTERVAL_SEC) is True


# ---------------------------------------------------------------------------
# TS7 — GROUP-AVG-ANON: 지표별 표본 게이트
# ---------------------------------------------------------------------------


def test_07_지표별_표본부족이면_그_지표만_null(client):
    """착용자 총수는 충분해도, 개별 지표를 실제로 보고한 사람이 MIN_WEARERS 미만이면
    그 지표 평균은 null 이어야 한다(1명 기여 → 개인값 역산 방지)."""
    counselor = _register(client, "ga124f@test.com")
    cls = _started_group_class(client, counselor)
    pids = [_join_guest(client, cls["access_code"], f"착용자{i}") for i in range(3)]

    # 3명 모두 focus_index 보고 / relaxation_index 는 2명만 → relaxation 은 mean null
    _seed_full_windows(cls["id"], pids[0], count=140, focus_index=1.0, relaxation_index=0.2)
    _seed_full_windows(cls["id"], pids[1], count=140, focus_index=0.6, relaxation_index=0.4)
    _seed_full_windows(cls["id"], pids[2], count=140, focus_index=0.4)

    db = _db()
    try:
        payload = ga.compute_group_average(cls["id"], db)
    finally:
        db.close()

    assert payload["wearer_count"] == 3
    m = payload["metrics"]
    # focus: 3명 모두 보고 → 평균 산출 (payload 는 소수 2자리로 반올림)
    assert m["focus_index"]["mean"] == pytest.approx(0.67, abs=1e-6)
    # relaxation: 2명만 보고(2 < MIN_WEARERS=3) → null
    assert m["relaxation_index"]["mean"] is None
    # 미보고(heart_rate 등) 지표도 null
    assert m["heart_rate"]["mean"] is None
