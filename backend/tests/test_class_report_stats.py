"""SDD-237 B2: 클래스 6지표 통계 서비스 (순수 계산부).

verify C1~C8, S1~S7·S16~S18. 입력은 합성 윈도우뿐이며 DB·네트워크를 쓰지 않는다.
"""

import math
import random

import pytest

from app.services import class_report_stats_service as stats
from app.services.class_report_stats_service import ParticipantInput, StatWindow

SESSION_SEC = 45 * 60


def W(pid, i, *, sec=None, seg=None, quality="valid", **vals):
    """윈도우 1개. sec 생략 시 window_index 와 같은 초."""
    base = dict(respiratory_rate=None, heart_rate=None, sdnn=None,
                focus_index=None, relaxation_index=None, emotional_stability=None)
    base.update(vals)
    return StatWindow(participant_id=pid, window_index=i, play_group_id=seg, quality=quality,
                      rel_sec=i if sec is None else sec, **base)


def person(pid, n, *, start=0, seg=None, status="valid", version="v1", intent="yes", **vals):
    """n 초짜리 연속 윈도우. 값이 callable 이면 인덱스에 대한 함수."""
    wins = []
    for k in range(n):
        v = {name: (f(k) if callable(f) else f) for name, f in vals.items()}
        wins.append(W(pid, start + k, seg=seg, **v))
    return ParticipantInput(participant_id=pid, windows=wins, eeg_status=status,
                            norm_version=version, intent=intent)


def run(people, *, attended=None, session_sec=SESSION_SEC, duration_min=45):
    return stats.compute_stats(people, attended=attended if attended is not None else len(people),
                               session_sec=session_sec, duration_min=duration_min)


ALL_MIND = dict(focus_index=50.0, relaxation_index=40.0, emotional_stability=60.0)


# ── C1·C2 동등 가중 평균, 범위=개인 평균의 극값 ─────────────────────────
def test_평균은_참여자_동등_가중이라_오래_측정한_사람이_지배하지_않는다():
    a = person("a", 600, focus_index=50.0)   # 10분
    b = person("b", 120, focus_index=70.0)   # 2분
    m = run([a, b])["metrics"]["focus"]
    assert m["state"] == "ok"
    assert m["mean"] == pytest.approx(60.0)  # 가중이면 51.x 였을 것
    assert m["measured"] == 2


def test_범위는_개인_회차_평균의_최소_최대다_표본_극값이_아니다():
    a = person("a", 200, focus_index=lambda k: 10.0 if k < 100 else 90.0)  # 평균 50
    b = person("b", 200, focus_index=60.0)
    c = person("c", 200, focus_index=40.0)
    m = run([a, b, c])["metrics"]["focus"]
    assert (m["min"], m["max"]) == (pytest.approx(40.0), pytest.approx(60.0))


# ── P2·S2 측정 2명 미만 ────────────────────────────────────────────
def test_측정_1명이면_single이고_평균_범위_변화_시계열이_없다():
    a = person("a", 300, **ALL_MIND)
    res = run([a], attended=4)
    f = res["metrics"]["focus"]
    assert f["state"] == "single" and f["measured"] == 1
    for key in ("mean", "min", "max", "early", "late", "delta", "direction",
                "valid_min", "valid_ratio", "agreement"):
        assert f[key] is None, key
    assert f["series"] == []
    assert res["status"] == "single"


def test_결측은_0으로_채우지_않는다():
    a = person("a", 300, **ALL_MIND)
    b = person("b", 300, **ALL_MIND)
    res = run([a, b])
    h = res["metrics"]["hrv"]  # sdnn 값이 아예 없음
    assert h["mean"] is None and h["state"] != "ok" and h["series"] == []


