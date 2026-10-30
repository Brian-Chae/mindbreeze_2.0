"""SDD-237 B7: AI 입력 빌더(익명 집계만)와 출력 검증(필드 단위 폐기) — verify P7·P10·S14."""

import json
import re

import pytest

from app.services import class_report_narrative as nar
from tests.sdd237_helpers import make_block

FULL = {"respiration": "down", "bpm": "down", "hrv": "up", "focus": "up", "relaxation": "up", "emotional": "stable"}


def ai_input(**kw):
    return nar.build_ai_input(make_block(directions=kw.pop("directions", FULL), **kw))


# ── 입력 빌더 ───────────────────────────────────────────────────
def test_입력_키_화이트리스트():
    data = ai_input()
    assert set(data) == {"session_kind", "duration_min", "counts", "state", "flags", "metrics", "missing", "agreement"}
    assert data["session_kind"] == "meditation_class" and data["duration_min"] == 45
    assert data["counts"] == {"measured": 4, "attended": 6}
    assert set(data["metrics"]["focus"]) == {"unit", "compared", "early", "late", "direction"}


def test_입력에_이름_이메일_ID_클래스명_기관명_메모_수정문장_개인값이_없다():
    block = make_block(
        directions=FULL,
        participants=[{"participant_id": "11111111-2222-3333-4444-555555555555", "state": "measured",
                       "metrics": {"focus": {"mean": 77.7, "direction": "up"}}}])
    block["narrative"] = {"input_hash": "h", "fields": {
        "headline": {"rule_text": "R", "edited_text": "수정된_민감_문장_XYZ", "source": "edited"},
        "participant.11111111-2222-3333-4444-555555555555": {"rule_text": "개인 한 줄"}}}
    block["counselor_notes"] = "비공개 메모 본문"
    text = json.dumps(nar.build_ai_input(block), ensure_ascii=False)
    for forbidden in ("수정된_민감_문장_XYZ", "비공개 메모 본문", "11111111-2222", "77.7", "@", "participant",
                      "개인 한 줄", "counselor_notes", "transcript", "아침 호흡 명상", "기관", "채 코치", "회원"):
        assert forbidden not in text, forbidden
    assert re.search(r"[0-9a-f]{8}-[0-9a-f]{4}", text) is None


def test_측정_1명_또는_결측_지표는_입력에_넣지_않고_missing으로만_전달한다():
    block = make_block(directions={"focus": "up", "bpm": "down"})
    block["metrics"]["relaxation"].update(state="single", measured=1)
    block["metrics"]["hrv"].update(state="poor_signal", measured=1)
    data = nar.build_ai_input(block)
    assert set(data["metrics"]) == {"focus", "bpm"}
    assert set(data["missing"]) == {"respiration", "hrv", "relaxation", "emotional"}


def test_비교_불가_지표는_입력에서_빠진다():
    block = make_block(directions={"focus": "up", "bpm": "down"})
    block["metrics"]["focus"].update(direction=None, early=None, late=None, delta=None)
    assert set(nar.build_ai_input(block)["metrics"]) == {"bpm"}


def test_방향_분포는_있을_때만_담는다():
    block = make_block(directions={"focus": "up", "bpm": "down"})
    block["metrics"]["focus"]["agreement"] = {"up": 3, "stable": 1, "down": 0}
    assert nar.build_ai_input(block)["agreement"] == {"focus": {"up": 3, "stable": 1, "down": 0}}
    assert nar.build_ai_input(make_block(directions={"focus": "up"}))["agreement"] == {}


@pytest.mark.parametrize("status", ["unworn", "pending", "error", "zero", "lost", "single"])
def test_호출_대상이_아닌_상태는_입력이_None(status):
    assert nar.build_ai_input(make_block(status=status, directions={})) is None
    assert nar.build_ai_input(make_block(status=status, directions={"focus": "up"})) is None


def test_변화를_말할_지표가_하나도_없으면_None():
    assert nar.build_ai_input(make_block(status="poor_signal", directions={})) is None


def test_입력_해시는_결정적이고_숫자가_바뀌면_바뀐다():
    a, b = ai_input(), ai_input()
    assert nar.ai_input_hash(a) == nar.ai_input_hash(b)
    b["metrics"]["focus"]["late"] = 99.0
    assert nar.ai_input_hash(a) != nar.ai_input_hash(b)


def test_프롬프트에_입력이_들어가고_버전이_기록된다():
    data = ai_input()
    prompt = nar.build_prompt(data)
    assert "당신은 명상 수업을 관찰한 내용을 코치에게 전달하는 기록 보조입니다" in prompt
    assert json.dumps(data, ensure_ascii=False, sort_keys=True) in prompt
    assert nar.PROMPT_VERSION == "cr-1"


