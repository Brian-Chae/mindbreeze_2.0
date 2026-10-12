"""개선 8: 그룹 익명 집계 상태 지표(적응형 페이싱) — `/session-live` `class:aggregate` QA.

검증 시나리오:
- TS1: 순수 집계 — baseline 대비 상대값 매핑(50 = 기준선)과 캘리브레이션 분할.
- TS2: 참가자별 상대값 — 첫 120 윈도우가 baseline, 이후 구간이 현재값. 미완료면 None.
- TS3: 표본 부족(착용자 < MIN_WEARERS) 이면 점수를 만들지 않고 sample_status="insufficient".
- TS4: 익명성 — payload 에 개인 식별자·개인 점수·순위가 없다.
- TS5: 안정 비율 — 최근 구간 변동성이 큰 참가자는 안정 집계에서 빠진다.
- TS6: 적응형 페이싱 — 이완도 기준선 미달이면 slow_down, 충분+안정이면 deepen.
- TS7: DB 연동 — 세션의 윈도우로 집계하고 호스트 본인 행은 제외한다.
- TS8: WS — feature 수신 시 상담사(호스트) 룸으로만 `class:aggregate` 발행 + 주기 throttle.
- TS9: WS — 상담사 join 즉시 본인 소켓으로 1건 발행(게이지가 비지 않게).
- TS10: 이벤트명/throttle 계약 상수.

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


class _Window:
    """EEGFeatureWindow 최소 모사 — 순수 집계 함수 입력용."""

    def __init__(self, index: int, relaxation=None, focus=None, created_at=None):
        self.id = index
        self.window_index = index
        self.relaxation_index = relaxation
        self.focus_index = focus
        self.created_at = created_at or (
            datetime(2026, 9, 29, 10, 0, tzinfo=timezone.utc) + timedelta(seconds=index)
        )


def _windows(count: int, relaxation=0.25, focus=1.5, start: int = 0) -> list:
    return [
        _Window(start + i, relaxation=relaxation, focus=focus) for i in range(count)
    ]


def _db():
    """REST 와 동일한 인메모리 DB 세션을 연다(집계/시드 공용)."""
    from app.core.database import get_db
    from app.main import app as fastapi_app

    return next(fastapi_app.dependency_overrides[get_db]())


def _seed_windows(session_id: str, participant_id: str, *, count: int, relaxation, focus):
    """EEGFeatureWindow 를 직접 시드한다(120+ 윈도우를 WS 로 하나씩 올리는 비용 회피)."""
    from app.models.eeg_feature import EEGFeatureWindow

    db = _db()
    try:
        for i in range(count):
            db.add(
                EEGFeatureWindow(
                    session_id=session_id,
                    participant_id=participant_id,
                    play_group_id="g1",
                    window_index=i,
                    quality="valid",
                    relaxation_index=relaxation(i),
                    focus_index=focus(i),
                    signal_quality=0.95,
                    created_at=datetime.now(timezone.utc) + timedelta(seconds=i),
                )
            )
        db.commit()
    finally:
        db.close()


def _aggregate_emits(fake):
    return [e for e in fake.emits if e["event"] == ns.GROUP_AGGREGATE_EVENT]


def _started_group_class(client, counselor: dict, **overrides) -> dict:
    """클래스를 만들고 시작까지 진행해 EEG 업로드가 가능한 상태로 만든다.

    그룹 시작은 active 참가자 1명 이상이 필요하므로 준비 게스트 1명을 먼저 입장시킨다
    (밴드 윈도우가 없으므로 착용자 집계에는 잡히지 않는다).
    """
    cls = _create_group_class(client, counselor["h"], **overrides)
    _join_guest(client, cls["access_code"], "준비게스트")
    started = client.post(f"/api/v1/sessions/{cls['id']}/start", headers=counselor["h"])
    assert started.status_code == 200, started.text
    return started.json()


# ---------------------------------------------------------------------------
# TS1 / TS2 — 순수 집계 (baseline 상대값)
# ---------------------------------------------------------------------------


def test_01_상대값_매핑은_기준선이_50이다():
    # Δ=0 → 기준선(50). ±ref → 100/0. 클램프로 범위를 벗어나지 않는다.
    assert ga.relative_score(0.0, 0.08) == 50.0
    assert ga.relative_score(0.08, 0.08) == 100.0
    assert ga.relative_score(-0.08, 0.08) == 0.0
    assert ga.relative_score(0.04, 0.08) == 75.0
    assert ga.relative_score(1.0, 0.08) == 100.0  # 클램프
    assert ga.relative_score(None, 0.08) is None
    assert ga.relative_score(0.1, 0) is None
    assert ga.relative_score(float("nan"), 0.08) is None


def test_02_캘리브레이션_분할은_첫_120윈도우가_baseline이다():
    windows = _windows(300)
    baseline, after = ga.split_calibration(windows)
    assert len(baseline) == ga.CALIBRATION_SEC == 120
    assert [w.window_index for w in baseline] == list(range(120))
    # 사후 구간은 최근 STABILITY_WINDOW_SEC(180) 개만 남긴다
    assert len(after) == ga.STABILITY_WINDOW_SEC
    assert after[0].window_index == 120
    assert after[-1].window_index == 299


def test_03_참가자_상대값_미완료면_None():
    # 120 개 미만 → 캘리브레이션 미완료
    assert ga.participant_relative(_windows(119)) is None
    # 120 개(사후 구간 0) → 아직 상대값을 만들 수 없다
    assert ga.participant_relative(_windows(120)) is None


def test_04_참가자_상대값은_baseline_대비_델타다():
    # baseline(첫 120) = 0.25 / 이후 60 = 0.33 → Δ=+0.08 → 100점(최대 이완)
    windows = _windows(180, relaxation=0.25, focus=1.0) + [
        _Window(i, relaxation=0.33, focus=1.8) for i in range(180, 240)
    ]
    rel = ga.participant_relative(windows)
    assert rel is not None
    assert rel.relaxation_delta == pytest.approx(0.08)
    assert rel.relaxation_score == pytest.approx(100.0)
    assert rel.focus_delta == pytest.approx(0.8)
    assert rel.focus_score == pytest.approx(100.0)
    # 변동성 없는 평탄 구간 → 안정
    assert rel.relaxation_stable is True
    assert rel.focus_stable is True


def test_05_baseline_보다_낮아지면_점수가_50미만이다():
    windows = _windows(120, relaxation=0.30) + [
        _Window(i, relaxation=0.26) for i in range(120, 180)
    ]
    rel = ga.participant_relative(windows)
    assert rel is not None
    assert rel.relaxation_delta == pytest.approx(-0.04)
    assert rel.relaxation_score == pytest.approx(25.0)


# ---------------------------------------------------------------------------
# TS3 / TS4 — 표본 부족 · 익명성
# ---------------------------------------------------------------------------


def _relative(
    relax_delta: float, focus_delta: float = 0.0, *, stable: bool | None = True
) -> ga.ParticipantRelative:
    return ga.ParticipantRelative(
        relaxation_delta=relax_delta,
        focus_delta=focus_delta,
        relaxation_score=ga.relative_score(relax_delta, ga.RELAXATION_DELTA_REF),
        focus_score=ga.relative_score(focus_delta, ga.FOCUS_DELTA_REF),
        relaxation_stable=stable,
        focus_stable=stable,
    )


def test_06_표본이_적으면_점수를_만들지_않는다():
    # 착용자 2명 (< MIN_WEARERS=3) — 상대값이 있어도 평균을 내보내지 않는다
    payload = ga.summarize_group([_relative(0.08), _relative(0.08)], wearer_count=2)
    assert payload["sample_status"] == "insufficient"
    assert payload["wearer_count"] == 2
    assert payload["relaxation"] == {"mean": None, "stability_ratio": None}
    assert payload["focus"] == {"mean": None, "stability_ratio": None}
    assert payload["pace"] == ga.PACE_INSUFFICIENT
    assert payload["pace_hint"] == ga.PACE_HINTS[ga.PACE_INSUFFICIENT]

    # 착용자는 충분하지만 캘리브레이션 완료가 1명 — 마찬가지로 산출하지 않는다
    short = ga.summarize_group([_relative(0.08)], wearer_count=5)
    assert short["sample_status"] == "insufficient"
    assert short["wearer_count"] == 5
    assert short["calibrated_count"] == 1
    assert short["relaxation"]["mean"] is None


def test_07_집계_평균과_안정비율():
    relatives = [_relative(0.08), _relative(0.0), _relative(-0.08), _relative(0.0)]
    payload = ga.summarize_group(relatives, wearer_count=5)
    assert payload["sample_status"] == "ok"
    assert payload["calibrated_count"] == 4
    # 100, 50, 0, 50 → 평균 50
    assert payload["relaxation"]["mean"] == pytest.approx(50.0)
    # 전원 안정
    assert payload["relaxation"]["stability_ratio"] == 1.0


def test_08_payload에_개인_식별자와_개인점수가_없다():
    """익명성 계약 — 집계 밖의 개인 값은 어떤 키로도 새어나가면 안 된다."""
    payload = ga.summarize_group(
        [_relative(0.08), _relative(-0.08), _relative(0.0)], wearer_count=7
    )
    assert set(payload) == {
        "wearer_count",
        "calibrated_count",
        "min_wearers",
        "calibration_sec",
        "baseline_relative",
        "sample_status",
        "relaxation",
        "focus",
        "pace",
        "pace_hint",
    }
    raw = repr(payload)
    for forbidden in ("participant", "participant_id", "user_id", "rank", "display_name", "score"):
        assert forbidden not in raw, forbidden
    assert set(payload["relaxation"]) == {"mean", "stability_ratio"}


# ---------------------------------------------------------------------------
# TS5 / TS6 — 안정 비율 · 적응형 페이싱
# ---------------------------------------------------------------------------


def test_09_불안정_참가자는_안정비율에서_빠진다():
    relatives = [_relative(0.0, stable=True), _relative(0.0, stable=False), _relative(0.0, stable=None)]
    payload = ga.summarize_group(relatives, wearer_count=4)
    # 판정 불가(None)는 분모에서 제외 — 1/2
    assert payload["relaxation"]["stability_ratio"] == pytest.approx(0.5)


def test_10_변동성이_큰_참가자는_안정으로_보지_않는다():
    steady = _windows(200, relaxation=0.25)
    # 최근 구간에서 크게 흔들리는 참가자
    shaky = _windows(120, relaxation=0.25) + [
        _Window(i, relaxation=0.25 + (0.05 if i % 2 else -0.05)) for i in range(120, 200)
    ]
    steady_rel = ga.participant_relative(steady)
    shaky_rel = ga.participant_relative(shaky)
    assert steady_rel is not None and shaky_rel is not None
    assert steady_rel.relaxation_stable is True
    assert shaky_rel.relaxation_stable is False


def test_11_적응형_페이싱_제안():
    # 기준선 아래 → 속도를 늦춘다
    assert ga.describe_pace(35.0, 1.0, True)[0] == ga.PACE_SLOW_DOWN
    # 충분히 이완 + 안정 → 한 단계 깊게
    assert ga.describe_pace(70.0, 0.8, True)[0] == ga.PACE_DEEPEN
    # 이완도는 높지만 안정 비율이 낮다 → 유지
    assert ga.describe_pace(70.0, 0.3, True)[0] == ga.PACE_HOLD
    # 중간 → 유지
    assert ga.describe_pace(50.0, 0.9, True)[0] == ga.PACE_HOLD
    # 표본 부족이면 어떤 값이 있어도 판단하지 않는다
    assert ga.describe_pace(20.0, 0.0, False)[0] == ga.PACE_INSUFFICIENT
    # 힌트는 4가지 페이스 모두에 존재하고, 점수·순위 같은 표현이 없다
    assert set(ga.PACE_HINTS) == {
        ga.PACE_INSUFFICIENT,
        ga.PACE_SLOW_DOWN,
        ga.PACE_HOLD,
        ga.PACE_DEEPEN,
    }
    for hint in ga.PACE_HINTS.values():
        assert hint
        assert "점수" not in hint and "순위" not in hint


# ---------------------------------------------------------------------------
# TS7 — DB 연동
# ---------------------------------------------------------------------------


def test_12_세션_윈도우로_집계하고_호스트행은_제외한다(client):
    counselor = _register(client, "ga12c@test.com")
    cls = _started_group_class(client, counselor)
    pids = [_join_guest(client, cls["access_code"], f"게스트{i}") for i in range(3)]

    # 호스트 본인 참가자 행(=자기 세션)도 존재한다 — 그룹 상태 집계에서 빠져야 한다
    from app.models.session import Session, SessionParticipant

    db = _db()
    try:
        session = db.query(Session).filter(Session.id == cls["id"]).first()
        host_pid = None
        for p in session.participants:
            if p.user_id is not None and p.user_id == session.host_id:
                host_pid = str(p.id)
                break
        if host_pid is None:
            host_p = SessionParticipant(session_id=session.id, user_id=session.host_id)
            db.add(host_p)
            db.commit()
            host_pid = str(host_p.id)
    finally:
        db.close()

    # 착용자 3명(게스트) — 각자 baseline 0.25 → 최근 0.30 (+0.05 → 81.3점)
    for pid in pids:
        _seed_windows(
            cls["id"], pid, count=140, relaxation=lambda i: 0.25 if i < 120 else 0.30,
            focus=lambda i: 1.0, 
        )
    # 호스트 본인은 캘리브레이션 미완료(1건)까지 시드해도 제외되어야 한다
    _seed_windows(cls["id"], host_pid, count=1, relaxation=lambda i: 0.9, focus=lambda i: 9.0)

    db = _db()
    try:
        payload = ga.compute_group_aggregate(cls["id"], db)
    finally:
        db.close()

    assert payload["session_id"] == cls["id"]
    assert payload["sample_status"] == "ok"
    assert payload["wearer_count"] == 3  # 호스트 행 제외
    assert payload["calibrated_count"] == 3
    assert payload["baseline_relative"] is True
    assert payload["relaxation"]["mean"] == pytest.approx(81.3, abs=0.2)
    # 익명성 — 개인 식별 키는 payload 어디에도 없다
    assert "participant" not in repr(payload)


def test_13_착용자_0명이면_표본부족_빈집계(client):
    counselor = _register(client, "ga13c@test.com")
    cls = _started_group_class(client, counselor)

    db = _db()
    try:
        payload = ga.compute_group_aggregate(cls["id"], db)
    finally:
        db.close()

    assert payload["sample_status"] == "insufficient"
    assert payload["wearer_count"] == 0
    assert payload["relaxation"]["mean"] is None
    assert payload["pace"] == ga.PACE_INSUFFICIENT


# ---------------------------------------------------------------------------
# TS8 / TS9 — WS 발행
# ---------------------------------------------------------------------------


def test_14_상담사_룸으로만_발행되고_주기로_제한된다(client, monkeypatch):
    counselor = _register(client, "ga14c@test.com")
    cls = _started_group_class(client, counselor)
    pid = _join_guest(client, cls["access_code"], "집계게스트")
    fake = _wire(monkeypatch)

    fake.call("connect", "sidG", {}, {})
    fake.call(
        "feature",
        "sidG",
        {"session_id": cls["id"], "participant_id": pid, "feature": _feature(0, relaxation_index=0.25)},
    )

    emits = _aggregate_emits(fake)
    assert len(emits) == 1
    e = emits[0]
    # 상담사(호스트) 룸으로만 — 공용 룸/본인 룸으로는 나가지 않는다(회원 비노출)
    assert e["room"] == f"session:{cls['id']}"
    assert e["room"] != f"session:{cls['id']}:all"
    assert e["room"] != f"session:{cls['id']}:self:{pid}"
    assert e["to"] is None
    assert e["namespace"] == "/session-live"
    data = e["data"]
    assert data["session_id"] == cls["id"]
    assert data["sample_status"] == "insufficient"  # 착용자 1명
    assert data["pace"] == ga.PACE_INSUFFICIENT
    assert isinstance(data["at"], str) and "T" in data["at"]

    # 두 번째 feature 는 주기(5초) 이내라 발행하지 않는다
    fake.call(
        "feature",
        "sidG",
        {"session_id": cls["id"], "participant_id": pid, "feature": _feature(1, relaxation_index=0.26)},
    )
    assert len(_aggregate_emits(fake)) == 1


def test_15_상담사_join_즉시_본인소켓으로_1건_발행(client, monkeypatch):
    counselor = _register(client, "ga15c@test.com")
    cls = _started_group_class(client, counselor)
    fake = _wire(monkeypatch)

    fake.call("connect", "sidH", {}, {"token": counselor["token"]})
    fake.call("join", "sidH", {"session_id": cls["id"]})

    emits = _aggregate_emits(fake)
    assert len(emits) == 1
    assert emits[0]["to"] == "sidH"  # join 한 상담사 본인에게만
    assert emits[0]["room"] is None
    assert emits[0]["data"]["wearer_count"] == 0
    assert emits[0]["data"]["sample_status"] == "insufficient"

    # 참여자 join 에는 집계를 보내지 않는다
    pid = _join_guest(client, cls["access_code"], "게스트참가")
    fake.call("connect", "sidP", {}, {})
    fake.call("join", "sidP", {"session_id": cls["id"], "participant_id": pid})
    assert len(_aggregate_emits(fake)) == 1


# ---------------------------------------------------------------------------
# TS10 — 계약 상수
# ---------------------------------------------------------------------------


def test_16_이벤트명과_throttle_계약():
    assert ns.GROUP_AGGREGATE_EVENT == "class:aggregate"
    assert ns.AGGREGATE_INTERVAL_SEC > 0
    assert ga.MIN_WEARERS >= 3
    assert ga.CALIBRATION_SEC == 120  # 세션 초반 2분


def test_17_throttle_은_주기_경과후_다시_허용한다():
    sid = str(uuid4())
    assert ns.aggregate_due(sid, at=100.0) is True
    assert ns.aggregate_due(sid, at=100.0 + ns.AGGREGATE_INTERVAL_SEC - 0.1) is False
    assert ns.aggregate_due(sid, at=100.0 + ns.AGGREGATE_INTERVAL_SEC) is True
    # 다른 세션은 독립적으로 판정된다
    assert ns.aggregate_due(str(uuid4()), at=100.0) is True
