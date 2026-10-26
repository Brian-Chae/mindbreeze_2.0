"""[MB261026][FIX] D4 — 플랫폼 관리자 채팅 신고·금칙어 스키마.

목록(ChatReportItem)에는 이메일·메시지 발췌 필드가 아예 없다(최소 열람). 상세에서만 내려준다.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ReportStatus = Literal["submitted", "reviewing", "actioned", "dismissed", "withdrawn"]
TransitionTarget = Literal["reviewing", "actioned", "dismissed"]


class ChatReportPerson(BaseModel):
    id: str | None = None
    name: str | None = None


class ChatReportPersonDetail(ChatReportPerson):
    email: str | None = None


class ChatReportItem(BaseModel):
    id: str
    status: ReportStatus
    reason: str | None = None
    created_at: datetime | None = None
    reporter: ChatReportPerson
    reported_user: ChatReportPerson
    room_type: str | None = None
    has_message: bool
    ack_due_at: datetime
    decision_due_at: datetime
    acknowledged_at: datetime | None = None
    decided_at: datetime | None = None
    withdrawn_at: datetime | None = None
    ack_overdue: bool
    decision_overdue: bool
    handled_by_name: str | None = None


class ChatReportStatusCounts(BaseModel):
    submitted: int = 0
    reviewing: int = 0
    actioned: int = 0
    dismissed: int = 0
    withdrawn: int = 0


class ChatReportListResponse(BaseModel):
    items: list[ChatReportItem]
    total: int
    page: int
    size: int
    counts: ChatReportStatusCounts
    notice_email_configured: bool


class ChatReportHistoryItem(BaseModel):
    from_status: str | None = None
    to_status: str | None = None
    note: str | None = None
    admin_name: str | None = None
    at: datetime | None = None


class ChatReportTransitionResult(ChatReportItem):
    """상태 전이 응답 — 발췌·이메일 없음(열람은 상세 조회로만)."""

    resolution_note: str | None = None
    history: list[ChatReportHistoryItem]


class ChatReportDetail(ChatReportItem):
    reporter: ChatReportPersonDetail
    reported_user: ChatReportPersonDetail
    room_id: str | None = None
    message_id: str | None = None
    message_excerpt: str | None = None
    resolution_note: str | None = None
    history: list[ChatReportHistoryItem]


class ChatReportTransitionRequest(BaseModel):
    to: TransitionTarget
    note: str | None = Field(None, max_length=1000)


class ChatFilterTermCreate(BaseModel):
    term: str = Field(..., min_length=1, max_length=100)


class ChatFilterTermItem(BaseModel):
    id: str
    term: str
    created_at: datetime | None = None
    created_by_name: str | None = None


class ChatFilterTermListResponse(BaseModel):
    items: list[ChatFilterTermItem]
