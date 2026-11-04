"""SDD-285 S1 — 수업 종료 정산: 파일(feature 산출물)에는 있고 DB 에는 없는 창을 대조·적재한다.

- 기본은 **쓰기 없는 모드**(로그만). 환경변수 `FEATURE_RECONCILE_APPLY=true` 일 때만 적재한다(기본 false).
  (config.py 는 이 작업의 담당 경로 밖이라 설정값을 환경변수로 직접 읽는다.)
- 조건: `capture_stream` 이 1개 이상인 참가자만. 제외·건너뜀은 로그에 남긴다.
- 변환·멱등 키·표식(`ingest_path='recon'`)은 `app.services.feature_artifact_reconcile` 공통 모듈을 쓴다.
- 호출 방식: 수업 종료 N분 뒤 `reconcile_session_features.apply_async(args=[session_id], countdown=...)`
  또는 스윕 `sweep_ended_sessions_for_reconcile`(종료 후 N분~M시간 구간의 회차를 찾아 개별 태스크 발행).
  트리거 배선(종료 핸들러·cron 등록)은 별도 담당 경로이므로 이 파일은 태스크만 제공한다.
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)

RECONCILE_DELAY_MIN_DEFAULT = 10  # 수업 종료 후 정산까지 대기(분)
RECONCILE_SWEEP_MAX_HOURS_DEFAULT = 48  # 스윕이 되돌아보는 최대 시간


def reconcile_apply_enabled() -> bool:
    """FEATURE_RECONCILE_APPLY — 기본 false(쓰기 없음)."""
    return os.environ.get("FEATURE_RECONCILE_APPLY", "false").strip().lower() in ("1", "true", "yes", "on")


def _delay_minutes() -> int:
    try:
        return max(0, int(os.environ.get("FEATURE_RECONCILE_DELAY_MIN", RECONCILE_DELAY_MIN_DEFAULT)))
    except ValueError:
        return RECONCILE_DELAY_MIN_DEFAULT


def reconcile_session(db: Any, session_id: uuid.UUID, *, apply: bool | None = None, downloader=None) -> dict[str, Any]:
    """회차 1건 정산. apply=None 이면 설정값(FEATURE_RECONCILE_APPLY)을 따른다. 테스트에서 직접 호출 가능."""
    from app.models.session import SessionParticipant
    from app.services import feature_artifact_reconcile as far

    do_apply = reconcile_apply_enabled() if apply is None else apply
    result: dict[str, Any] = {"session": str(session_id)[:6], "mode": "apply" if do_apply else "dry-run",
                              "participants": 0, "skipped": 0, "would_insert": 0, "inserted": 0, "blocked": 0,
                              "details": []}
    pids = db.execute(select(SessionParticipant.id).where(SessionParticipant.session_id == session_id)).scalars().all()
    for pid in pids:
        plan = far.plan_participant(db, session_id, pid, downloader=downloader)
        db.rollback()  # 계획 단계는 읽기만 했다 — 트랜잭션 정리
        if plan.skipped_reason:
            result["skipped"] += 1
            logger.info("[feature-reconcile] 제외 session=%s participant=%s 사유=%s", str(session_id)[:6], str(pid)[:6], plan.skipped_reason)
            continue
        result["participants"] += 1
        result["would_insert"] += plan.insert_count
        detail = plan.summary()
        if plan.conflicts:
            # 해시 충돌·객체 누락이 있으면 그 참가자는 적재하지 않고 보고만 한다(덮어쓰기 금지).
            result["blocked"] += 1
            detail["blocked"] = True
            logger.warning("[feature-reconcile] 충돌/누락 — 적재 보류 session=%s participant=%s %s",
                           str(session_id)[:6], str(pid)[:6], plan.conflicts[:3])
        elif plan.insert_count:
            if do_apply:
                try:
                    n = far.apply_plan(db, session_id, pid, plan, ingest_path=far.INGEST_PATH_RECON)
                    db.commit()
                except Exception:  # noqa: BLE001
                    db.rollback()
                    logger.exception("[feature-reconcile] 적재 실패 session=%s participant=%s", str(session_id)[:6], str(pid)[:6])
                    detail["error"] = True
                    n = 0
                result["inserted"] += n
                detail["inserted"] = n
            logger.info("[feature-reconcile] %s session=%s participant=%s 삽입%s=%d", result["mode"], str(session_id)[:6],
                        str(pid)[:6], "" if do_apply else "예정", plan.insert_count)
        result["details"].append(detail)
    logger.info("[feature-reconcile] 완료 %s", {k: v for k, v in result.items() if k != "details"})
    return result


@celery_app.task(name="tasks.feature_reconcile_session")
def reconcile_session_features(session_id: str) -> dict[str, Any]:
    """수업 종료 정산 태스크(회차 1건)."""
    from app.core.database import SessionLocal

    with SessionLocal() as db:
        return reconcile_session(db, uuid.UUID(session_id))


@celery_app.task(name="tasks.feature_reconcile_sweep")
def sweep_ended_sessions_for_reconcile() -> dict[str, int]:
    """종료 후 N분~M시간 지난 회차에 정산 태스크를 발행한다(멱등이라 반복 실행해도 안전)."""
    from app.core.database import SessionLocal
    from app.models.session import Session as SessionModel

    now = datetime.now(timezone.utc)
    lo = now - timedelta(hours=RECONCILE_SWEEP_MAX_HOURS_DEFAULT)
    hi = now - timedelta(minutes=_delay_minutes())
    with SessionLocal() as db:
        ids = db.execute(select(SessionModel.id).where(
            SessionModel.ended_at.is_not(None), SessionModel.ended_at >= lo, SessionModel.ended_at <= hi)).scalars().all()
    for sid in ids:
        reconcile_session_features.delay(str(sid))
    logger.info("[feature-reconcile] 스윕 발행 %d건 (적재모드=%s)", len(ids), reconcile_apply_enabled())
    return {"dispatched": len(ids)}
