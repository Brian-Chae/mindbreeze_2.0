"""상담센터(Organization) API 라우터"""

import logging
import uuid

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, Response, status
from redis.asyncio import Redis
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.api_error import ApiError
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
    OrgCounselorRemoveRequest,
    OrgCounselorRolePatch,
    OrganizationPublicResponse,
    OrganizationSearchResult,
    OrgJoinRequestDetail,
    PasswordResetIssueRequest,
    PasswordResetIssueResponse,
    PrimaryAdminTransferRequest,
    PrimaryAdminTransferResponse,
)
from app.services import (
    admin_password_reset_service,
    counselor_info_service,
    membership_service,
    org_management_service,
    org_permission_service,
    org_service,
)

router = APIRouter(prefix="/org", tags=["org"])


def _require_org_admin(db: Session, current_user: dict, org_id: str, *, allow_platform: bool = False) -> str:
    """본인 기관의 org_admin 만 통과. 아니면 403 `ORG_ADMIN_REQUIRED`. 행위자 역할을 반환한다.

    AUTHZ-02: User.org_id 미러(주 소속 1개)가 아니라 membership 을 판정 기준으로 쓴다.
    SDD-323: allow_platform=True 면 플랫폼 관리자도 통과(조회·초대·재초대). 가입 요청 처리·개인정보 수정은
    기관 소속 관리자(대표/일반)만 허용한다(권한표 '—').
    """
    role = org_permission_service.resolve_actor_role(db, current_user, org_id)
    if allow_platform:
        org_permission_service.require_manager(role)
    else:
        org_permission_service.require_org_manager_only(role)
    return role


def _request_id() -> str:
    return str(uuid.uuid4())


def _counselor_to_response(
    u,
    membership=None,
    *,
    has_personal_office: bool = False,
    extras: dict | None = None,
) -> CounselorResponse:
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
        # SDD-258: 다기관 소속에서는 전역 role 이 아니라 이 기관의 멤버십 역할을 표시한다
        role=membership.role if membership is not None and membership.role in ("counselor", "org_admin") else u.role,
        status=status_str,
        invited_at=invited_at.isoformat() if invited_at else None,
        invite_expires_at=invite_expires_at.isoformat() if invite_expires_at else None,
        invite_type=invite_type,
        counselor_code=profile.counselor_code if profile else None,
        has_personal_office=has_personal_office,
        membership_status=(
            membership.status if membership is not None and membership.status in ("active", "invited") else None
        ),
        account_status=u.status if u.status in ("active", "pending", "suspended") else None,
        **(extras or {}),
    )


def _serialize_org(org) -> OrganizationPublicResponse:
    """SEC-08 — 무인증 공개 상세 직렬화.

    GET /{org_id} 는 인증 없이 호출되므로 공개 가능한 필드만 반환한다.
    대표자명(ceo_name)·사업자번호(biz_number)·연락처(phone)는 응답에서 제거한다.
    """
    return OrganizationPublicResponse(
        id=str(org.id),
        name=org.name,
        address=org.address,
        org_code=org.org_code,
        verified=org.verified,
        verified_at=org.verified_at.isoformat() if org.verified_at else None,
        created_at=org.created_at.isoformat() if org.created_at else "",
    )


