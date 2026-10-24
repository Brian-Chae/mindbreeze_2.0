"""SDD-237 상담사용 클래스 리포트의 AI 서사 태스크.

- 통계·규칙 문장은 리포트 생성 체인에서 이미 저장됐다. 이 태스크는 그 위에 AI 초안(`ai_draft`)만 채운다.
- 호출은 회차당 1회(같은 입력 해시면 성공·실패 불문 재호출 0), 재시도 없음. 실패·꺼짐·검증 실패는 모두 규칙 문장이 확정이다.
- 입력은 이름 없는 집계뿐이다(상담사 수정 문장·비공개 메모·전사·개인 값 제외).
- 리포트 `status`/`generation_status`/`generation_error` 는 AI 결과와 무관하게 바꾸지 않는다.
- 로그에는 사유 코드만 남기고 입력·출력 원문은 남기지 않는다.
"""

import logging
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session as DBSession

from app.config import settings
from app.models.record import Report
from app.models.session import Session, SessionParticipant
from app.models.user import User
from app.services import class_report_narrative as narrative
from app.tasks import summary_task

logger = logging.getLogger(__name__)

AI_TIMEOUT_SECONDS = 30


def _outcome_for(exc: Exception) -> str:
    """예외 → 사유 코드. 원문 메시지는 로그에 남기지 않는다."""
    import requests

    from app.core.celery_app import RetryableTaskError

    if isinstance(exc, requests.Timeout):
        return "timeout"
    if isinstance(exc, (RetryableTaskError, requests.RequestException)):
        return "http_error"
    if isinstance(exc, ValueError):
        return "schema_mismatch"
    if isinstance(exc, RuntimeError) and "api_key" in str(exc).lower():
        return "no_key"
    return "error"


def _participant_names(db: DBSession, session_id) -> list[str]:
    """출력에 이름이 섞였는지 검사하기 위한 서버 내부 목록. 외부(LLM)로는 나가지 않는다."""
    names = []
    for p in db.query(SessionParticipant).filter(SessionParticipant.session_id == session_id).all():
        if p.guest_name:
            names.append(p.guest_name)
        if p.user_id:
            user = db.query(User).filter(User.id == p.user_id).first()
            if user and user.name:
                names.append(user.name)
    return names


def _counselor_report(db: DBSession, session_id) -> Report | None:
    return (
        db.query(Report)
        .filter(Report.session_id == session_id, Report.type == "counselor")
        .order_by(Report.created_at.asc(), Report.id.asc())
        .first()
    )


def _block(report: Report | None) -> dict | None:
    content = report.content if report is not None and isinstance(report.content, dict) else {}
    block = content.get("class_report")
    return block if isinstance(block, dict) else None


def _record(db: DBSession, report_id, stats_hash: str, accepted: dict, rejected: list, *, ai_hash: str,
            outcome: str) -> str:
    """결과를 리포트에 저장한다. 행을 잠그고 최신 블록을 다시 읽어, 그 사이 수정/재생성이 있었으면 버린다."""
    report = (
        db.query(Report).filter(Report.id == report_id).with_for_update().populate_existing().one()
    )
    block = _block(report)
    if block is None or (block.get("narrative") or {}).get("input_hash") != stats_hash:
        db.rollback()
        return "stale_input"
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    new_block = narrative.apply_ai_result(
        block, accepted, rejected, ai_hash=ai_hash, outcome=outcome, model=settings.gemini_model, now_iso=now)
    report.content = {**report.content, "class_report": new_block}
    db.commit()
    return outcome


def run_class_report_narrative(session_id: str, db: DBSession) -> str:
    """AI 서사 1회 실행. 결과 코드를 돌려준다(테스트·관측용)."""
    from app.core.ai_features import AiFeaturesDisabled, is_ai_enabled

    session = db.query(Session).filter(Session.id == UUID(str(session_id))).first()
    if session is None or session.class_id is None:
        return "skipped"
    if not is_ai_enabled():
        return "disabled"
    report = _counselor_report(db, session.id)
    block = _block(report)
    data = narrative.build_ai_input(block) if block else None
    if data is None:
        return "skipped"
    ai_hash = narrative.ai_input_hash(data)
    attempt = (block.get("narrative") or {}).get("ai_attempt")
    if isinstance(attempt, dict) and attempt.get("hash") == ai_hash:
        return "already_attempted"
    stats_hash = (block.get("narrative") or {}).get("input_hash")
    report_id = report.id
    names = _participant_names(db, session.id)
    prompt = narrative.build_prompt(data)
    db.rollback()     # AI 호출(최대 30초) 동안 DB 트랜잭션·잠금을 잡고 있지 않는다.

    try:
        text = summary_task._call_gemini_text(prompt, json_mode=True, timeout=AI_TIMEOUT_SECONDS)
    except AiFeaturesDisabled:
        return "disabled"
    except Exception as exc:  # noqa: BLE001 — 어떤 실패도 규칙 문장 확정 + 사유 코드만 기록
        outcome = _outcome_for(exc)
        logger.warning("[class_report] AI 서사 실패: session_id=%s outcome=%s", session.id, outcome)
        return _record(db, report_id, stats_hash, {}, [], ai_hash=ai_hash, outcome=outcome)

    raw = narrative.parse_ai_response(text)
    if raw is None or not narrative.schema_ok(raw):
        eligible = narrative.eligible_ai_keys(data)
        logger.warning("[class_report] AI 서사 스키마 불일치: session_id=%s", session.id)
        return _record(db, report_id, stats_hash, {}, eligible, ai_hash=ai_hash, outcome="schema_mismatch")
    accepted, rejected = narrative.validate_fields(raw, data, names=names)
    outcome = "ok" if accepted else "all_rejected"
    if rejected:
        logger.info("[class_report] AI 서사 필드 폐기: session_id=%s rejected=%s", session.id, len(rejected))
    return _record(db, report_id, stats_hash, accepted, rejected, ai_hash=ai_hash, outcome=outcome)


try:
    from app.core.celery_app import celery_app

    # AI 실패는 재시도하지 않는다(autoretry 없음) — 규칙 문장이 확정이라 상담사 화면이 AI 때문에 비지 않는다.
    @celery_app.task(name="tasks.class_report_narrative", soft_time_limit=60, time_limit=90)
    def class_report_narrative_task(session_id: str) -> str:
        from app.core.database import SessionLocal

        db = SessionLocal()
        try:
            return run_class_report_narrative(session_id, db)
        finally:
            db.close()
except Exception:  # noqa: BLE001
    logger.exception("[class_report_task] Celery 태스크 등록 실패 — AI 서사 태스크 미등록 가능")


def enqueue_class_report_narrative(session_id: str) -> None:
    """리포트 생성 직후 AI 서사를 비동기로 예약한다. 브로커 장애는 호출부가 삼킨다(best-effort)."""
    class_report_narrative_task.apply_async(args=[session_id], retry=False)
