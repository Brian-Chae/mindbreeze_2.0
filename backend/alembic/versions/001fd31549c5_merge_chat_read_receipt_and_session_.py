"""merge chat_read_receipt and session_settings

Revision ID: 001fd31549c5
Revises: 0f5a7c2b9e14, e512db25533a
Create Date: 2026-08-27 15:57:14.889905

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '001fd31549c5'
down_revision: Union[str, Sequence[str], None] = ('0f5a7c2b9e14', 'e512db25533a')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
