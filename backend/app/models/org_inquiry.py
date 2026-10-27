"""OrgInquiry — 공개 랜딩 기관 도입 문의 (SDD-248)

가입 신청(SignupApplication)과 분리된 영업성 문의 원장. IP 는 저장하지 않는다
(rate limit 은 Redis 키 TTL 로만 사용). notify_status 로 운영자 메일 발송 상태를 추적한다.
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class OrgInquiry(Base):
    __tablename__ = "org_inquiries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_name: Mapped[str] = mapped_column(String(200), nullable=False)
    contact_name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str] = mapped_column(String(254), nullable=False, index=True)
    phone: Mapped[str] = mapped_column(String(30), nullable=False)
    org_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    expected_users: Mapped[int | None] = mapped_column(Integer, nullable=True)
    band_interest: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # new → handled (운영자 처리 완료)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="new", server_default="new", index=True
    )
    # pending / queued / sent / failed — 메일 알림 상태(접수 상태와 분리)
    notify_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", server_default="pending"
    )
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    consented_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
