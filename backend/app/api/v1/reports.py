"""AI 리포트 API"""

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user, require_roles
from app.core.database import get_db
from app.schemas.report import (
    ReportApprovalRequest,
    ReportAutoApproveSetting,
    ReportCommentDraftResponse,
    ReportCommentUpdate,
    ReportCreate,
    ReportEmailResendRequest,
    ReportEmailResendResponse,
    ReportListResponse,
    ReportResponse,
    ReportUpdate,
)
from app.services import report_comment_service
from app.services import report_service
from app.services import report_email_service
from app.services.report_pdf_service import pdf_response

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/view", response_model=ReportResponse)
def view(token: str, response: Response, db: DBSession = Depends(get_db)):
    """이메일 report_view 토큰으로 내담자 리포트를 공개 열람한다."""
    # VIEW-HTTP-004: 공개 열람 JSON — PII 유출 방지를 위해 캐시·리퍼러 노출을 차단한다.
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return report_email_service.get_report_view_content(token, db)


@router.get("/view/pdf")
def view_pdf(token: str, db: DBSession = Depends(get_db)):
    """기존 report_view 검증을 통과한 메일 수신자에게 PDF를 제공한다."""
    return pdf_response(report_email_service.get_report_view_content(token, db))


@router.get("/auto-approve", response_model=ReportAutoApproveSetting)
def get_auto_approve(
    current_user: dict = Depends(require_roles("counselor", "org_admin")),
    db: DBSession = Depends(get_db),
):
    return report_service.get_auto_approve_setting(current_user["id"], db)


@router.patch("/auto-approve", response_model=ReportAutoApproveSetting)
def update_auto_approve(
    payload: ReportAutoApproveSetting,
    current_user: dict = Depends(require_roles("counselor", "org_admin")),
    db: DBSession = Depends(get_db),
):
    return report_service.update_auto_approve_setting(
        current_user["id"], payload.enabled, db
    )


@router.post("/generate/{session_id}", response_model=ReportResponse)
def generate(
    session_id: str,
    payload: ReportCreate,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return report_service.generate_report(
        session_id, current_user["id"], payload.type, db, payload.participant_id
    )


@router.get("", response_model=ReportListResponse)
def list_all(
    page: int | None = Query(default=None, ge=1),
    # VB-09: limit 상한(le) 미지정 → 초대형 limit 대량 조회 차단.
    limit: int | None = Query(default=None, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return report_service.list_reports(current_user["id"], db, page, limit)


@router.get("/{report_id}/pdf")
def download_pdf(
    report_id: str,
    current_user: dict = Depends(require_roles("counselor", "org_admin")),
    db: DBSession = Depends(get_db),
):
    report_service.require_report_host(report_id, current_user["id"], db)
    report = report_service.get_report(report_id, current_user["id"], db)
    if report["status"] != "completed":
        raise HTTPException(409, "승인된 리포트만 PDF로 다운로드할 수 있습니다.")
    return pdf_response(report)


@router.get("/{report_id}", response_model=ReportResponse)
def get_one(
    report_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return report_service.get_report(report_id, current_user["id"], db)


@router.put("/{report_id}", response_model=ReportResponse)
def update(
    report_id: str,
    payload: ReportUpdate,
    current_user: dict = Depends(require_roles("counselor", "org_admin")),
    db: DBSession = Depends(get_db),
):
    # SDD-136: 리포트 본문 수정은 상담사/기관관리자만 — 내담자·게스트의 덮어쓰기 차단.
    return report_service.update_report(report_id, current_user["id"], payload, db)


@router.patch("/{report_id}/comment", response_model=ReportResponse)
def update_comment(
    report_id: str,
    payload: ReportCommentUpdate,
    current_user: dict = Depends(require_roles("counselor", "org_admin")),
    db: DBSession = Depends(get_db),
):
    """SDD-087: 내담자 리포트에 상담사 코멘트 저장 (pending_review 한정, null=삭제)."""
    return report_comment_service.update_client_comment(
        report_id, current_user["id"], payload.comment, db
    )


@router.post("/{report_id}/comment-draft", response_model=ReportCommentDraftResponse)
def create_comment_draft(
    report_id: str,
    current_user: dict = Depends(require_roles("counselor", "org_admin")),
    db: DBSession = Depends(get_db),
):
    """SDD-087: AI(Gemini) 코멘트 초안 생성 — 실패 시 규칙 템플릿 폴백, 저장 없음."""
    return report_comment_service.build_comment_draft(report_id, current_user["id"], db)


@router.post("/{report_id}/approve", response_model=ReportResponse)
def approve(
    report_id: str,
    payload: ReportApprovalRequest | None = None,  # noqa: ARG001
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return report_service.approve_report(report_id, current_user["id"], db)


@router.post(
    "/{report_id}/resend-email",
    response_model=ReportEmailResendResponse,
)
def resend_email(
    report_id: str,
    payload: ReportEmailResendRequest,
    current_user: dict = Depends(require_roles("counselor", "org_admin")),
    db: DBSession = Depends(get_db),
):
    report_service.require_report_host(report_id, current_user["id"], db)
    success = report_email_service.resend_report_email(
        report_id,
        str(payload.email),
        db,
    )
    # RPT-EMAIL-CONTRACT-004: {success, sent, message} 계약 — 프론트가 성공/실패를 구분할 수 있게 한다.
    return {
        "success": success,
        "sent": success,
        "message": (
            f"{payload.email}로 리포트 메일을 발송했습니다"
            if success
            else "메일 발송에 실패했습니다. 잠시 후 다시 시도해 주세요."
        ),
    }
