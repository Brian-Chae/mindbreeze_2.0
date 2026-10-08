"""SDD-188: AI 에이전트 주기 태스크.

celery beat 는 제거됐으므로(INFRA-08) 실제 실행은 OS cron
(`sweep_agent_reminders_cron.py`·`sweep_agent_briefings_cron.py`, 각 매 1분)이 담당한다.
여기서는 DB 세션 수명과 태스크 등록만 책임지고 로직은 `agent_reminder.sweep` /
`agent_briefing.sweep` 에 둔다(테스트에서 직접 호출 가능).
"""

import logging

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="tasks.sweep_agent_reminders")
def sweep_agent_reminders(limit: int = 200) -> dict:
    """예약 사전 노티(3시간 전·1시간 전) + 일정 정정 안내 스윕 1회."""
    from app.core.database import SessionLocal
    from app.services import agent_reminder

    with SessionLocal() as db:
        return agent_reminder.sweep(db, limit=limit)


@celery_app.task(name="tasks.sweep_agent_briefings")
def sweep_agent_briefings(limit: int = 500) -> dict:
    """SDD-189: 상담사 아침 일정 브리핑 · 저녁 상담 정리 스윕 1회."""
    from app.core.database import SessionLocal
    from app.services import agent_briefing

    with SessionLocal() as db:
        return agent_briefing.sweep(db, limit=limit)


@celery_app.task(name="tasks.sweep_agent_checkins")
def sweep_agent_checkins(limit: int = 500) -> dict:
    """SDD-191: 안부 아웃리치 스윕 1회 + 방치된 열린 체크인 마무리."""
    from app.core.database import SessionLocal
    from app.services import agent_checkin

    with SessionLocal() as db:
        result = agent_checkin.sweep(db, limit=limit)
        result["closed"] = agent_checkin.close_stale(db)
        return result
