"""방향 패턴별 리포트 서사 캐시."""

from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class NarrativeCache(Base):
    __tablename__ = "narrative_cache"

    signature: Mapped[str] = mapped_column(String(6), primary_key=True)
    narrative: Mapped[dict[str, str]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
