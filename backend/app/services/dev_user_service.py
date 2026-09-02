"""SDD-019 — dev 전용 역할 시뮬레이션 사용자 서비스.

개발/QA 과정에서 회원가입·이메일 검증·동의 절차를 건너뛰고 역할별 계정을 즉석
생성한다. 이 서비스는 dev 라우터에서만 호출되며, 라우터 자체가 프로덕션에서는
물리적으로 include 되지 않는다(app/api/v1/__init__.py 조건부 include).

시뮬레이션 계정은 ``auth_provider="dev"`` 로 마킹해 실계정과 격리하고, 정리(reset)도
이 마킹된 계정만 대상으로 한다.
"""

import secrets
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models.onboarding_progress import OnboardingProgress
from app.models.organization import Organization
from app.models.user import User
from app.services import org_service

# 시뮬레이션에서 생성 가능한 역할 — 레거시 "admin" 은 제외한다.
ALLOWED_ROLES = ("platform_admin", "org_admin", "counselor", "client")
ALLOWED_STATUSES = ("active", "pending", "suspended")

# dev fixture org 자동 생성 시 사용하는 이름
DEMO_ORG_NAME = "DEV 시뮬레이션 센터"

# reset-fixtures 시 users.id 를 참조하는 자식 테이블 정리 목록.
# admin_service.delete_user 와 동일한 FK 정리 패턴을 dev 계정에 적용한다.
_CHILD_TABLES: list[tuple[str, list[str]]] = [
    ("client_counselor_links", ["client_id", "counselor_id"]),
    ("client_invites", ["counselor_id"]),
    ("chat_message_reads", ["user_id"]),
    ("chat_messages", ["sender_id"]),
    ("chat_room_participants", ["user_id"]),
    ("chat_rooms", ["host_id"]),
    ("credentials", ["user_id"]),
    ("eeg_records", ["user_id"]),
    ("notifications", ["user_id"]),
    ("org_join_requests", ["user_id"]),
    ("reports", ["user_id"]),
    ("session_participants", ["user_id"]),
    ("sessions", ["host_id"]),
    ("verification_audits", ["admin_id"]),
    ("consents", ["user_id"]),
    ("refresh_tokens", ["user_id"]),
    ("password_history", ["user_id"]),
    ("onboarding_progress", ["user_id"]),
    ("counselor_profiles", ["user_id"]),
    ("client_profiles", ["user_id"]),
    ("qualifications", ["user_id"]),
    ("careers", ["user_id"]),
]


def _resolve_org_id(
    role: str, org_id: uuid.UUID | None, db: Session
) -> uuid.UUID | None:
    """역할별 org_id 규칙을 적용하고, 필요 시 demo org 를 확보한다.

    - platform_admin: 전역 관리자이므로 org_id 는 항상 None 으로 강제한다.
    - client: 기관 소속이 아니므로 None 으로 둔다(null 허용).
    - org_admin / counselor: org_id 가 주어지면 존재를 검증해 그대로 쓰고,
      없으면 verified demo org 를 자동 생성한다.
    """
    if role == "platform_admin":
        return None
    if role == "client":
        return None

    # org_admin / counselor
    if org_id is not None:
        org = db.query(Organization).filter(Organization.id == org_id).first()
        if org is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="기관을 찾을 수 없습니다"
            )
        return org.id

    # org_id 미지정 → demo org 자동 생성 (verified + org_code 발급)
    org = org_service.admin_create_organization(DEMO_ORG_NAME, db)
    return org.id


