"""SDD-244 M1 — 세 신호 raw v2 원장 + stream/segment/gap/종료 의도/manifest revision.

additive 전용: eeg_raw_chunks 에 nullable/default 컬럼만 추가하고(기존 행 = eeg/legacy), identity
유니크를 (signal_type, segment_id 포함)로 확장한다. v1 의미는 default 값 때문에 동일하다.
기존 행 재작성 없음(PG11+ 상수 default 는 메타데이터만 변경). downgrade 는 v2 행이 있으면 거부한다.
"""
from alembic import op

revision = "e036a0244001"
down_revision = "e036a0000061"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    for col in (
        "signal_type varchar(8) NOT NULL DEFAULT 'eeg'",
        "segment_id varchar(64) NOT NULL DEFAULT 'legacy'",
        "play_group_id varchar(64)",
        "sample_count integer",
        "packet_count integer",
        "first_sample_index bigint",
        "time_basis varchar(20)",
        "parser_profile_id varchar(64)",
        "parser_profile_hash varchar(64)",
        "header jsonb",
        "object_version_id varchar(200)",
        "verified_at timestamptz",
        "failure_reason varchar(100)",
        "chunk_alias varchar(64)",
    ):
        op.execute(f"ALTER TABLE eeg_raw_chunks ADD COLUMN IF NOT EXISTS {col}")

    # 새 identity 를 먼저 만든 뒤 구 유니크를 제거한다(중간에도 중복 방지가 끊기지 않는다).
    op.execute("""
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_eeg_raw_chunk_v2') THEN
            ALTER TABLE eeg_raw_chunks ADD CONSTRAINT uq_eeg_raw_chunk_v2
              UNIQUE (session_id, participant_id, signal_type, stream_id, segment_id, chunk_index);
          END IF;
        END $$""")
    op.execute("ALTER TABLE eeg_raw_chunks DROP CONSTRAINT IF EXISTS uq_eeg_raw_chunk")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_eeg_raw_chunk_alias ON eeg_raw_chunks (session_id, participant_id, chunk_alias) WHERE chunk_alias IS NOT NULL")
    op.execute("CREATE INDEX IF NOT EXISTS ix_eeg_raw_chunk_signal ON eeg_raw_chunks (session_id, participant_id, signal_type)")
    for name, expr in (
        ("ck_eeg_raw_signal_type", "signal_type IN ('eeg','ppg','acc')"),
        ("ck_eeg_raw_counts", "(sample_count IS NULL OR sample_count >= 0) AND (packet_count IS NULL OR packet_count >= 0)"),
        ("ck_eeg_raw_v2_participant", "schema_version <> 'mb-biosignal-raw-v2' OR participant_id IS NOT NULL"),
    ):
        op.execute(f"""
            DO $$ BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '{name}') THEN
                ALTER TABLE eeg_raw_chunks ADD CONSTRAINT {name} CHECK ({expr}) NOT VALID;
                ALTER TABLE eeg_raw_chunks VALIDATE CONSTRAINT {name};
              END IF;
            END $$""")

    op.execute("""
        CREATE TABLE IF NOT EXISTS biosignal_streams (
          id uuid PRIMARY KEY,
          session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          participant_id uuid NOT NULL REFERENCES session_participants(id) ON DELETE CASCADE,
          stream_id varchar(64) NOT NULL,
          play_group_id varchar(64),
          created_at timestamptz DEFAULT now(),
          CONSTRAINT uq_biosignal_stream UNIQUE (session_id, participant_id, stream_id)
        )""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_biosignal_streams_session_id ON biosignal_streams (session_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_biosignal_streams_participant_id ON biosignal_streams (participant_id)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS biosignal_segments (
          id uuid PRIMARY KEY,
          stream_pk uuid NOT NULL REFERENCES biosignal_streams(id) ON DELETE CASCADE,
          segment_id varchar(64) NOT NULL,
          signal_type varchar(8) NOT NULL,
          profile_id varchar(64),
          profile_hash varchar(64),
          time_basis varchar(20),
          rate_numerator integer,
          rate_denominator integer,
          created_at timestamptz DEFAULT now(),
          CONSTRAINT uq_biosignal_segment UNIQUE (stream_pk, segment_id, signal_type),
          CONSTRAINT ck_biosignal_segment_signal CHECK (signal_type IN ('eeg','ppg','acc'))
        )""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_biosignal_segments_stream_pk ON biosignal_segments (stream_pk)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS biosignal_gap_events (
          id uuid PRIMARY KEY,
          session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          participant_id uuid NOT NULL REFERENCES session_participants(id) ON DELETE CASCADE,
          event_id varchar(64) NOT NULL,
          sequence integer NOT NULL,
          signal varchar(8) NOT NULL,
          stream_id varchar(64) NOT NULL,
          segment_id varchar(64) NOT NULL,
          start_us bigint NOT NULL,
          end_us bigint,
          discovered_at_us bigint NOT NULL,
          reason varchar(32) NOT NULL,
          observed_or_estimated varchar(12) NOT NULL,
          expected_samples integer,
          received_samples integer,
          reconnect_count integer NOT NULL DEFAULT 0,
          payload_hash varchar(64) NOT NULL,
          created_at timestamptz DEFAULT now(),
          CONSTRAINT uq_biosignal_gap_event UNIQUE (session_id, participant_id, event_id),
          CONSTRAINT ck_biosignal_gap_signal CHECK (signal IN ('eeg','ppg','acc'))
        )""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_biosignal_gap_seq ON biosignal_gap_events (session_id, participant_id, sequence)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS biosignal_close_intents (
          id uuid PRIMARY KEY,
          session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          participant_id uuid NOT NULL REFERENCES session_participants(id) ON DELETE CASCADE,
          intent_id varchar(64) NOT NULL,
          payload jsonb NOT NULL,
          payload_hash varchar(64) NOT NULL,
          created_at timestamptz DEFAULT now(),
          CONSTRAINT uq_biosignal_close_intent UNIQUE (session_id, participant_id, intent_id)
        )""")
    op.execute("""
        CREATE TABLE IF NOT EXISTS biosignal_manifest_revisions (
          id uuid PRIMARY KEY,
          session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          participant_id uuid NOT NULL REFERENCES session_participants(id) ON DELETE CASCADE,
          revision integer NOT NULL,
          close_state varchar(16) NOT NULL,
          close_intent_id varchar(64),
          content jsonb NOT NULL,
          content_sha256 varchar(64) NOT NULL,
          created_at timestamptz DEFAULT now(),
          CONSTRAINT uq_biosignal_manifest_revision UNIQUE (session_id, participant_id, revision),
          CONSTRAINT ck_biosignal_manifest_revision_pos CHECK (revision > 0),
          CONSTRAINT ck_biosignal_manifest_state CHECK (close_state IN ('pending_upload','partial','complete','unknown'))
        )""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_biosignal_manifest_revisions_session_id ON biosignal_manifest_revisions (session_id)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS biosignal_manifest_current (
          session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          participant_id uuid NOT NULL REFERENCES session_participants(id) ON DELETE CASCADE,
          revision integer NOT NULL,
          updated_at timestamptz DEFAULT now(),
          PRIMARY KEY (session_id, participant_id)
        )""")


