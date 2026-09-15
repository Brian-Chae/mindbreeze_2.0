"""SDD-048 규칙 기반 서사 캐시를 소량씩 LLM 서사로 업그레이드한다."""
from sqlalchemy.orm import Session as DBSession

from app.models.narrative_cache import NarrativeCache
from app.services.report_narrative import summary_from_signature
from app.tasks.summary_task import _call_narrative_llm


def _generate_narrative_for_upgrade(row: NarrativeCache, db: DBSession) -> dict | None:
    narrative = _call_narrative_llm(
        summary_from_signature(row.signature), db, force_refresh=True
    )
    db.flush()
    db.refresh(row)
    return narrative if row.source == "llm" else None


def upgrade_rule_narratives(db: DBSession, limit: int = 5) -> int:
    """오래된 규칙 항목부터 최대 limit개를 시도하고 성공한 수를 반환한다."""
    if limit < 1:
        return 0
    rows = (
        db.query(NarrativeCache)
        .filter(NarrativeCache.source == "rule")
        .order_by(NarrativeCache.updated_at, NarrativeCache.signature)
        .limit(limit)
        .all()
    )
    upgraded = 0
    for row in rows:
        narrative = _generate_narrative_for_upgrade(row, db)
        if narrative is None:
            continue
        row.narrative = narrative
        row.source = "llm"
        upgraded += 1
    db.commit()
    return upgraded


try:
    from celery import shared_task

    @shared_task(name="tasks.upgrade_narrative_cache")
    def upgrade_narrative_cache_task(limit: int = 5) -> int:
        from app.core.database import SessionLocal

        db = SessionLocal()
        try:
            return upgrade_rule_narratives(db, limit=limit)
        finally:
            db.close()
except Exception:  # Celery 미설치 환경에서도 순수 함수를 사용할 수 있다.
    pass
