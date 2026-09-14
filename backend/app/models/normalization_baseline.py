"""집단 정규화에 사용하는 눈 감기/뜨기 기준 데이터."""

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Index, Integer, String, false, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class NormalizationBaseline(Base):
    __tablename__ = "normalization_baselines"
    __table_args__ = (
        Index(
            "uq_normalization_baselines_active",
            "is_active",
            unique=True,
            postgresql_where=text("is_active = true"),
            sqlite_where=text("is_active = 1"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, nullable=False)
    device_id: Mapped[str | None] = mapped_column(String, nullable=True)
    pipeline_version: Mapped[str | None] = mapped_column(String, nullable=True)
    gender: Mapped[str | None] = mapped_column(String, nullable=True)
    birth_date: Mapped[str | None] = mapped_column(String, nullable=True)
    closed: Mapped[dict[str, float | None]] = mapped_column(JSON, nullable=False)
    open: Mapped[dict[str, float | None]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false(), nullable=False
    )
