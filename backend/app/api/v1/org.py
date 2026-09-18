"""상담센터(Organization) API 라우터"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from redis.asyncio import Redis
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.redis import get_redis
from app.models.organization import Organization
from app.schemas.counselor_info import CounselorInfoResponse, CounselorInfoUpdate
from app.schemas.org import (
    CounselorActivityResponse,
    CounselorInviteRequest,
    CounselorInviteResponse,
    CounselorResponse,
    CounselorStatusChangeRequest,
    CounselorStatusResponse,
    JoinRequestResponse,
    JoinRequestUpdate,
    MembershipInviteAcceptRequest,
    MembershipInviteAcceptResponse,
    OrganizationResponse,
    OrganizationSearchResult,
    OrgJoinRequestDetail,
    PasswordResetIssueRequest,
    PasswordResetIssueResponse,
)
from app.services import (
    admin_password_reset_service,
    counselor_info_service,
    membership_service,
    org_service,
)

router = APIRouter(prefix="/org", tags=["org"])


def _require_org_admin(current_user: dict, org_id: str) -> None:
    """본인 기관의 org_admin 만 통과. 아니면 403."""
    if current_user.get("role") != "org_admin" or str(current_user.get("org_id") or "") != str(org_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="센터 관리자만 접근할 수 있습니다",
        )


def _counselor_to_response(u, membership=None, *, has_personal_office: bool = False) -> CounselorResponse:
    """SDD-079: membership 이 주어지면 목록 상태는 membership 기준으로 표시한다.

    membership invited → "pending" (기존 FE 상태값 유지).
    invite_type: 신규 가입 초대(new_account) / 소속 추가 초대(org_membership).
    SDD-082: 계정 정지(suspended)는 로그인이 차단된 상태이므로 membership 상태보다 우선 표기한다.
    """
    if membership is not None:
        status_str = "pending" if membership.status == "invited" else membership.status
        invited_at = membership.invited_at or u.invited_at
        invite_expires_at = membership.invite_expires_at or u.invite_expires_at
        invite_type = None
        if membership.status == "invited":
            invite_type = "new_account" if u.status == "pending" else "org_membership"
    else:
        status_str = u.status
        invited_at = u.invited_at
        invite_expires_at = u.invite_expires_at
        invite_type = None
    if u.status == "suspended":
        status_str = "suspended"
    profile = u.counselor_profile
    return CounselorResponse(
        id=str(u.id),
        name=u.name,
        email=u.email,
        role=u.role,
        status=status_str,
        invited_at=invited_at.isoformat() if invited_at else None,
        invite_expires_at=invite_expires_at.isoformat() if invite_expires_at else None,
        invite_type=invite_type,
        counselor_code=profile.counselor_code if profile else None,
        has_personal_office=has_personal_office,
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


@router.post("/register", status_code=status.HTTP_403_FORBIDDEN)
async def register_org(
    current_user: dict = Depends(get_current_user),  # noqa: ARG001 — 인증만 요구
):
    """센터 자가 등록 차단 (SDD-073).

    기존 흐름(신청자 → org_admin 자가 승격)은 플랫폼 관리자 등록 정책의 우회로였다.
    기관 등록은 /signup-applications/organization 가입 상담 접수 후
    플랫폼 관리자의 기관 등록(/admin/orgs)으로만 진행한다.
    """
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="기관 등록은 가입 상담 신청 후 플랫폼 관리자를 통해 진행됩니다.",
    )


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
    """센터 소속 상담사 목록 — OrgAdmin 전용. membership 기반 (SDD-079)."""
    _require_org_admin(current_user, org_id)
    rows = org_service.get_counselors(org_id, db)
    # SDD-082: 개인 상담소(kind=individual) 소속 여부를 1쿼리로 계산해 배지로 구분한다
    personal_owner_ids: set = set()
    if rows:
        from app.models.user_org_membership import UserOrgMembership

        personal_owner_ids = {
            row[0]
            for row in (
                db.query(UserOrgMembership.user_id)
                .join(Organization, Organization.id == UserOrgMembership.org_id)
                .filter(
                    UserOrgMembership.user_id.in_([u.id for u, _ in rows]),
                    UserOrgMembership.status == "active",
                    Organization.kind == "individual",
                )
                .all()
            )
        }
    return [
        _counselor_to_response(u, m, has_personal_office=u.id in personal_owner_ids)
        for u, m in rows
    ]


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
    """상담사 초대 — OrgAdmin 전용 (SDD-079 자동 분기).

    신규 이메일은 pending 계정 + 초대 메일, 기존 상담사는 소속 추가 초대 메일.
    응답 형태는 두 경우 동일 — 계정 존재 여부를 문구로 노출하지 않는다.
    """
    _require_org_admin(current_user, org_id)
    user, invite_sent = await org_service.invite_counselor(
        org_id, req.name, str(req.email), redis, db
    )
    membership = membership_service.get_membership(db, user.id, org_id)
    return CounselorInviteResponse(
        counselor=_counselor_to_response(user, membership), invite_sent=invite_sent
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
    """상담사 초대 재발송 — OrgAdmin 전용. membership invited 상태만 허용 (SDD-079)."""
    _require_org_admin(current_user, org_id)
    user, invite_sent = await org_service.resend_counselor_invite(
        org_id, user_id, redis, db
    )
    membership = membership_service.get_membership(db, user.id, org_id)
    return CounselorInviteResponse(
        counselor=_counselor_to_response(user, membership), invite_sent=invite_sent
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


# ---------------------------------------------------------------------------
# SDD-077: 기관 관리자 — 소속 상담사 정보 조회·수정 (개인정보 포함, 정책 확정)
# ---------------------------------------------------------------------------


def _parse_target_uuid(user_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="대상 상담사를 찾을 수 없습니다")


@router.get("/{org_id}/counselors/{user_id}/profile", response_model=CounselorInfoResponse)
async def get_org_counselor_profile(
    org_id: str,
    user_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """소속 상담사 정보 조회 — OrgAdmin 전용. 성별/생년월일/전화/주소 포함(정책 확정)."""
    _require_org_admin(current_user, org_id)
    target = counselor_info_service.get_target_counselor(_parse_target_uuid(user_id), db, org_id=org_id)
    return counselor_info_service.serialize(target)


@router.patch("/{org_id}/counselors/{user_id}/profile", response_model=CounselorInfoResponse)
async def patch_org_counselor_profile(
    org_id: str,
    user_id: str,
    req: CounselorInfoUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """소속 상담사 정보 수정 — OrgAdmin 전용. 사유 필수 + 감사 + 대상자 알림.

    기관 관리자 계정(org_admin)은 이 경로로 수정할 수 없다 — 본인 설정 또는
    플랫폼 관리자 수정만 허용한다.
    """
    _require_org_admin(current_user, org_id)
    org = db.query(Organization).filter(Organization.id == uuid.UUID(str(org_id))).first()
    if org is None:
        raise HTTPException(status_code=404, detail="기관을 찾을 수 없습니다")
    if org.deactivated_at is not None:
        raise HTTPException(status_code=409, detail="비활성화된 기관에서는 이 작업을 수행할 수 없습니다")
    target = counselor_info_service.get_target_counselor(_parse_target_uuid(user_id), db, org_id=org_id)
    if target.role == "org_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="기관 관리자 계정은 본인 설정 또는 플랫폼 관리자를 통해 수정할 수 있습니다",
        )
    name_changed = counselor_info_service.update_profile(
        target, req, db, actor_id=uuid.UUID(current_user["id"]), actor_kind="org_admin"
    )
    if name_changed:
        from app.ws.chat_namespace import broadcast_profile_updated
        await broadcast_profile_updated(str(target.id), target.name)
    return counselor_info_service.serialize(target)


@router.post(
    "/{org_id}/counselors/{user_id}/password-reset",
    response_model=PasswordResetIssueResponse,
)
async def reset_org_counselor_password(
    org_id: str,
    user_id: str,
    req: PasswordResetIssueRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
    redis: Redis = Depends(get_redis),
):
    """소속 상담사(active) 비밀번호 재설정 링크 발송 — OrgAdmin 전용 (SDD-078).

    기관 관리자는 소속 상담사만 재설정할 수 있다 — 기관 관리자(org_admin) 계정은
    플랫폼 관리자를 통해서만 재설정한다 (권한 매트릭스 §4).
    """
    from app.models.user import User

    _require_org_admin(current_user, org_id)
    org = db.query(Organization).filter(Organization.id == uuid.UUID(str(org_id))).first()
    if org is None:
        raise HTTPException(status_code=404, detail="기관을 찾을 수 없습니다")
    if org.deactivated_at is not None:
        raise HTTPException(status_code=409, detail="비활성화된 기관에서는 이 작업을 수행할 수 없습니다")
    target = db.query(User).filter(
        User.id == _parse_target_uuid(user_id), User.org_id == org.id,
    ).first()
    if target is None:
        raise HTTPException(status_code=404, detail="대상 상담사를 찾을 수 없습니다")
    if target.role != "counselor":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="기관 관리자 계정은 플랫폼 관리자를 통해 재설정할 수 있습니다",
        )
    actor_id = uuid.UUID(current_user["id"])
    email_sent, expires_at = await admin_password_reset_service.issue_admin_reset(
        target, actor_id=actor_id, actor_name=current_user["name"], actor_role="org_admin",
        reason=req.reason, org_id=org.id, db=db, redis=redis,
    )
    return PasswordResetIssueResponse(email_sent=email_sent, expires_at=expires_at.isoformat())


# ---------------------------------------------------------------------------
# SDD-082: 기관 관리자 — 소속 상담사 활성화/비활성화 + 최근 이력
# ---------------------------------------------------------------------------


@router.post("/{org_id}/counselors/{user_id}/suspend", response_model=CounselorStatusResponse)
async def suspend_org_counselor(
    org_id: str,
    user_id: str,
    req: CounselorStatusChangeRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """소속 상담사 비활성화 — OrgAdmin 전용. 사유 필수 + 감사 + 대상자 알림.

    계정 상태만 suspended 로 변경한다 (데이터 삭제 아님). 정지된 계정은 기존
    suspended 로직으로 로그인이 차단된다. counselor 만 대상 — 자기 자신·org_admin 은 403.
    """
    _require_org_admin(current_user, org_id)
    user = org_service.set_counselor_suspension(
        org_id, user_id, req.reason, current_user["id"], suspend=True, db=db
    )
    return CounselorStatusResponse(id=str(user.id), status=user.status)


@router.post("/{org_id}/counselors/{user_id}/unsuspend", response_model=CounselorStatusResponse)
async def unsuspend_org_counselor(
    org_id: str,
    user_id: str,
    req: CounselorStatusChangeRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """소속 상담사 활성화(정지 해제) — OrgAdmin 전용. 사유 필수 + 감사 + 대상자 알림."""
    _require_org_admin(current_user, org_id)
    user = org_service.set_counselor_suspension(
        org_id, user_id, req.reason, current_user["id"], suspend=False, db=db
    )
    return CounselorStatusResponse(id=str(user.id), status=user.status)


@router.get("/{org_id}/counselors/{user_id}/activity", response_model=CounselorActivityResponse)
async def get_org_counselor_activity(
    org_id: str,
    user_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """소속 상담사 최근 이력 — OrgAdmin 전용. 세션/리포트 메타데이터만 (내용 미노출)."""
    _require_org_admin(current_user, org_id)
    data = org_service.get_counselor_activity(org_id, user_id, db)
    return CounselorActivityResponse(**data)


@router.post("/membership-invites/accept", response_model=MembershipInviteAcceptResponse)
async def accept_membership_invite(
    req: MembershipInviteAcceptRequest,
    db: Session = Depends(get_db),
    redis: Redis = Depends(get_redis),
):
    """기존 상담사 소속 추가 초대 수락 (SDD-079).

    이메일 링크의 일회용 토큰이 본인 수락을 증명한다 (set-password 와 동일 신뢰 모델).
    비밀번호·계정 상태는 변경하지 않고 membership 만 active 로 전환한다.
    """
    from app.services import org_invite_service

    _, org = await org_invite_service.consume_membership_invite(req.token, db, redis)
    return MembershipInviteAcceptResponse(org_id=str(org.id), org_name=org.name)


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