def downgrade():
    # v2 데이터가 있으면 컬럼/행을 지우지 않고 중단한다(자동 데이터 삭제 금지).
    op.execute("""
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM eeg_raw_chunks WHERE signal_type <> 'eeg' OR segment_id <> 'legacy') THEN
            RAISE EXCEPTION 'SDD-244 M1 downgrade 거부: v2 raw 행이 존재한다';
          END IF;
          IF EXISTS (SELECT 1 FROM biosignal_streams) OR EXISTS (SELECT 1 FROM biosignal_gap_events)
             OR EXISTS (SELECT 1 FROM biosignal_manifest_revisions) THEN
            RAISE EXCEPTION 'SDD-244 M1 downgrade 거부: biosignal 원장에 데이터가 있다';
          END IF;
        END $$""")
    for table in (
        "biosignal_manifest_current", "biosignal_manifest_revisions", "biosignal_close_intents",
        "biosignal_gap_events", "biosignal_segments", "biosignal_streams",
    ):
        op.execute(f"DROP TABLE IF EXISTS {table}")
    for name in ("ck_eeg_raw_v2_participant", "ck_eeg_raw_counts", "ck_eeg_raw_signal_type"):
        op.execute(f"ALTER TABLE eeg_raw_chunks DROP CONSTRAINT IF EXISTS {name}")
    op.execute("DROP INDEX IF EXISTS uq_eeg_raw_chunk_alias")
    op.execute("DROP INDEX IF EXISTS ix_eeg_raw_chunk_signal")
    op.execute("ALTER TABLE eeg_raw_chunks ADD CONSTRAINT uq_eeg_raw_chunk UNIQUE (session_id, participant_id, stream_id, chunk_index)")
    op.execute("ALTER TABLE eeg_raw_chunks DROP CONSTRAINT IF EXISTS uq_eeg_raw_chunk_v2")
    for col in (
        "chunk_alias", "failure_reason", "verified_at", "object_version_id", "header", "parser_profile_hash", "parser_profile_id",
        "time_basis", "first_sample_index", "packet_count", "sample_count", "play_group_id", "segment_id", "signal_type",
    ):
        op.execute(f"ALTER TABLE eeg_raw_chunks DROP COLUMN IF EXISTS {col}")
