"""SDD-218 클래스 리포트 일괄 작업 스키마.

기존 reports 테이블과 승인 컬럼은 변경하지 않는다. 새 테이블 2개만 추가한다.
"""
from alembic import op

revision = "e036a0000058"
down_revision = "e036a0000057"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""SET LOCAL lock_timeout = '5s'""")
    op.execute("""CREATE TABLE class_report_jobs (
        id uuid PRIMARY KEY,
        class_id uuid NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
        session_id uuid REFERENCES sessions(id) ON DELETE RESTRICT,
        action varchar(20) NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'accepted',
        actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        on_behalf boolean NOT NULL DEFAULT false,
        operation_key varchar(100) NOT NULL,
        request_hash varchar(64) NOT NULL,
        accepted_count integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        CONSTRAINT uq_class_report_jobs_actor_operation UNIQUE (actor_id, operation_key),
        CONSTRAINT ck_class_report_jobs_action CHECK (action IN ('approve','regenerate','resend_email')),
        CONSTRAINT ck_class_report_jobs_status CHECK (status IN ('accepted','running','completed'))
    )""")
    op.execute("""CREATE INDEX ix_class_report_jobs_class_id ON class_report_jobs(class_id)""")
    op.execute("""CREATE INDEX ix_class_report_jobs_session_id ON class_report_jobs(session_id)""")
    op.execute("""CREATE INDEX ix_class_report_jobs_actor_id ON class_report_jobs(actor_id)""")
    op.execute("""CREATE INDEX ix_class_report_jobs_status ON class_report_jobs(status)""")

    op.execute("""CREATE TABLE class_report_job_items (
        id uuid PRIMARY KEY,
        job_id uuid NOT NULL REFERENCES class_report_jobs(id) ON DELETE CASCADE,
        report_id uuid NOT NULL REFERENCES reports(id) ON DELETE RESTRICT,
        state varchar(20) NOT NULL DEFAULT 'pending',
        reason_code varchar(40),
        detail jsonb NOT NULL DEFAULT '{}',
        error_message text,
        attempts integer NOT NULL DEFAULT 0,
        processed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_class_report_job_items_job_report UNIQUE (job_id, report_id),
        CONSTRAINT ck_class_report_job_items_state CHECK (state IN ('pending','succeeded','failed','excluded'))
    )""")
    op.execute("""CREATE INDEX ix_class_report_job_items_job_id ON class_report_job_items(job_id)""")
    op.execute("""CREATE INDEX ix_class_report_job_items_state ON class_report_job_items(state)""")


def downgrade():
    op.execute("""DROP TABLE IF EXISTS class_report_job_items""")
    op.execute("""DROP TABLE IF EXISTS class_report_jobs""")
