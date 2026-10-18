"""SDD-214 S2: 상담군 테이블 5개 (counseling_guests · counseling_relationships · counseling_relationship_counselors ·
counseling_relationship_events · guest_claim_events)

새 테이블만 만든다. 기존 테이블·행은 건드리지 않는다. 053 과 서로 독립이며 055 만 둘에 의존한다. 제약은 이름으로 존재를
검사한 뒤 추가하므로 어느 상태에서 다시 실행해도 오류가 없다(멱등). 컬럼 정의의 정본은
specs/sdd-214-class-structure-phase1/schema-contract.md.
downgrade 는 신규 테이블을 의존 역순으로 제거한다. 데이터가 있으면 소실되므로 빈 환경에서만 사용한다.

Revision ID: e036a0000054
Revises: e036a0000053
Create Date: 2026-10-18
"""
from typing import Sequence, Union

from alembic import op

revision: str = "e036a0000054"
down_revision: Union[str, Sequence[str], None] = "e036a0000053"
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

    # ── counseling_guests ──
    op.execute("""
        CREATE TABLE IF NOT EXISTS counseling_guests (
          id uuid NOT NULL PRIMARY KEY,
          organization_id uuid,
          created_by_counselor_id uuid NOT NULL,
          display_name varchar(100),
          email varchar(320),
          email_norm varchar(320),
          email_verified_at timestamptz,
          gender varchar(20),
          birth_date date,
          reentry_secret_hash varchar(64),
          reentry_ver integer NOT NULL DEFAULT 0,
          reentry_issued_at timestamptz,
          reentry_last_used_at timestamptz,
          privacy_consent_at timestamptz,
          privacy_notice_version varchar(20),
          claimed_user_id uuid,
          claimed_at timestamptz,
          claim_method varchar(20),
          pii_scrubbed_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
    """)
    _constraint(
        "counseling_guests", "fk_counseling_guests_organization_id",
        "FOREIGN KEY (organization_id) REFERENCES organizations (id)",
    )
    _constraint(
        "counseling_guests", "fk_counseling_guests_created_by_counselor_id",
        "FOREIGN KEY (created_by_counselor_id) REFERENCES users (id)",
    )
    _constraint(
        "counseling_guests", "fk_counseling_guests_claimed_user_id",
        "FOREIGN KEY (claimed_user_id) REFERENCES users (id)",
    )
    _constraint(
        "counseling_guests", "ck_counseling_guests_claim_method",
        "CHECK (claim_method IS NULL OR claim_method IN ('email_otp', 'counselor_confirmed', 'admin'))",
    )
    _constraint(
        "counseling_guests", "ck_counseling_guests_claimed",
        "CHECK (claimed_user_id IS NULL OR claimed_at IS NOT NULL)",
    )
    _constraint(
        "counseling_guests", "ck_counseling_guests_name",
        "CHECK (pii_scrubbed_at IS NOT NULL OR display_name IS NOT NULL)",
    )
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_guest_email_per_counselor
        ON counseling_guests (created_by_counselor_id, email_norm)
        WHERE email_norm IS NOT NULL AND claimed_user_id IS NULL AND pii_scrubbed_at IS NULL
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_counseling_guests_created_by_counselor_id "
        "ON counseling_guests (created_by_counselor_id)"
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_counseling_guests_email_norm ON counseling_guests (email_norm)")

    # ── counseling_relationships ──
    op.execute("""
        CREATE TABLE IF NOT EXISTS counseling_relationships (
          id uuid NOT NULL PRIMARY KEY,
          organization_id uuid,
          organization_attribution_known boolean NOT NULL DEFAULT false,
          counselor_id uuid NOT NULL,
          client_user_id uuid,
          client_guest_id uuid,
          is_placeholder boolean NOT NULL DEFAULT false,
          link_id uuid,
          title varchar(200),
          modality_default varchar(20),
          status varchar(10) NOT NULL DEFAULT 'active',
          started_at timestamptz NOT NULL DEFAULT now(),
          closed_at timestamptz,
          closed_by uuid,
          close_reason varchar(40),
          archived_at timestamptz,
          reopened_count integer NOT NULL DEFAULT 0,
          predecessor_relationship_id uuid,
          default_duration_min integer,
          location_type varchar(20),
          location_address varchar(300),
          linkband_mode varchar(20),
          record_audio boolean,
          record_video boolean,
          reminder_offsets jsonb,
          access_code varchar(6),
          legacy_access_code varchar(6),
          hidden_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
    """)
    rel = "counseling_relationships"
    _constraint(rel, "fk_counseling_relationships_organization_id", "FOREIGN KEY (organization_id) REFERENCES organizations (id)")
    _constraint(rel, "fk_counseling_relationships_counselor_id", "FOREIGN KEY (counselor_id) REFERENCES users (id)")
    _constraint(rel, "fk_counseling_relationships_client_user_id", "FOREIGN KEY (client_user_id) REFERENCES users (id)")
    _constraint(
        rel, "fk_counseling_relationships_client_guest_id",
        "FOREIGN KEY (client_guest_id) REFERENCES counseling_guests (id) ON DELETE RESTRICT",
    )
    _constraint(
        rel, "fk_counseling_relationships_link_id",
        "FOREIGN KEY (link_id) REFERENCES client_counselor_links (id) ON DELETE SET NULL",
    )
    _constraint(rel, "fk_counseling_relationships_closed_by", "FOREIGN KEY (closed_by) REFERENCES users (id)")
    _constraint(
        rel, "fk_counseling_relationships_predecessor",
        "FOREIGN KEY (predecessor_relationship_id) REFERENCES counseling_relationships (id) ON DELETE RESTRICT",
    )
    _constraint(
        rel, "ck_rel_client",
        "CHECK ((is_placeholder AND client_user_id IS NULL AND client_guest_id IS NULL) "
        "OR (NOT is_placeholder AND (client_user_id IS NOT NULL OR client_guest_id IS NOT NULL)))",
    )
    _constraint(rel, "ck_rel_status", "CHECK (status IN ('pending', 'active', 'closed', 'archived'))")
    _constraint(rel, "ck_rel_modality", "CHECK (modality_default IS NULL OR modality_default IN ('clinical', 'hypnosis'))")
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_rel_active_pair ON counseling_relationships (counselor_id, client_user_id)
        WHERE client_user_id IS NOT NULL AND status = 'active'
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_rel_guest ON counseling_relationships (client_guest_id)
        WHERE client_guest_id IS NOT NULL
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_rel_placeholder ON counseling_relationships (counselor_id)
        WHERE is_placeholder
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_counseling_relationships_counselor_status "
        "ON counseling_relationships (counselor_id, status)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_counseling_relationships_client_user_id ON counseling_relationships (client_user_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_counseling_relationships_organization_id ON counseling_relationships (organization_id)"
    )

    # ── counseling_relationship_counselors (sessions 복합 FK 의 참조 대상) ──
    op.execute("""
        CREATE TABLE IF NOT EXISTS counseling_relationship_counselors (
          id uuid NOT NULL PRIMARY KEY,
          relationship_id uuid NOT NULL,
          counselor_id uuid NOT NULL,
          status varchar(10) NOT NULL DEFAULT 'active',
          from_at timestamptz NOT NULL DEFAULT now(),
          to_at timestamptz
        )
    """)
    rc = "counseling_relationship_counselors"
    _constraint(
        rc, "fk_rel_counselors_relationship_id",
        "FOREIGN KEY (relationship_id) REFERENCES counseling_relationships (id) ON DELETE RESTRICT",
    )
    _constraint(rc, "fk_rel_counselors_counselor_id", "FOREIGN KEY (counselor_id) REFERENCES users (id)")
    _constraint(rc, "uq_rel_counselors_rel_counselor", "UNIQUE (relationship_id, counselor_id)")
    _constraint(rc, "ck_rel_counselors_status", "CHECK (status IN ('active', 'removed'))")
    op.execute("CREATE INDEX IF NOT EXISTS ix_rel_counselors_counselor_id ON counseling_relationship_counselors (counselor_id)")

    # ── counseling_relationship_events (append-only, FK 없음) ──
    op.execute("""
        CREATE TABLE IF NOT EXISTS counseling_relationship_events (
          id uuid NOT NULL PRIMARY KEY,
          relationship_id uuid NOT NULL,
          from_status varchar(10),
          to_status varchar(10) NOT NULL,
          actor_kind varchar(20) NOT NULL,
          actor_user_id uuid,
          reason text,
          created_at timestamptz NOT NULL DEFAULT now()
        )
    """)
    _constraint(
        "counseling_relationship_events", "ck_rel_events_actor_kind",
        "CHECK (actor_kind IN ('counselor', 'client', 'system', 'platform_admin'))",
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_rel_events_relationship_id ON counseling_relationship_events (relationship_id)"
    )

    # ── guest_claim_events (append-only, FK 없음) ──
    op.execute("""
        CREATE TABLE IF NOT EXISTS guest_claim_events (
          id uuid NOT NULL PRIMARY KEY,
          guest_client_id uuid NOT NULL,
          user_id uuid NOT NULL,
          method varchar(20) NOT NULL,
          rewritten_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now()
        )
    """)
    _constraint(
        "guest_claim_events", "ck_guest_claim_events_method",
        "CHECK (method IN ('email_otp', 'counselor_confirmed', 'admin'))",
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_guest_claim_events_guest_client_id ON guest_claim_events (guest_client_id)")


def downgrade() -> None:
    """신규 테이블 제거. 데이터가 있으면 소실되므로 빈 환경에서만 사용한다."""
    op.execute("DROP TABLE IF EXISTS guest_claim_events")
    op.execute("DROP TABLE IF EXISTS counseling_relationship_events")
    op.execute("DROP TABLE IF EXISTS counseling_relationship_counselors")
    op.execute("DROP TABLE IF EXISTS counseling_relationships")
    op.execute("DROP TABLE IF EXISTS counseling_guests")
