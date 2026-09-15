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
    post = Mock()
    monkeypatch.setattr(requests, "post", post)
    monkeypatch.setattr(summary_task, "DEEPSEEK_API_KEY", "test")

    assert summary_task._call_narrative_llm(summary, narrative_db) == cached
    post.assert_not_called()


def test_narrative_cache_miss_saves_fallback(monkeypatch, summary, narrative_db):
    from app.models.narrative_cache import NarrativeCache

    monkeypatch.setattr(summary_task, "DEEPSEEK_API_KEY", "")
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
    monkeypatch.setattr(summary_task, "DEEPSEEK_API_KEY", "test")
    generated = dict(journey="첫 여정", body="첫 몸", mind="첫 마음", closing="첫 마무리")
    response = Mock()
    response.json.return_value = {"choices": [{"message": {"content": json.dumps(generated)}}]}
    post = Mock(return_value=response)
    monkeypatch.setattr(requests, "post", post)

    assert summary_task._call_narrative_llm(summary, narrative_db) == generated
    same_pattern = json.loads(json.dumps(summary))
    same_pattern["body"]["heart_rate"]["delta"] = -999
    assert summary_task._call_narrative_llm(same_pattern, narrative_db) == generated
    assert post.call_count == 1


def test_deepseek_success(monkeypatch, summary):
    monkeypatch.setattr(summary_task, "DEEPSEEK_API_KEY", "test")
    expected = dict(journey="여정", body="몸", mind="마음", closing="마무리")
    response = Mock()
    response.json.return_value = {"choices": [{"message": {"content": '```json\n'+json.dumps(expected)+'\n```'}}]}
    post = Mock(return_value=response)
    monkeypatch.setattr(requests, "post", post)
    assert summary_task._call_narrative_llm(summary) == expected
    payload = post.call_args.kwargs
    assert payload["timeout"] == 30
    assert "점수" in payload["json"]["messages"][0]["content"]
    assert "score" not in payload["json"]["messages"][0]["content"]


@pytest.mark.parametrize("content", ['{}', '[]', 'null', '{"journey":5}', 'broken'])
def test_bad_responses_fallback(monkeypatch, summary, content):
    monkeypatch.setattr(summary_task, "DEEPSEEK_API_KEY", "test")
    response = Mock()
    response.json.return_value = {"choices": [{"message": {"content": content}}]}
    monkeypatch.setattr(requests, "post", Mock(return_value=response))
    assert summary_task._call_narrative_llm(summary) == fallback_narrative(summary)


def test_timeout_and_no_key(monkeypatch, summary):
    post = Mock(side_effect=requests.Timeout())
    monkeypatch.setattr(requests, "post", post)
    monkeypatch.setattr(summary_task, "DEEPSEEK_API_KEY", "test")
    assert summary_task._call_narrative_llm(summary) == fallback_narrative(summary)
    post.reset_mock()
    monkeypatch.setattr(summary_task, "DEEPSEEK_API_KEY", "")
    assert summary_task._call_narrative_llm(summary) == fallback_narrative(summary)
    post.assert_not_called()


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
