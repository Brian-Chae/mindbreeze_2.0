"""014_session_settings_expansion — 세션 설정 확장 필드 추가

sessions: custom_type_name, location_type, participant_mode, linkband_mode,
          webrtc_room_id, sfu_enabled
session_participants: linkband_device_id, webrtc_peer_id
(기존 type 컬럼은 custom 유형을 포함하도록 확장, 기존 band_connected 재사용)

Revision ID: 0f5a7c2b9e14
Revises: c8f3a1b5d201
Create Date: 2026-06-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0f5a7c2b9e14"
down_revision: Union[str, Sequence[str], None] = "c8f3a1b5d201"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # sessions 신규 설정 필드
    op.add_column("sessions", sa.Column("custom_type_name", sa.String(length=30), nullable=True))
    op.add_column(
        "sessions",
        sa.Column("location_type", sa.String(length=20), nullable=False, server_default="offline"),
    )
    op.add_column(
        "sessions",
        sa.Column("participant_mode", sa.String(length=20), nullable=False, server_default="one_on_one"),
    )
    op.add_column(
        "sessions",
        sa.Column("linkband_mode", sa.String(length=20), nullable=False, server_default="none"),
    )
    op.add_column("sessions", sa.Column("webrtc_room_id", sa.UUID(), nullable=True))
    op.add_column(
        "sessions",
        sa.Column("sfu_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )

    # session_participants 신규 WebRTC/LINK BAND 필드
    op.add_column("session_participants", sa.Column("linkband_device_id", sa.String(), nullable=True))
    op.add_column("session_participants", sa.Column("webrtc_peer_id", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("session_participants", "webrtc_peer_id")
    op.drop_column("session_participants", "linkband_device_id")

    op.drop_column("sessions", "sfu_enabled")
    op.drop_column("sessions", "webrtc_room_id")
    op.drop_column("sessions", "linkband_mode")
    op.drop_column("sessions", "participant_mode")
    op.drop_column("sessions", "location_type")
    op.drop_column("sessions", "custom_type_name")
