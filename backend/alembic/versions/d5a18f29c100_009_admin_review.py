"""009 admin review queue: org_documents + audit target_type/id + user.status

Revision ID: d5a18f29c100
Revises: 1c9166897b31
Create Date: 2026-05-20 16:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "d5a18f29c100"
down_revision: Union[str, Sequence[str], None] = "1c9166897b31"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "org_documents",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("org_id", sa.UUID(), nullable=False),
        sa.Column("type", sa.String(length=40), nullable=False),
        sa.Column("s3_key", sa.String(length=500), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("ai_verdict", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_org_documents_org_id", "org_documents", ["org_id"])
    op.create_index("ix_org_documents_status", "org_documents", ["status"])

    op.add_column("verification_audits", sa.Column("target_type", sa.String(length=30), nullable=True))
    op.add_column("verification_audits", sa.Column("target_id", sa.UUID(), nullable=True))
    op.alter_column("verification_audits", "credential_id", existing_type=sa.UUID(), nullable=True)
    op.alter_column("verification_audits", "action", existing_type=sa.String(length=20), type_=sa.String(length=30))

    op.add_column(
        "users",
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
    )


def downgrade() -> None:
    op.drop_column("users", "status")
    op.alter_column("verification_audits", "action", existing_type=sa.String(length=30), type_=sa.String(length=20))
    op.alter_column("verification_audits", "credential_id", existing_type=sa.UUID(), nullable=False)
    op.drop_column("verification_audits", "target_id")
    op.drop_column("verification_audits", "target_type")
    op.drop_index("ix_org_documents_status", table_name="org_documents")
    op.drop_index("ix_org_documents_org_id", table_name="org_documents")
    op.drop_table("org_documents")