@router.get("/search", response_model=list[OrganizationSearchResult])
async def search_orgs(
    # VB-13: 무인증 공개 검색 — q 길이 상한 + 결과 개수 상한(page/size 대신 limit)을 둔다.
    q: str | None = Query(default=None, max_length=100),
    region: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """센터 검색 — 이름/주소 부분 일치."""
    orgs = org_service.search_organizations(q, region, db, limit=limit)
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
    """센터의 가입 요청 목록 — 기관 소속 관리자(대표/일반) 전용. membership 기반 (AUTHZ-02)."""
    _require_org_admin(db, current_user, org_id)
    rows = org_service.list_org_join_requests(org_id, db)
    return [OrgJoinRequestDetail(**r) for r in rows]


@router.get("/{org_id}", response_model=OrganizationPublicResponse)
async def get_org(org_id: str, db: Session = Depends(get_db)):
    """센터 상세 조회 (무인증 공개) — SEC-08: 민감 필드 제외."""
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
    """가입 신청 승인/거절 — 기관 소속 관리자 전용. 거절은 사유 필수, 처리 완료 요청은 409."""
    _require_org_admin(db, current_user, org_id)
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
    role: str | None = Query(default=None, pattern="^(counselor|org_admin)$"),
    status_filter: str | None = Query(default=None, alias="status", pattern="^(active|invited|pending|suspended)$"),
    response: Response = None,  # type: ignore[assignment]
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """센터 소속 구성원 목록 — 관리자(대표/일반)·플랫폼 관리자. membership 기반 (SDD-079/323).

    SDD-323: 소속/계정 상태 분리, 대표·본인 표시, 기관 범위 class_count·last_activity_at(일괄 집계),
    allowed_actions/blocked_reasons(서버 판정 단일 출처)를 함께 내려준다. 정지/재활성은 포함하지 않는다.
    """
    actor_role = _require_org_admin(db, current_user, org_id, allow_platform=True)
    rows = org_service.get_counselors(org_id, db, role=role, status_filter=status_filter)
    org = org_management_service.get_active_org_readonly(org_id, db)
    # 대표 이전(If-Match)에 쓸 기관 버전 — FE 가 이 값을 그대로 If-Match 로 보낸다
    response.headers["ETag"] = f'"{org.version}"'
    if not rows:
        return []
    from app.models.user_org_membership import UserOrgMembership

    user_ids = [u.id for u, _ in rows]
    # SDD-082: 개인 상담소(kind=individual) 소속 여부를 1쿼리로 계산해 배지로 구분한다
    personal_owner_ids = {
        row[0]
        for row in (
            db.query(UserOrgMembership.user_id)
            .join(Organization, Organization.id == UserOrgMembership.org_id)
            .filter(
                UserOrgMembership.user_id.in_(user_ids),
                UserOrgMembership.status == "active",
                Organization.kind == "individual",
            )
            .all()
        )
    }
    class_counts, last_seen = org_service.aggregate_member_stats(org, user_ids, db)
    busy_ids = org_management_service.find_members_with_active_work(db, org, user_ids)
    active_admin_count = sum(
        1 for u, m in rows if m.role == "org_admin" and m.status == "active" and u.status == "active"
    )
    me = uuid.UUID(current_user["id"])
    out = []
    for u, m in rows:
        is_admin_row = m.role == "org_admin"
        allowed, blocked = org_permission_service.compute_row_actions(
            actor_role,
            target_role=m.role,
            membership_status=m.status,
            account_status=u.status,
            is_self=u.id == me,
            is_primary_target=u.id == org.primary_admin_id,
            org_kind=org.kind,
            is_individual_owner=org.kind == "individual" and org.owner_user_id == u.id,
            is_last_active_admin=(
                is_admin_row and m.status == "active" and u.status == "active" and active_admin_count <= 1
            ),
            has_active_work=u.id in busy_ids,
        )
        seen = last_seen.get(u.id)
        out.append(
            _counselor_to_response(
                u,
                m,
                has_personal_office=u.id in personal_owner_ids,
                extras={
                    "is_primary_admin": u.id == org.primary_admin_id,
                    "is_self": u.id == me,
                    "class_count": int(class_counts.get(u.id, 0)),
                    "last_activity_at": seen.isoformat() if seen else None,
                    "allowed_actions": allowed,
                    "blocked_reasons": blocked,
                },
            )
        )
    return out


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
    SDD-323: 대표·일반 관리자·플랫폼 관리자 모두 코치/관리자 초대 가능.
    """
    _require_org_admin(db, current_user, org_id, allow_platform=True)
    user, invite_sent = await org_service.invite_counselor(
        org_id, req.name, str(req.email), redis, db, role=req.role
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
    """상담사 초대 재발송 — 관리자(대표/일반)·플랫폼. membership invited 상태만 허용 (SDD-079).

    쿨다운 중이면 429 `INVITE_COOLDOWN` + `retry_after_sec`.
    """
    _require_org_admin(db, current_user, org_id, allow_platform=True)
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
    req: OrgCounselorRolePatch,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """구성원 역할 변경(승격·회수) — **대표 관리자(또는 플랫폼 관리자)만** (SDD-323).

    body: {"role": "counselor"|"org_admin", "reason": "..."} — 사유 필수(422 REASON_REQUIRED).
    일반 관리자는 403 `PRIMARY_ADMIN_REQUIRED`. 자기 자신 409, 대표 409, 마지막 관리자 409.
    """
    role = org_permission_service.resolve_actor_role(db, current_user, org_id)
    org_permission_service.require_owner(role)
    user = org_service.update_counselor_role(
        org_id, user_id, req.role, current_user["id"], db, reason=req.reason, request_id=_request_id()
    )
    membership = membership_service.get_membership(db, user.id, org_id)
    return _counselor_to_response(user, membership)


# ---------------------------------------------------------------------------
# SDD-077: 기관 관리자 — 소속 상담사 정보 조회·수정 (개인정보 포함, 정책 확정)
# ---------------------------------------------------------------------------


def _parse_target_uuid(user_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="대상 코치를 찾을 수 없습니다")


@router.get("/{org_id}/counselors/{user_id}/profile", response_model=CounselorInfoResponse)
async def get_org_counselor_profile(
    org_id: str,
    user_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """소속 상담사 정보 조회 — OrgAdmin 전용. 성별/생년월일/전화/주소 포함(정책 확정)."""
    _require_org_admin(db, current_user, org_id)
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
    _require_org_admin(db, current_user, org_id)
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
        # MB-ERR-006: 커밋 이후 best-effort WS 브로드캐스트 — 실패를 격리해 저장 성공을 유지한다.
        from app.ws.chat_namespace import broadcast_profile_updated
        try:
            await broadcast_profile_updated(str(target.id), target.name)
        except Exception as exc:  # noqa: BLE001 — best-effort 실패 격리
            logging.getLogger(__name__).warning(
                "[org] broadcast_profile_updated failed user=%s: %s", target.id, exc
            )
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

    _require_org_admin(db, current_user, org_id)
    org = db.query(Organization).filter(Organization.id == uuid.UUID(str(org_id))).first()
    if org is None:
        raise HTTPException(status_code=404, detail="기관을 찾을 수 없습니다")
    if org.deactivated_at is not None:
        raise HTTPException(status_code=409, detail="비활성화된 기관에서는 이 작업을 수행할 수 없습니다")
    target = db.query(User).filter(User.id == _parse_target_uuid(user_id)).first()
    # MB2-ORG-02: User.org_id 미러가 아니라 membership(active) 으로 소속을 검증한다.
    if target is None or membership_service.get_membership(
        db, target.id, org.id, statuses=("active",)
    ) is None:
        raise HTTPException(status_code=404, detail="대상 코치를 찾을 수 없습니다")
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


def _status_platform_only() -> ApiError:
    return ApiError(
        status.HTTP_403_FORBIDDEN,
        "ORG_STATUS_PLATFORM_ONLY",
        "계정 정지·재활성은 본인 또는 플랫폼 관리자만 처리할 수 있습니다",
    )


@router.post("/{org_id}/counselors/{user_id}/suspend", response_model=CounselorStatusResponse)
async def suspend_org_counselor(
    org_id: str,
    user_id: str,
    req: CounselorStatusChangeRequest,  # noqa: ARG001 — 본문은 검증하지 않고 항상 거절한다
    current_user: dict = Depends(get_current_user),  # noqa: ARG001
    db: Session = Depends(get_db),  # noqa: ARG001
):
    """SDD-323: 기관 관리자(대표 포함)는 계정 정지 불가 — 항상 403 `ORG_STATUS_PLATFORM_ONLY`.

    정지는 플랫폼 관리자(`/admin/users/{id}/suspend`)만 수행한다. 서비스 함수
    (`org_service.set_counselor_suspension`)는 플랫폼 경로 재사용을 위해 남겨 두고 라우터 허용만 제거했다.
    """
    raise _status_platform_only()


@router.post("/{org_id}/counselors/{user_id}/unsuspend", response_model=CounselorStatusResponse)
async def unsuspend_org_counselor(
    org_id: str,
    user_id: str,
    req: CounselorStatusChangeRequest,  # noqa: ARG001
    current_user: dict = Depends(get_current_user),  # noqa: ARG001
    db: Session = Depends(get_db),  # noqa: ARG001
):
    """SDD-323: 재활성도 기관 관리자 전원 403 `ORG_STATUS_PLATFORM_ONLY`."""
    raise _status_platform_only()


@router.get("/{org_id}/counselors/{user_id}/activity", response_model=CounselorActivityResponse)
async def get_org_counselor_activity(
    org_id: str,
    user_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """소속 상담사 최근 이력 — 관리자(대표/일반)·플랫폼. 이 기관 범위 세션/리포트 메타데이터 + 담당 클래스 요약(내용 미노출)."""
    _require_org_admin(db, current_user, org_id, allow_platform=True)
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
    req: OrgCounselorRemoveRequest | None = Body(default=None),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """구성원 소속 해지 — 사유(body `reason`) 필수 (SDD-323).

    코치 대상=관리자 누구나, 관리자 대상=대표/플랫폼만. 자기 자신·대표는 항상 409.
    계정 삭제가 아니라 소속 해제이며, 개인상담소 복귀·진행 세션/활성 연결 가드는 기존 로직을 공유한다.
    """
    role = org_permission_service.resolve_actor_role(db, current_user, org_id)
    org_permission_service.require_manager(role)
    org_service.remove_counselor(
        org_id, user_id, current_user["id"], db,
        reason=req.reason if req is not None else None, request_id=_request_id(),
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/{org_id}/primary-admin", response_model=PrimaryAdminTransferResponse)
async def transfer_primary_admin(
    org_id: str,
    req: PrimaryAdminTransferRequest,
    if_match: str | None = Header(default=None),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """대표 관리자 넘기기 — **현 대표만** (SDD-323 A5).

    헤더 `If-Match: <org.version>` 필수(428/412), `expected_primary_admin_id` 불일치 409 `PRIMARY_CHANGED`.
    넘긴 뒤 이전 대표는 일반 관리자(org_admin)로 남는다. 플랫폼 관리자용 경로는 이번 범위에서 제외.
    """
    role = org_permission_service.resolve_actor_role(db, current_user, org_id)
    org_permission_service.require_manager(role)
    if role != org_permission_service.PRIMARY:
        raise ApiError(403, "PRIMARY_ADMIN_REQUIRED", "대표 관리자만 수행할 수 있는 작업입니다")
    org = org_management_service.transfer_primary_admin(
        db, org_id, uuid.UUID(current_user["id"]),
        target_user_id=req.target_user_id,
        expected_primary_admin_id=req.expected_primary_admin_id,
        reason=req.reason, if_match=if_match, request_id=_request_id(),
    )
    return PrimaryAdminTransferResponse(
        org_id=str(org.id), primary_admin_id=str(org.primary_admin_id), version=org.version
    )