def create_dev_user(
    *,
    name: str,
    email: str,
    role: str,
    org_id: uuid.UUID | None = None,
    status_value: str = "active",
    db: Session,
) -> User:
    """검증/동의 없이 dev 시뮬레이션 사용자를 생성한다.

    유지하는 검증: 이메일 형식(스키마)·중복, name 길이, role/status enum, org_id 존재,
    role-org_id 조합. 생략하는 검증: OTP·이메일 토큰·약관 동의·Google·초대 메일.
    """
    clean_name = (name or "").strip()
    if not clean_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="이름을 입력해야 합니다"
        )

    email_norm = (email or "").strip().lower()
    if not email_norm:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="이메일을 입력해야 합니다"
        )

    if role not in ALLOWED_ROLES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"role 은 {', '.join(ALLOWED_ROLES)} 중 하나여야 합니다",
        )

    status_norm = status_value or "active"
    if status_norm not in ALLOWED_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"status 는 {', '.join(ALLOWED_STATUSES)} 중 하나여야 합니다",
        )

    # 실계정 병합·승격 위험을 막기 위해 이메일 중복은 기존 가입과 동일하게 409.
    if db.query(User).filter(User.email == email_norm).first() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="이미 등록된 이메일입니다"
        )

    resolved_org_id = _resolve_org_id(role, org_id, db)

    user = User(
        email=email_norm,
        # 사용자가 알 수 없는 난수 해시 — 비밀번호 로그인은 불가, dev 로그인으로만 진입.
        password_hash=hash_password(secrets.token_urlsafe(32)),
        name=clean_name,
        role=role,
        org_id=resolved_org_id,
        status=status_norm,
        verified_tier="email",
        auth_provider="dev",
    )
    db.add(user)
    db.flush()

    # org_admin 인데 기관에 주 담당자가 없으면 연결한다(_require_org_admin 정합).
    if role == "org_admin" and resolved_org_id is not None:
        org = db.query(Organization).filter(Organization.id == resolved_org_id).first()
        if org is not None and org.primary_admin_id is None:
            org.primary_admin_id = user.id

    # 역할 화면 빠른 전환이 목표이므로 온보딩을 완료 상태로 만든다.
    db.add(
        OnboardingProgress(
            user_id=user.id,
            current_step=1,
            completed=True,
            completed_at=datetime.now(timezone.utc),
            steps={},
        )
    )

    db.commit()
    db.refresh(user)
    return user


def list_dev_users(
    role: str | None, q: str | None, db: Session
) -> list[User]:
    """시뮬레이션 계정(auth_provider="dev") 목록을 반환한다."""
    query = db.query(User).filter(User.auth_provider == "dev")
    if role:
        query = query.filter(User.role == role)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter((User.name.ilike(like)) | (User.email.ilike(like)))
    return query.order_by(User.created_at.desc()).all()


def get_dev_user(user_id: uuid.UUID, db: Session) -> User:
    """dev 로그인 대상 조회 — 시뮬레이션 계정이 아니면 404 로 실계정 접근을 막는다."""
    user = (
        db.query(User)
        .filter(User.id == user_id, User.auth_provider == "dev")
        .first()
    )
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="시뮬레이션 사용자를 찾을 수 없습니다"
        )
    return user


def reset_dev_fixtures(db: Session) -> int:
    """auth_provider="dev" 계정만 FK 자식과 함께 hard delete 한다.

    실계정은 절대 건드리지 않는다. platform_admin dev 계정도 포함해 정리하기 위해
    admin_service.delete_user(platform_admin 보호) 대신 전용 정리 로직을 둔다.
    반환값: 삭제된 사용자 수.
    """
    dev_users = db.query(User).filter(User.auth_provider == "dev").all()
    deleted = 0
    for user in dev_users:
        uid = str(user.id)
        # 기관의 primary_admin_id 참조 해제 (SET NULL)
        db.execute(
            text("UPDATE organizations SET primary_admin_id = NULL WHERE primary_admin_id = :id"),
            {"id": uid},
        )
        for table, cols in _CHILD_TABLES:
            for col in cols:
                db.execute(text(f"DELETE FROM {table} WHERE {col} = :id"), {"id": uid})
        db.delete(user)
        deleted += 1
    db.commit()
    return deleted
