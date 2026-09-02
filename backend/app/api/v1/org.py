"""상담센터(Organization) API 라우터"""

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from redis.asyncio import Redis
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.redis import get_redis
from app.schemas.org import (
    CounselorInviteRequest,
    CounselorInviteResponse,
    CounselorResponse,
    JoinRequestResponse,
    JoinRequestUpdate,
    OrganizationCreate,
    OrganizationResponse,
    OrganizationSearchResult,
    OrgJoinRequestDetail,
)
from app.services import org_service

router = APIRouter(prefix="/org", tags=["org"])


def _require_org_admin(current_user: dict, org_id: str) -> None:
    """본인 기관의 org_admin 만 통과. 아니면 403."""
    if current_user.get("role") != "org_admin" or str(current_user.get("org_id") or "") != str(org_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="센터 관리자만 접근할 수 있습니다",
        )


def _counselor_to_response(u) -> CounselorResponse:
    return CounselorResponse(
        id=str(u.id),
        name=u.name,
        email=u.email,
        role=u.role,
        status=u.status,
        invited_at=u.invited_at.isoformat() if u.invited_at else None,
        invite_expires_at=u.invite_expires_at.isoformat() if u.invite_expires_at else None,
    )


def _serialize_org(org) -> OrganizationResponse:
    return OrganizationResponse(
        id=str(org.id),
        name=org.name,
        ceo_name=org.ceo_name,
        biz_number=org.biz_number,
        address=org.address,
        phone=org.phone,
        org_code=org.org_code,
        verified=org.verified,
        verified_at=org.verified_at.isoformat() if org.verified_at else None,
        created_at=org.created_at.isoformat() if org.created_at else "",
    )


@router.get("/search", response_model=list[OrganizationSearchResult])
async def search_orgs(
    q: str | None = Query(default=None),
    region: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """센터 검색 — 이름/주소 부분 일치."""
    orgs = org_service.search_organizations(q, region, db)
    return [
        OrganizationSearchResult(
            id=str(o.id), name=o.name, address=o.address, verified=o.verified
        )
        for o in orgs
    ]


@router.post("/register", response_model=OrganizationResponse, status_code=status.HTTP_201_CREATED)
async def register_org(
    req: OrganizationCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """센터 등록 — 신청자를 OrgAdmin으로 승격."""
    org = org_service.create_organization(req, current_user["id"], db)
    return _serialize_org(org)


@router.get("/requests", response_model=list[JoinRequestResponse])
async def my_join_requests(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """내가 신청한 가입 요청 목록."""
    rows = org_service.list_my_join_requests(current_user["id"], db)
    return [JoinRequestResponse(**r) for r in rows]


@router.get("/{org_id}/requests", response_model=list[OrgJoinRequestDetail])
async def org_join_requests(
    org_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """센터의 가입 요청 목록 — OrgAdmin 전용."""
    if current_user.get("role") != "org_admin" or str(current_user.get("org_id", "")) != str(org_id):
        from fastapi import HTTPException
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="센터 관리자만 조회할 수 있습니다")
    rows = org_service.list_org_join_requests(org_id, db)
    return [OrgJoinRequestDetail(**r) for r in rows]


@router.get("/{org_id}", response_model=OrganizationResponse)
async def get_org(org_id: str, db: Session = Depends(get_db)):
    """센터 상세 조회."""
    org = org_service.get_organization(org_id, db)
    return _serialize_org(org)


@router.post("/{org_id}/join", response_model=JoinRequestResponse, status_code=status.HTTP_201_CREATED)
async def join_org(
    org_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """센터 가입 신청."""
    req = org_service.request_join(org_id, current_user["id"], db)
    org = org_service.get_organization(org_id, db)
    return JoinRequestResponse(
        id=str(req.id),
        org_id=str(req.org_id),
        org_name=org.name,
        status=req.status,
        reason=req.reason,
        created_at=req.created_at.isoformat() if req.created_at else "",
    )


@router.put("/{org_id}/requests/{req_id}", response_model=JoinRequestResponse)
async def handle_request(
    org_id: str,
    req_id: str,
    body: JoinRequestUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """가입 신청 승인/거절 — OrgAdmin 전용."""
    req = org_service.handle_join_request(
        req_id, org_id, current_user["id"], body.status, body.reason, db
    )
    org = org_service.get_organization(org_id, db)
    return JoinRequestResponse(
        id=str(req.id),
        org_id=str(req.org_id),
        org_name=org.name,
        status=req.status,
        reason=req.reason,
        created_at=req.created_at.isoformat() if req.created_at else "",
    )


@router.get("/{org_id}/counselors", response_model=list[CounselorResponse])
async def list_counselors(
    org_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """센터 소속 상담사 목록 — OrgAdmin 전용. pending/active 상태 포함."""
    _require_org_admin(current_user, org_id)
    users = org_service.get_counselors(org_id, db)
    return [_counselor_to_response(u) for u in users]


@router.post(
    "/{org_id}/counselors/invite",
    response_model=CounselorInviteResponse,
    status_code=status.HTTP_201_CREATED,
)
async def invite_counselor(
    org_id: str,
    req: CounselorInviteRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
    redis: Redis = Depends(get_redis),
):
    """상담사 초대 — OrgAdmin 전용. 이름+이메일 → pending 계정 + 초대 메일."""
    _require_org_admin(current_user, org_id)
    user, invite_sent = await org_service.invite_counselor(
        org_id, req.name, str(req.email), redis, db
    )
    return CounselorInviteResponse(
        counselor=_counselor_to_response(user), invite_sent=invite_sent
    )


@router.post(
    "/{org_id}/counselors/{user_id}/resend-invite",
    response_model=CounselorInviteResponse,
)
async def resend_counselor_invite(
    org_id: str,
    user_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
    redis: Redis = Depends(get_redis),
):
    """상담사 초대 재발송 — OrgAdmin 전용. pending 상태만 허용."""
    _require_org_admin(current_user, org_id)
    user, invite_sent = await org_service.resend_counselor_invite(
        org_id, user_id, redis, db
    )
    return CounselorInviteResponse(
        counselor=_counselor_to_response(user), invite_sent=invite_sent
    )


@router.put("/{org_id}/counselors/{user_id}", response_model=CounselorResponse)
async def update_counselor(
    org_id: str,
    user_id: str,
    body: dict,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """상담사 권한 조정 — OrgAdmin 전용. body: {"role": "counselor"|"org_admin"}"""
    new_role = body.get("role", "")
    user = org_service.update_counselor_role(
        org_id, user_id, new_role, current_user["id"], db
    )
    return _counselor_to_response(user)


@router.delete("/{org_id}/counselors/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_counselor(
    org_id: str,
    user_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """상담사 소속 해제 — OrgAdmin 전용."""
    org_service.remove_counselor(org_id, user_id, current_user["id"], db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
