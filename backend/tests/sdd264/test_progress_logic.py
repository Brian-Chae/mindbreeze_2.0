"""SDD-264 B4 — 진행 판정·합계 순수 함수 시험 (V-X3~X7, X23~X31, X33, X39~X41).

DB 없이 입력→출력만 본다. 정답은 시험 안에서 독립 계산한다.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.services import upload_progress_service as ps

AS_OF = datetime(2026, 11, 4, 5, 10, 0, tzinfo=timezone.utc)
ENDED_LONG_AGO = AS_OF - timedelta(minutes=45)


def exp(feature=100, eeg=50, ppg=20, acc=20, final=False, first=AS_OF - timedelta(seconds=30)):
    return ps.ExpectedSnapshot(feature=feature, raw={"eeg": eeg, "ppg": ppg, "acc": acc}, final=final,
                               first_reported_at=first)


def inp(expected="auto", *, feature=100, eeg=50, ppg=20, acc=20, failed=0, last=AS_OF - timedelta(seconds=5),
        excluded=False, has_data=True, status="in_progress", ended=None):
    return ps.ProgressInput(
        excluded=excluded, has_data=has_data, expected=exp() if expected == "auto" else expected,
        feature_received=feature, raw_received={"eeg": eeg, "ppg": ppg, "acc": acc}, raw_failed=failed,
        last_received_at=last, session_status=status, ended_at=ended, as_of=AS_OF)


def build(**kw):
    return ps.build_participant_progress(inp(**kw))


# ── percent / 수식 (V-X7, V-X41) ──────────────────────────────────
@pytest.mark.parametrize("e,r,want", [
    (1000, 999, 99.9), (1000, 1000, 100.0), (1000, 1500, 100.0), (3, 1, 33.3), (3, 2, 66.6),
    (0, 0, None), (0, 5, None), (None, 5, None), (200, 0, 0.0),
])
def test_percent_내림_상한_분모0은_null(e, r, want):
    assert ps.percent(e, r) == want


# ── 상태 (V-X6, X23, X25~X31, X33) ────────────────────────────────
def test_모두_수신은_final_이고_부족분_없을때만():
    assert build(expected=exp(final=True)).state == "all_received"
    assert build(expected=exp(final=False)).state == "in_progress"   # 아직 더 만들 수 있음
    assert build(expected=exp(final=True), feature=99).state == "in_progress"


def test_V_X23_보고_없으면_기대량_미확인():
    p = build(expected=None)
    assert p.state == "expected_unknown"
    assert p.feature.expected is None and p.feature.percent is None and p.feature.received == 100
    assert p.total.expected is None and p.total.percent is None


def test_raw_미보고_신호가_하나라도_있으면_기대량_미확인():
    e = ps.ExpectedSnapshot(feature=100, raw={"eeg": 50, "ppg": None, "acc": None}, final=True,
                            first_reported_at=AS_OF)
    p = ps.build_participant_progress(inp(expected=e))
    assert p.state == "expected_unknown"
    assert p.feature.expected == 100 and p.raw.eeg.expected == 50 and p.raw.ppg.expected is None


def test_V_X25_수집_제외이고_수신_0이면_not_collected():
    p = build(expected=None, excluded=True, has_data=False, feature=0, eeg=0, ppg=0, acc=0, last=None)
    assert p.state == "not_collected"


def test_V_X26_수집_제외여도_수신_기록이_있으면_판정_계속():
    assert build(expected=None, excluded=True, has_data=True).state == "expected_unknown"
    assert build(expected=exp(final=True), excluded=True, has_data=True).state == "all_received"


def test_V_X27_모두_0_보고는_final_이면_모두_수신():
    p = build(expected=ps.ExpectedSnapshot(0, {"eeg": 0, "ppg": 0, "acc": 0}, True, AS_OF),
              feature=0, eeg=0, ppg=0, acc=0, last=None)
    assert p.state == "all_received"
    assert p.total.expected == 0 and p.total.percent is None


def test_V_X29_종료_30분_경과_final_false_는_기대량_미확인():
    assert build(expected=exp(final=False), status="completed", ended=ENDED_LONG_AGO).state == "expected_unknown"
    # final=true 면 영향 없음
    assert build(expected=exp(final=True), status="completed", ended=ENDED_LONG_AGO).state == "all_received"
    # 종료 29분이면 아직 아님
    recent = AS_OF - timedelta(minutes=29)
    assert build(expected=exp(final=False), status="completed", ended=recent).state == "in_progress"


def test_V_X30_부족분_정체는_확인_필요_수신_중이면_진행_중():
    stalled = AS_OF - timedelta(seconds=ps.STALL_SEC)
    assert build(feature=90, last=stalled).state == "needs_attention"
    assert build(feature=90, last=stalled + timedelta(seconds=1)).state == "in_progress"
    assert build(feature=100, last=stalled).state == "in_progress"      # 부족분 없으면 정체 무관


def test_V_X31_수신_0이면_보고_후_120초부터_정체():
    old = AS_OF - timedelta(seconds=ps.STALL_SEC)
    young = AS_OF - timedelta(seconds=ps.STALL_SEC - 1)
    zero = dict(feature=0, eeg=0, ppg=0, acc=0, last=None)
    assert build(expected=exp(first=old), **zero).state == "needs_attention"
    assert build(expected=exp(first=young), **zero).state == "in_progress"


def test_V_X33_원시_failed_와_부족분이면_정체_무관_확인_필요():
    assert build(eeg=40, failed=2).state == "needs_attention"
    assert build(failed=2).state == "in_progress"                       # 부족분 없으면 failed 만으로는 아님


# ── 컴포넌트 · 총합 (V-X3) ────────────────────────────────────────
def test_V_X3_신호별_부족분이_섞이지_않는다():
    p = build(feature=100, eeg=10, ppg=20, acc=0)
    assert (p.raw.eeg.expected, p.raw.eeg.received, p.raw.eeg.percent) == (50, 10, 20.0)
    assert (p.raw.ppg.expected, p.raw.ppg.received, p.raw.ppg.percent) == (20, 20, 100.0)
    assert (p.raw.acc.expected, p.raw.acc.received, p.raw.acc.percent) == (20, 0, 0.0)
    assert (p.total.expected, p.total.received) == (190, 130)


def test_초과_수신은_표시값은_그대로_합은_상한():
    p = build(feature=120)
    assert p.feature.received == 120 and p.feature.percent == 100.0
    # feature 120→100 으로 상한, raw 는 그대로: 100 + 50 + 20 + 20
    assert p.total.received == 190 and p.total.expected == 190


# ── 합계 aggregate (V-X4, X5, X24, X39~X41) ───────────────────────
def mk(feature_e, feature_r, final=True, *, raw=(0, 0)):
    e = ps.ExpectedSnapshot(feature_e, {"eeg": raw[0], "ppg": 0, "acc": 0}, final, AS_OF - timedelta(seconds=10))
    return ps.build_participant_progress(ps.ProgressInput(
        excluded=False, has_data=True, expected=e, feature_received=feature_r,
        raw_received={"eeg": raw[1], "ppg": 0, "acc": 0}, raw_failed=0, last_received_at=AS_OF - timedelta(seconds=3),
        session_status="in_progress", ended_at=None, as_of=AS_OF))


def test_V_X4_합계_독립_계산과_일치():
    plist = [mk(100, 100), mk(200, 150), mk(0, 0)]
    agg = ps.aggregate(plist)
    assert (agg.feature.expected, agg.feature.received, agg.feature.percent) == (300, 250, 83.3)
    assert agg.participants.total == 3 and agg.participants.counted == 3
    assert agg.participants.all_received == 2 and agg.participants.in_progress == 1


def test_V_X5_초과_수신이_다른_참여자_부족분을_가리지_않는다():
    agg = ps.aggregate([mk(100, 120), mk(100, 50)])
    assert (agg.feature.expected, agg.feature.received, agg.feature.percent) == (200, 150, 75.0)


def test_V_X24_기대량_미확인은_분모에서_빠지지_않고_따로_센다():
    unknown = ps.build_participant_progress(inp(expected=None))
    agg = ps.aggregate([mk(100, 100), unknown])
    assert agg.participants.total == 2 and agg.participants.counted == 2
    assert agg.participants.expected_unknown == 1 and agg.participants.all_received == 1
    # 미보고 컴포넌트는 합계에 안 들어간다
    assert agg.feature.expected == 100


def test_not_collected_는_모든_합계와_counted_에서_제외():
    nc = ps.build_participant_progress(inp(expected=None, excluded=True, has_data=False, feature=0, eeg=0, ppg=0,
                                           acc=0, last=None))
    agg = ps.aggregate([mk(100, 100), nc])
    assert agg.participants.total == 2 and agg.participants.counted == 1 and agg.participants.not_collected == 1
    s = agg.participants
    assert s.all_received + s.in_progress + s.needs_attention + s.expected_unknown == s.counted


def test_V_X28_기대합_0_이면_percent_null_보고자_없으면_expected_null():
    agg = ps.aggregate([mk(0, 0)])
    assert agg.feature.expected == 0 and agg.feature.percent is None
    empty = ps.aggregate([])
    assert empty.feature.expected is None and empty.feature.received == 0 and empty.overall.percent is None
    assert empty.participants.total == 0


def test_V_X7_999_of_1000_은_99_9_퍼센트_모두수신_아님():
    p = mk(1000, 999)
    assert p.feature.percent == 99.9 and p.state == "in_progress"
    assert ps.aggregate([p]).feature.percent != 100.0


def test_overall_은_feature_와_raw_신호의_상한_합():
    agg = ps.aggregate([mk(100, 100, raw=(50, 30))])
    assert agg.overall.expected == 150 and agg.overall.received == 130
    assert agg.overall.percent == 86.6


def test_V_X39_merge_는_aggregate_와_같은_수치():
    a, b = [mk(100, 80), mk(50, 50)], [mk(200, 150), mk(10, 10, final=False)]
    merged = ps.merge([ps.aggregate(a), ps.aggregate(b)])
    whole = ps.aggregate(a + b)
    assert merged.model_dump() == whole.model_dump()


def test_merge_는_보고_없는_회차를_분모로_세지_않는다():
    unknown = ps.aggregate([ps.build_participant_progress(inp(expected=None))])
    full = ps.aggregate([mk(100, 100)])
    m = ps.merge([unknown, full])
    assert m.feature.expected == 100 and m.participants.expected_unknown == 1 and m.participants.total == 2
