"""SDD-220 계정·개인정보 스키마 — 생년월일·탈퇴 시각·소셜 연결·삭제 원장·동의 철회.

기존 사용자에게 임의 값을 채우지 않는다(생년월일 NULL). consents.version 컬럼은 재사용한다.
"""
from alembic import op

revision = "e036a0000059"
down_revision = "e036a0000058"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""SET LOCAL lock_timeout = '5s'""")

    # ── users: 만 14세 확인용 생년월일, 탈퇴 시각, 영구 삭제 예정 시각 ──
    op.execute("""ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date date""")
    op.execute("""ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz""")
    op.execute("""ALTER TABLE users ADD COLUMN IF NOT EXISTS purge_after timestamptz""")
    op.execute("""CREATE INDEX IF NOT EXISTS ix_users_purge_after ON users(purge_after)""")

    # ── consents: 선택 동의(eeg/research) 앱 내 철회 시각 ──
    op.execute("""ALTER TABLE consents ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz""")

    # ── session_participants: F1 회차별 녹음·녹화 동의 + 뇌파 수집 선택 동의 ──
    #   기존 행의 recording_consented 는 false(미확인)로 시작한다 — 과거 입장을 동의로 추정하지 않는다.
    op.execute("""ALTER TABLE session_participants ADD COLUMN IF NOT EXISTS recording_consented boolean NOT NULL DEFAULT false""")
    op.execute("""ALTER TABLE session_participants ADD COLUMN IF NOT EXISTS recording_consent_at timestamptz""")
    op.execute("""ALTER TABLE session_participants ADD COLUMN IF NOT EXISTS recording_notice_version varchar(20)""")
    op.execute("""ALTER TABLE session_participants ADD COLUMN IF NOT EXISTS eeg_collection_consented boolean""")
    op.execute("""ALTER TABLE session_participants ADD COLUMN IF NOT EXISTS eeg_collection_consent_at timestamptz""")
    op.execute("""ALTER TABLE session_participants ADD COLUMN IF NOT EXISTS eeg_notice_version varchar(20)""")

    # ── 소셜 공급자 연결(sub 고유) ──
    op.execute("""CREATE TABLE social_identities (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider varchar(20) NOT NULL,
        subject varchar(255) NOT NULL,
        email varchar(255),
        client_id varchar(255),
        encrypted_refresh_token text,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_social_identity_provider_subject UNIQUE (provider, subject),
        CONSTRAINT uq_social_identity_user_provider UNIQUE (user_id, provider)
    )""")
    op.execute("""CREATE INDEX ix_social_identities_user_id ON social_identities(user_id)""")

    # ── 소셜 연결 해제 재시도 큐(users FK 없음 — 영구 삭제 뒤에도 추적) ──
    op.execute("""CREATE TABLE social_revoke_outbox (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL,
        provider varchar(20) NOT NULL,
        client_id varchar(255),
        encrypted_token text,
        token_type_hint varchar(30) NOT NULL DEFAULT 'refresh_token',
        status varchar(20) NOT NULL DEFAULT 'pending',
        attempts integer NOT NULL DEFAULT 0,
        last_error varchar(200),
        next_attempt_at timestamptz,
        completed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_social_revoke_user_provider UNIQUE (user_id, provider),
        CONSTRAINT ck_social_revoke_status CHECK (status IN ('pending','done','skipped'))
    )""")
    op.execute("""CREATE INDEX ix_social_revoke_outbox_user_id ON social_revoke_outbox(user_id)""")
    op.execute("""CREATE INDEX ix_social_revoke_outbox_status ON social_revoke_outbox(status)""")

    # ── 사용자 단위 영구 삭제 원장 ──
    op.execute("""CREATE TABLE account_deletion_ledger (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL,
        email_hash varchar(64) NOT NULL,
        role varchar(20),
        deleted_at timestamptz NOT NULL,
        purge_after timestamptz NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'requested',
        attempts integer NOT NULL DEFAULT 0,
        last_error varchar(200),
        retained_reasons jsonb,
        purged_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_account_deletion_ledger_user UNIQUE (user_id),
        CONSTRAINT ck_account_deletion_ledger_status CHECK (status IN ('requested','purging','purged','failed'))
    )""")
    op.execute("""CREATE INDEX ix_account_deletion_ledger_status ON account_deletion_ledger(status)""")

    op.execute("""CREATE TABLE account_deletion_objects (
        id uuid PRIMARY KEY,
        ledger_id uuid NOT NULL REFERENCES account_deletion_ledger(id) ON DELETE CASCADE,
        object_key varchar(1000) NOT NULL,
        kind varchar(30) NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'pending',
        attempts integer NOT NULL DEFAULT 0,
        last_error varchar(200),
        deleted_at timestamptz,
        CONSTRAINT uq_account_deletion_object_key UNIQUE (ledger_id, object_key)
    )""")
    op.execute("""CREATE INDEX ix_account_deletion_objects_ledger_id ON account_deletion_objects(ledger_id)""")

    # ── 공개 /account-deletion 이메일 접수 원장 ──
    op.execute("""CREATE TABLE account_deletion_requests (
        id uuid PRIMARY KEY,
        email varchar(255) NOT NULL,
        ip_hash varchar(64),
        status varchar(20) NOT NULL DEFAULT 'received',
        notify_status varchar(20) NOT NULL DEFAULT 'pending',
        notify_attempts integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        notified_at timestamptz
    )""")
    op.execute("""CREATE INDEX ix_account_deletion_requests_email ON account_deletion_requests(email)""")
    op.execute("""CREATE INDEX ix_account_deletion_requests_notify_status ON account_deletion_requests(notify_status)""")


def downgrade():
    op.execute("""ALTER TABLE session_participants DROP COLUMN IF EXISTS eeg_notice_version""")
    op.execute("""ALTER TABLE session_participants DROP COLUMN IF EXISTS eeg_collection_consent_at""")
    op.execute("""ALTER TABLE session_participants DROP COLUMN IF EXISTS eeg_collection_consented""")
    op.execute("""ALTER TABLE session_participants DROP COLUMN IF EXISTS recording_notice_version""")
    op.execute("""ALTER TABLE session_participants DROP COLUMN IF EXISTS recording_consent_at""")
    op.execute("""ALTER TABLE session_participants DROP COLUMN IF EXISTS recording_consented""")
    op.execute("""DROP TABLE IF EXISTS account_deletion_requests""")
    op.execute("""DROP TABLE IF EXISTS account_deletion_objects""")
    op.execute("""DROP TABLE IF EXISTS account_deletion_ledger""")
    op.execute("""DROP TABLE IF EXISTS social_revoke_outbox""")
    op.execute("""DROP TABLE IF EXISTS social_identities""")
    op.execute("""ALTER TABLE consents DROP COLUMN IF EXISTS withdrawn_at""")
    op.execute("""DROP INDEX IF EXISTS ix_users_purge_after""")
    op.execute("""ALTER TABLE users DROP COLUMN IF EXISTS purge_after""")
    op.execute("""ALTER TABLE users DROP COLUMN IF EXISTS deleted_at""")
    op.execute("""ALTER TABLE users DROP COLUMN IF EXISTS birth_date""")
