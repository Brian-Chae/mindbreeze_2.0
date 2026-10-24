"""SDD-244 M2 — 산출물(feature/raw_derived/indices/…) 원장, 화면 스냅샷 1Hz 원장, 정규화 모델 snapshot.

additive 전용: 신규 테이블 4개 + eeg_feature_windows nullable 컬럼 2개. 기존 27 feature 컬럼은 변경하지 않는다.
큰 배열은 DB 에 복제하지 않는다(객체 저장소 + hash).
"""
from alembic import op

revision = "e036a0244002"
down_revision = "e036a0244001"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("ALTER TABLE eeg_feature_windows ADD COLUMN IF NOT EXISTS source_feature_alias varchar(64)")
    op.execute("ALTER TABLE eeg_feature_windows ADD COLUMN IF NOT EXISTS algorithm_version varchar(40)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS biosignal_artifacts (
          id uuid PRIMARY KEY,
          session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          participant_id uuid NOT NULL REFERENCES session_participants(id) ON DELETE CASCADE,
          artifact_alias varchar(64) NOT NULL,
          artifact_kind varchar(20) NOT NULL,
          signal varchar(8),
          stream_id varchar(64),
          segment_id varchar(64),
          view_instance_id varchar(64),
          play_group_id varchar(64),
          sequence integer NOT NULL,
          first_sequence integer,
          last_sequence integer,
          row_count integer NOT NULL,
          content_encoding varchar(10) NOT NULL DEFAULT 'identity',
          schema_version varchar(40) NOT NULL,
          checksum varchar(64) NOT NULL,
          uncompressed_sha256 varchar(64),
          size_bytes integer NOT NULL,
          time_from_us bigint,
          time_to_us bigint,
          retention_class varchar(20) NOT NULL,
          object_key varchar(500) NOT NULL,
          object_version_id varchar(200),
          upload_status varchar(10) NOT NULL DEFAULT 'pending',
          verified_at timestamptz,
          failure_reason varchar(100),
          created_at timestamptz DEFAULT now(),
          CONSTRAINT uq_biosignal_artifact_alias UNIQUE (session_id, participant_id, artifact_alias),
          CONSTRAINT ck_biosignal_artifact_kind CHECK (artifact_kind IN ('feature','raw_derived','indices','normalization','algorithm')),
          CONSTRAINT ck_biosignal_artifact_status CHECK (upload_status IN ('pending','uploaded','failed')),
          CONSTRAINT ck_biosignal_artifact_counts CHECK (row_count >= 0 AND sequence >= 0 AND size_bytes > 0)
        )""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_biosignal_artifacts_session_id ON biosignal_artifacts (session_id)")
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_biosignal_artifact_slot ON biosignal_artifacts
          (session_id, participant_id, artifact_kind, COALESCE(stream_id,''), COALESCE(segment_id,''),
           COALESCE(signal,''), COALESCE(view_instance_id,''), sequence)""")
    op.execute("""
        CREATE TABLE IF NOT EXISTS biosignal_feature_aliases (
          id uuid PRIMARY KEY,
          session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          participant_id uuid NOT NULL REFERENCES session_participants(id) ON DELETE CASCADE,
          feature_alias varchar(64) NOT NULL,
          artifact_pk uuid NOT NULL REFERENCES biosignal_artifacts(id) ON DELETE CASCADE,
          CONSTRAINT uq_biosignal_feature_alias UNIQUE (session_id, participant_id, feature_alias)
        )""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_biosignal_feature_aliases_artifact_pk ON biosignal_feature_aliases (artifact_pk)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS display_snapshots (
          id uuid PRIMARY KEY,
          session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          participant_id uuid NOT NULL REFERENCES session_participants(id) ON DELETE CASCADE,
          artifact_pk uuid NOT NULL REFERENCES biosignal_artifacts(id) ON DELETE CASCADE,
          stream_alias varchar(64) NOT NULL,
          view_instance_alias varchar(64) NOT NULL,
          view_instance_id varchar(64),
          view_kind varchar(24) NOT NULL,
          second_index integer NOT NULL,
          t_rel_ms double precision NOT NULL,
          play_group_id varchar(64),
          window_index integer,
          displayed_at_us bigint,
          render_status varchar(16) NOT NULL,
          source varchar(20) NOT NULL,
          display_match varchar(12) NOT NULL,
          focus_value integer,
          relaxation_value integer,
          emotional_value integer,
          bpm_value integer,
          respiration_value integer,
          hrv_value integer,
          normalization_hash varchar(64),
          source_feature_aliases jsonb,
          display_pipeline_version varchar(80),
          unavailable_reason varchar(100),
          created_at timestamptz DEFAULT now(),
          CONSTRAINT uq_display_snapshot UNIQUE (session_id, participant_id, stream_alias, view_instance_alias, second_index)
        )""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_display_snapshots_artifact_pk ON display_snapshots (artifact_pk)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_display_snapshots_participant_time ON display_snapshots (session_id, participant_id, t_rel_ms)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS normalization_snapshots (
          id uuid PRIMARY KEY,
          params_hash varchar(64) NOT NULL UNIQUE,
          model_id_alias varchar(64) NOT NULL,
          version varchar(80) NOT NULL,
          formula_version varchar(80) NOT NULL,
          content jsonb NOT NULL,
          created_at timestamptz DEFAULT now()
        )""")


def downgrade():
    op.execute("""
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM biosignal_artifacts) OR EXISTS (SELECT 1 FROM display_snapshots)
             OR EXISTS (SELECT 1 FROM normalization_snapshots) THEN
            RAISE EXCEPTION 'SDD-244 M2 downgrade 거부: 산출물 원장에 데이터가 있다';
          END IF;
        END $$""")
    for t in ("normalization_snapshots", "display_snapshots", "biosignal_feature_aliases", "biosignal_artifacts"):
        op.execute(f"DROP TABLE IF EXISTS {t}")
    op.execute("ALTER TABLE eeg_feature_windows DROP COLUMN IF EXISTS algorithm_version")
    op.execute("ALTER TABLE eeg_feature_windows DROP COLUMN IF EXISTS source_feature_alias")
