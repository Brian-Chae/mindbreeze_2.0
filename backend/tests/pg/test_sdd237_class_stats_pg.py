"""SDD-237 B2/S18: 실제 PostgreSQL 행(eeg_feature_windows)으로 클래스 통계 검증.

중복 초 윈도우·pause/resume 세그먼트(window_index 재시작)·수업 구간 필터를 실 DB 제약 위에서 본다.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.models.eeg_feature import EEGFeatureWindow
from app.models.session import Session, SessionParticipant
from app.services import class_report_stats_service as stats
from tests.pg.sdd216_helpers import user, world

pytestmark = pytest.mark.pg

START = datetime(2026, 10, 23, 9, 0, 0, tzinfo=timezone.utc)
START_MS = int(START.timestamp() * 1000)


def _setup(db, members=3):
    org, host, _o, parent = world(db)
    session = Session(type="meditation", host_id=host.id, class_id=parent.id, seq=1, status="completed",
                      host_state="assigned", duration_min=45, started_at=START,
                      ended_at=START + timedelta(minutes=45))
    db.add(session)
    db.flush()
    parts = []
    for i in range(members):
        u = user(db, org, role="client")
        p = SessionParticipant(session_id=session.id, user_id=u.id, attendance_status="attended",
                               report_included=True, joined_at=START + timedelta(seconds=i))
        db.add(p)
        db.flush()
        parts.append(p)
    return session, parts


def _win(session, p, idx, sec, *, seg=None, focus=2.0, rr=14.0, quality="valid"):
    return EEGFeatureWindow(
        session_id=session.id, participant_id=p.id, user_id=p.user_id, play_group_id=seg,
        window_index=idx, quality=quality, device_timestamp_ms=START_MS + sec * 1000,
        focus_index=focus, relaxation_index=1.0, emotional_stability=0.5,
        heart_rate=70.0, respiratory_rate=rr, sdnn=40.0)


def test_같은_초에_몰린_윈도우_100개는_1초이고_60초_이상이어야_측정(pg_session):
    session, parts = _setup(pg_session)
    # a: 초당 윈도우 2개씩 60초(=120행) → 고유 초 60 → 측정. b: 한 초에 100행 → 1초 → 미측정.
    a, b, c = parts
    for k in range(120):
        pg_session.add(_win(session, a, k, k // 2))
    for k in range(100):
        pg_session.add(_win(session, b, k, 5))
    for k in range(60):
        pg_session.add(_win(session, c, k, k))
    pg_session.flush()
    res = stats.compute_class_stats(pg_session, session)
    assert res["metrics"]["focus"]["measured"] == 2
    assert res["metrics"]["focus"]["valid_min"] == pytest.approx(1.0)
    states = {r["participant_id"]: r["state"] for r in res["participants"]}
    assert states[str(b.id)] == "poor_signal"


def test_pause_resume_세그먼트는_window_index가_0부터_재시작해도_전후를_각각_나눈다(pg_session):
    session, parts = _setup(pg_session, members=2)
    for p in parts:
        for i in range(60):   # g1: 값 낮음→높음
            pg_session.add(_win(session, p, i, i, seg="g1", focus=1.0 if i < 30 else 3.0))
        for i in range(60):   # g2: 같은 window_index 0~59 재시작, 다른 시각
            pg_session.add(_win(session, p, i, 600 + i, seg="g2", focus=1.0 if i < 30 else 3.0))
    pg_session.flush()
    res = stats.compute_class_stats(pg_session, session)
    f = res["metrics"]["focus"]
    assert f["measured"] == 2 and f["compared"] == 2
    assert f["direction"] in ("up", "stable")
    assert f["valid_min"] == pytest.approx(2.0)


def test_수업_구간_밖_윈도우는_제외된다(pg_session):
    session, parts = _setup(pg_session, members=2)
    for p in parts:
        for i in range(120):
            pg_session.add(_win(session, p, i, -900 + i))  # 수업 시작 15분 전(대기실)
    pg_session.flush()
    res = stats.compute_class_stats(pg_session, session)
    assert res["scope"]["measured"] == 0
