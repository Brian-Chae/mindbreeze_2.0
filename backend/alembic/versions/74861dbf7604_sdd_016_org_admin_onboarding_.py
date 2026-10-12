"""sdd-016 org admin onboarding: organizations.primary_admin_id

Revision ID: 74861dbf7604
Revises: 881a08fbe584
Create Date: 2026-09-02

SDD-016: 기관의 주 담당자(org_admin)를 가리키는 참조 컬럼 1개만 추가한다.
담당자 이름·이메일·전화의 진실원은 users 테이블이므로 별도 컬럼을 두지 않는다.
users.org_id → organizations.id 와 순환 FK 관계이므로 제약 이름을 명시해 생성한다.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '74861dbf7604'
down_revision: Union[str, Sequence[str], None] = '881a08fbe584'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "organizations",
        sa.Column("primary_admin_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_organizations_primary_admin_id",
        "organizations",
        "users",
        ["primary_admin_id"],
        ["id"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        "fk_organizations_primary_admin_id", "organizations", type_="foreignkey"
    )
    op.drop_column("organizations", "primary_admin_id")
