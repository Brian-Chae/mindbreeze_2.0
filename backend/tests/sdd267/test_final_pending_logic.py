"""SDD-267 — final_pending 보조 표기 순수 함수 시험 (V-P01~P20)."""

from datetime import datetime, timedelta, timezone

import pytest

from app.services import upload_progress_service as ps

A = datetime(2026, 11, 4, 5, 10, 0, tzinfo=timezone.utc)


def exp(feature=100, eeg=50, ppg=20, acc=20, final=False, first=A - timedelta(hours=1)):
    return ps.ExpectedSnapshot(feature=feature, raw={"eeg": eeg, "ppg": ppg, "acc": acc}, final=final,
                               first_reported_at=first)


def build(expected="auto", *, feature=100, eeg=50, ppg=20, acc=20, failed=0, last_ago=130, excluded=False,
          status="completed", ended_ago=181):
    return ps.build_participant_progress(ps.ProgressInput(
        excluded=excluded, has_data=True, expected=exp() if expected == "auto" else expected,
        feature_received=feature, raw_received={"eeg": eeg, "ppg": ppg, "acc": acc}, raw_failed=failed,
        last_received_at=None if last_ago is None else A - timedelta(seconds=last_ago),
        session_status=status, ended_at=None if ended_ago is None else A - timedelta(seconds=ended_ago), as_of=A))


def test_P01_네_조건_충족():
    p = build()
    assert p.final_pending is True and p.state == "in_progress"


@pytest.mark.parametrize("ago,want", [(179, False), (180, True), (181, True)])
def test_P02_P03_종료후_경계(ago, want):
    assert build(ended_ago=ago).final_pending is want


def test_P04_P05_회차_종료_전_또는_종료시각_없음():
    assert build(status="in_progress", ended_ago=None).final_pending is False
    assert build(status="completed", ended_ago=None).final_pending is False


@pytest.mark.parametrize("ago,want", [(119, False), (120, True), (121, True)])
def test_P06_P07_수신_정체_경계(ago, want):
    assert build(last_ago=ago).final_pending is want


@pytest.mark.parametrize("first_ago,want", [(119, False), (120, True)])
def test_P08_수신_없음은_첫_보고_기준(first_ago, want):
    p = build(expected=exp(first=A - timedelta(seconds=first_ago)), last_ago=None, feature=100)
    assert p.final_pending is want


def test_P09_feature_부족():
    assert build(feature=99).final_pending is False


@pytest.mark.parametrize("sig", ["eeg", "ppg", "acc"])
def test_P10_raw_신호별_부족(sig):
    kw = {"eeg": 50, "ppg": 20, "acc": 20}
    kw[sig] -= 1
    assert build(**kw).final_pending is False


def test_P11_초과_수신은_충족():
    assert build(feature=150, eeg=60).final_pending is True


def test_P12_final_true는_해당없음():
    p = build(expected=exp(final=True))
    assert p.state == "all_received" and p.final_pending is False


def test_P13_P14_기대량_없음_또는_일부_미보고():
    p = build(expected=None)
    assert p.final_pending is False and p.state == "expected_unknown"
    e = ps.ExpectedSnapshot(feature=100, raw={"eeg": 50, "ppg": None, "acc": 20}, final=False, first_reported_at=A)
    assert build(expected=e).final_pending is False


def test_P15_수집제외():
    p = ps.build_participant_progress(ps.ProgressInput(
        excluded=True, has_data=False, expected=None, feature_received=0, raw_received={}, raw_failed=0,
        last_received_at=None, session_status="completed", ended_at=A - timedelta(hours=1), as_of=A))
    assert p.state == "not_collected" and p.final_pending is False


def test_P16_업로드_실패는_해당없음():
    assert build(failed=1).final_pending is False


def test_P17_30분_유예_후에도_표기하되_state_불변():
    p = build(ended_ago=45 * 60)
    assert p.state == "expected_unknown" and p.final_pending is True


def test_P18_판정_불변_final_pending이_state를_바꾸지_않는다():
    base = build(ended_ago=181)
    early = build(ended_ago=60)
    assert base.final_pending and not early.final_pending
    assert base.state == early.state == "in_progress"
    assert base.model_dump(exclude={"final_pending"}) == early.model_dump(exclude={"final_pending"})


def test_P19_P20_합계_가산과_불변식():
    plist = [build(), build(), build(feature=10), build(expected=exp(final=True))]
    agg = ps.aggregate(plist)
    c = agg.participants
    assert c.final_pending == 2
    assert (c.total, c.counted, c.all_received, c.in_progress, c.needs_attention) == (4, 4, 1, 2, 1)
    assert c.all_received + c.in_progress + c.needs_attention + c.expected_unknown == c.counted
    merged = ps.merge([ps.aggregate(plist[:2]), ps.aggregate(plist[2:])])
    assert merged.participants == c


def test_P25_금지_필드_없음():
    keys = set(ps.ParticipantProgress.model_fields) | set(ps.ParticipantCounts.model_fields)
    assert not {k for k in keys if any(w in k for w in ("score", "grade", "guarantee", "quality"))}
    assert ps.ParticipantProgress.model_fields["final_pending"].annotation is bool
    assert ps.ParticipantCounts.model_fields["final_pending"].annotation is int
