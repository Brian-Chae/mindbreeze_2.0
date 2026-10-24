"""SDD-237 B2: compute_class_stats — DB 에서 입력을 모아 계산하는 경로(SQLite)."""

import pytest

from app.services import class_report_stats_service as stats
from app.services import eeg_metrics
from tests.sdd237_helpers import add_windows, build_class_world, start_ms


@pytest.fixture
def db(app_client):
    from app.core.database import get_db
    from app.main import app

    session = next(app.dependency_overrides[get_db]())
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def test_DB_입력으로_측정자_2명_통계를_만든다(client, db):
    w = build_class_world(db, members=3)
    p = w["participants"]
    add_windows(db, w["session"], p[0], 300)
    add_windows(db, w["session"], p[1], 300)
    res = stats.compute_class_stats(db, w["session"])
    assert res["scope"]["attended"] == 3
    assert res["scope"]["included"] == 3
    assert res["scope"]["measured"] == 2
    assert res["scope"]["duration_min"] == 45
    assert res["status"] == "measured" and res["flags"] == ["partial"]
    focus = res["metrics"]["focus"]
    assert focus["state"] == "ok" and focus["measured"] == 2
    assert focus["mean"] == pytest.approx(eeg_metrics.normalize_focus(2.0), abs=1e-6)
    assert res["metrics"]["respiration"]["mean"] == pytest.approx(14.0)
    states = {r["participant_id"]: r["state"] for r in res["participants"]}
    assert states[str(p[2].id)] == "unworn"


def test_수업_구간_밖_윈도우와_결석자는_집계에서_빠진다(client, db):
    w = build_class_world(db, members=3)
    p = w["participants"]
    p[2].attendance_status = "excused"
    db.commit()
    base = start_ms(w["session"])
    # 수업 시작 전(대기실)에 모인 윈도우는 분석 대상이 아니다
    add_windows(db, w["session"], p[0], 300, ms=base - 400_000)
    add_windows(db, w["session"], p[1], 300)
    add_windows(db, w["session"], p[2], 300)
    res = stats.compute_class_stats(db, w["session"])
    assert res["scope"]["attended"] == 2
    assert res["scope"]["measured"] == 1
    assert res["status"] == "single"
    assert str(p[2].id) not in [r["participant_id"] for r in res["participants"]]


def test_리포트_반영_제외_참여자는_어떤_집계에도_기여하지_않는다(client, db):
    w = build_class_world(db, members=3)
    p = w["participants"]
    p[2].report_included = False
    db.commit()
    for part in p:
        add_windows(db, w["session"], part, 300)
    res = stats.compute_class_stats(db, w["session"])
    assert res["scope"]["included"] == 2 and res["scope"]["measured"] == 2
    assert res["scope"]["attended"] == 3
    assert str(p[2].id) not in [r["participant_id"] for r in res["participants"]]


def test_윈도우가_없어도_밴드_연결_기록이_있으면_lost(client, db):
    w = build_class_world(db, members=2)
    for part in w["participants"]:
        part.band_connected = True
    db.commit()
    res = stats.compute_class_stats(db, w["session"])
    assert res["status"] == "lost"


def test_출석_0명이면_zero(client, db):
    w = build_class_world(db, members=0)
    res = stats.compute_class_stats(db, w["session"])
    assert res["status"] == "zero"


def test_세그먼트_pause_resume_윈도우_인덱스_재시작도_고유초로_센다(client, db):
    w = build_class_world(db, members=2)
    p = w["participants"]
    for part in p:
        add_windows(db, w["session"], part, 60, seg="g1")
        add_windows(db, w["session"], part, 60, seg="g2", start_offset=0, ms=start_ms(w["session"]) + 600_000)
    res = stats.compute_class_stats(db, w["session"])
    assert res["metrics"]["focus"]["measured"] == 2
    assert res["metrics"]["focus"]["valid_min"] == pytest.approx(2.0)  # 60+60 고유 초
