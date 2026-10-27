"""[SDD-248] 기관 도입 문의 org_inquiries 테이블 (가역)

IP 는 저장하지 않는다. status(new/handled), notify_status(메일 상태) 분리.
"""
from alembic import op

revision = "e261027a0248"
down_revision = "e261026c0001"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""SET LOCAL lock_timeout = '5s'""")
    op.execute(
        """CREATE TABLE IF NOT EXISTS org_inquiries (
               id uuid PRIMARY KEY,
               org_name varchar(200) NOT NULL,
               contact_name varchar(100) NOT NULL,
               email varchar(254) NOT NULL,
               phone varchar(30) NOT NULL,
               org_type varchar(30),
               expected_users integer,
               band_interest boolean,
               message text,
               status varchar(20) NOT NULL DEFAULT 'new',
               notify_status varchar(20) NOT NULL DEFAULT 'pending',
               notified_at timestamptz,
               consented_at timestamptz NOT NULL,
               created_at timestamptz NOT NULL DEFAULT now()
           )"""
    )
    op.execute("""CREATE INDEX IF NOT EXISTS ix_org_inquiries_email ON org_inquiries (email)""")
    op.execute("""CREATE INDEX IF NOT EXISTS ix_org_inquiries_status ON org_inquiries (status)""")


def downgrade():
    op.execute("""DROP TABLE IF EXISTS org_inquiries""")