# ── 출력 검증 ───────────────────────────────────────────────────
def good():
    return {
        "headline": "측정한 4명의 호흡과 심박이 차분해지는 쪽으로 움직였고, 집중과 이완 신호는 후반으로 갈수록 높아졌어요.",
        "body_subtitle": "호흡과 심박은 느려지는 쪽이었고 심박 간격의 변화는 커졌어요.",
        "mind_subtitle": "집중과 이완 신호는 높아졌고 정서 안정 신호는 비슷했어요.",
        "metrics": {
            "respiration": "후반으로 갈수록 호흡이 느려졌어요.",
            "bpm": "후반으로 갈수록 심박이 느려졌어요.",
            "hrv": "후반으로 갈수록 심박 간격의 변화가 커졌어요.",
            "focus": "후반으로 갈수록 집중 신호가 높아졌어요.",
            "relaxation": "후반으로 갈수록 이완 신호가 높아졌어요.",
            "emotional": "정서 안정 신호가 비슷했어요.",
        },
    }


def validate(raw, data=None, names=()):
    return nar.validate_fields(raw, data or ai_input(), names=names)


def test_정상_응답은_8개_필드를_모두_채택한다():
    accepted, rejected = validate(good())
    assert rejected == []
    assert set(accepted) == {"headline", "body_subtitle", "mind_subtitle", "metric.respiration", "metric.bpm",
                             "metric.hrv", "metric.focus", "metric.relaxation", "metric.emotional"}


@pytest.mark.parametrize("term", ["종합", "순위", "상위", "하위", "우수", "부족", "양호", "불량", "좋아졌", "나빠졌",
                                  "주의가 필요", "개선", "악화", "회복", "호전", "완화", "치료", "진단", "증상", "효과",
                                  "질환", "우울", "잘하", "당신", "여러분", "점수", "스코어", "정규화", "SDNN", "PPG"])
def test_금지어가_있으면_그_필드만_폐기(term):
    raw = good()
    raw["mind_subtitle"] = f"집중 신호가 높아졌어요 {term}"
    accepted, rejected = validate(raw)
    assert "mind_subtitle" in rejected and "mind_subtitle" not in accepted
    assert "headline" in accepted  # 다른 필드는 채택


def test_허용_집합_밖_숫자는_폐기_측정_인원_숫자는_허용():
    raw = good()
    raw["headline"] = "측정한 4명 중 집중이 52에서 61로 높아졌어요."
    assert "headline" in validate(raw)[1]
    raw["headline"] = "참석한 6명 가운데 측정한 4명의 집중 신호가 후반에 높아졌어요."
    assert "headline" in validate(raw)[0]
    raw["headline"] = "측정한 5명의 집중 신호가 후반에 높아졌어요."
    assert "headline" in validate(raw)[1]
    raw = good()
    raw["metrics"]["focus"] = "후반에 집중 신호가 3.5 높아졌어요."
    assert "metric.focus" in validate(raw)[1]


def test_방향_모순_폐기():
    raw = good()
    raw["metrics"]["focus"] = "후반으로 갈수록 집중 신호가 낮아졌어요."          # 입력은 up
    raw["metrics"]["bpm"] = "후반으로 갈수록 심박이 빨라졌어요."                  # 입력은 down
    raw["metrics"]["emotional"] = "후반으로 갈수록 정서 안정 신호가 높아졌어요."  # 입력은 stable
    raw["metrics"]["respiration"] = "호흡이 느려졌어요."                          # 정상
    accepted, rejected = validate(raw)
    assert {"metric.focus", "metric.bpm", "metric.emotional"} <= set(rejected)
    assert "metric.respiration" in accepted


def test_소제목_headline_의_절_단위_방향_모순도_폐기():
    raw = good()
    raw["mind_subtitle"] = "집중 신호는 낮아졌고 이완 신호는 높아졌어요."          # 집중 up 인데 낮아졌다
    raw["headline"] = "측정한 4명의 호흡이 빨라졌고, 집중 신호는 높아졌어요."       # 호흡 down 인데 빨라졌다
    accepted, rejected = validate(raw)
    assert "mind_subtitle" in rejected and "headline" in rejected


def test_차분해지는_쪽이라는_맥락어도_몸_지표가_상승이면_모순():
    data = nar.build_ai_input(make_block(directions={"respiration": "up", "bpm": "up", "focus": "up"}))
    raw = {"headline": "측정한 4명의 호흡과 심박이 차분해지는 쪽으로 움직였어요.",
           "body_subtitle": "호흡과 심박이 빨라졌어요.", "mind_subtitle": "집중 신호가 높아졌어요.",
           "metrics": {"respiration": "호흡이 빨라졌어요.", "bpm": "심박이 빨라졌어요.",
                       "focus": "집중 신호가 높아졌어요."}}
    accepted, rejected = nar.validate_fields(raw, data)
    assert "headline" in rejected and "body_subtitle" in accepted


