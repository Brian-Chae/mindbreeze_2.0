"""SDD-244 M3 — 연구 신호별 영수증 · 객체 삭제 outbox · 연구 item 스키마 범위 (스키마만).

additive 전용. 서비스 로직(연구 v3·삭제 재시도)은 후속 Task(C)에서 구현한다. 과거 EEG ACK 를 다른 신호로
backfill 하지 않는다. 연구 영수증/outbox 는 세션·참여자 FK 를 두지 않는다(삭제 CASCADE 로 증거가 사라지면 안 됨).
"""
from alembic import op

revision = "e036a0244003"
down_revision = "e036a0244002"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("ALTER TABLE research_export_items ADD COLUMN IF NOT EXISTS bundle_schema_version varchar(20)")
    op.execute("ALTER TABLE research_export_items ADD COLUMN IF NOT EXISTS signal_scope jsonb")
    op.execute("""
        CREATE TABLE IF NOT EXISTS research_signal_receipts (
          id uuid PRIMARY KEY,
          session_id uuid NOT NULL,
          participant_id uuid NOT NULL,
          consent_id uuid,
          signal varchar(8) NOT NULL,
          artifact_kind varchar(20) NOT NULL,
          manifest_revision integer NOT NULL,
          manifest_sha256 varchar(64) NOT NULL,
          schema_version varchar(20) NOT NULL,
          batch_id uuid,
          acked_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT uq_research_signal_receipt UNIQUE (participant_id, signal, artifact_kind, manifest_revision, manifest_sha256),
          CONSTRAINT ck_research_signal_receipt_signal CHECK (signal IN ('eeg','ppg','acc')),
          CONSTRAINT ck_research_signal_receipt_revision CHECK (manifest_revision > 0)
        )""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_research_signal_receipts_session_id ON research_signal_receipts (session_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_research_signal_receipts_participant_id ON research_signal_receipts (participant_id)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS object_deletion_outbox (
          id uuid PRIMARY KEY,
          object_key varchar(500) NOT NULL,
          source_table varchar(40) NOT NULL,
          reason varchar(40) NOT NULL,
          state varchar(16) NOT NULL DEFAULT 'pending',
          attempts integer NOT NULL DEFAULT 0,
          next_attempt_at timestamptz,
          last_error varchar(200),
          tombstone jsonb,
          created_at timestamptz NOT NULL DEFAULT now(),
          completed_at timestamptz,
          CONSTRAINT uq_object_deletion_outbox_key UNIQUE (object_key),
          CONSTRAINT ck_object_deletion_state CHECK (state IN ('pending','in_progress','done','failed_permanent'))
        )""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_object_deletion_outbox_due ON object_deletion_outbox (state, next_attempt_at)")
    # M1 의 manifest revision 은 불변이다 — 후발 ACK 는 새 revision 만 만들고 기존 행은 수정할 수 없다(DB 수준 강제).
    op.execute("""
        CREATE OR REPLACE FUNCTION biosignal_manifest_revisions_no_update() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'biosignal_manifest_revisions 는 불변이다(새 revision 을 추가하라)';
        END;
        $$ LANGUAGE plpgsql""")
    op.execute("DROP TRIGGER IF EXISTS trg_biosignal_manifest_revisions_immutable ON biosignal_manifest_revisions")
    op.execute("""
        CREATE TRIGGER trg_biosignal_manifest_revisions_immutable
        BEFORE UPDATE ON biosignal_manifest_revisions
        FOR EACH ROW EXECUTE FUNCTION biosignal_manifest_revisions_no_update()""")


def downgrade():
    op.execute("""
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM research_signal_receipts) OR EXISTS (SELECT 1 FROM object_deletion_outbox) THEN
            RAISE EXCEPTION 'SDD-244 M3 downgrade 거부: 연구 영수증/삭제 outbox 에 데이터가 있다';
          END IF;
        END $$""")
    op.execute("DROP TRIGGER IF EXISTS trg_biosignal_manifest_revisions_immutable ON biosignal_manifest_revisions")
    op.execute("DROP FUNCTION IF EXISTS biosignal_manifest_revisions_no_update()")
    op.execute("DROP TABLE IF EXISTS object_deletion_outbox")
    op.execute("DROP TABLE IF EXISTS research_signal_receipts")
    op.execute("ALTER TABLE research_export_items DROP COLUMN IF EXISTS signal_scope")
    op.execute("ALTER TABLE research_export_items DROP COLUMN IF EXISTS bundle_schema_version")
