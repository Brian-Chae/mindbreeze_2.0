"""SDD-214 S3: 가드 + 보조 테이블 + 기존 3개 테이블 가산 컬럼 + 제약 일괄

① 가드: 아직 이 제약이 없는 DB 에 비템플릿 세션이 있으면 아무것도 바꾸지 않고 중단한다(데이터 초기화 먼저).
   기존 데이터를 이전하지 않는다는 전제(정식 릴리스 전)라서, 부모가 없는 세션이 CHECK 에 걸리기 전에 막는다.
② session_host_history ③ sessions · session_participants · reports 에 컬럼 추가(기존 컬럼은 변경하지 않는다)
④ 제약은 모두 즉시 유효(NOT VALID 단계 없음): ck_sessions_one_parent(템플릿 예외), 복합 FK 2개, 회차 번호·출석 유니크.
모든 문장은 존재 검사 후 실행해 어느 상태에서 다시 실행해도 오류가 없다(멱등).
downgrade 는 추가한 제약·컬럼·테이블만 제거한다(기존 컬럼·행은 건드리지 않음).
데이터가 있으면 소실되므로 빈 환경에서만 사용한다.

Revision ID: e036a0000055
Revises: e036a0000054
Create Date: 2026-10-18
"""
from typing import Sequence, Union

from alembic import op