def test_결측_지표를_언급하면_폐기():
    data = nar.build_ai_input(make_block(directions={"focus": "up", "bpm": "down"}))
    raw = {"headline": "측정한 4명의 심박이 느려졌고 호흡도 느려졌어요.",      # 호흡은 결측
           "body_subtitle": "심박이 느려졌어요.", "mind_subtitle": "집중 신호가 높아졌어요.",
           "metrics": {"focus": "집중 신호가 높아졌어요.", "bpm": "심박이 느려졌어요."}}
    accepted, rejected = nar.validate_fields(raw, data)
    assert "headline" in rejected
    assert {"body_subtitle", "mind_subtitle", "metric.focus", "metric.bpm"} <= set(accepted)
    raw["headline"] = "측정한 4명의 심박 간격의 변화가 커졌어요."               # HRV 결측
    assert "headline" in nar.validate_fields(raw, data)[1]
    raw["headline"] = "측정한 4명의 심박이 느려지고 집중 신호가 높아졌어요."
    assert "headline" in nar.validate_fields(raw, data)[0]


def test_결측_지표의_문장은_받지_않는다():
    data = nar.build_ai_input(make_block(directions={"focus": "up"}))
    raw = {"headline": "측정한 4명의 집중 신호가 높아졌어요.", "body_subtitle": "호흡이 느려졌어요.",
           "mind_subtitle": "집중 신호가 높아졌어요.", "metrics": {"focus": "집중 신호가 높아졌어요.", "bpm": "심박이 느려졌어요."}}
    accepted, _ = nar.validate_fields(raw, data)
    assert set(accepted) == {"headline", "mind_subtitle", "metric.focus"}


def test_이름_형태_폐기():
    raw = good()
    raw["headline"] = "측정한 4명 중 김하늘님의 집중 신호가 높아졌어요."
    assert "headline" in validate(raw)[1]
    raw = good()
    raw["mind_subtitle"] = "철수의 집중 신호가 높아졌어요."
    assert "mind_subtitle" in validate(raw, names=["철수"])[1]
    assert "mind_subtitle" in validate(raw)[0]  # 이름 목록이 없으면 일반 규칙만


def test_이메일_ID_형태_폐기():
    raw = good()
    raw["metrics"]["focus"] = "집중 신호가 높아졌어요 a@b.com"
    raw["metrics"]["bpm"] = "심박 11111111-2222-3333-4444-555555555555 느려졌어요"
    rejected = validate(raw)[1]
    assert {"metric.focus", "metric.bpm"} <= set(rejected)


def test_길이_상한_headline_120_소제목_100_지표_60():
    raw = good()
    raw["headline"] = "측정한 4명의 집중 신호가 높아졌어요" + "요" * 120
    raw["body_subtitle"] = "호흡이 느려졌어요" + "요" * 100
    raw["metrics"]["focus"] = "집중 신호가 높아졌어요" + "요" * 60
    raw["metrics"]["bpm"] = "심박이 느려졌어요" + "요" * 40
    accepted, rejected = validate(raw)
    assert {"headline", "body_subtitle", "metric.focus"} <= set(rejected)
    assert "metric.bpm" in accepted


def test_partial_상태에서는_headline에_측정한_N명이_있어야_한다():
    data = nar.build_ai_input(make_block(status="partial", directions=FULL, measured=2, included=4, attended=4,
                                         flags=["partial"]))
    raw = good()
    raw["headline"] = "집중과 이완 신호는 후반으로 갈수록 높아졌어요."
    assert "headline" in nar.validate_fields(raw, data)[1]
    raw["headline"] = "측정한 2명의 집중과 이완 신호는 후반으로 갈수록 높아졌어요."
    assert "headline" in nar.validate_fields(raw, data)[0]


def test_스키마_불일치는_전_필드_폐기():
    for raw in (None, "문자열", [], {"headline": 5}, {"headline": "x"}, {"metrics": "x"},
                {**good(), "metrics": ["a"]}, {**good(), "headline": 5}):
        accepted, rejected = validate(raw)
        assert accepted == {} and rejected, raw
    # 필수 키 누락(소제목)도 스키마 불일치
    missing = good()
    del missing["mind_subtitle"]
    assert validate(missing)[0] == {}


def test_빈_문자열과_공백_필드는_해당_필드만_폐기():
    raw = good()
    raw["metrics"]["hrv"] = "   "
    raw["body_subtitle"] = ""
    accepted, rejected = validate(raw)
    assert {"metric.hrv", "body_subtitle"} <= set(rejected) and "headline" in accepted


def test_순수_함수_입력을_변경하지_않는다():
    import copy
    raw, data = good(), ai_input()
    snap = (copy.deepcopy(raw), copy.deepcopy(data))
    validate(raw, data)
    assert (raw, data) == snap


# ── 호출 필요 판정 ──────────────────────────────────────────────
def test_ai_call_needed(monkeypatch):
    block = make_block(directions=FULL)
    assert nar.ai_call_needed(block) is True
    block["narrative"] = {"ai_attempt": {"hash": nar.ai_input_hash(nar.build_ai_input(block)), "outcome": "ok",
                                        "at": "t"}}
    assert nar.ai_call_needed(block) is False          # 같은 입력으로 이미 시도(성공이든 실패든)
    block["metrics"]["focus"]["late"] = 99.0
    assert nar.ai_call_needed(block) is True            # 입력이 바뀐 경우에만 재호출
    assert nar.ai_call_needed(make_block(status="unworn", directions={})) is False
