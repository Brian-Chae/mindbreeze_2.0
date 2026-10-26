"""SDD-216 명상 편성 가산 스키마. 기존 데이터와 제약을 변경하지 않는다."""

from alembic import op

revision = "e036a0000056"
down_revision = "e036a0000055"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("""ALTER TABLE classes
        ADD COLUMN draft_schedule jsonb,
        ADD COLUMN ends_on date,
        ADD COLUMN generation_cursor date,
        ADD COLUMN revision integer NOT NULL DEFAULT 0,
        ADD COLUMN archived_from_status varchar(12)""")
    op.execute(
        "ALTER TABLE sessions ADD COLUMN assignment_override boolean NOT NULL DEFAULT false"
    )
    op.execute(
        "CREATE INDEX ix_sessions_host_scheduled_at ON sessions(host_id, scheduled_at)"
    )
    op.execute("""CREATE TABLE class_operations (
        id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES users(id),
        operation_key varchar(100) NOT NULL, request_hash varchar(64) NOT NULL,
        class_id uuid REFERENCES classes(id), result jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_class_operations_actor_key UNIQUE(actor_id, operation_key))""")
    op.execute("""CREATE TABLE class_effects (
        id uuid PRIMARY KEY, class_id uuid NOT NULL REFERENCES classes(id),
        session_id uuid REFERENCES sessions(id), effect_key varchar(240) NOT NULL UNIQUE,
        kind varchar(60) NOT NULL, payload jsonb NOT NULL,
        available_at timestamptz NOT NULL DEFAULT now(), status varchar(20) NOT NULL DEFAULT 'pending',
        attempts integer NOT NULL DEFAULT 0)""")
    op.execute(
        """CREATE TABLE class_email_invites (
        id uuid PRIMARY KEY, class_id uuid NOT NULL REFERENCES classes(id),
        email_norm varchar(320) NOT NULL, invited_by uuid NOT NULL REFERENCES users(id),
        invite_version integer NOT NULL DEFAULT 1, status varchar(20) NOT NULL DEFAULT 'pending',
        created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz,
        CONSTRAINT uq_class_email_invites_version UNIQUE(class_id,email_norm,invite_version))"""
    )
    op.execute("""CREATE TABLE session_host_requests (
        id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES sessions(id),
        requested_by uuid NOT NULL REFERENCES users(id), candidate_host_id uuid NOT NULL REFERENCES users(id),
        request_kind varchar(20) NOT NULL, status varchar(20) NOT NULL,
        expected_state_version integer NOT NULL, reason text, expires_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz)""")
    op.execute(
        "CREATE UNIQUE INDEX uq_session_host_requests_pending ON session_host_requests(session_id) WHERE status IN ('requested','pending_ack')"
    )
    op.execute("""CREATE TABLE session_host_notes (
        id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES sessions(id),
        actor_id uuid NOT NULL REFERENCES users(id), displayed_host_name varchar(100) NOT NULL,
        reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())""")


def downgrade():
    raise RuntimeError(
        "SDD-216 편성 이력은 자동 삭제하지 않습니다. 복구는 이전 앱과 기능 스위치로 수행하세요."
    )
