"""SDD-045 서사 입력, 공급자 실패, content 추가 계약 검증."""
import json
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
import requests
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.services.report_narrative import (
    DEFAULT_NARRATIVE_PATTERNS,
    build_metrics_summary,
    build_narrative_signature,
    fallback_narrative,
    seed_narrative_cache,
)
from app.tasks import summary_task, report_task


def window(i, **kwargs):
    values = dict(window_index=i, participant_id=None, quality="valid", heart_rate=80-i,
                  respiratory_rate=18-i, sdnn=30+i*3, focus_index=1+i*.1,
                  relaxation_index=1+i*.1, emotional_stability=1+i*.1)
    values.update(kwargs)
    return SimpleNamespace(**values)


def test_changes_preserve_missing_and_zero():
    result = build_metrics_summary([window(0, focus_index=0, sdnn=None),
                                    window(1, focus_index=1, sdnn=None)], "valid")
    assert result["mind"]["focus"]["direction"] == "up"
    assert result["mind"]["focus"]["percent_change"] is None
    assert result["body"]["hrv"]["direction"] is None
    assert "HRV" not in fallback_narrative(result)["body"]


def test_time_split_and_quality():
    result = build_metrics_summary([window(0), window(1), window(100)], "invalid")
    assert result["body"]["heart_rate"]["early"] == 79.5
    assert result["mind"]["focus"]["early"] is None
    assert "확인하기 어려" in fallback_narrative(result)["mind"]


def test_missing_and_mixed_participants_are_not_stable():
    for windows in ([], [window(0)], [window(0, participant_id="a"), window(1, participant_id="b")]):
        narrative = fallback_narrative(build_metrics_summary(windows, "valid"))
        assert "확인하기 어려" in narrative["journey"]
        assert "유지" not in narrative["journey"]


@pytest.mark.parametrize(("metric", "direction", "sentence"), [
    ("respiratory_rate", "down", "호흡이 깊고 느려졌어요"),
    ("respiratory_rate", "stable", "호흡이 고르게 유지됐어요"),
    ("respiratory_rate", "up", "호흡이 빨라졌어요"),
    ("heart_rate", "down", "심장이 차분해졌어요"),
    ("heart_rate", "stable", "심박이 일정했어요"),
    ("heart_rate", "up", "심박이 빨라졌어요"),
    ("hrv", "down", "자율신경이 긴장 상태였어요"),
    ("hrv", "stable", "자율신경이 유지됐어요"),
    ("hrv", "up", "자율신경 회복이 좋았어요"),
    ("focus", "down", "집중이 흔들렸어요"),
    ("focus", "stable", "집중이 유지됐어요"),
    ("focus", "up", "집중이 깊어졌어요"),
    ("relaxation", "down", "긴장이 남아 있었어요"),
    ("relaxation", "stable", "이완이 유지됐어요"),
    ("relaxation", "up", "이완이 깊어졌어요"),
    ("emotional_stability", "down", "감정 기복이 있었어요"),
    ("emotional_stability", "stable", "감정이 유지됐어요"),
    ("emotional_stability", "up", "감정이 평온해졌어요"),
])
def test_fallback_uses_frontend_metric_sentence(metric, direction, sentence):
    group = "body" if metric in {"respiratory_rate", "heart_rate", "hrv"} else "mind"

    narrative = fallback_narrative({group: {metric: {"direction": direction}}})

    assert narrative[group] == f"{sentence}."


@pytest.mark.parametrize(("metric", "early", "stable_late", "boundary_late"), [
    ("respiratory_rate", 10, 10.999, 11),
    ("heart_rate", 60, 62.999, 63),
    ("hrv", 30, 34.999, 35),
    ("focus", 100, 104.999, 105),
    ("relaxation", 100, 104.999, 105),
    ("emotional_stability", 100, 104.999, 105),
])
def test_direction_threshold_boundaries_match_frontend(metric, early, stable_late, boundary_late):
    attr = {"respiratory_rate": "respiratory_rate", "heart_rate": "heart_rate", "hrv": "sdnn",
            "focus": "focus_index", "relaxation": "relaxation_index",
            "emotional_stability": "emotional_stability"}[metric]
    group = "body" if metric in {"respiratory_rate", "heart_rate", "hrv"} else "mind"

    stable = build_metrics_summary([window(0, **{attr: early}), window(10, **{attr: stable_late})], "valid")
    boundary = build_metrics_summary([window(0, **{attr: early}), window(10, **{attr: boundary_late})], "valid")

    assert stable[group][metric]["direction"] == "stable"
    assert boundary[group][metric]["direction"] == "up"


def test_narrative_signature_uses_six_metric_directions():
    summary = build_metrics_summary([window(0), window(10)], "valid")
    assert build_narrative_signature(summary) == "↓↓↑↑↑↑"

    summary["body"]["hrv"]["direction"] = None
    assert build_narrative_signature(summary) is None


