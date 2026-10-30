"""AI 리포트 API"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response, Header
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user, get_current_user_optional, require_roles
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
from app.services import report_hierarchy_service

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


@router.get("/counts")
def badge_counts(
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """배지용 경량 집계(unread, pending_review) — 목록 본문을 내려받지 않는다."""
    return report_service.count_reports_badges(current_user["id"], db)


@router.get("/hierarchy")
def hierarchy(
    q: str | None = Query(default=None, max_length=100),
    tab: str = Query(default="all"),
    counselor_id: str | None = None,
    activity: str | None = Query(default=None, max_length=20),
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=10, ge=1, le=50),
    current_user: dict = Depends(require_roles("counselor", "org_admin")),
    db: DBSession = Depends(get_db),
):
    """SDD-253: 클래스 > 회차 > 회원 > 리포트 계층 조회(회차 단위 페이지네이션)."""
    return report_hierarchy_service.build_hierarchy(
        current_user["id"], db, q=q, tab=tab, counselor_id=counselor_id, activity=activity,
        date_from=date_from, date_to=date_to, page=page, limit=limit,
    )


@router.put("/read-all")
def mark_all_read(
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """내담자 리포트 전체 읽음 — 쌓인 미열람 리포트를 한 번에 처리한다."""
    count = report_service.mark_all_read(current_user["id"], db)
    return {"count": count}


@router.post("/approve-all")
def approve_all(
    current_user: dict = Depends(require_roles("counselor")),
    db: DBSession = Depends(get_db),
):
    """상담사 일괄 승인 — 검토중(pending_review) 리포트를 코멘트 없이 모두 승인·발송한다."""
    return report_service.approve_all_reports(current_user["id"], db)


@router.get("/{report_id}/pdf")
def download_pdf(
    report_id: str,
    current_user: dict = Depends(require_roles("counselor", "org_admin")),
    db: DBSession = Depends(get_db),
):
    report = report_service.get_report(report_id, current_user["id"], db)
    if report["status"] != "completed":
        raise HTTPException(409, "승인된 리포트만 PDF로 다운로드할 수 있습니다.")
    return pdf_response(report)


@router.get("/{report_id}", response_model=ReportResponse)
def get_one(
    report_id: str,
    current_user: dict | None = Depends(get_current_user_optional),
    member_credential: str | None = Header(default=None, alias="X-Class-Member-Credential"),
    db: DBSession = Depends(get_db),
):
    if current_user is None and member_credential is None:
        raise HTTPException(401, detail="인증이 필요합니다")
    return report_service.get_report(report_id, current_user["id"] if current_user else None, db,
        member_credential=member_credential)


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


@router.post("/{report_id}/approve-and-send", response_model=ReportResponse)
def approve_and_send(
    report_id: str,
    current_user: dict = Depends(require_roles("counselor", "org_admin")),
    db: DBSession = Depends(get_db),
):
    """SDD-253 D4: 승인하고 발송 — 승인(멱등)과 발송 예약을 한 행동으로 묶는다.

    기존 승인과 같은 경로를 재사용하므로 메일을 이중 예약하지 않고, 재호출로 승인자·시각이 바뀌지 않는다.
    """
    result = report_service.approve_report(report_id, current_user["id"], db)
    return report_service.attach_capabilities(result, report_id, current_user["id"], db)


@router.post("/{report_id}/retry-delivery", response_model=ReportResponse)
def retry_delivery(
    report_id: str,
    current_user: dict = Depends(require_roles("counselor", "org_admin")),
    db: DBSession = Depends(get_db),
):
    """SDD-253 D4: 발송 실패 건 다시 발송(승인자·승인 시각 불변)."""
    result = report_service.retry_report_delivery(report_id, current_user["id"], db)
    return report_service.attach_capabilities(result, report_id, current_user["id"], db)


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
