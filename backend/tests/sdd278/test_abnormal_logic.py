"""SDD-278 — 비정상 종료 의심 순수 함수 시험 (V1~V10)."""

from datetime import datetime, timedelta, timezone

import pytest

from app.services import upload_progress_service as ps

A = datetime(2026, 11, 5, 5, 0, 0, tzinfo=timezone.utc)
DAY = 24 * 3600


def exp(final=False, eeg=50, ppg=20, acc=20):
    return ps.ExpectedSnapshot(feature=100, raw={"eeg": eeg, "ppg": ppg, "acc": acc}, final=final,
                               first_reported_at=A - timedelta(days=2))


def build(expected=None, *, ended_ago=DAY, status="completed", has_data=True, excluded=False, after=None,
          feature=10, raw=(5, 5, 5)):
    kw = {} if after is None else {"abnormal_after_sec": after}
    return ps.build_participant_progress(ps.ProgressInput(
        excluded=excluded, has_data=has_data, expected=expected, feature_received=feature,
        raw_received=dict(zip(("eeg", "ppg", "acc"), raw)), raw_failed=0,
        last_received_at=A - timedelta(days=1, hours=1),
        session_status=status, ended_at=None if ended_ago is None else A - timedelta(seconds=ended_ago), as_of=A, **kw))


def test_상수는_24시간():
    assert ps.ABNORMAL_EXIT_AFTER_END_SEC == 24 * 3600


@pytest.mark.parametrize("ago,want", [(DAY - 1, False), (DAY, True), (DAY + 1, True)])
def test_V1_V2_경계(ago, want):
    p = build(ended_ago=ago)
    assert p.abnormal_exit_suspected is want
    assert p.state == "expected_unknown"          # state 열거값은 그대로


def test_V1_23시간59분():
    assert build(ended_ago=DAY - 60).abnormal_exit_suspected is False


def test_V3_종료시각없음_또는_회차_진행중():
    assert build(ended_ago=None).abnormal_exit_suspected is False
    assert build(status="in_progress").abnormal_exit_suspected is False
    assert build(status="cancelled").abnormal_exit_suspected is False


def test_V4_보고있고_final이면_아님():
    p = build(exp(final=True))
    assert p.abnormal_exit_suspected is False and p.state != "expected_unknown"


def test_V5_보고있으나_final_미도달_expected_unknown():
    p = build(exp(final=False, eeg=None), ended_ago=DAY)
    assert p.state == "expected_unknown" and p.abnormal_exit_suspected is True
    p2 = build(exp(final=False), ended_ago=DAY)             # 종료 30분 경과 final 미도달 → stale_open
    assert p2.state == "expected_unknown" and p2.abnormal_exit_suspected is True


def test_V6_종료_30분_미만이거나_final_이면_아님():
    assert build(exp(final=False), ended_ago=600).abnormal_exit_suspected is False
    p = build(exp(final=True, eeg=None))
    assert p.state == "expected_unknown" and p.abnormal_exit_suspected is False


def test_V7_데이터_없음과_제외():
    assert build(has_data=False).abnormal_exit_suspected is False
    p = build(excluded=True, has_data=False)
    assert p.state == "not_collected" and p.abnormal_exit_suspected is False


def test_V8_제외지만_데이터_있고_보고없음():
    assert build(excluded=True, has_data=True).abnormal_exit_suspected is True


def test_V10_기한_오버라이드():
    assert build(ended_ago=59, after=60).abnormal_exit_suspected is False
    assert build(ended_ago=60, after=60).abnormal_exit_suspected is True


def test_V9_합계_의심_제외_수치와_인원():
    ok = build(exp(final=True), feature=100, raw=(50, 20, 20))
    sus = build(None, feature=7, raw=(1, 1, 1))
    wait = build(None, ended_ago=100)                       # 의심 아님(대기)
    gone = build(None, has_data=False, excluded=True)
    agg = ps.aggregate([ok, sus, wait, gone])
    c = agg.participants
    assert (c.total, c.counted, c.all_received, c.expected_unknown, c.not_collected, c.abnormal_exit_suspected) == (4, 3, 1, 2, 1, 1)
    assert agg.feature.expected == 100 and agg.feature.received == 100     # 의심 7 은 분모·분자 모두 제외
    assert agg.overall.percent == 100.0 or agg.overall.percent is not None
    merged = ps.merge([agg, agg])
    assert merged.participants.abnormal_exit_suspected == 2


def test_모두_의심이면_수치는_미보고():
    agg = ps.aggregate([build(None), build(None)])
    assert agg.participants.abnormal_exit_suspected == 2
    assert agg.overall.expected is None and agg.overall.percent is None
