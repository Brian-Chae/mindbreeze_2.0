"""소속(membership) 쓰기 경로 단일화 서비스 (SDD-079)

user_org_memberships 가 소속의 유일한 진실 원천이다. User.org_id 는 "주 소속 미러"로,
membership 변경 시 이 서비스가 동기 갱신한다. 다른 서비스는 소속을 직접 쓰지 말 것.

트랜잭션 규칙: 이 모듈의 함수는 flush 까지만 수행한다. commit 은 호출자 책임 —
초대/승인/해제 로직이 감사 로그 등과 한 트랜잭션으로 묶을 수 있게 한다.
"""

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.user import User
from app.models.user_org_membership import UserOrgMembership

# 소속이 "살아있는" 상태 — left 는 이력
ALIVE_STATUSES = ("invited", "active")


def _to_uuid(value: uuid.UUID | str) -> uuid.UUID:
    return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))


def get_membership(
    db: Session,
    user_id: uuid.UUID | str,
    org_id: uuid.UUID | str,
    *,
    statuses: tuple[str, ...] = ALIVE_STATUSES,
) -> UserOrgMembership | None:
    """user × org 의 살아있는 membership 조회 (기본: invited/active)."""
    return (
        db.query(UserOrgMembership)
        .filter(
            UserOrgMembership.user_id == _to_uuid(user_id),
            UserOrgMembership.org_id == _to_uuid(org_id),
            UserOrgMembership.status.in_(statuses),
        )
        .first()
    )


def is_member(
    db: Session,
    user_id: uuid.UUID | str,
    org_id: uuid.UUID | str,
    *,
    statuses: tuple[str, ...] = ("active",),
) -> bool:
    return get_membership(db, user_id, org_id, statuses=statuses) is not None


def get_active_org_ids(db: Session, user_id: uuid.UUID | str) -> list[uuid.UUID]:
    rows = (
        db.query(UserOrgMembership.org_id)
        .filter(
            UserOrgMembership.user_id == _to_uuid(user_id),
            UserOrgMembership.status == "active",
        )
        .all()
    )
    return [r[0] for r in rows]


def require_membership(db: Session, user: User, org_id: uuid.UUID | str) -> UserOrgMembership:
    """active 소속이 아니면 403."""
    membership = get_membership(db, user.id, org_id, statuses=("active",))
    if membership is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="해당 기관 소속이 아닙니다",
        )
    return membership


def _sync_primary_mirror(db: Session, user: User) -> None:
    """User.org_id 미러를 'is_primary=True 인 active 소속'과 일치시킨다.

    예외: pending(초대 수락 전) 계정은 생성 시점의 org_id 를 유지한다 —
    기존 초대 관리 코드가 pending 계정의 org_id 를 전제하기 때문(SDD-017).
    단, 그 기관의 초대(invited)마저 사라진 경우(초대 취소·소속 해제)는 미러를 비운다.
    """
    if user.status == "pending":
        if user.org_id is not None and get_membership(
            db, user.id, user.org_id, statuses=("invited", "active")
        ) is not None:
            return
        user.org_id = None
        return
    primary = (
        db.query(UserOrgMembership)
        .filter(
            UserOrgMembership.user_id == user.id,
            UserOrgMembership.status == "active",
            UserOrgMembership.is_primary.is_(True),
        )
        .first()
    )
    user.org_id = primary.org_id if primary else None


def _has_active_primary(db: Session, user_id: uuid.UUID) -> bool:
    return (
        db.query(UserOrgMembership.id)
        .filter(
            UserOrgMembership.user_id == user_id,
            UserOrgMembership.status == "active",
            UserOrgMembership.is_primary.is_(True),
        )
        .first()
        is not None
    )


def add_membership(
    db: Session,
    user: User,
    org_id: uuid.UUID | str,
    *,
    status_: str = "invited",
    role: str = "counselor",
    invited_at: datetime | None = None,
    invite_expires_at: datetime | None = None,
) -> UserOrgMembership:
    """소속 생성 — status='active' 면 첫 active 소속을 자동으로 주 소속으로 승격."""
    org_uuid = _to_uuid(org_id)
    now = datetime.now(timezone.utc)
    membership = UserOrgMembership(
        user_id=user.id,
        org_id=org_uuid,
        role=role,
        status=status_,
        invited_at=invited_at,
        invite_expires_at=invite_expires_at,
        joined_at=now if status_ == "active" else None,
        is_primary=(status_ == "active" and not _has_active_primary(db, user.id)),
    )
    db.add(membership)
    db.flush()
    if membership.is_primary:
        _sync_primary_mirror(db, user)
    return membership


def activate_membership(db: Session, membership: UserOrgMembership, user: User) -> UserOrgMembership:
    """초대 수락 — invited → active. 첫 active 소속이면 주 소속으로 승격."""
    if membership.status != "invited":
        return membership
    membership.status = "active"
    membership.joined_at = datetime.now(timezone.utc)
    if not _has_active_primary(db, user.id):
        membership.is_primary = True
    db.flush()
    _sync_primary_mirror(db, user)
    return membership


def leave_membership(db: Session, user: User, org_id: uuid.UUID | str) -> UserOrgMembership | None:
    """소속 해제 — 행 삭제 없이 status='left' + left_at.

    해제 대상이 주 소속이면 남은 active 소속 중 가장 오래된(joined_at 최소) 소속을 승격한다.
    """
    membership = get_membership(db, user.id, org_id)
    if membership is None:
        return None
    was_primary = membership.is_primary and membership.status == "active"
    membership.status = "left"
    membership.left_at = datetime.now(timezone.utc)
    membership.is_primary = False
    db.flush()
    if was_primary:
        successor = (
            db.query(UserOrgMembership)
            .filter(
                UserOrgMembership.user_id == user.id,
                UserOrgMembership.status == "active",
            )
            .order_by(UserOrgMembership.joined_at.asc())
            .first()
        )
        if successor is not None:
            successor.is_primary = True
        db.flush()
    _sync_primary_mirror(db, user)
    return membership


def set_primary(db: Session, user: User, org_id: uuid.UUID | str) -> UserOrgMembership:
    """주 소속 변경 — active 소속 중에서만 선택 가능."""
    membership = get_membership(db, user.id, org_id, statuses=("active",))
    if membership is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="active 상태의 소속만 주 소속으로 설정할 수 있습니다",
        )
    db.query(UserOrgMembership).filter(
        UserOrgMembership.user_id == user.id,
        UserOrgMembership.is_primary.is_(True),
    ).update({"is_primary": False}, synchronize_session="fetch")
    membership.is_primary = True
    db.flush()
    _sync_primary_mirror(db, user)
    return membership
