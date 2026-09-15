"""SDD-048 규칙 캐시의 제한적 LLM 업그레이드 검증."""
import json
from unittest.mock import Mock

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.services.report_narrative import seed_narrative_cache
from app.tasks import summary_task


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


def test_upgrade_only_processes_limited_rule_rows(monkeypatch, narrative_db):
    from app.models.narrative_cache import NarrativeCache
    from app.tasks import upgrade_narrative_cache as task_module

    seed_narrative_cache(narrative_db, ["↓↓↑↑↑↑", "→→→→→→", "↑↑↑↓↓↓"])
    narrative_db.commit()
    generated = dict(journey="LLM 여정", body="LLM 몸", mind="LLM 마음", closing="LLM 마무리")
    call = Mock(return_value=generated)
    monkeypatch.setattr(task_module, "_generate_narrative_for_upgrade", call)

    assert task_module.upgrade_rule_narratives(narrative_db, limit=2) == 2
    assert call.call_count == 2
    assert narrative_db.query(NarrativeCache).filter(NarrativeCache.source == "llm").count() == 2
    assert narrative_db.query(NarrativeCache).filter(NarrativeCache.source == "rule").count() == 1


def test_failed_llm_generation_keeps_rule_source(monkeypatch, narrative_db):
    from app.models.narrative_cache import NarrativeCache
    from app.tasks import upgrade_narrative_cache as task_module

    seed_narrative_cache(narrative_db, ["↓↓↑↑↑↑"])
    narrative_db.commit()
    monkeypatch.setattr(task_module, "_generate_narrative_for_upgrade", Mock(return_value=None))

    assert task_module.upgrade_rule_narratives(narrative_db, limit=5) == 0
    assert narrative_db.get(NarrativeCache, "↓↓↑↑↑↑").source == "rule"


def test_upgrade_replaces_rule_narrative_after_real_llm_success(monkeypatch, narrative_db):
    from app.models.narrative_cache import NarrativeCache
    from app.tasks.upgrade_narrative_cache import upgrade_rule_narratives

    seed_narrative_cache(narrative_db, ["↓↓↑↑↑↑"])
    narrative_db.commit()
    generated = dict(journey="LLM 여정", body="LLM 몸", mind="LLM 마음", closing="LLM 마무리")
    response = Mock()
    response.json.return_value = {"choices": [{"message": {"content": json.dumps(generated)}}]}
    monkeypatch.setattr("requests.post", Mock(return_value=response))
    monkeypatch.setattr(summary_task, "DEEPSEEK_API_KEY", "test")

    assert upgrade_rule_narratives(narrative_db, limit=1) == 1
    cached = narrative_db.get(NarrativeCache, "↓↓↑↑↑↑")
    assert cached.source == "llm"
    assert cached.narrative == generated


def test_cron_calls_upgrade_rule_narratives_with_daily_limit(monkeypatch):
    import upgrade_narrative_cache_cron as cron_module

    db = Mock()
    upgrade = Mock(return_value=2)
    monkeypatch.setattr(cron_module, "SessionLocal", Mock(return_value=db))
    monkeypatch.setattr(cron_module, "upgrade_rule_narratives", upgrade)

    assert cron_module.main() == 0
    upgrade.assert_called_once_with(db, limit=5)
    db.close.assert_called_once_with()
