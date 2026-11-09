"""SDD-323 B1 — 기관 구성원 관리 권한 판정 단일 출처.

판정은 서버가 매 요청 수행한다(active org_admin membership + organizations.primary_admin_id).
라우터 가드, 서비스 내부 재검증(기관 행 잠금 후), 목록의 ``allowed_actions`` 가 모두
이 모듈의 순수 함수(``can`` / ``compute_row_actions``)를 공유해 서로 어긋나지 않는다.

행위자 역할: ``platform``(플랫폼 관리자) / ``primary``(대표) / ``admin``(일반 관리자) / ``none``.
"""

import uuid

from sqlalchemy.orm import Session

from app.core.api_error import ApiError
from app.models.organization import Organization
from app.models.user_org_membership import UserOrgMembership

PLATFORM, PRIMARY, ADMIN, NONE = "platform", "primary", "admin", "none"

# 행동 이름 — allowed_actions 와 can() 이 같은 어휘를 쓴다. (정지/재활성은 어디에도 없다)
ACTION_DETAIL = "detail"
ACTION_EDIT_PROFILE = "edit_profile"
ACTION_RESEND_INVITE = "resend_invite"
ACTION_PROMOTE = "promote"
ACTION_REVOKE_ADMIN = "revoke_admin"
ACTION_REMOVE = "remove"
ACTION_TRANSFER_PRIMARY = "transfer_primary"
ACTION_INVITE = "invite"
ACTION_HANDLE_REQUEST = "handle_request"

_MANAGER_ROLES = (PLATFORM, PRIMARY, ADMIN)
_OWNER_ROLES = (PLATFORM, PRIMARY)  # 승격·회수·관리자 해지·대표 이전


def get_actor_org_role(
    db: Session,
    actor_id: uuid.UUID | str,
    global_role: str | None,
    org: Organization | uuid.UUID | str,
    *,
    fresh: bool = False,
) -> str:
    """행위자의 이 기관에 대한 역할을 판정한다.

    fresh=True 면 membership 을 DB 에서 다시 읽는다(기관 행 잠금 대기 후 재검증용 —
    identity map 에 남은 오래된 값을 쓰지 않는다).
    """
    if global_role == "platform_admin":
        return PLATFORM
    org_uuid = org.id if isinstance(org, Organization) else uuid.UUID(str(org))
    actor_uuid = actor_id if isinstance(actor_id, uuid.UUID) else uuid.UUID(str(actor_id))
    query = db.query(UserOrgMembership).filter(
        UserOrgMembership.user_id == actor_uuid,
        UserOrgMembership.org_id == org_uuid,
        UserOrgMembership.role == "org_admin",
        UserOrgMembership.status == "active",
    )
    if fresh:
        query = query.populate_existing()
    if query.first() is None:
        return NONE
    primary_id = (
        org.primary_admin_id
        if isinstance(org, Organization)
        else db.query(Organization.primary_admin_id).filter(Organization.id == org_uuid).scalar()
    )
    return PRIMARY if primary_id == actor_uuid else ADMIN


def can(actor_role: str, action: str, *, target_role: str | None = None) -> bool:
    """행동×역할 판정(순수 함수). target_role 은 대상의 이 기관 membership 역할."""
    if actor_role not in _MANAGER_ROLES:
        return False
    if action in (ACTION_DETAIL, ACTION_INVITE, ACTION_RESEND_INVITE):
        return True
    if action == ACTION_HANDLE_REQUEST or action == ACTION_EDIT_PROFILE:
        # 플랫폼 관리자는 기관 구성원 개인정보·가입 요청 처리 대상이 아니다(권한표 '—').
        return actor_role in (PRIMARY, ADMIN)
    if action in (ACTION_PROMOTE, ACTION_REVOKE_ADMIN):
        return actor_role in _OWNER_ROLES
    if action == ACTION_REMOVE:
        # 코치 해지는 관리자 누구나, 관리자 해지는 대표/플랫폼만.
        return target_role != "org_admin" or actor_role in _OWNER_ROLES
    if action == ACTION_TRANSFER_PRIMARY:
        return actor_role == PRIMARY
    return False


def require_manager(actor_role: str) -> None:
    """기관 관리자(대표/일반) 또는 플랫폼 관리자만 통과. 아니면 403 ORG_ADMIN_REQUIRED."""
    if actor_role not in _MANAGER_ROLES:
        raise ApiError(403, "ORG_ADMIN_REQUIRED", "센터 관리자만 접근할 수 있습니다")


