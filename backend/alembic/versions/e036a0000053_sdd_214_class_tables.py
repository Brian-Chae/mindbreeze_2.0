"""SDD-214 S1: 클래스군 테이블 4개 (classes · class_instructors · class_members · class_member_events)

새 테이블만 만든다. 기존 테이블·행은 건드리지 않는다. 제약은 테이블이 이미 있어도 이름으로 존재를 검사한 뒤 추가하므로
어느 상태에서 다시 실행해도 오류가 없다(멱등). 컬럼 정의의 정본은 specs/sdd-214-class-structure-phase1/schema-contract.md.
downgrade 는 신규 테이블을 의존 역순으로 제거한다. 데이터가 있으면 소실되므로 빈 환경에서만 사용한다.

Revision ID: e036a0000053
Revises: e036a0000052
Create Date: 2026-10-18
"""
from typing import Sequence, Union

from alembic import op

revision: str = "e036a0000053"
down_revision: Union[str, Sequence[str], None] = "e036a0000052"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _constraint(table: str, name: str, ddl: str) -> None:
    op.execute(f"""
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '{name}' AND conrelid = '{table}'::regclass) THEN
            ALTER TABLE {table} ADD CONSTRAINT {name} {ddl};
          END IF;
        END $$
    """)


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")

    # ── classes ──
    op.execute("""
        CREATE TABLE IF NOT EXISTS classes (
          id uuid NOT NULL PRIMARY KEY,
          organization_id uuid,
          organization_attribution_known boolean NOT NULL DEFAULT false,
          created_by uuid NOT NULL,
          title varchar(200),
          description text,
          schedule_mode varchar(10) NOT NULL DEFAULT 'fixed',
          planned_session_count integer,
          status varchar(12) NOT NULL DEFAULT 'active',
          capacity integer NOT NULL DEFAULT 1,
          participant_mode varchar(20) NOT NULL DEFAULT 'one_on_one',
          linkband_mode varchar(20) NOT NULL DEFAULT 'none',
          location_type varchar(20) NOT NULL DEFAULT 'offline',
          location_address varchar(300),
          default_duration_min integer NOT NULL,
          record_audio boolean NOT NULL DEFAULT true,
          record_video boolean NOT NULL DEFAULT true,
          chat_enabled boolean NOT NULL DEFAULT false,
          sfu_enabled boolean NOT NULL DEFAULT false,
          reminder_offsets jsonb NOT NULL DEFAULT '[]'::jsonb,
          recurrence_rule jsonb,
          assignment_rule jsonb,
          access_code varchar(6),
          legacy_access_code varchar(6),
          hidden_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
    """)
    _constraint("classes", "fk_classes_organization_id", "FOREIGN KEY (organization_id) REFERENCES organizations (id)")
    _constraint("classes", "fk_classes_created_by", "FOREIGN KEY (created_by) REFERENCES users (id)")
    _constraint("classes", "ck_classes_schedule_mode", "CHECK (schedule_mode IN ('fixed', 'rolling'))")
    _constraint("classes", "ck_classes_planned_count", "CHECK (planned_session_count IS NULL OR planned_session_count >= 1)")
    _constraint(
        "classes", "ck_classes_status",
        "CHECK (status IN ('draft', 'active', 'completed', 'cancelled', 'archived'))",
    )
    _constraint("classes", "ck_classes_capacity", "CHECK (capacity >= 1)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_classes_organization_id ON classes (organization_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_classes_created_by ON classes (created_by)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_classes_status ON classes (status)")
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_classes_active_access_code ON classes (access_code)
        WHERE access_code IS NOT NULL AND hidden_at IS NULL AND status NOT IN ('completed', 'cancelled', 'archived')
    """)

    # ── class_instructors ──
    op.execute("""
        CREATE TABLE IF NOT EXISTS class_instructors (
          id uuid NOT NULL PRIMARY KEY,
          class_id uuid NOT NULL,
          user_id uuid NOT NULL,
          role varchar(10) NOT NULL DEFAULT 'lead',
          status varchar(10) NOT NULL DEFAULT 'active',
          scope_session_id uuid,
          added_by uuid,
          added_at timestamptz NOT NULL DEFAULT now(),
          removed_at timestamptz
        )
    """)
    _constraint(
        "class_instructors", "fk_class_instructors_class_id",
        "FOREIGN KEY (class_id) REFERENCES classes (id) ON DELETE RESTRICT",
    )
    _constraint("class_instructors", "fk_class_instructors_user_id", "FOREIGN KEY (user_id) REFERENCES users (id)")
    _constraint(
        "class_instructors", "fk_class_instructors_scope_session_id",
        "FOREIGN KEY (scope_session_id) REFERENCES sessions (id) ON DELETE SET NULL",
    )
    _constraint("class_instructors", "fk_class_instructors_added_by", "FOREIGN KEY (added_by) REFERENCES users (id)")
    _constraint("class_instructors", "uq_class_instructors_class_user", "UNIQUE (class_id, user_id)")
    _constraint("class_instructors", "ck_class_instructors_role", "CHECK (role IN ('lead', 'assistant', 'guest'))")
    _constraint("class_instructors", "ck_class_instructors_status", "CHECK (status IN ('active', 'removed'))")
    _constraint("class_instructors", "ck_class_instructors_scope", "CHECK (scope_session_id IS NULL OR role = 'guest')")
    op.execute("CREATE INDEX IF NOT EXISTS ix_class_instructors_user_id ON class_instructors (user_id)")

    # ── class_members ──
    op.execute("""
        CREATE TABLE IF NOT EXISTS class_members (
          id uuid NOT NULL PRIMARY KEY,
          class_id uuid NOT NULL,
          user_id uuid,
          kind varchar(10) NOT NULL DEFAULT 'member',
          status varchar(20) NOT NULL,
          joined_via varchar(20) NOT NULL,
          guest_name varchar(100),
          gender varchar(20),
          birth_date date,
          report_email varchar(320),
          pii_scrubbed_at timestamptz,
          waitlist_position integer,
          joined_at timestamptz NOT NULL DEFAULT now(),
          activated_at timestamptz,
          left_at timestamptz,
          removed_at timestamptz,
          completed_at timestamptz,
          first_session_id uuid,
          report_included_default boolean NOT NULL DEFAULT false,
          notice_ack_at timestamptz,
          notice_version varchar(20),
          entry_ver integer NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
    """)
    _constraint(
        "class_members", "fk_class_members_class_id",
        "FOREIGN KEY (class_id) REFERENCES classes (id) ON DELETE RESTRICT",
    )
    _constraint("class_members", "fk_class_members_user_id", "FOREIGN KEY (user_id) REFERENCES users (id)")
    _constraint(
        "class_members", "fk_class_members_first_session_id",
        "FOREIGN KEY (first_session_id) REFERENCES sessions (id) ON DELETE SET NULL",
    )
    _constraint("class_members", "uq_class_members_class_user", "UNIQUE (class_id, user_id)")
    _constraint("class_members", "ck_class_members_kind", "CHECK (kind IN ('member', 'guest'))")
    _constraint(
        "class_members", "ck_class_members_status",
        "CHECK (status IN ('invited', 'waitlisted', 'active', 'completed', 'left', 'removed', 'declined'))",
    )
    _constraint(
        "class_members", "ck_class_members_joined_via",
        "CHECK (joined_via IN ('host_invite', 'code', 'email_invite', 'waitlist_promotion'))",
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_class_members_user_id ON class_members (user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_class_members_class_status ON class_members (class_id, status)")

    # ── class_member_events (append-only, FK 없음) ──
    op.execute("""
        CREATE TABLE IF NOT EXISTS class_member_events (
          id uuid NOT NULL PRIMARY KEY,
          class_id uuid NOT NULL,
          member_id uuid NOT NULL,
          from_status varchar(20),
          to_status varchar(20) NOT NULL,
          actor_kind varchar(20) NOT NULL,
          actor_user_id uuid,
          reason text,
          created_at timestamptz NOT NULL DEFAULT now()
        )
    """)
    _constraint(
        "class_member_events", "ck_class_member_events_actor_kind",
        "CHECK (actor_kind IN ('self', 'host', 'system', 'platform_admin'))",
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_class_member_events_class_id ON class_member_events (class_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_class_member_events_member_id ON class_member_events (member_id)")


def downgrade() -> None:
    """신규 테이블 제거. 데이터가 있으면 소실되므로 빈 환경에서만 사용한다."""
    op.execute("DROP TABLE IF EXISTS class_member_events")
    op.execute("DROP TABLE IF EXISTS class_members")
    op.execute("DROP TABLE IF EXISTS class_instructors")
    op.execute("DROP TABLE IF EXISTS classes")
