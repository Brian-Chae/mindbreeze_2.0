"""client_counselor_links.memo 컬럼 추가 (MB2-CLIENT-01)

상담사 비공개 메모를 저장할 컬럼이 없어 update_memo 가 성공 응답만 하고
실제로는 아무 것도 저장하지 못하던 문제를 수정한다. 메모는 상담사-내담자
연결(ClientCounselorLink) 단위로 둔다.

Revision ID: e036a0000031
Revises: e036a0000030
Create Date: 2026-10-06
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "e036a0000031"
down_revision = "e036a0000030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "client_counselor_links",
        sa.Column("memo", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("client_counselor_links", "memo")