def require_org_manager_only(actor_role: str) -> None:
    """기관 소속 관리자(대표/일반)만 통과 — 가입 요청 처리·개인정보 수정용."""
    if actor_role not in (PRIMARY, ADMIN):
        raise ApiError(403, "ORG_ADMIN_REQUIRED", "센터 관리자만 접근할 수 있습니다")


def require_owner(actor_role: str) -> None:
    """대표 또는 플랫폼만 통과. 일반 관리자는 403 PRIMARY_ADMIN_REQUIRED."""
    require_manager(actor_role)
    if actor_role not in _OWNER_ROLES:
        raise ApiError(
            403, "PRIMARY_ADMIN_REQUIRED", "대표 관리자만 수행할 수 있는 작업입니다"
        )


def compute_row_actions(
    actor_role: str,
    *,
    target_role: str,
    membership_status: str,
    account_status: str,
    is_self: bool,
    is_primary_target: bool,
    org_kind: str | None,
    is_individual_owner: bool = False,
    is_last_active_admin: bool = False,
    has_active_work: bool = False,
) -> tuple[list[str], dict[str, str]]:
    """목록 행 하나의 (allowed_actions, blocked_reasons).

    allowed_actions: 요청자가 이 행에서 '보여도 되는' 행동(역할·보호 조건으로 걸러냄).
    blocked_reasons: 보이지만 지금은 막히는 조건부 차단 {action: code}.
    정지/재활성은 어떤 경우에도 포함하지 않는다.
    """
    if actor_role not in _MANAGER_ROLES:
        return [], {}
    actions: list[str] = [ACTION_DETAIL]
    blocked: dict[str, str] = {}
    is_active = membership_status == "active"
    is_admin_target = target_role == "org_admin"
    individual = org_kind == "individual"

    if membership_status == "invited" and can(actor_role, ACTION_RESEND_INVITE):
        actions.append(ACTION_RESEND_INVITE)
    if (
        is_active
        and not is_admin_target
        and can(actor_role, ACTION_EDIT_PROFILE)
    ):
        actions.append(ACTION_EDIT_PROFILE)

    protected = is_self or is_primary_target or is_individual_owner
    if is_active and not is_admin_target and not individual and can(actor_role, ACTION_PROMOTE):
        actions.append(ACTION_PROMOTE)
    if (
        is_active
        and is_admin_target
        and not protected
        and can(actor_role, ACTION_REVOKE_ADMIN)
    ):
        actions.append(ACTION_REVOKE_ADMIN)
        if is_last_active_admin:
            blocked[ACTION_REVOKE_ADMIN] = "LAST_ADMIN"
    # 초대 대기 구성원 해지(=초대 철회)도 소속 해지로 취급한다.
    if not protected and can(actor_role, ACTION_REMOVE, target_role=target_role):
        actions.append(ACTION_REMOVE)
        if is_active and is_admin_target and is_last_active_admin:
            blocked[ACTION_REMOVE] = "LAST_ADMIN"
        elif has_active_work:
            blocked[ACTION_REMOVE] = "MEMBER_HAS_ACTIVE_WORK"
    if (
        is_active
        and is_admin_target
        and not protected
        and account_status == "active"
        and not individual
        and can(actor_role, ACTION_TRANSFER_PRIMARY)
    ):
        actions.append(ACTION_TRANSFER_PRIMARY)
    return actions, blocked


def resolve_actor_role(db: Session, current_user: dict, org_id: uuid.UUID | str) -> str:
    """JWT 사용자 dict + org_id(문자열) → 역할. 형식 오류/없는 기관은 none."""
    try:
        org_uuid = uuid.UUID(str(org_id))
    except (TypeError, ValueError):
        return NONE
    return get_actor_org_role(db, current_user["id"], current_user.get("role"), org_uuid)


def require_actor_in_org(
    db: Session, actor: dict, org: Organization, *, fresh: bool = False
) -> str:
    """actor(JWT 사용자 dict)의 역할을 판정하고 관리자가 아니면 403 을 던진다."""
    role = get_actor_org_role(db, actor["id"], actor.get("role"), org, fresh=fresh)
    require_manager(role)
    return role


__all__ = [
    "ADMIN",
    "NONE",
    "PLATFORM",
    "PRIMARY",
    "can",
    "compute_row_actions",
    "get_actor_org_role",
    "require_actor_in_org",
    "resolve_actor_role",
    "require_manager",
    "require_org_manager_only",
    "require_owner",
]
