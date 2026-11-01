"""SDD-265 T1·T2 — 순수 계산(길이·바이트 추정·인원·분 환산)과 cursor 코덱 (V-R07, R21~R23, R25~R30)."""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.services import upload_metrics_service as m

NOW = datetime(2026, 11, 4, 5, 10, 0, tzinfo=timezone.utc)


# ── 길이 (V-R25~R28) ──────────────────────────────────────────────
def test_V_R25_종료_회차_길이():
    s = NOW - timedelta(minutes=60)
    assert m.duration_minutes(s, s + timedelta(minutes=52), "completed", NOW) == 52


def test_V_R25_초_반올림():
    s = NOW - timedelta(minutes=60)
    assert m.duration_minutes(s, s + timedelta(minutes=52, seconds=40), "completed", NOW) == 53
    assert m.duration_minutes(s, s + timedelta(minutes=52, seconds=20), "completed", NOW) == 52


def test_V_R26_진행_중은_경과():
    assert m.duration_minutes(NOW - timedelta(minutes=17), None, "in_progress", NOW) == 17


def test_V_R27_시작_없음_null():
    assert m.duration_minutes(None, None, "in_progress", NOW) is None
    assert m.duration_minutes(None, NOW, "completed", NOW) is None


def test_V_R28_종료_없는_완료_회차_null():
    assert m.duration_minutes(NOW - timedelta(hours=2), None, "completed", NOW) is None


def test_길이_음수는_0():
    assert m.duration_minutes(NOW, NOW - timedelta(minutes=5), "completed", NOW) == 0


def test_naive_datetime도_UTC로_처리():
    s = datetime(2026, 11, 4, 4, 0, 0)
    e = datetime(2026, 11, 4, 4, 30, 0)
    assert m.duration_minutes(s, e, "completed", NOW) == 30


# ── 바이트 추정 (V-R21~R23) ───────────────────────────────────────
def _stat(raw=None, feature=(0, 0), other=0):
    return m.BytesStat(raw=raw or {}, feature_bytes=feature[0], feature_rows=feature[1], other_bytes=other)


def _part(status="received_unreconciled", feature_received=0, feature_expected=None, signals=None):
    sigs = signals or {}
    return SimpleNamespace(
        status=status,
        feature=SimpleNamespace(received=feature_received, expected=feature_expected),
        raw=SimpleNamespace(signals=[
            SimpleNamespace(signal_type=n, uploaded=sigs.get(n, (0, None))[0], expected=sigs.get(n, (0, None))[1])
            for n in ("eeg", "ppg", "acc")]),
    )


def test_V_R21_기대_바이트_평균_청크_기반():
    part = _part(feature_received=100, feature_expected=200,
                 signals={"eeg": (10, 20), "ppg": (5, 5), "acc": (5, 5)})
    stat = _stat(raw={"eeg": (1000, 10), "ppg": (500, 5), "acc": (250, 5)}, feature=(2000, 100), other=40)
    pm = m.participant_metrics(part, stat)
    # eeg 100*20=2000, ppg 100*5=500, acc 50*5=250, feature 20*200=4000, other 40
    assert pm.bytes_arrived == 1000 + 500 + 250 + 2000 + 40
    assert pm.bytes_expected == 2000 + 500 + 250 + 4000 + 40


def test_V_R22_기대_미보고는_null():
    part = _part(feature_received=100, feature_expected=None, signals={"eeg": (10, None)})
    pm = m.participant_metrics(part, _stat(raw={"eeg": (1000, 10)}, feature=(2000, 100)))
    assert pm.bytes_arrived == 3000 and pm.bytes_expected is None


def test_V_R22_일부_신호만_미보고여도_null():
    part = _part(feature_received=10, feature_expected=10, signals={"eeg": (4, 4), "ppg": (2, None), "acc": (2, 2)})
    pm = m.participant_metrics(part, _stat(raw={"eeg": (40, 4), "ppg": (20, 2), "acc": (20, 2)}, feature=(100, 10)))
    assert pm.bytes_expected is None


def test_기대_0이면_0_바이트로_본다():
    part = _part(feature_received=0, feature_expected=0, signals={"eeg": (0, 0), "ppg": (0, 0), "acc": (0, 0)})
    pm = m.participant_metrics(part, None)
    assert pm.bytes_arrived == 0 and pm.bytes_expected == 0


