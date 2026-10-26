"""SDD-246 T03 — live_session_epoch / live_command_ledger / live_outbox / capture_stream (additive)

기존 테이블은 건드리지 않는다(신규 4개만). downgrade 는 신규 테이블 DROP 이며 새 write 시작 후에는 쓰지 않는다.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg

revision = "e246a0301001"
down_revision = "e036a0261001"
branch_labels = None
depends_on = None


def _uuid(name, **kw):
    return sa.Column(name, pg.UUID(as_uuid=True), **kw)


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    now = sa.text("now()")
    op.create_table(
        "live_session_epoch",
        _uuid("session_id", primary_key=True),
        sa.Column("epoch", sa.BigInteger, nullable=False, server_default="1"),
        sa.Column("revision", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("auth_revision", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], ondelete="CASCADE"),
    )
    op.create_table(
        "live_command_ledger",
        _uuid("id", primary_key=True),
        _uuid("session_id", nullable=False),
        _uuid("actor_id", nullable=False),
        _uuid("command_id", nullable=False),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("body_hash", sa.String(64), nullable=False),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("code", sa.String(64)),
        sa.Column("epoch", sa.BigInteger, nullable=False),
        sa.Column("revision", sa.BigInteger, nullable=False),
        sa.Column("entity_version", sa.BigInteger),
        sa.Column("result", pg.JSONB, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("session_id", "actor_id", "command_id", name="uq_live_command_ledger_cmd"),
    )
    op.create_index("ix_live_command_ledger_session_rev", "live_command_ledger", ["session_id", "revision"])
    op.create_table(
        "live_outbox",
        _uuid("id", primary_key=True),
        _uuid("event_id", nullable=False),
        _uuid("session_id", nullable=False),
        sa.Column("revision", sa.BigInteger, nullable=False),
        sa.Column("epoch", sa.BigInteger, nullable=False),
        sa.Column("domain", sa.String(16), nullable=False),
        sa.Column("event_type", sa.String(40), nullable=False),
        sa.Column("entity_id", sa.String(64)),
        sa.Column("entity_version", sa.BigInteger),
        sa.Column("audience_policy", pg.JSONB, nullable=False),
        sa.Column("payload", pg.JSONB, nullable=False),
        _uuid("command_id"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.Column("processed_at", sa.DateTime(timezone=True)),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("event_id", name="uq_live_outbox_event_id"),
        sa.UniqueConstraint("session_id", "revision", name="uq_live_outbox_session_revision"),
    )
    op.create_index("ix_live_outbox_pending", "live_outbox", ["session_id", "revision"],
                    postgresql_where=sa.text("processed_at IS NULL"))
    op.create_table(
        "capture_stream",
        _uuid("id", primary_key=True),
        _uuid("session_id", nullable=False),
        _uuid("participant_id", nullable=False),
        _uuid("owner_actor_id", nullable=False),
        sa.Column("generation", sa.BigInteger, nullable=False),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("device_profile", sa.String(64), nullable=False),
        sa.Column("algorithm_version", sa.String(64), nullable=False),
        sa.Column("model_version", sa.String(64), nullable=False),
        _uuid("clock_anchor_id"),
        _uuid("clock_probe_id"),
        sa.Column("anchor_device_ticks", sa.BigInteger),
        sa.Column("anchor_monotonic_us", sa.BigInteger),
        sa.Column("anchor_server_at", sa.DateTime(timezone=True)),
        sa.Column("clock_uncertainty_ms", sa.Integer),
        sa.Column("clock_uncertain", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True)),
        sa.Column("offline_bound_until", sa.DateTime(timezone=True)),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True)),
        sa.Column("close_reason", sa.String(64)),
        sa.Column("cutoff_at", sa.DateTime(timezone=True)),
        sa.Column("cutoff_code", sa.String(32)),
        sa.Column("close_deadline_at", sa.DateTime(timezone=True)),
        sa.Column("final_sequences", pg.JSONB),
        sa.Column("entity_version", sa.BigInteger, nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["participant_id"], ["session_participants.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("participant_id", "generation", name="uq_capture_stream_participant_generation"),
    )
    op.create_index("ix_capture_stream_session", "capture_stream", ["session_id"])
    op.create_index("uq_capture_stream_active_participant", "capture_stream", ["participant_id"], unique=True,
                    postgresql_where=sa.text("status = 'active'"))


def downgrade():
    for t in ("capture_stream", "live_outbox", "live_command_ledger", "live_session_epoch"):
        op.execute(f"DROP TABLE IF EXISTS {t}")