# ── C6·S18 유효 초 경계/중복 ──────────────────────────────────────
def test_유효_59초는_측정_제외_60초는_측정():
    p59 = person("a", 59, focus_index=50.0)
    p60 = person("b", 60, focus_index=50.0)
    p60b = person("c", 60, focus_index=50.0)
    res = run([p59, p60, p60b])
    f = res["metrics"]["focus"]
    assert f["measured"] == 2
    states = {p["participant_id"]: p["state"] for p in res["participants"]}
    assert states["a"] == "poor_signal"  # 윈도우는 있으나 측정 기준 미달
    assert states["b"] == "measured"


def test_같은_초의_윈도우_여러_개는_1초로_센다():
    wins = [W("a", i, sec=i // 100, focus_index=50.0) for i in range(6000)]  # 60개 고유 초... 아님
    # 6000개를 100개씩 묶어 60초 → 정확히 60 고유 초
    a = ParticipantInput("a", wins, "valid", "v1", "yes")
    b = person("b", 60, focus_index=50.0)
    f = run([a, b])["metrics"]["focus"]
    assert f["measured"] == 2
    assert f["valid_min"] == pytest.approx(1.0)  # (60+60)/2/60

    short = ParticipantInput("a", [W("a", i, sec=0, focus_index=50.0) for i in range(100)], "valid", "v1", "yes")
    f2 = run([short, b])["metrics"]["focus"]
    assert f2["measured"] == 1  # 100개여도 1초


def test_유효_초는_세션_길이를_넘지_않게_자른다():
    a = person("a", 200, focus_index=50.0)
    b = person("b", 200, focus_index=50.0)
    res = run([a, b], session_sec=100, duration_min=2)
    assert res["metrics"]["focus"]["valid_ratio"] == pytest.approx(1.0)


def test_품질이_invalid인_윈도우와_EEG_세션상태가_불량이면_마음_지표에서_빠지고_몸_지표는_유지():
    bad = person("a", 300, status="invalid", respiratory_rate=14.0, **ALL_MIND)
    ok = person("b", 300, respiratory_rate=12.0, **ALL_MIND)
    ok2 = person("c", 300, respiratory_rate=12.0, **ALL_MIND)
    res = run([bad, ok, ok2])
    assert res["metrics"]["focus"]["measured"] == 2
    assert res["metrics"]["respiration"]["measured"] == 3
    low = ParticipantInput("d", [W("d", i, quality="invalid", focus_index=50.0) for i in range(300)],
                           "valid", "v1", "yes")
    assert run([low, ok, ok2])["metrics"]["focus"]["measured"] == 2


# ── C4·S18 전후반 ────────────────────────────────────────────────
def test_전반_후반_변화량과_방향():
    a = person("a", 300, focus_index=lambda k: 40.0 if k < 150 else 60.0)
    b = person("b", 300, focus_index=lambda k: 50.0 if k < 150 else 70.0)
    f = run([a, b])["metrics"]["focus"]
    assert (f["early"], f["late"]) == (pytest.approx(45.0), pytest.approx(65.0))
    assert f["delta"] == pytest.approx(20.0)
    assert f["direction"] == "up" and f["compared"] == 2


def _gapped(pid, early_sec, late_sec):
    """한 세그먼트에서 window_index 간격을 벌려 전반=early_sec, 후반=late_sec 초가 되게 만든다."""
    wins = [W(pid, i, seg="g1", focus_index=40.0) for i in range(early_sec)]
    wins += [W(pid, 1000 + i, sec=early_sec + i, seg="g1", focus_index=60.0) for i in range(late_sec)]
    return ParticipantInput(pid, wins, "valid", "v1", "yes")


def test_후반이_29초면_측정은_돼도_비교_인원에서_빠지고_30초면_들어간다():
    ok = _gapped("a", 60, 30)
    short = _gapped("b", 60, 29)
    ok2 = _gapped("c", 60, 30)
    f = run([ok, short, ok2])["metrics"]["focus"]
    assert f["measured"] == 3
    assert f["compared"] == 2
    assert f["direction"] == "up"
    # 비교 불가인 사람의 early/late 는 클래스 early/late 에 기여하지 않는다
    assert (f["early"], f["late"]) == (pytest.approx(40.0), pytest.approx(60.0))


def test_전체가_60초_미만이면_전후가_각_30초여도_측정_제외():
    a = _gapped("a", 29, 30)  # 59초
    b = _gapped("b", 60, 30)
    c = _gapped("c", 60, 30)
    assert run([a, b, c])["metrics"]["focus"]["measured"] == 2


def test_세그먼트_pause_resume은_세그먼트별로_전후를_나눠_동일_가중한다():
    # g1: 값 10(전반)→20(후반), g2: 값 30→40. 세그먼트 평균 동일 가중: early=(10+30)/2=20, late=(20+40)/2=30
    wins = []
    for seg, lo, hi, off in (("g1", 10.0, 20.0, 0), ("g2", 30.0, 40.0, 1000)):
        for i in range(60):
            wins.append(W("a", i, sec=off + i, seg=seg, focus_index=lo if i < 30 else hi))
    a = ParticipantInput("a", wins, "valid", "v1", "yes")
    b = person("b", 120, focus_index=lambda k: 20.0 if k < 60 else 30.0)
    f = run([a, b])["metrics"]["focus"]
    assert f["early"] == pytest.approx(20.0) and f["late"] == pytest.approx(30.0)


# ── C5 방향 임계 경계값 ──────────────────────────────────────────
@pytest.mark.parametrize("key,early,delta,expected", [
    ("respiration", 14.0, 0.99, "stable"), ("respiration", 14.0, 1.0, "up"), ("respiration", 14.0, -1.0, "down"),
    ("bpm", 70.0, 2.99, "stable"), ("bpm", 70.0, 3.0, "up"), ("bpm", 70.0, -3.01, "down"),
    ("hrv", 40.0, 4.99, "stable"), ("hrv", 40.0, 5.0, "up"), ("hrv", 40.0, -5.0, "down"),
    ("focus", 50.0, 2.49, "stable"),   # 5% of 50 = 2.5
    ("focus", 50.0, 2.5, "up"), ("focus", 50.0, -2.51, "down"),
    ("relaxation", 40.0, 1.99, "stable"), ("relaxation", 40.0, 2.0, "up"),
    ("emotional", 60.0, -2.99, "stable"), ("emotional", 60.0, -3.0, "down"),
])
def test_direction_for_임계값_경계(key, early, delta, expected):
    assert stats.direction_for(key, early, early + delta) == expected


def test_direction_for_결측이면_None():
    assert stats.direction_for("focus", None, 3.0) is None
    assert stats.direction_for("focus", 3.0, None) is None


def test_EEG_변화량_단위는_퍼센트포인트이고_몸_지표는_원_단위():
    assert stats.METRIC_UNITS == {"respiration": "회/분", "bpm": "bpm", "hrv": "ms",
                                  "focus": "%", "relaxation": "%", "emotional": "%"}


# ── C8 방향 분포 ────────────────────────────────────────────────
def test_방향_분포는_비교_3명_이상일_때만():
    def p(pid, lo, hi):
        return person(pid, 200, focus_index=lambda k: lo if k < 100 else hi)
    two = run([p("a", 40, 60), p("b", 40, 60)])["metrics"]["focus"]
    assert two["agreement"] is None
    three = run([p("a", 40, 60), p("b", 40, 60), p("c", 60, 40), p("d", 50, 50)])["metrics"]["focus"]
    assert three["agreement"] == {"up": 2, "stable": 1, "down": 1}


# ── C7 시계열 ───────────────────────────────────────────────────
def test_시계열_버킷은_5분이고_측정_2명_미만_버킷은_v가_null():
    a = person("a", 600, focus_index=50.0)               # 0~10분
    b = person("b", 300, focus_index=70.0)               # 0~5분만
    res = run([a, b])
    f = res["metrics"]["focus"]
    assert res["scope"]["bucket_min"] == 5
    s = {pt["t_min"]: pt for pt in f["series"]}
    assert s[0]["v"] == pytest.approx(60.0) and s[0]["n"] == 2
    assert s[5]["v"] is None and s[5]["n"] == 1


def test_30분_미만_수업은_2분_버킷():
    a = person("a", 600, focus_index=50.0)
    b = person("b", 600, focus_index=50.0)
    res = run([a, b], session_sec=20 * 60, duration_min=20)
    assert res["scope"]["bucket_min"] == 2
    assert [pt["t_min"] for pt in res["metrics"]["focus"]["series"]][:3] == [0, 2, 4]


def test_연결이_끊긴_구간의_버킷은_v가_null이고_선을_잇지_않는다():
    gap = [W("a", i, focus_index=50.0) for i in range(300)] + [W("a", 600 + i, focus_index=50.0) for i in range(300)]
    a = ParticipantInput("a", gap, "valid", "v1", "yes")
    b = person("b", 900, focus_index=50.0)
    s = {pt["t_min"]: pt for pt in run([a, b])["metrics"]["focus"]["series"]}
    assert s[5]["n"] == 1 and s[5]["v"] is None
    assert s[0]["v"] is not None and s[10]["v"] is not None


# ── C6 유효 시간/비율 ───────────────────────────────────────────
def test_유효_시간은_참여자_평균_고유초_분이고_비율은_세션초_대비():
    a = person("a", 600, focus_index=50.0)   # 10분
    b = person("b", 1200, focus_index=50.0)  # 20분
    f = run([a, b], session_sec=2400, duration_min=40)["metrics"]["focus"]
    assert f["valid_min"] == pytest.approx(15.0)
    assert f["valid_ratio"] == pytest.approx((600 / 2400 + 1200 / 2400) / 2)


# ── C3 정규화 버전 ──────────────────────────────────────────────
def test_정규화_버전이_섞이면_마음_지표는_평균하지_않는다_몸은_유지():
    a = person("a", 300, version="v1", respiratory_rate=14.0, **ALL_MIND)
    b = person("b", 300, version="v2", respiratory_rate=12.0, **ALL_MIND)
    res = run([a, b])
    f = res["metrics"]["focus"]
    assert f["mean"] is None and f["missing_reason"] == "normalization_mismatch"
    assert res["metrics"]["respiration"]["state"] == "ok"
    assert res["normalization_version"] is None


def test_같은_버전이면_기록한다():
    a = person("a", 300, version="v3", **ALL_MIND)
    b = person("b", 300, version="v3", **ALL_MIND)
    assert run([a, b])["normalization_version"] == "v3"


# ── §2.1 상태 코드 ──────────────────────────────────────────────
def _six(pid, n=300, **extra):
    return person(pid, n, respiratory_rate=14.0, heart_rate=70.0, sdnn=40.0, **ALL_MIND, **extra)


def test_상태_measured():
    res = run([_six("a"), _six("b"), _six("c")])
    assert res["status"] == "measured" and res["flags"] == []


def test_상태_zero_출석_0():
    res = run([], attended=0)
    assert res["status"] == "zero"
    assert all(m["state"] == "missing" for m in res["metrics"].values())


def test_상태_unworn_측정자_0이고_유실_0():
    res = run([person("a", 0, intent="no"), person("b", 0, intent="no")], attended=2)
    assert res["status"] == "unworn"
    assert {p["state"] for p in res["participants"]} == {"unworn"}
    assert all(m["state"] == "unworn" for m in res["metrics"].values())


def test_상태_lost_측정자_0이고_유실만():
    res = run([person("a", 0, intent="yes"), person("b", 0, intent="no")], attended=2)
    assert res["status"] == "lost"
    assert {p["participant_id"]: p["state"] for p in res["participants"]} == {"a": "lost", "b": "unworn"}


def test_상태_single_측정자_1():
    res = run([_six("a"), person("b", 0, intent="no")], attended=2)
    assert res["status"] == "single"


def test_상태_poor_signal_측정자_2이상인데_일부_지표만_1명():
    a = _six("a")
    b = _six("b")
    c = person("c", 300, respiratory_rate=14.0, heart_rate=70.0, **ALL_MIND)  # sdnn 없음
    res = run([a, b, c])
    assert res["metrics"]["hrv"]["state"] == "ok"  # a,b 두 명이면 ok
    assert res["status"] == "measured"
    d = person("d", 300, **ALL_MIND)
    e = person("e", 300, **ALL_MIND)
    res2 = run([_six("a"), d, e])  # hrv 는 a 1명만
    assert res2["status"] == "poor_signal"
    assert res2["metrics"]["hrv"]["state"] == "poor_signal"
    assert res2["metrics"]["hrv"]["missing_reason"] == "signal_insufficient"
    assert res2["metrics"]["focus"]["state"] == "ok"


def test_상태_partial_측정자가_대상의_절반_이하():
    res = run([_six("a"), _six("b"), person("c", 0, intent="no"), person("d", 0, intent="no")], attended=4)
    assert res["status"] == "partial" and "partial" in res["flags"]


def test_과반_측정이면_일부_미착용이어도_measured_이고_flags에_partial():
    res = run([_six("a"), _six("b"), _six("c"), _six("d"), person("e", 0, intent="no")], attended=6)
    assert res["status"] == "measured" and res["flags"] == ["partial"]


def test_복합_상태는_우선순위_1개와_flags_중복_표기():
    a = _six("a")
    b = person("b", 300, respiratory_rate=14.0, heart_rate=70.0, **ALL_MIND)  # sdnn 없음 → HRV 는 1명
    c = person("c", 300, **ALL_MIND)
    lost = person("d", 0, intent="yes")
    unworn = person("e", 0, intent="no")
    res = run([a, b, c, lost, unworn], attended=6)
    assert res["status"] == "poor_signal"
    assert set(res["flags"]) == {"partial", "lost", "poor_signal"}


def test_scope는_인원과_분할_분을_담는다():
    res = run([_six("a"), _six("b")], attended=6)
    assert res["scope"] == {"attended": 6, "measured": 2, "included": 2,
                            "duration_min": 45, "bucket_min": 5, "split_min": 22.5}


def test_참여자_행은_측정_지표별_요약만_담고_이름을_담지_않는다():
    res = run([_six("a"), _six("b")])
    row = res["participants"][0]
    assert set(row) == {"participant_id", "state", "metrics"}
    assert set(row["metrics"]["focus"]) == {"mean", "early", "late", "delta", "direction",
                                              "valid_min", "valid_ratio"}


def test_출력은_JSON_직렬화_가능한_순수_값이다():
    import json
    json.dumps(run([_six("a"), _six("b")]))


# ── C1 독립 재계산 ──────────────────────────────────────────────
def _independent_mean_by_person(people_values):
    """개인 평균의 동등 가중 평균을 표준 라이브러리 없이 다시 계산한다."""
    means = []
    for vals in people_values:
        s = 0.0
        for v in vals:
            s += v
        means.append(s / len(vals))
    total = 0.0
    for m in means:
        total += m
    return total / len(means), min(means), max(means)


def test_독립_재계산과_서비스_결과가_일치한다():
    rng = random.Random(237)
    people, raw = [], []
    for idx in range(5):
        n = rng.randint(80, 400)
        vals = [rng.uniform(20, 80) for _ in range(n)]
        people.append(person(f"p{idx}", n, focus_index=lambda k, v=vals: v[k]))
        raw.append(vals)
    f = run(people)["metrics"]["focus"]
    mean, lo, hi = _independent_mean_by_person(raw)
    assert math.isclose(f["mean"], mean, abs_tol=1e-6)
    assert math.isclose(f["min"], lo, abs_tol=1e-6)
    assert math.isclose(f["max"], hi, abs_tol=1e-6)
