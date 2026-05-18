"""상담센터(Organization) 모델"""

import uuid
from datetime import datetime

from sqlalchemy import String, DateTime, Boolean, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    ceo_name: Mapped[str] = mapped_column(String(100), nullable=False)
    biz_number: Mapped[str] = mapped_column(String(10), unique=True, nullable=False)
    address: Mapped[str] = mapped_column(String(300), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(20))
    verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
