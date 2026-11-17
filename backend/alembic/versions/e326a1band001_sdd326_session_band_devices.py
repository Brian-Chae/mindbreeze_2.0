"""SDD-326: session_band_devices 신규 — 회차별 밴드 시리얼 이력 (가산).

- 참가자×시리얼 1행(UNIQUE), 재보고는 UPSERT 로 last_seen_at 갱신.
- 현재 기기는 기존 session_participants.linkband_device_id 를 그대로 쓴다.
- downgrade: 테이블 drop (이력만 사라지고 다른 테이블은 무변경).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "e326a1band001"
down_revision = "d305a1rot001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "session_band_devices",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("participant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("session_participants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("serial", sa.String(64), nullable=False),
        sa.Column("firmware", sa.String(32), nullable=True),
        sa.Column("platform", sa.String(16), nullable=True),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("participant_id", "serial", name="uq_session_band_devices_participant_serial"),
    )
    op.create_index("ix_session_band_devices_session_id", "session_band_devices", ["session_id"])
    op.create_index("ix_session_band_devices_participant_id", "session_band_devices", ["participant_id"])
    op.create_index("ix_session_band_devices_serial", "session_band_devices", ["serial"])


def downgrade() -> None:
    op.drop_index("ix_session_band_devices_serial", table_name="session_band_devices")
    op.drop_index("ix_session_band_devices_participant_id", table_name="session_band_devices")
    op.drop_index("ix_session_band_devices_session_id", table_name="session_band_devices")
    op.drop_table("session_band_devices")
