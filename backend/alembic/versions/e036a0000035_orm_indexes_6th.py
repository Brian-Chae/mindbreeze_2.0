"""MB2-ORM-IDX-08/09/10: 조회 인덱스 추가

- credentials.user_id 인덱스 (증빙 목록·보유 개수 제한·승인 상태 조회)
- chat_message_reads (user_id, message_id) 인덱스
  (PK 가 (message_id, user_id) 라 user_id 단독 필터를 커버하지 못함)
- org_join_requests (user_id, org_id, status) + (org_id, created_at) 인덱스
  (가입 신청 목록/중복 검사 반복 조회)

Revision ID: e036a0000035
Revises: e036a0000034
Create Date: 2026-10-06
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "e036a0000035"
down_revision: Union[str, Sequence[str], None] = "e036a0000034"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_index("ix_credentials_user_id", "credentials", ["user_id"])
    op.create_index(
        "ix_chat_message_reads_user_id", "chat_message_reads", ["user_id", "message_id"]
    )
    op.create_index(
        "ix_org_join_requests_user_org_status",
        "org_join_requests",
        ["user_id", "org_id", "status"],
    )
    op.create_index(
        "ix_org_join_requests_org_created",
        "org_join_requests",
        ["org_id", "created_at"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_org_join_requests_org_created", table_name="org_join_requests")
    op.drop_index("ix_org_join_requests_user_org_status", table_name="org_join_requests")
    op.drop_index("ix_chat_message_reads_user_id", table_name="chat_message_reads")
    op.drop_index("ix_credentials_user_id", table_name="credentials")
