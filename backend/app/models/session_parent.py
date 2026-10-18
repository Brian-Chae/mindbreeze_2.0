"""SDD-214: 세션 진행자 변경 이력 (session_host_history)

append-only 이며 FK 를 두지 않아 세션 원본이 정리된 뒤에도 이력이 남는다. Phase 1 에서는 쓰는 코드가 없다.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, Text, event, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class SessionHostHistory(Base):
    __tablename__ = "session_host_history"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    previous_host_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    new_host_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    changed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


@event.listens_for(SessionHostHistory, "before_update")
def _forbid_host_history_update(mapper, connection, target) -> None:  # noqa: ARG001
    raise ValueError("진행자 변경 이력은 수정할 수 없습니다(append-only)")


@event.listens_for(SessionHostHistory, "before_delete")
def _forbid_host_history_delete(mapper, connection, target) -> None:  # noqa: ARG001
    raise ValueError("진행자 변경 이력은 삭제할 수 없습니다(append-only)")
