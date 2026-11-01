"""SDD-263 — 전체 회차 업로드 현황 목록 API (담당 코치·org_admin·platform_admin)."""

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.schemas.upload_status_overview import UploadStatusOverviewResponse
from app.services import upload_status_overview_service as svc

router = APIRouter(prefix="/upload-status", tags=["upload-status"])


@router.get("/overview", response_model=UploadStatusOverviewResponse)
def get_upload_status_overview(
    response: Response,
    limit: int = Query(svc.DEFAULT_LIMIT, ge=1, le=svc.MAX_LIMIT),
    since: str | None = Query(None),
    org_id: UUID | None = None,
    class_id: UUID | None = None,
    status: Literal["needs_attention", "uploading", "received_unreconciled", "no_data"] | None = None,
    if_none_match: str | None = Header(default=None, alias="If-None-Match"),
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """회차별 서버 수신 요약 목록(최근순·진행 중 우선). ETag/304 지원. 계약: specs/sdd-263-*/contract.md"""
    result = svc.load_overview(db, current_user, limit=limit, since=since, org_id=org_id, class_id=class_id,
                               status=status, if_none_match=if_none_match)
    headers = {
        "ETag": result.etag,
        "Cache-Control": "no-store, private",
        "Vary": "Authorization",
        "X-Poll-Interval": str(result.poll_interval_sec),
    }
    if result.body is None:
        return Response(status_code=304, headers=headers)
    response.headers.update(headers)
    return result.body
