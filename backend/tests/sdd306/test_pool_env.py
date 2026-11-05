"""SDD-306 — DB 풀 환경변수 상향: 코드 기본값(20/20)은 유지하고 환경변수로만 올린다."""
from __future__ import annotations

from app.config import Settings


def test_V5_기본값은_20_20_유지():
    f = Settings.model_fields
    assert f["db_pool_size"].default == 20 and f["db_max_overflow"].default == 20


def test_V5b_환경변수로_풀을_올릴_수_있다(monkeypatch):
    monkeypatch.setenv("DB_POOL_SIZE", "30")
    monkeypatch.setenv("DB_MAX_OVERFLOW", "10")
    s = Settings()
    assert s.db_pool_size == 30 and s.db_max_overflow == 10
