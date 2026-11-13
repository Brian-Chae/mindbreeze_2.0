"""SDD-327 T4 — 문장 규칙 테스트. sample 픽스처(확정 시안 v11)의 문장과 일치하는지 골든 비교."""

import copy
import json
from pathlib import Path

import pytest

from app.schemas.member_report import MemberReport
from app.services import member_report_narrative as narr
from app.services.member_report_wording import (
    apply_wording,
    assert_clean,
    assert_report_clean,
    direction_for_change,
    find_violations,
    tone_for,
)

FIX = Path(__file__).parent / "fixtures" / "member_report"


def _load(name: str) -> dict:
    return json.loads((FIX / f"member-report-{name}.json").read_text(encoding="utf-8"))


def _blank(report: dict) -> dict:
    """문장 필드를 지운 사본 — 규칙이 처음부터 만들어 내는지 확인."""
    r = copy.deepcopy(report)
    for sec in r["metrics"].values():
        b = sec.get("body")
        if b:
            for k in ("conclusion", "bridge", "interpretation", "reading", "result_note", "source_note"):
                b[k] = None if k != "conclusion" and k != "interpretation" else ""
    r["hero"].update(headline="", lead="", caution=None, other_directions=None)
    r["opinion"]["narrative"].update(title="", body="")
    r["next_steps"]["items"] = []
    return r


# ── 골든: 시안 문장 재현 ───────────────────────────────────────────
@pytest.mark.parametrize("name", [
    "sample", "group-hidden", "partial-missing-rmssd", "no-aperiodic-no_raw",
    "no-aperiodic-insufficient_window", "no-aperiodic-poor_fit",
])
def test_시안_문장_재현(name):
    src = _load(name)
    out = apply_wording(_blank(src))
    for key, sec in src["metrics"].items():
        if sec["state"] != "ok":
            continue
        for f in ("conclusion", "bridge", "interpretation", "reading", "result_note", "source_note"):
            assert out["metrics"][key]["body"][f] == sec["body"][f], (name, key, f)
    for f in ("headline", "lead", "caution", "other_directions"):
        assert out["hero"][f] == src["hero"][f], (name, f)
    assert out["opinion"]["narrative"] == src["opinion"]["narrative"]
    assert out["next_steps"] == src["next_steps"]


def test_미착용_문장_재현():
    src = _load("not-worn")
    out = apply_wording(_blank(src))
    for f in ("headline", "lead", "caution", "other_directions"):
        assert out["hero"][f] == src["hero"][f]
    assert out["opinion"]["narrative"] == src["opinion"]["narrative"]
    assert out["next_steps"] == src["next_steps"]


def test_결과가_계약을_통과():
    for name in ("sample", "not-worn", "partial-missing-rmssd"):
        MemberReport.model_validate(apply_wording(_blank(_load(name))))


def test_입력_불변():
    src = _blank(_load("sample"))
    before = copy.deepcopy(src)
    apply_wording(src)
    assert src == before


# ── 방향·톤 임계 ──────────────────────────────────────────────────
def test_방향_임계():
    assert direction_for_change("heart_rate", 75.0, 72.1) == "stable"  # 2.9bpm < 3
    assert direction_for_change("heart_rate", 75.0, 72.0) == "down"
    assert direction_for_change("rmssd", 27.1, 22.6) == "stable"  # 4.5ms < 5 (시안)
    assert direction_for_change("rmssd", 27.1, 22.0) == "down"
    assert direction_for_change("relaxation", 64.5, 78.8) == "up"
    assert direction_for_change("focus", 50.0, 52.0) == "stable"  # 4% < 5%
    assert direction_for_change("focus", 50.0, None) is None


def test_톤_calm은_기대_방향만():
    assert tone_for("heart_rate", "down") == "calm"
    assert tone_for("heart_rate", "up") == "neutral"
    assert tone_for("focus", "up") == "neutral"  # 집중도는 가치 판단 없음


