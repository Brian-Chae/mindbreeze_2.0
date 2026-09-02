"""상담센터(Organization) 모델"""

import uuid
from datetime import datetime

from sqlalchemy import String, DateTime, Boolean, ForeignKey, func
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
    # SDD-016: 주 담당자(org_admin) User 참조. 담당자 이름/이메일/전화의 진실원은 User 이며
    # 여기에는 참조만 둔다. users.org_id 와 순환 FK 이므로 use_alter 로 생성 순서를 분리한다.
    primary_admin_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", use_alter=True, name="fk_organizations_primary_admin_id"),
        nullable=True,
    )
    verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
