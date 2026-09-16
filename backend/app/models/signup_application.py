"""SignupApplication — 가입 신청 (기관 상담 / 개인 상담사) (SDD-073)

기관 가입 상담과 개인 상담사 신청을 하나의 테이블로 관리한다.
신청 DB가 원본이고 운영자 이메일 알림은 부가 채널이다(아웃박스 패턴:
notify_status 로 발송 상태를 신청 상태와 분리해 추적한다).
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class SignupApplication(Base):
    __tablename__ = "signup_applications"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # organization(기관 가입 상담) | individual_counselor(개인 상담사 신청)
    application_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    # 기관명 또는 개인 상담사 활동명(기관 표시명)
    organization_name: Mapped[str] = mapped_column(String(200), nullable=False)
    contact_name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    # 전화번호는 선택 수집. 메일 제목·로그에는 노출하지 않는다(마스킹).
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    inquiry: Mapped[str | None] = mapped_column(Text, nullable=True)
    specialties: Mapped[str | None] = mapped_column(String(300), nullable=True)

    # submitted → reviewing → approved / rejected (철회: withdrawn)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="submitted", server_default="submitted", index=True
    )
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # 개인 상담사 신청 시 함께 생성된 객체 참조 (기관 신청은 접수만 하므로 null 유지)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )

    # 운영자 알림 발송 상태 — pending / queued / sent / failed (신청 상태와 분리)
    notify_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", server_default="pending"
    )
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # 개인정보 수집·이용 동의 시각 (필수 동의)
    consented_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