@pytest.fixture
def summary():
    return build_metrics_summary([window(0), window(10)], "valid")


@pytest.fixture
def narrative_db():
    from app.models.narrative_cache import NarrativeCache  # noqa: F401

    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(engine)


def test_narrative_cache_hit_skips_llm(monkeypatch, summary, narrative_db):
    from app.models.narrative_cache import NarrativeCache

    cached = dict(journey="캐시 여정", body="캐시 몸", mind="캐시 마음", closing="캐시 마무리")
    narrative_db.add(NarrativeCache(signature="↓↓↑↑↑↑", narrative=cached))
    narrative_db.commit()
    call = Mock()
    monkeypatch.setattr(summary_task, "_call_gemini_text", call)

    assert summary_task._call_narrative_llm(summary, narrative_db) == cached
    call.assert_not_called()


def test_narrative_cache_miss_saves_fallback(monkeypatch, summary, narrative_db):
    from app.models.narrative_cache import NarrativeCache

    # Gemini 호출 실패(키 미설정 등) → 규칙 스텁 폴백
    monkeypatch.setattr(summary_task, "_call_gemini_text", Mock(side_effect=RuntimeError("gemini_api_key not set")))
    expected = fallback_narrative(summary)
    assert summary_task._call_narrative_llm(summary, narrative_db) == expected
    narrative_db.flush()
    cached = narrative_db.get(NarrativeCache, "↓↓↑↑↑↑")
    assert cached is not None
    assert cached.narrative == expected
    assert cached.source == "rule"


def test_seed_narrative_cache_is_rule_based_and_idempotent(monkeypatch, narrative_db):
    from app.models.narrative_cache import NarrativeCache

    post = Mock()
    monkeypatch.setattr(requests, "post", post)
    assert seed_narrative_cache(narrative_db, ["↓↓↑↑↑↑", "→→→→→→"]) == 2
    narrative_db.commit()

    rows = narrative_db.query(NarrativeCache).order_by(NarrativeCache.signature).all()
    assert [row.source for row in rows] == ["rule", "rule"]
    assert all(row.narrative == fallback_narrative({
        "body": {
            "respiratory_rate": {"direction": {"↓": "down", "→": "stable"}[row.signature[0]]},
            "heart_rate": {"direction": {"↓": "down", "→": "stable"}[row.signature[1]]},
            "hrv": {"direction": {"↑": "up", "→": "stable"}[row.signature[2]]},
        },
        "mind": {
            "focus": {"direction": {"↑": "up", "→": "stable"}[row.signature[3]]},
            "relaxation": {"direction": {"↑": "up", "→": "stable"}[row.signature[4]]},
            "emotional_stability": {"direction": {"↑": "up", "→": "stable"}[row.signature[5]]},
        },
    }) for row in rows)
    assert seed_narrative_cache(narrative_db, ["↓↓↑↑↑↑", "→→→→→→"]) == 0
    post.assert_not_called()


def test_seed_defaults_to_representative_patterns(narrative_db):
    assert seed_narrative_cache(narrative_db) == len(DEFAULT_NARRATIVE_PATTERNS)


def test_seed_does_not_overwrite_llm_cache(narrative_db):
    from app.models.narrative_cache import NarrativeCache

    llm_narrative = dict(journey="LLM", body="몸", mind="마음", closing="마무리")
    narrative_db.add(NarrativeCache(signature="↓↓↑↑↑↑", narrative=llm_narrative, source="llm"))
    narrative_db.commit()

    assert seed_narrative_cache(narrative_db, ["↓↓↑↑↑↑"]) == 0
    assert narrative_db.get(NarrativeCache, "↓↓↑↑↑↑").narrative == llm_narrative


def test_same_direction_pattern_reuses_first_narrative(monkeypatch, summary, narrative_db):
    generated = dict(journey="첫 여정", body="첫 몸", mind="첫 마음", closing="첫 마무리")
    call = Mock(return_value=json.dumps(generated))
    monkeypatch.setattr(summary_task, "_call_gemini_text", call)

    assert summary_task._call_narrative_llm(summary, narrative_db) == generated
    same_pattern = json.loads(json.dumps(summary))
    same_pattern["body"]["heart_rate"]["delta"] = -999
    assert summary_task._call_narrative_llm(same_pattern, narrative_db) == generated
    assert call.call_count == 1


def test_gemini_success(monkeypatch, summary):
    expected = dict(journey="여정", body="몸", mind="마음", closing="마무리")
    call = Mock(return_value=json.dumps(expected))
    monkeypatch.setattr(summary_task, "_call_gemini_text", call)
    assert summary_task._call_narrative_llm(summary) == expected
    assert call.call_args.kwargs["timeout"] == 30
    assert call.call_args.kwargs["json_mode"] is True
    prompt = call.call_args.args[0]
    assert "점수" in prompt
    assert "score" not in prompt


