"""SDD-318 F-C — 리포트 content.quote (인용 한 줄) 단위 시험. 외부 LLM 호출은 전부 mock."""

from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.services import report_quote
from app.services.report_service import normalize_report_content


def _record(status="completed", transcript="요즘 생각이 많았는데 호흡에 집중하니 편해졌어요.", ai_summary=None):
    return SimpleNamespace(status=status, transcript=transcript, ai_summary=ai_summary or {})


def _session(mode="individual"):
    return SimpleNamespace(participant_mode=mode)


# C1 파서
def test_parse_reads_quote_from_json():
    assert report_quote.parse_quote('{"quote": "다시 호흡으로 돌아왔어요"}') == "다시 호흡으로 돌아왔어요."


@pytest.mark.parametrize("raw", ['{"quote": null}', "{}", '{"quote": ""}', '{"quote": 3}', "not json", "[]", None])
def test_parse_missing_or_invalid_is_none(raw):
    assert report_quote.parse_quote(raw) is None


# C2 형식
def test_sanitize_strips_quotes_and_keeps_period():
    assert report_quote.sanitize_quote("“마음이 한결 가라앉았어요.”") == "마음이 한결 가라앉았어요."


def test_sanitize_rejects_too_long_multi_sentence_and_non_haeyo():
    assert report_quote.sanitize_quote("가" * 60 + "해요") is None
    assert report_quote.sanitize_quote("편안했어요. 그리고 쉬었어요.") is None
    assert report_quote.sanitize_quote("편안했습니다.") is None


# C3 금지어
@pytest.mark.parametrize(
    "text",
    ["오늘은 점수가 올랐어요", "기분이 좋음이었어요", "100% 만족했어요", "명상을 완료했어요",
     "우울증이 나아졌어요", "치료가 된 것 같아요", "효과를 보증해요"],
)
def test_sanitize_rejects_forbidden_terms(text):
    assert report_quote.sanitize_quote(text) is None


# C4 마이크 오프 / C5 저신뢰·STT off
def test_mic_off_never_calls_llm_even_with_transcript():
    with patch("app.tasks.summary_task._call_gemini_text") as llm:
        assert report_quote.generate_quote(_record(status="manual"), None) is None
        llm.assert_not_called()


def test_mic_off_uses_counselor_comment_only_without_stt_text():
    with patch("app.tasks.summary_task._call_gemini_text", return_value='{"quote": "호흡이 편안해졌어요"}') as llm:
        out = report_quote.generate_quote(_record(status="manual"), "오늘 호흡이 안정적이었습니다.")
    assert out == "호흡이 편안해졌어요."
    prompt = llm.call_args.args[0]
    assert "[녹음 전사]" not in prompt and "생각이 많았는데" not in prompt
    assert "[코치 코멘트]" in prompt


def test_low_confidence_transcript_not_used():
    rec = _record(ai_summary={"transcript_confidence": "low"})
    with patch("app.tasks.summary_task._call_gemini_text") as llm:
        assert report_quote.generate_quote(rec, None) is None
        llm.assert_not_called()


def test_stt_disabled_transcript_not_used():
    with patch("app.core.ai_features.is_stt_enabled", return_value=False), \
            patch("app.tasks.summary_task._call_gemini_text") as llm:
        assert report_quote.generate_quote(_record(), None) is None
        llm.assert_not_called()


# 정상: 전사 사용
def test_transcript_used_when_available():
    with patch("app.core.ai_features.is_stt_enabled", return_value=True), \
            patch("app.tasks.summary_task._call_gemini_text", return_value='{"quote": "호흡에 집중하니 편해졌어요"}') as llm:
        out = report_quote.generate_quote(_record(), None)
    assert out == "호흡에 집중하니 편해졌어요."
    assert "[녹음 전사]" in llm.call_args.args[0]


# C7 근거 부족
def test_no_sources_means_no_llm_call():
    with patch("app.core.ai_features.is_stt_enabled", return_value=True), \
            patch("app.tasks.summary_task._call_gemini_text") as llm:
        assert report_quote.generate_quote(_record(transcript="  "), None) is None
        assert report_quote.generate_quote(None, "   ") is None
        llm.assert_not_called()


# C8 실패 내성
def test_llm_error_returns_none():
    with patch("app.core.ai_features.is_stt_enabled", return_value=True), \
            patch("app.tasks.summary_task._call_gemini_text", side_effect=RuntimeError("boom")):
        assert report_quote.generate_quote(_record(), None) is None


def test_llm_forbidden_output_filtered():
    with patch("app.core.ai_features.is_stt_enabled", return_value=True), \
            patch("app.tasks.summary_task._call_gemini_text", return_value='{"quote": "점수가 올랐어요"}'):
        assert report_quote.generate_quote(_record(), None) is None


# C6 격리
def test_attach_quote_none_for_group_excluded_and_stub():
    with patch("app.tasks.summary_task._call_gemini_text") as llm:
        c1: dict = {}
        report_quote.attach_quote(c1, _session("group"), _record(), None)
        c2: dict = {}
        report_quote.attach_quote(c2, _session(), _record(), None, excluded=True)
        c3 = {"fallback": True}
        report_quote.attach_quote(c3, _session(), _record(), None)
        llm.assert_not_called()
    assert c1["quote"] is None and c2["quote"] is None and c3["quote"] is None


def test_attach_quote_uses_previous_counselor_comment():
    with patch("app.core.ai_features.is_stt_enabled", return_value=False), \
            patch("app.tasks.summary_task._call_gemini_text", return_value='{"quote": "마음이 가벼워졌어요"}') as llm:
        content: dict = {}
        report_quote.attach_quote(content, _session(), None, {"counselor_comment": "차분한 세션이었습니다."})
    assert content["quote"] == "마음이 가벼워졌어요."
    assert "차분한 세션이었습니다." in llm.call_args.args[0]


# C9/C10 API 정규화·하위호환
@pytest.mark.parametrize("report_type", ["client", "counselor"])
def test_normalize_exposes_quote(report_type):
    out = normalize_report_content({"headline": "h", "quote": " 편안했어요. "}, report_type)
    assert out["quote"] == "편안했어요."
    assert out["headline"] == "h"


@pytest.mark.parametrize("content", [{"headline": "h"}, {"quote": None}, {"quote": ""}, {"quote": 5}])
def test_normalize_legacy_report_quote_none(content):
    assert normalize_report_content(content, "client")["quote"] is None