# ── 반대 방향 정직 표기 ──────────────────────────────────────────
def test_반대_방향_심박_상승_이완_하락():
    r = _blank(_load("sample"))
    hr = r["metrics"]["heart_rate"]["body"]["change"]
    hr.update(before=60.0, after=72.0, delta=12.0, direction="up")
    rel = r["metrics"]["relaxation"]["body"]["change"]
    rel.update(before=80.0, after=60.0, delta=-20.0, direction="down")
    out = apply_wording(r)
    assert out["hero"]["headline"] == "심박은 올라가고,\n이완도는 내려갔어요."
    assert "더 빠르게 뛰었어요" in out["metrics"]["heart_rate"]["body"]["conclusion"]
    assert "낮아졌어요" in out["metrics"]["relaxation"]["body"]["conclusion"]
    assert "심박 ↑12.0회/분" in out["hero"]["other_directions"]
    assert_report_clean(out)


def test_비슷한_변화는_비슷했어요():
    r = _blank(_load("sample"))
    hr = r["metrics"]["heart_rate"]["body"]["change"]
    hr.update(before=60.0, after=60.0, delta=0.0, direction="stable")
    out = apply_wording(r)
    assert "비슷하게 이어졌어요" in out["metrics"]["heart_rate"]["body"]["conclusion"]
    assert "비슷한 수준" in out["metrics"]["heart_rate"]["body"]["interpretation"]


# ── 금지어·인과 ──────────────────────────────────────────────────
@pytest.mark.parametrize("word", ["B5", "건강 수준", "점수", "등급", "스트레스", "우울", "진단합니다", "위험"])
def test_금지어_검출(word):
    with pytest.raises(ValueError):
        assert_clean(f"이번 {word} 안내")


@pytest.mark.parametrize("text", ["명상 때문에 좋아졌어요", "명상 덕분에 내려갔어요", "덕분에 편해졌어요"])
def test_인과_단정_검출(text):
    assert find_violations(text)


def test_정상_문장은_통과():
    assert_clean("이 수업 동안 심박이 내려갔어요.")


@pytest.mark.parametrize("name", [
    "sample", "not-worn", "group-hidden", "partial-missing-rmssd", "no-aperiodic-no_raw"])
def test_생성_문장에_금지어_없음(name):
    assert_report_clean(apply_wording(_blank(_load(name))))


# ── 결측 ─────────────────────────────────────────────────────────
def test_결측_지표는_문장_생성_안함_0으로_채우지_않음():
    out = apply_wording(_blank(_load("partial-missing-rmssd")))
    assert out["metrics"]["rmssd"]["body"] is None
    assert "RMSSD ↓" not in (out["hero"]["other_directions"] or "")


# ── AI 훅 (mock, 기본 off) ───────────────────────────────────────
def test_AI_기본_off():
    out = apply_wording(_blank(_load("sample")))
    assert out["opinion"]["narrative"]["source"] == "rule"


def test_AI_통과분만_대체():
    ai = json.dumps({"title": "심박이 천천히 내려온 수업이에요",
                     "body": "심박 중앙값이 75.0에서 58.0으로 내려왔어요. 편안함은 회원님의 기억과 함께 읽어 주세요."},
                    ensure_ascii=False)
    out = apply_wording(_blank(_load("sample")), ai_text=ai)
    n = out["opinion"]["narrative"]
    assert n["source"] == "ai" and n["title"].startswith("심박이")


@pytest.mark.parametrize("bad", [
    "not json",
    json.dumps({"title": "t", "body": "명상 덕분에 좋아졌어요."}, ensure_ascii=False),
    json.dumps({"title": "t", "body": "점수가 올랐어요."}, ensure_ascii=False),
    json.dumps({"title": "t", "body": "심박이 99.0까지 내려왔어요."}, ensure_ascii=False),  # 사실에 없는 숫자
    json.dumps({"title": "x" * 41, "body": "괜찮아요."}, ensure_ascii=False),
    json.dumps({"title": "t"}),
    "",
])
def test_AI_검증_실패시_규칙_문장_유지(bad):
    src = _load("sample")
    out = apply_wording(_blank(src), ai_text=bad)
    assert out["opinion"]["narrative"] == src["opinion"]["narrative"]


def test_narrative_모듈_단독_ai_병합():
    r = _load("sample")
    assert narr.merge_ai_narrative(r, None) is None