def test_validate_metric_sentence_blocks_jargon_and_contradiction():
    from app.services.report_narrative import validate_metric_sentence

    # 정상 문장
    assert validate_metric_sentence("후반부에 집중이 높아졌어요", "up") is True
    assert validate_metric_sentence("후반부에 집중이 흔들렸어요", "down") is True
    assert validate_metric_sentence("집중이 유지됐어요", "stable") is True
    # 금지 용어(전문 약어·기술 용어)
    assert validate_metric_sentence("SDNN 수치가 낮아졌어요", "down") is False
    assert validate_metric_sentence("집중 점수가 하락했어요", "down") is False
    # 방향 모순: 하락(down)인데 회복·개선으로 서술
    assert validate_metric_sentence("후반부에 몰입을 되찾았습니다", "down") is False
    assert validate_metric_sentence("후반부에 회복했어요", "down") is False
    # 길이·방향·공백 검증
    assert validate_metric_sentence("집" * 61, "up") is False
    assert validate_metric_sentence("문장", "sideways") is False
    assert validate_metric_sentence("   ", "up") is False


def test_narrative_llm_validates_metric_sentences(monkeypatch, summary):
    generated = {
        "journey": "여정", "body": "몸", "mind": "마음", "closing": "마무리",
        "metrics": {
            "respiratory_rate": "호흡이 느려졌어요",
            "heart_rate": "심박이 빨라졌어요",
            "hrv": "심박변이가 늘었어요",
            "focus": "SDNN 스코어가 올랐어요",  # 금지 용어 → 거부
            "relaxation": "이완이 깊어졌어요",
            "emotional_stability": "감정이 평온해졌어요",
        },
    }
    monkeypatch.setattr(summary_task, "_call_gemini_text", Mock(return_value=json.dumps(generated)))
    result = summary_task._call_narrative_llm(summary)
    assert result["journey"] == "여정"
    assert result.get("metrics") is not None
    assert result["metrics"]["respiratory_rate"] == "호흡이 느려졌어요"
    assert "focus" not in result["metrics"]  # 금지 용어 문장은 제거돼 규칙 폴백을 남긴다


@pytest.mark.parametrize("content", ['{}', '[]', 'null', '{"journey":5}', 'broken'])
def test_bad_responses_fallback(monkeypatch, summary, content):
    monkeypatch.setattr(summary_task, "_call_gemini_text", Mock(return_value=content))
    assert summary_task._call_narrative_llm(summary) == fallback_narrative(summary)


def test_timeout_and_no_key(monkeypatch, summary):
    call = Mock(side_effect=requests.Timeout())
    monkeypatch.setattr(summary_task, "_call_gemini_text", call)
    assert summary_task._call_narrative_llm(summary) == fallback_narrative(summary)
    assert call.call_count == 1

    monkeypatch.setattr(summary_task, "_call_gemini_text", Mock(side_effect=RuntimeError("gemini_api_key not set")))
    assert summary_task._call_narrative_llm(summary) == fallback_narrative(summary)


def test_gemini_text_no_key_raises_without_http(monkeypatch):
    monkeypatch.setattr(summary_task.settings, "gemini_api_key", "")
    post = Mock()
    monkeypatch.setattr(requests, "post", post)
    with pytest.raises(RuntimeError):
        summary_task._call_gemini_text("test")
    post.assert_not_called()


def test_gemini_text_parses_response(monkeypatch):
    monkeypatch.setattr(summary_task.settings, "gemini_api_key", "test")
    response = Mock()
    response.json.return_value = {"candidates": [{"content": {"parts": [{"text": '{"a": 1}'}]}}]}
    monkeypatch.setattr(requests, "post", Mock(return_value=response))
    assert summary_task._call_gemini_text("test") == '{"a": 1}'


def test_report_eeg_additive_contract(monkeypatch):
    from app.models.eeg_feature import EEGFeatureWindow
    windows = [EEGFeatureWindow(window_index=i, quality="valid", heart_rate=80-i/10,
                               focus_index=1, relaxation_index=1) for i in range(80)]
    db = Mock()
    db.query.return_value.filter.return_value.filter.return_value.order_by.return_value.all.return_value = windows
    db.query.return_value.filter.return_value.first.return_value = None
    narrative = dict(journey="여정", body="몸", mind="마음", closing="마무리")
    call = Mock(return_value=narrative)
    monkeypatch.setattr(report_task, "_call_narrative_llm", call)
    block = report_task._build_eeg_content(uuid4(), db)
    assert block["narrative"] == narrative
    assert {"score", "metrics", "timeline", "status"} <= block.keys()
    assert len(block["timeline"]) == 80
    assert call.call_args.args[0]["body"]["heart_rate"]["direction"] == "down"
    db.query.return_value.filter.return_value.filter.return_value.order_by.return_value.all.return_value = []
    call.reset_mock()
    assert report_task._build_eeg_content(uuid4(), db) == {"status": "not_measured"}
    call.assert_not_called()
