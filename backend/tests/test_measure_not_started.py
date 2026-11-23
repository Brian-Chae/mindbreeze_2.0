"""SDD-334 — 입장 후 측정 미시작(measure_not_started) 판정."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.eeg_feature import EEGFeatureWindow
from app.models.record import EEGRawChunk
from app.services.session_service import compute_measure_not_started, get_live_metrics
from tests.sdd237_helpers import build_class_world
from tests.test_sdd027_rollup_raw_report import _db

NOW = datetime(2026, 11, 23, 6, 0, 0, tzinfo=timezone.utc)


def _calc(**kw):
    base = dict(session_status="in_progress", entered_at=NOW - timedelta(seconds=120),
                started_at=NOW - timedelta(seconds=300), has_data=False, eeg_consented=None, now=NOW)
    base.update(kw)
    return compute_measure_not_started(**base)


# ── 순수 판정: 경계값 ─────────────────────────────────────────
def test_89초는_아직_아니고_91초는_대상():
    assert _calc(entered_at=NOW - timedelta(seconds=89)) is None
    assert _calc(entered_at=NOW - timedelta(seconds=90)) is None  # 정확히 90초는 초과가 아님
    since = _calc(entered_at=NOW - timedelta(seconds=91))
    assert since == NOW - timedelta(seconds=91)


def test_데이터가_있으면_해제():
    assert _calc(has_data=True) is None


def test_밴드_미사용_명시는_제외하고_미확인_동의는_대상():
    assert _calc(eeg_consented=False) is None
    assert _calc(eeg_consented=None) is not None
    assert _calc(eeg_consented=True) is not None


def test_미입장_또는_회차_비진행은_제외():
    assert _calc(entered_at=None) is None
    for status in ("open", "ready", "scheduled", "completed", "cancelled"):
        assert _calc(session_status=status) is None


def test_회차_시작보다_먼저_입장했으면_시작_시각부터_센다():
    started = NOW - timedelta(seconds=60)
    assert _calc(entered_at=NOW - timedelta(seconds=600), started_at=started) is None
    started = NOW - timedelta(seconds=100)
    assert _calc(entered_at=NOW - timedelta(seconds=600), started_at=started) == started


def test_naive_시각도_안전():
    since = _calc(entered_at=(NOW - timedelta(seconds=200)).replace(tzinfo=None))
    assert since is not None and since.tzinfo is not None


# ── get_live_metrics 통합 ─────────────────────────────────────
@pytest.fixture
def live_world(client):
    with _db() as db:
        world = build_class_world(db, members=3, status="in_progress", ended=False)
        now = datetime.now(timezone.utc)
        world["session"].started_at = now - timedelta(minutes=10)
        world["session"].state_version = 1
        for p in world["participants"]:
            p.entered_at = now - timedelta(minutes=5)
        db.commit()
        yield {"world": world, "db": db}


def _by_pid(db, world):
    res = get_live_metrics(str(world["session"].id), str(world["host"].id), db)
    return {m["participant_id"]: m for m in res["metrics"]}


def test_측정_데이터_없는_입장자만_측정_미시작(live_world):
    db, world = live_world["db"], live_world["world"]
    p0, p1, p2 = world["participants"]
    # p1: raw 청크만 있음 / p2: 밴드 미사용 명시
    db.add(EEGRawChunk(session_id=world["session"].id, user_id=p1.user_id, participant_id=p1.id,
                       chunk_index=0, object_key=f"eeg-raw/{uuid.uuid4()}/0"))
    p2.eeg_collection_consented = False
    db.commit()
    rows = _by_pid(db, world)
    assert rows[str(p0.id)]["measure_not_started"] is True
    assert rows[str(p0.id)]["measure_not_started_since"] is not None
    assert rows[str(p1.id)]["measure_not_started"] is False
    assert rows[str(p2.id)]["measure_not_started"] is False
    assert rows[str(p1.id)]["measure_not_started_since"] is None


def test_feature가_들어오면_즉시_해제되고_끊김과_구분(live_world):
    db, world = live_world["db"], live_world["world"]
    p0 = world["participants"][0]
    assert _by_pid(db, world)[str(p0.id)]["measure_not_started"] is True
    # 측정 중이다가 오래전에 끊긴 회원: feature 있음 → 측정 미시작이 아님(기존 '연결 끊김' 경로)
    db.add(EEGFeatureWindow(session_id=world["session"].id, participant_id=p0.id, window_index=0,
                            relaxation_index=50.0))
    db.commit()
    row = _by_pid(db, world)[str(p0.id)]
    assert row["measure_not_started"] is False
    assert row["measure_not_started_since"] is None


def test_입장_90초_이내와_미입장은_대상_아님(live_world):
    db, world = live_world["db"], live_world["world"]
    p0, p1, p2 = world["participants"]
    p0.entered_at = datetime.now(timezone.utc) - timedelta(seconds=30)
    p1.entered_at = None
    db.commit()
    rows = _by_pid(db, world)
    assert rows[str(p0.id)]["measure_not_started"] is False
    assert rows[str(p1.id)]["measure_not_started"] is False
    assert rows[str(p2.id)]["measure_not_started"] is True


def test_REST_응답에_필드_포함(client, live_world):
    world = live_world["world"]
    res = client.get(f"/api/v1/sessions/{world['session'].id}/live-metrics", headers=world["auth"])
    assert res.status_code == 200, res.text
    metrics = res.json()["metrics"]
    assert all("measure_not_started" in m and "measure_not_started_since" in m for m in metrics)
    assert any(m["measure_not_started"] for m in metrics)
