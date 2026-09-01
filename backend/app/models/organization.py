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
    # SDD-015: 상담사 가입 시 입력하는 6자리 기관 코드 (system_admin이 기관 등록 시 발급)
    org_code: Mapped[str | None] = mapped_column(String(6), unique=True, index=True)
    # SDD-015: system_admin 간이 등록(기관명만)을 위해 사업자 정보는 nullable로 완화
    ceo_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    biz_number: Mapped[str | None] = mapped_column(String(10), unique=True, nullable=True)
    address: Mapped[str | None] = mapped_column(String(300), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(20))
    verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
