"""기관 도입 문의 공개 API (SDD-248) — 비로그인 접수"""

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.redis import get_redis
from app.schemas.org_inquiry import OrgInquiryCreate, OrgInquiryCreatedResponse
from app.services import org_inquiry_service as svc

router = APIRouter(prefix="/public/org-inquiries", tags=["org-inquiries"])


@router.post("", response_model=OrgInquiryCreatedResponse, status_code=status.HTTP_201_CREATED)
async def create_org_inquiry(
    request: Request,
    req: OrgInquiryCreate,
    db: Session = Depends(get_db),
    redis=Depends(get_redis),
):
    """기관 도입 문의 접수 — 저장 후 운영자 메일을 비동기 발송한다(메일 실패해도 201)."""
    client_ip = request.client.host if request.client else None
    await svc.check_rate_limit(client_ip, redis)
    row = svc.create_inquiry(req, db)
    svc.enqueue_notice(row, db)
    return OrgInquiryCreatedResponse(inquiry_id=str(row.id), status=row.status)
