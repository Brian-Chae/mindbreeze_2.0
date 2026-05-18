"""CounselorProfile — 상담사 프로필 + 식별 코드"""

import uuid
from datetime import datetime, date

from sqlalchemy import String, DateTime, Date, Integer, Text, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class CounselorProfile(Base):
    __tablename__ = "counselor_profiles"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), unique=True, nullable=False, index=True)
    counselor_code: Mapped[str] = mapped_column(String(6), unique=True, nullable=False, index=True)
    gender: Mapped[str | None] = mapped_column(String(20))
    birth_date: Mapped[date | None] = mapped_column(Date)
    years_of_experience: Mapped[int | None] = mapped_column(Integer)
    specialties: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)
    affiliation_type: Mapped[str | None] = mapped_column(String(50))
    profile_image_url: Mapped[str | None] = mapped_column(String(500))
    bio: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user = relationship("User", back_populates="counselor_profile")
