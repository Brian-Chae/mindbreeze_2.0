"""SDD-019 — dev 전용 역할 시뮬레이션 로그인 라우터.

이 라우터는 프로덕션에서 물리적으로 include 되지 않는다
(app/api/v1/__init__.py 에서 environment != "production" and enable_dev_role_simulation 일 때만 등록).
따라서 라우터 내부 guard 없이도 운영 환경에는 엔드포인트 자체가 존재하지 않는다.

토큰 발급/소비 경로는 기존 /auth/* 와 동일하다. dev 로그인으로 발급된 access_token 도
get_current_user 가 DB 에서 role/org_id 를 다시 읽으므로 기존 role guard 를 그대로 검증할 수 있다.
"""

import re
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.api.v1.auth import _to_user_response
from app.core.database import get_db
from app.core.security import create_access_token
from app.models.organization import Organization
from app.models.user import User
from app.schemas.auth import LoginResponse
from app.services import dev_user_service, refresh_token_service

router = APIRouter(prefix="/dev/auth", tags=["dev"])

# 이메일 형식은 유지하되, spec 이 권장하는 @dev.local 같은 특수·예약 도메인도 허용해야 하므로
# email-validator(EmailStr) 대신 가벼운 형식 검증만 둔다. (dev 전용 라우터)
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# ---------------------------------------------------------------------------
# 스키마
# ---------------------------------------------------------------------------


class DevUserCreateRequest(BaseModel):
    """검증/동의 없이 dev 사용자를 즉석 생성하는 요청."""

    name: str = Field(min_length=1, max_length=100)
    email: str = Field(min_length=3, max_length=255)
    role: str = Field(pattern="^(platform_admin|org_admin|counselor|client)$")
    org_id: UUID | None = None
    status: str = Field(default="active", pattern="^(active|pending|suspended)$")

    @field_validator("email")
    @classmethod
    def _check_email(cls, v: str) -> str:
        normalized = (v or "").strip().lower()
        if not _EMAIL_RE.match(normalized):
            raise ValueError("이메일 형식이 올바르지 않습니다")
        return normalized


class DevUserItem(BaseModel):
    """역할 시뮬레이션 패널 목록/생성 응답 항목."""

    id: str
    email: str
    name: str
    role: str
    status: str
    org_id: str | None = None
    org_name: str | None = None
    onboarding_completed: bool = False
    verified_tier: str
    auth_provider: str
    created_at: str | None = None


class DevUserListResponse(BaseModel):
    users: list[DevUserItem]


class DevLoginRequest(BaseModel):
    user_id: UUID


class DevResetResponse(BaseModel):
    deleted: int


# ---------------------------------------------------------------------------
# 직렬화 헬퍼
# ---------------------------------------------------------------------------


def _to_dev_user_item(user: User, db: Session) -> DevUserItem:
    """User ORM → DevUserItem. org_name 은 org_id 가 있을 때만 조회한다."""
    org_name: str | None = None
    if user.org_id is not None:
        org = db.query(Organization).filter(Organization.id == user.org_id).first()
        org_name = org.name if org is not None else None
    return DevUserItem(
        id=str(user.id),
        email=user.email,
        name=user.name,
        role=user.role,
        status=user.status,
        org_id=str(user.org_id) if user.org_id else None,
        org_name=org_name,
        onboarding_completed=user.onboarding_completed,
        verified_tier=user.verified_tier,
        auth_provider=user.auth_provider,
        created_at=user.created_at.isoformat() if user.created_at else None,
    )


# ---------------------------------------------------------------------------
# 엔드포인트
# ---------------------------------------------------------------------------


@router.get("/users", response_model=DevUserListResponse)
async def list_dev_users(
    role: str | None = Query(default=None),
    q: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """시뮬레이션 유저 목록 (auth_provider="dev" 만). role/q 필터 지원."""
    users = dev_user_service.list_dev_users(role, q, db)
    return DevUserListResponse(users=[_to_dev_user_item(u, db) for u in users])


@router.post("/users", response_model=DevUserItem, status_code=status.HTTP_201_CREATED)
async def create_dev_user(req: DevUserCreateRequest, db: Session = Depends(get_db)):
    """검증/동의 없이 dev 사용자를 즉석 생성한다. 중복 이메일은 409."""
    user = dev_user_service.create_dev_user(
        name=req.name,
        email=req.email,
        role=req.role,
        org_id=req.org_id,
        status_value=req.status,
        db=db,
    )
    return _to_dev_user_item(user, db)


@router.post("/login", response_model=LoginResponse)
async def dev_login(req: DevLoginRequest, db: Session = Depends(get_db)):
    """user_id 로 비밀번호 없이 로그인 → 기존 LoginResponse 발급.

    시뮬레이션 계정이 아니면 404 로 거부해 실계정 무비번 로그인을 막는다.
    토큰 발급은 기존 로그인과 동일하게 create_access_token + issue_refresh_token 을 쓴다.
    """
    user = dev_user_service.get_dev_user(req.user_id, db)
    access_token = create_access_token(subject=str(user.id))
    refresh_token = refresh_token_service.issue_refresh_token(str(user.id), db)
    return LoginResponse(
        user=_to_user_response(user),
        access_token=access_token,
        refresh_token=refresh_token,
    )


@router.post("/reset-fixtures", response_model=DevResetResponse)
async def reset_dev_fixtures(db: Session = Depends(get_db)):
    """auth_provider="dev" 계정만 FK 자식과 함께 정리한다. 실계정은 건드리지 않는다."""
    deleted = dev_user_service.reset_dev_fixtures(db)
    return DevResetResponse(deleted=deleted)
