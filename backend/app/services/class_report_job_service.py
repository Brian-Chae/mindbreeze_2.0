"""SDD-218 클래스 리포트 일괄 작업 실행기 (plan.md §3).

3단계로 나눈다. 시안 R2 화면의 단계와 1:1 대응한다.
  ① 접수            — operation_key 멱등 검사 후 작업 생성, 202 반환
  ② 대상 확정·권한 재검사 — 실행 시점에 다시 판정한다. 접수 시점 권한으로 실행하지 않는다.
  ③ 건별 처리        — 건마다 독립 트랜잭션. 한 건의 실패가 다른 건에 영향을 주지 않는다.

`failed`(재시도 가능)와 `excluded`(정책상 처리 제외)를 분리하는 것이 이 모듈의 핵심 계약이다.
"""

import hashlib
import json
import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from app.models.class_program import Class
from app.models.class_report_job import (
    JOB_ACTIONS,
    ClassReportJob,
    ClassReportJobItem,
)
from app.models.record import Report
from app.models.session import Session, SessionParticipant
from app.models.user import User

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _to_uuid(value) -> UUID:
    return value if isinstance(value, UUID) else UUID(str(value))


def _digest(action: str, class_id, targets: list[str]) -> str:
    """대상 순서가 달라도 같은 요청으로 본다."""
    payload = {
        "action": action,
        "class_id": str(class_id),
        "targets": sorted(str(t) for t in targets),
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


# ──────────────────────────── ② 대상 확정 ────────────────────────────

def _is_current_lead(db: DBSession, actor: User, class_id) -> bool:
    """클래스 단위 주강사 여부. 대상마다 다시 계산할 필요가 없다."""
    if actor is None or actor.status != "active":
        return False
    from app.services.class_access_service import class_role

    cls = db.query(Class).filter(Class.id == _to_uuid(class_id)).first()
    if cls is None:
        return False
    return class_role(db, actor, cls) == "lead"


def classify_target(
    db: DBSession,
    actor: User,
    report: Report,
    *,
    session=None,
    participant=None,
    is_lead: bool | None = None,
) -> tuple[str, str | None]:
    """실행 시점 판정. (state, reason_code) 를 돌려준다.

    excluded 는 재시도해도 결과가 달라지지 않는 정책적 제외다.
    session/participant/is_lead 를 미리 넘기면 조회를 건너뛴다(N+1 방지).
    """
    if session is None:
        session = db.query(Session).filter(Session.id == report.session_id).first()
    if session is None:
        return "excluded", "not_target"

    # 실행 시점에 권한을 다시 본다 (verify A10).
    if is_lead:
        authorized = actor is not None and actor.status == "active"
    else:
        from app.services.report_service import can_approve_report

        authorized = can_approve_report(db, actor, session)
    if not authorized:
        return "excluded", "forbidden"

    if participant is None and report.participant_id:
        participant = (
            db.query(SessionParticipant)
            .filter(
                SessionParticipant.id == report.participant_id,
                SessionParticipant.session_id == report.session_id,
            )
            .first()
        )

    if participant is not None:
        # 결석·이탈자는 리포트 대상이 아니다. 빈 리포트나 0점을 만들지 않는다.
        if participant.attendance_status in ("excused", "withdrawn"):
            return "excluded", "absent"
        if participant.removed_at is not None:
            return "excluded", "not_target"
        # 실행 중 동의가 철회된 건은 실패가 아니라 제외다 (verify B9).
        if _consent_withdrawn(db, participant):
            return "excluded", "consent_withdrawn"

    # 분석 미완/실패 상태는 승인 대상이 아니다. 재생성으로 풀어야 한다.
    if report.status not in ("pending_review", "completed"):
        return "excluded", "not_target"

    return "pending", None


def _consent_withdrawn(db: DBSession, participant) -> bool:
    """회차 리포트 반영이 철회됐는지 본다 (217/209 계약을 읽기만 한다).

    `report_included` 는 명시 선택 시에만 참이다. 회차 override 가 걸린 상태에서
    꺼져 있으면 참여자가 이 회차를 직접 뺀 것이므로 처리 제외로 본다.
    override 없이 기본 제외인 경우는 애초에 리포트 대상이 아니다(`not_target`).
    """
    if not getattr(participant, "report_consent_override", False):
        return False
    return participant.report_included is False


# ──────────────────────────── ① 접수 ────────────────────────────

def accept_job(
    db: DBSession,
    *,
    actor_id,
    class_id,
    action: str,
    operation_key: str,
    targets: list[str],
    session_id=None,
) -> dict:
    """작업을 접수하고 202 응답 본문을 돌려준다.

    같은 operation_key + 같은 본문은 기존 job 을 그대로 돌려준다(멱등).
    같은 key 인데 본문이 다르면 409 로 막는다.
    """
    if action not in JOB_ACTIONS:
        raise HTTPException(422, detail={"code": "unsupported_action"})
    if not targets:
        raise HTTPException(422, detail={"code": "empty_targets"})

    actor_id, class_id = _to_uuid(actor_id), _to_uuid(class_id)
    digest = _digest(action, class_id, targets)

    prior = (
        db.query(ClassReportJob)
        .filter(
            ClassReportJob.actor_id == actor_id,
            ClassReportJob.operation_key == operation_key,
        )
        .first()
    )
    if prior is not None:
        if prior.request_hash != digest:
            raise HTTPException(409, detail={"code": "operation_key_reused"})
        return job_result(db, prior.id)

    actor = db.query(User).filter(User.id == actor_id).first()
    if actor is None or actor.status != "active":
        raise HTTPException(403, detail={"code": "action_forbidden"})
    cls = db.query(Class).filter(Class.id == class_id).first()
    if cls is None:
        raise HTTPException(404, detail={"code": "class_not_found"})

    reports = (
        db.query(Report)
        .filter(Report.id.in_([_to_uuid(t) for t in targets]))
        .all()
    )
    found = {r.id for r in reports}
    missing = [t for t in targets if _to_uuid(t) not in found]

    job = ClassReportJob(
        class_id=class_id,
        session_id=_to_uuid(session_id) if session_id else None,
        action=action,
        status="accepted",
        actor_id=actor_id,
        operation_key=operation_key,
        request_hash=digest,
    )
    db.add(job)
    db.flush()

    # N+1 방지: 세션과 참여자를 한 번에 읽어 둔다 (verify B12·B13).
    session_ids = {r.session_id for r in reports}
    sessions = {
        s.id: s for s in db.query(Session).filter(Session.id.in_(session_ids)).all()
    }
    participant_ids = {r.participant_id for r in reports if r.participant_id}
    participants = (
        {
            p.id: p
            for p in db.query(SessionParticipant)
            .filter(SessionParticipant.id.in_(participant_ids))
            .all()
        }
        if participant_ids
        else {}
    )
    # 클래스 단위 권한은 리포트마다 달라지지 않는다. 회차 호스트 여부만 건별로 본다.
    approver_is_lead = _is_current_lead(db, actor, class_id)

    on_behalf = False
    accepted = 0
    for report in reports:
        session = sessions.get(report.session_id)
        # 다른 클래스의 리포트를 섞어 보내는 경로를 막는다 (IDOR).
        if session is None or session.class_id != class_id:
            state, reason = "excluded", "not_target"
        else:
            state, reason = classify_target(
                db,
                actor,
                report,
                session=session,
                participant=participants.get(report.participant_id),
                is_lead=approver_is_lead,
            )
            if state == "pending" and session.host_id != actor_id:
                on_behalf = True
        if state == "pending":
            accepted += 1
        db.add(
            ClassReportJobItem(
                job_id=job.id, report_id=report.id, state=state, reason_code=reason
            )
        )

    for target in missing:
        logger.warning("[class_report_job] 존재하지 않는 리포트 대상: %s", target)

    job.accepted_count = accepted
    job.on_behalf = on_behalf
    db.commit()
    return job_result(db, job.id)


# ──────────────────────────── ③ 건별 처리 ────────────────────────────

def process_item(db: DBSession, item_id) -> str:
    """건 1개를 처리한다. 호출자는 건마다 독립 세션을 쓴다.

    이미 처리된 건은 다시 실행해도 아무 효과가 없다 (워커 재시도 안전, verify B5).
    """
    from app.services import report_service

    item = (
        db.query(ClassReportJobItem)
        .filter(ClassReportJobItem.id == _to_uuid(item_id))
        .populate_existing()
        .with_for_update()
        .first()
    )
    if item is None:
        return "missing"
    if item.state != "pending":
        # succeeded / excluded / failed 는 여기서 재처리하지 않는다.
        # failed 의 재시도는 retry_job 이 state 를 pending 으로 되돌린 뒤 들어온다.
        return item.state

    job = db.query(ClassReportJob).filter(ClassReportJob.id == item.job_id).first()
    actor = db.query(User).filter(User.id == job.actor_id).first()
    report = db.query(Report).filter(Report.id == item.report_id).first()

    item.attempts += 1

    # 실행 직전에 한 번 더 본다. 접수 이후 상태가 바뀌었을 수 있다.
    state, reason = classify_target(db, actor, report) if report else ("excluded", "not_target")
    if state != "pending":
        item.state, item.reason_code = state, reason
        item.processed_at = _now()
        db.commit()
        return item.state

    try:
        if job.action == "approve":
            report_service.approve_report(str(report.id), str(actor.id), db)
        elif job.action == "resend_email":
            from app.services.report_email_service import enqueue_report_email

            enqueue_report_email(str(report.id))
        elif job.action == "regenerate":
            report_service.generate_report_inline(str(report.id), db)
        item.state = "succeeded"
        item.reason_code = None
        item.error_message = None
    except HTTPException as exc:
        # 권한이 사라진 경우는 실패가 아니라 제외로 분류한다.
        if exc.status_code == 403:
            item.state, item.reason_code = "excluded", "forbidden"
        else:
            item.state, item.reason_code = "failed", "http_error"
            item.error_message = str(exc.detail)[:500]
    except Exception as exc:  # noqa: BLE001 — 한 건의 실패가 작업 전체를 멈추지 않는다
        logger.exception("[class_report_job] 건별 처리 실패: item=%s", item.id)
        item.state, item.reason_code = "failed", "internal_error"
        item.error_message = str(exc)[:500]

    item.processed_at = _now()
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return "conflict"
    return item.state


def run_job(db: DBSession, job_id) -> dict:
    """작업의 모든 pending 건을 순차 처리한다."""
    job_id = _to_uuid(job_id)
    job = db.query(ClassReportJob).filter(ClassReportJob.id == job_id).first()
    if job is None:
        raise HTTPException(404, detail={"code": "job_not_found"})
    if job.status == "accepted":
        job.status = "running"
        db.commit()

    item_ids = [
        row[0]
        for row in db.query(ClassReportJobItem.id)
        .filter(
            ClassReportJobItem.job_id == job_id,
            ClassReportJobItem.state == "pending",
        )
        .all()
    ]
    for item_id in item_ids:
        process_item(db, item_id)

    job = db.query(ClassReportJob).filter(ClassReportJob.id == job_id).first()
    job.status = "completed"
    job.completed_at = _now()
    db.commit()
    return job_result(db, job_id)


def reopen_failed(db: DBSession, job_id, actor_id, *, class_id=None) -> dict:
    """실패한 건만 pending 으로 되돌린다. succeeded·excluded 는 건드리지 않는다 (verify B7).

    실제 재실행은 호출자(API 백그라운드 또는 retry_job)가 이어서 한다.
    """
    job_id = _to_uuid(job_id)
    job = _owned_job(db, job_id, actor_id=actor_id, class_id=class_id)

    failed = (
        db.query(ClassReportJobItem)
        .filter(
            ClassReportJobItem.job_id == job_id,
            ClassReportJobItem.state == "failed",
        )
        .all()
    )
    for item in failed:
        item.state = "pending"
        item.reason_code = None
        item.error_message = None
    job.status = "running"
    db.commit()
    return job_result(db, job_id)


def retry_job(db: DBSession, job_id, actor_id, *, class_id=None) -> dict:
    """실패 건을 되돌리고 바로 재실행한다(동기). 테스트·워커용."""
    reopen_failed(db, job_id, actor_id, class_id=class_id)
    return run_job(db, job_id)


# ──────────────────────────── 조회 ────────────────────────────

def _owned_job(db: DBSession, job_id, *, actor_id=None, class_id=None) -> ClassReportJob:
    """작업 소유권을 확인한다. 남의 작업·다른 클래스의 작업은 404 로 가린다 (IDOR)."""
    job = db.query(ClassReportJob).filter(ClassReportJob.id == _to_uuid(job_id)).first()
    if job is None:
        raise HTTPException(404, detail={"code": "job_not_found"})
    if class_id is not None and job.class_id != _to_uuid(class_id):
        raise HTTPException(404, detail={"code": "job_not_found"})
    if actor_id is not None and job.actor_id != _to_uuid(actor_id):
        raise HTTPException(403, detail={"code": "action_forbidden"})
    return job


def job_result(db: DBSession, job_id, *, actor_id=None, class_id=None) -> dict:
    job_id = _to_uuid(job_id)
    job = _owned_job(db, job_id, actor_id=actor_id, class_id=class_id)

    rows = (
        db.query(ClassReportJobItem, Report)
        .join(Report, Report.id == ClassReportJobItem.report_id)
        .filter(ClassReportJobItem.job_id == job_id)
        .order_by(ClassReportJobItem.created_at)
        .all()
    )
    items = [
        {
            "report_id": str(item.report_id),
            "state": item.state,
            "reason_code": item.reason_code,
            # 재시도 수단을 노출할지 여부를 서버가 정한다 (verify B8).
            "retriable": item.state == "failed",
            "approved_by": str(report.approved_by_user_id) if report.approved_by_user_id else None,
            "processed_at": item.processed_at.isoformat() if item.processed_at else None,
            "error_message": item.error_message,
        }
        for item, report in rows
    ]
    return {
        "job_id": str(job.id),
        "class_id": str(job.class_id),
        "action": job.action,
        "status": job.status,
        "on_behalf": job.on_behalf,
        "accepted": job.accepted_count,
        "excluded": [i for i in items if i["state"] == "excluded"],
        "items": items,
    }
