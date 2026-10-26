"""[MB261026][FIX] D4 — 플랫폼 관리자 채팅 신고 처리 · 금칙어 관리 API.

권한: 기존 require_platform_admin 재사용(회원·상담사·기관관리자 403, 미인증 401).
"""

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.api.v1.admin import require_platform_admin
from app.core.database import get_db
from app.models.user import User
from app.schemas.chat_report_admin import (
    ChatFilterTermCreate,
    ChatFilterTermItem,
    ChatFilterTermListResponse,
    ChatReportDetail,
    ChatReportListResponse,
    ChatReportTransitionRequest,
    ChatReportTransitionResult,
    ReportStatus,
)
from app.services import chat_report_admin_service as service

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/chat-reports", response_model=ChatReportListResponse)
def list_chat_reports(
    status_filter: ReportStatus | None = Query(default=None, alias="status"),
    overdue: bool = Query(default=False),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=20, ge=1, le=100),
    admin: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """신고 목록(최신순). 메시지 발췌·이메일은 싣지 않는다."""
    return service.list_reports(db, admin.id, status=status_filter, overdue=overdue, page=page, size=size)


@router.get("/chat-reports/{report_id}", response_model=ChatReportDetail)
def get_chat_report(
    report_id: str,
    admin: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """신고 상세 — 신고된 메시지 1건 발췌 포함. 열람은 감사 로그에 남는다."""
    return service.get_report_detail(report_id, admin.id, db)


@router.post("/chat-reports/{report_id}/transition", response_model=ChatReportTransitionResult)
def transition_chat_report(
    report_id: str,
    req: ChatReportTransitionRequest,
    admin: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """처리 상태 변경(접수 확인·판단). 자동 삭제·정지·차단은 하지 않는다. 응답에 발췌·이메일 없음."""
    return service.transition_report(report_id, req.to, req.note, admin.id, db)


@router.get("/chat-filter-terms", response_model=ChatFilterTermListResponse)
def list_chat_filter_terms(
    admin: User = Depends(require_platform_admin),  # noqa: ARG001
    db: Session = Depends(get_db),
):
    return {"items": service.list_terms(db)}


@router.post("/chat-filter-terms", response_model=ChatFilterTermItem, status_code=status.HTTP_201_CREATED)
def add_chat_filter_term(
    req: ChatFilterTermCreate,
    admin: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    return service.add_term(req.term, admin.id, db)


@router.delete("/chat-filter-terms/{term_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_chat_filter_term(
    term_id: str,
    admin: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    service.remove_term(term_id, admin.id, db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
