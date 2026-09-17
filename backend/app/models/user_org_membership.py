"""UserOrgMembership — 상담사 다중 기관 소속 (SDD-079)

소속의 유일한 진실 원천. User.org_id 는 "주 소속(primary) 미러"로 유지되며
쓰기는 membership_service 한 곳에서만 수행한다.
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class UserOrgMembership(Base):
    __tablename__ = "user_org_memberships"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False, index=True
    )
    # 해당 기관에서의 역할. MVP 는 counselor/org_admin 만 존재하며 User.role 과 동기화한다.
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="counselor")
    # 소속 상태 (계정 상태와 분리): invited / active / left
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="invited")
    # 주 소속 여부 — user 당 active 중 1개만 True (partial unique index)
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    invited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    invite_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    joined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 소속 해제 = 행 삭제가 아니라 status='left' + left_at (이력 보존)
    left_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user = relationship("User", foreign_keys=[user_id])
    org = relationship("Organization", foreign_keys=[org_id])

    __table_args__ = (
        # 동일 기관 중복 소속 방지 — left 는 이력이므로 제외해 재가입을 허용한다
        Index(
            "uq_membership_user_org_alive",
            "user_id",
            "org_id",
            unique=True,
            postgresql_where=text("status != 'left'"),
            sqlite_where=text("status != 'left'"),
        ),
        # 주 소속은 user 당 active 소속 중 1개만
        Index(
            "uq_membership_primary_active",
            "user_id",
            unique=True,
            postgresql_where=text("is_primary AND status = 'active'"),
            sqlite_where=text("is_primary AND status = 'active'"),
        ),
    )