revision: str = "e036a0000055"
down_revision: Union[str, Sequence[str], None] = "e036a0000054"
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

    # ① 가드 — 이미 이 리비전의 제약이 있는 DB 는 통과(재실행). 그렇지 않은데 비템플릿 세션이 있으면 중단.
    op.execute("""
        DO $$ DECLARE n integer; BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'ck_sessions_one_parent' AND conrelid = 'sessions'::regclass
          ) THEN
            SELECT count(*) INTO n FROM sessions WHERE NOT is_template;
            IF n > 0 THEN
              RAISE EXCEPTION 'SDD-214 마이그레이션 중단: 비템플릿 세션 %건이 남아 있습니다. 데이터 초기화(Z) 절차를 먼저 수행하세요. 이 마이그레이션은 변경 없이 중단되었습니다.', n;
            END IF;
          END IF;
        END $$
    """)

    # ② session_host_history (append-only, FK 없음)
    op.execute("""
        CREATE TABLE IF NOT EXISTS session_host_history (
          id uuid NOT NULL PRIMARY KEY,
          session_id uuid NOT NULL,
          previous_host_id uuid NOT NULL,
          new_host_id uuid NOT NULL,
          reason text,
          changed_by uuid,
          created_at timestamptz NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_session_host_history_session_id ON session_host_history (session_id)")

    # ③ sessions
    op.execute("""
        ALTER TABLE sessions
          ADD COLUMN IF NOT EXISTS class_id uuid,
          ADD COLUMN IF NOT EXISTS counseling_relationship_id uuid,
          ADD COLUMN IF NOT EXISTS seq integer,
          ADD COLUMN IF NOT EXISTS session_kind varchar(10) NOT NULL DEFAULT 'regular',
          ADD COLUMN IF NOT EXISTS host_state varchar(20)
    """)
    # session_participants
    op.execute("""
        ALTER TABLE session_participants
          ADD COLUMN IF NOT EXISTS member_id uuid,
          ADD COLUMN IF NOT EXISTS guest_client_id uuid,
          ADD COLUMN IF NOT EXISTS attendance_status varchar(20),
          ADD COLUMN IF NOT EXISTS attendance_kind varchar(10) NOT NULL DEFAULT 'regular',
          ADD COLUMN IF NOT EXISTS makeup_for_session_id uuid,
          ADD COLUMN IF NOT EXISTS attendance_marked_by varchar(20),
          ADD COLUMN IF NOT EXISTS absence_reason varchar(200)
    """)
    # reports
    op.execute("""
        ALTER TABLE reports
          ADD COLUMN IF NOT EXISTS approved_by_user_id uuid,
          ADD COLUMN IF NOT EXISTS approved_at timestamptz
    """)

    # ④ 제약 — sessions
    _constraint(
        "sessions", "fk_sessions_class_id",
        "FOREIGN KEY (class_id) REFERENCES classes (id) ON DELETE RESTRICT",
    )
    _constraint(
        "sessions", "fk_sessions_counseling_relationship_id",
        "FOREIGN KEY (counseling_relationship_id) REFERENCES counseling_relationships (id) ON DELETE RESTRICT",
    )
    _constraint(
        "sessions", "fk_sessions_class_host",
        "FOREIGN KEY (class_id, host_id) REFERENCES class_instructors (class_id, user_id) ON DELETE RESTRICT",
    )
    _constraint(
        "sessions", "fk_sessions_relationship_host",
        "FOREIGN KEY (counseling_relationship_id, host_id) "
        "REFERENCES counseling_relationship_counselors (relationship_id, counselor_id) ON DELETE RESTRICT",
    )
    _constraint(
        "sessions", "ck_sessions_one_parent",
        "CHECK (is_template OR (num_nonnulls(class_id, counseling_relationship_id) = 1 "
        "AND seq IS NOT NULL AND host_state IS NOT NULL))",
    )
    _constraint("sessions", "ck_sessions_session_kind", "CHECK (session_kind IN ('regular', 'makeup'))")
    _constraint(
        "sessions", "ck_sessions_host_state",
        "CHECK (host_state IS NULL OR host_state IN ('assigned', 'pending_ack', 'needs_reassign'))",
    )
    _constraint("sessions", "uq_sessions_class_seq", "UNIQUE (class_id, seq)")
    _constraint("sessions", "uq_sessions_relationship_seq", "UNIQUE (counseling_relationship_id, seq)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_sessions_class_id ON sessions (class_id)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_sessions_counseling_relationship_id ON sessions (counseling_relationship_id)"
    )

    # session_participants
    sp = "session_participants"
    _constraint(sp, "fk_session_participants_member_id", "FOREIGN KEY (member_id) REFERENCES class_members (id) ON DELETE RESTRICT")
    _constraint(
        sp, "fk_session_participants_guest_client_id",
        "FOREIGN KEY (guest_client_id) REFERENCES counseling_guests (id) ON DELETE RESTRICT",
    )
    _constraint(
        sp, "fk_session_participants_makeup_for",
        "FOREIGN KEY (makeup_for_session_id) REFERENCES sessions (id) ON DELETE SET NULL",
    )
    _constraint(sp, "uq_session_participants_session_member", "UNIQUE (session_id, member_id)")
    _constraint(sp, "ck_session_participants_one_identity", "CHECK (member_id IS NULL OR guest_client_id IS NULL)")
    _constraint(
        sp, "ck_session_participants_attendance_status",
        "CHECK (attendance_status IS NULL OR attendance_status IN ('expected', 'attended', 'absent', 'excused', 'withdrawn'))",
    )
    _constraint(
        sp, "ck_session_participants_attendance_kind",
        "CHECK (attendance_kind IN ('regular', 'makeup', 'guest_pass'))",
    )
    _constraint(
        sp, "ck_session_participants_marked_by",
        "CHECK (attendance_marked_by IS NULL OR attendance_marked_by IN ('system', 'host', 'self'))",
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_session_participants_member_id ON session_participants (member_id)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_session_participants_guest_client_id ON session_participants (guest_client_id)"
    )

    # reports
    _constraint("reports", "fk_reports_approved_by_user_id", "FOREIGN KEY (approved_by_user_id) REFERENCES users (id)")


def downgrade() -> None:
    """055 가 추가한 제약·컬럼·테이블 제거. 데이터가 있으면 소실되므로 빈 환경에서만 사용한다."""
    op.execute("ALTER TABLE reports DROP CONSTRAINT IF EXISTS fk_reports_approved_by_user_id")
    op.execute("ALTER TABLE reports DROP COLUMN IF EXISTS approved_by_user_id, DROP COLUMN IF EXISTS approved_at")

    op.execute("DROP INDEX IF EXISTS ix_session_participants_guest_client_id")
    op.execute("DROP INDEX IF EXISTS ix_session_participants_member_id")
    op.execute("""
        ALTER TABLE session_participants
          DROP CONSTRAINT IF EXISTS ck_session_participants_marked_by,
          DROP CONSTRAINT IF EXISTS ck_session_participants_attendance_kind,
          DROP CONSTRAINT IF EXISTS ck_session_participants_attendance_status,
          DROP CONSTRAINT IF EXISTS ck_session_participants_one_identity,
          DROP CONSTRAINT IF EXISTS uq_session_participants_session_member,
          DROP CONSTRAINT IF EXISTS fk_session_participants_makeup_for,
          DROP CONSTRAINT IF EXISTS fk_session_participants_guest_client_id,
          DROP CONSTRAINT IF EXISTS fk_session_participants_member_id,
          DROP COLUMN IF EXISTS absence_reason,
          DROP COLUMN IF EXISTS attendance_marked_by,
          DROP COLUMN IF EXISTS makeup_for_session_id,
          DROP COLUMN IF EXISTS attendance_kind,
          DROP COLUMN IF EXISTS attendance_status,
          DROP COLUMN IF EXISTS guest_client_id,
          DROP COLUMN IF EXISTS member_id
    """)

    op.execute("DROP INDEX IF EXISTS ix_sessions_counseling_relationship_id")
    op.execute("DROP INDEX IF EXISTS ix_sessions_class_id")
    op.execute("""
        ALTER TABLE sessions
          DROP CONSTRAINT IF EXISTS uq_sessions_relationship_seq,
          DROP CONSTRAINT IF EXISTS uq_sessions_class_seq,
          DROP CONSTRAINT IF EXISTS ck_sessions_host_state,
          DROP CONSTRAINT IF EXISTS ck_sessions_session_kind,
          DROP CONSTRAINT IF EXISTS ck_sessions_one_parent,
          DROP CONSTRAINT IF EXISTS fk_sessions_relationship_host,
          DROP CONSTRAINT IF EXISTS fk_sessions_class_host,
          DROP CONSTRAINT IF EXISTS fk_sessions_counseling_relationship_id,
          DROP CONSTRAINT IF EXISTS fk_sessions_class_id,
          DROP COLUMN IF EXISTS host_state,
          DROP COLUMN IF EXISTS session_kind,
          DROP COLUMN IF EXISTS seq,
          DROP COLUMN IF EXISTS counseling_relationship_id,
          DROP COLUMN IF EXISTS class_id
    """)

    op.execute("DROP TABLE IF EXISTS session_host_history")
