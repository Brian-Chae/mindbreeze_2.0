"""상담센터 가입 신청(OrganizationJoinRequest) 모델"""

import uuid
from datetime import datetime

from sqlalchemy import String, DateTime, Text, ForeignKey, Index, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class OrganizationJoinRequest(Base):
    __tablename__ = "org_join_requests"
    # MB2-ORM-UNQ-11: (user_id, org_id, status='pending') 부분 유니크 인덱스.
    # request_join 이 'pending 조회 후 삽입'이라 동시 요청이 둘 다 통과해 중복 pending
    # 신청이 생성될 수 있었다. DB 레벨에서 (user_id, org_id) pending 을 1건으로 강제한다.
    __table_args__ = (
        Index(
            "uq_org_join_request_pending",
            "user_id",
            "org_id",
            unique=True,
            postgresql_where=text("status = 'pending'"),
            sqlite_where=text("status = 'pending'"),
        ),
        # MB2-ORM-IDX-10: user_id/org_id/status 반복 조회 + org_id/created_at 목록 조회를 인덱스화한다.
        Index("ix_org_join_requests_user_org_status", "user_id", "org_id", "status"),
        Index("ix_org_join_requests_org_created", "org_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)  # pending, approved, rejected
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
