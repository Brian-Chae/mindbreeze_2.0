"""전체 기준 데이터에서 계산한 버전별 표준 분포 모델."""

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Index, Integer, false, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class NormalizationModel(Base):
    __tablename__ = "normalization_models"
    __table_args__ = (
        Index(
            "uq_normalization_models_active",
            "is_active",
            unique=True,
            postgresql_where=text("is_active = true"),
            sqlite_where=text("is_active = 1"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    n_samples: Mapped[int] = mapped_column(Integer, nullable=False)
    params: Mapped[dict[str, dict[str, float | int]]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false(), nullable=False
    )
