"""SDD-213: dev 스키마 ↔ 마이그레이션 체인 드리프트 정리 (A군 D-01~D-09)

덤프 복원 DB(dev 모양)와 빈 DB 체인 DB 가 이 리비전 적용 후 같은 모양이 되도록 한다. 모든 문장은 현재 상태를
검사하거나 no-op 이라 멱등이다(어느 쪽에서 시작해도 안전). 삭제·컬럼 제거 없음, NULL 은 백필한다.
dev 전용 컬럼(careers.description, qualifications.credential_* 등)은 건드리지 않는다.
downgrade 는 no-op: 롤백은 코드 revert 만 하고 스키마는 유지한다(e036a0000044 와 같은 방식).

Revision ID: e036a0000052
Revises: e036a0000051
Create Date: 2026-10-18
"""
from typing import Sequence, Union

from alembic import op

revision: str = "e036a0000052"
down_revision: Union[str, Sequence[str], None] = "e036a0000051"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")

    # D-01 chat_messages.read_by : ARRAY → JSONB (모델·앱은 JSON 리스트로 기록)
    op.execute("""
        DO $$ BEGIN
          IF (SELECT data_type FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'chat_messages' AND column_name = 'read_by') = 'ARRAY' THEN
            ALTER TABLE chat_messages ALTER COLUMN read_by TYPE jsonb USING to_jsonb(read_by);
          END IF;
        END $$
    """)

    # D-02 chat_messages.recipient_count
    op.execute("UPDATE chat_messages SET recipient_count = 0 WHERE recipient_count IS NULL")
    op.execute("ALTER TABLE chat_messages ALTER COLUMN recipient_count SET NOT NULL")

    # D-03 users.auth_provider (Phase 1 의 users 변경이 NOT NULL 을 가정)
    op.execute("UPDATE users SET auth_provider = 'email' WHERE auth_provider IS NULL")
    op.execute("ALTER TABLE users ALTER COLUMN auth_provider SET NOT NULL")

    # D-04 + D-09 careers. organization 은 소속기관명 — 값이 없으면 의미 중립인 빈 문자열(가짜 문구 금지, 행 삭제 금지)
    op.execute("UPDATE careers SET organization = '' WHERE organization IS NULL")
    op.execute("UPDATE careers SET created_at = now() WHERE created_at IS NULL")
    op.execute("UPDATE careers SET updated_at = COALESCE(created_at, now()) WHERE updated_at IS NULL")
    op.execute("UPDATE careers SET is_current = false WHERE is_current IS NULL")
    op.execute("ALTER TABLE careers ALTER COLUMN is_current SET DEFAULT false")
    op.execute("""
        ALTER TABLE careers
          ALTER COLUMN organization SET NOT NULL,
          ALTER COLUMN created_at SET NOT NULL,
          ALTER COLUMN updated_at SET NOT NULL,
          ALTER COLUMN is_current SET NOT NULL
    """)

    # D-05 qualifications
    op.execute("UPDATE qualifications SET created_at = now() WHERE created_at IS NULL")
    op.execute("UPDATE qualifications SET updated_at = COALESCE(created_at, now()) WHERE updated_at IS NULL")
    op.execute("""
        ALTER TABLE qualifications
          ALTER COLUMN created_at SET NOT NULL,
          ALTER COLUMN updated_at SET NOT NULL
    """)

    # D-06 길이 확장(손실 없음). 이미 200 이상이면 건너뛴다.
    op.execute("""
        DO $$ DECLARE c text; BEGIN
          FOREACH c IN ARRAY ARRAY['name', 'issuer'] LOOP
            IF (SELECT character_maximum_length FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'qualifications' AND column_name = c) < 200 THEN
              EXECUTE format('ALTER TABLE qualifications ALTER COLUMN %I TYPE varchar(200)', c);
            END IF;
          END LOOP;
        END $$
    """)

    # D-07 user_id → users.id FK 를 ON DELETE CASCADE 로. 제약 이름은 컬럼 기준으로 찾아(덤프/체인 이름 차이 무관) 유지한다.
    op.execute("""
        DO $$ DECLARE t text; fk record; BEGIN
          FOREACH t IN ARRAY ARRAY['careers', 'qualifications'] LOOP
            FOR fk IN
              SELECT conname FROM pg_constraint
               WHERE contype = 'f' AND conrelid = format('public.%I', t)::regclass
                 AND confrelid = 'public.users'::regclass AND confdeltype <> 'c'
            LOOP
              EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', t, fk.conname);
              EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE',
                             t, fk.conname);
            END LOOP;
          END LOOP;
        END $$
    """)

    # D-08 인덱스
    op.execute("CREATE INDEX IF NOT EXISTS ix_careers_user_id ON careers (user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_qualifications_user_id ON qualifications (user_id)")


def downgrade() -> None:
    # 백필·타입 변환은 되돌리지 않는다(되돌려도 의미 없음). 롤백은 코드 revert, 스키마 유지.
    pass