def test_근거_없는_신호는_null():
    # 기대 청크는 있는데 도착 청크가 없어 청크 크기를 알 수 없다
    part = _part(feature_received=0, feature_expected=0, signals={"eeg": (0, 30), "ppg": (0, 0), "acc": (0, 0)})
    assert m.participant_metrics(part, None).bytes_expected is None


def test_기대가_도착보다_작아도_도착_이상():
    part = _part(feature_received=10, feature_expected=5, signals={"eeg": (10, 4), "ppg": (0, 0), "acc": (0, 0)})
    pm = m.participant_metrics(part, _stat(raw={"eeg": (100, 10)}, feature=(50, 10)))
    assert pm.bytes_expected >= pm.bytes_arrived


def test_크기_NULL_청크는_평균에서_제외():
    part = _part(feature_received=0, feature_expected=0, signals={"eeg": (10, 10), "ppg": (0, 0), "acc": (0, 0)})
    # 업로드 10건 중 크기가 있는 건 5건(500B) → 평균 100B
    pm = m.participant_metrics(part, _stat(raw={"eeg": (500, 5)}))
    assert pm.bytes_arrived == 500 and pm.bytes_expected == 1000


# ── 인원·분 (V-R29, R30) ──────────────────────────────────────────
def test_V_R30_도착_인원은_제외_상태_빼고_센다():
    sig = {"eeg": (3, 3), "ppg": (0, 0), "acc": (0, 0)}
    pms = [
        m.participant_metrics(_part(feature_received=5, feature_expected=5, signals=sig), _stat(raw={"eeg": (30, 3)}, feature=(5, 5))),
        m.participant_metrics(_part(status="no_data"), None),
        m.participant_metrics(_part(status="excluded"), None),
        m.participant_metrics(_part(status="excluded"), None),
    ]
    roll = m.rollup(pms)
    assert roll.participants_expected == 2 and roll.participants_arrived == 1


def test_V_R29_참여자_분_합계는_창_합을_60으로_나눈_내림():
    pms = [m.participant_metrics(_part(feature_received=n), None) for n in (3600, 1800, 90)]
    assert m.rollup(pms).participant_minutes_total == 91  # 5490초 // 60


def test_합계_기대_바이트는_하나라도_모르면_null():
    ok = m.PMetrics(excluded=False, arrived=True, bytes_arrived=10, bytes_expected=20, windows=0)
    unk = m.PMetrics(excluded=False, arrived=True, bytes_arrived=5, bytes_expected=None, windows=0)
    roll = m.rollup([ok, unk])
    assert roll.bytes_arrived == 15 and roll.bytes_expected is None and roll.bytes_basis is None


def test_합계_기대_바이트는_제외_참여자_무시():
    ok = m.PMetrics(excluded=False, arrived=True, bytes_arrived=10, bytes_expected=20, windows=0)
    ex = m.PMetrics(excluded=True, arrived=False, bytes_arrived=0, bytes_expected=None, windows=0)
    roll = m.rollup([ok, ex])
    assert roll.bytes_expected == 20 and roll.bytes_basis == "estimate"


def test_대상_없으면_기대_null():
    ex = m.PMetrics(excluded=True, arrived=False, bytes_arrived=0, bytes_expected=None, windows=0)
    assert m.rollup([ex]).bytes_expected is None and m.rollup([]).bytes_expected is None


# ── cursor (V-R07) ────────────────────────────────────────────────
def test_cursor_왕복():
    sid = uuid.uuid4()
    token = m.encode_cursor(1, NOW, sid)
    g, eff, back = m.decode_cursor(token)
    assert (g, eff, back) == (1, NOW, sid)


def test_cursor_naive는_UTC로_인코딩():
    token = m.encode_cursor(0, datetime(2026, 11, 4, 5, 10, 0), uuid.uuid4())
    assert m.decode_cursor(token)[1] == NOW


@pytest.mark.parametrize("bad", ["", "!!!", "abc", "e30", "W10", "WzEsIngiLCJ4Il0",
                                 m.encode_cursor(2, NOW, uuid.uuid4())])
def test_V_R07_잘못된_cursor는_ValueError(bad):
    with pytest.raises(ValueError):
        m.decode_cursor(bad)
