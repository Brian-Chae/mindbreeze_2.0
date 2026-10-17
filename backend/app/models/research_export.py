"""연구 DB 내보내기 배치 (SDD-209 B13 / BE-R3 · MG-7).

연구 동의(미철회) 참여자의 **비식별 데이터만** 번들(Parquet + manifest.json)로 만들어 S3 스테이징 prefix 에 올리고,
Spark(DGX)가 pull 한 뒤 ack API 로 회신하면 ``research_consents.export_state`` 가 ``acked`` 가 된다.
이 SDD 에서 Spark 실접속·실전송은 하지 않는다(스테이징 포맷·ack API·계약 테스트까지).

- ``research_export_batches``: 배치 1건 = 세션 1개의 번들. 상태 ``built → uploaded → acked`` | ``failed`` | ``cancelled``.
- ``research_export_items``: 배치 안의 연구 동의 건별 항목. append-only — 재내보내기는 새 revision 항목이 추가될 뿐
  기존 항목(해시)은 바뀌지 않는다.
세션/참여자/동의 FK 를 두지 않는다(CASCADE 금지) — 스크럽·숨김·삭제 뒤에도 적재 이력과 철회 대조가 남아야 한다.
번들 안에는 원본 세션/참여자 UUID 가 없다(가명 ID 만).
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ResearchExportBatch(Base):
    __tablename__ = "research_export_batches"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # 내부 추적용 — 번들 안에는 싣지 않는다.
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    # building | uploaded | acked | failed | cancelled
    status: Mapped[str] = mapped_column(String(15), nullable=False, default="building")
    key_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # S3 스테이징 prefix(예: research-export/<batch_id>/) 와 manifest 해시/바이트
    prefix: Mapped[str | None] = mapped_column(String(200), nullable=True)
    manifest_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    total_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    file_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    alerted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    acked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ResearchExportItem(Base):
    __tablename__ = "research_export_items"
    __table_args__ = (
        UniqueConstraint("batch_id", "consent_id", name="uq_research_export_item"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    batch_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    consent_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    research_subject_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # 같은 동의 건의 N 번째 내보내기(1부터). 재내보내기는 새 revision.
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # 이 항목에 담긴 데이터(원자료 행 요약)의 sha256 — 같으면 재내보내기를 건너뛴다(중복 제거).
    content_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    rows: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
