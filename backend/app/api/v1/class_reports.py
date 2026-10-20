"""SDD-218 클래스 리포트 일괄 작업 API (plan.md §2).

접수는 202 로 즉시 돌려주고 실제 처리는 백그라운드에서 한다.
기존 단건 승인(`POST /reports/{id}/approve`)과 `POST /reports/approve-all` 은 건드리지 않는다.
"""

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Response
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user
from app.api.v1.classes import scheduling_enabled
from app.core.database import get_db
from app.schemas.class_report_job import ReportJobCommand, ReportJobResponse
from app.services import class_report_job_service as job_service

router = APIRouter(
    prefix="/classes", tags=["classes"], dependencies=[Depends(scheduling_enabled)]
)


def _run_in_background(job_id: str) -> None:
    """백그라운드 실행은 자체 세션을 연다. 요청 세션을 재사용하지 않는다."""
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        job_service.run_job(db, job_id)
    finally:
        db.close()


@router.post(
    "/{class_id}/report-jobs", response_model=ReportJobResponse, status_code=202
)
def create_report_job(
    class_id: UUID,
    payload: ReportJobCommand,
    background_tasks: BackgroundTasks,
    response: Response,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    result = job_service.accept_job(
        db,
        actor_id=current_user["id"],
        class_id=class_id,
        action=payload.action,
        operation_key=payload.operation_key,
        targets=[str(t) for t in payload.targets],
        session_id=payload.session_id,
    )
    # 이미 끝난 작업을 멱등 재요청한 경우에는 다시 돌리지 않는다.
    if result["status"] != "completed":
        background_tasks.add_task(_run_in_background, result["job_id"])
    response.headers["Location"] = f"/api/v1/classes/{class_id}/report-jobs/{result['job_id']}"
    return result


@router.get("/{class_id}/report-jobs/{job_id}", response_model=ReportJobResponse)
def get_report_job(
    class_id: UUID,
    job_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    return job_service.job_result(db, job_id, actor_id=current_user["id"], class_id=class_id)


@router.post(
    "/{class_id}/report-jobs/{job_id}/retry",
    response_model=ReportJobResponse,
    status_code=202,
)
def retry_report_job(
    class_id: UUID,
    job_id: UUID,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    result = job_service.reopen_failed(db, job_id, current_user["id"], class_id=class_id)
    background_tasks.add_task(_run_in_background, str(job_id))
    return result


@router.get("/{class_id}/me/trend")
def get_my_trend(
    class_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    """본인 변화 추이. 승인된 본인 리포트만 쓴다 (D-43: 회원 전용)."""
    from app.services import class_report_trend_service as trend

    return trend.member_trend(db, class_id=class_id, viewer_user_id=current_user["id"])


@router.get("/{class_id}/sessions/{session_id}/summary")
def get_session_summary(
    class_id: UUID,
    session_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    """회차 출석 요약과 익명 방향 분포. 개인별 수치·순위는 제공하지 않는다."""
    from app.api.v1.classes import load_class_actor
    from app.services import class_report_trend_service as trend

    # 클래스 열람 권한을 기존 판정으로 확인한다. 새로 넓히지 않는다.
    load_class_actor(db, class_id, current_user, "host_request")
    return trend.session_summary(db, class_id=class_id, session_id=session_id)
