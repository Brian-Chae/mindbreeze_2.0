"""AI 리포트 Pydantic 스키마"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ReportCreate(BaseModel):
    type: str = "counselor"  # counselor | client


class ReportUpdate(BaseModel):
    content: dict[str, Any] | None = None


class ReportApprovalRequest(BaseModel):
    note: str | None = None


class ReportResponse(BaseModel):
    id: str
    session_id: str
    user_id: str
    type: str
    content: dict[str, Any] = Field(default_factory=dict)
    pdf_url: str | None = None
    sent_at: datetime | None = None
    is_read: bool = False
    created_at: datetime | None = None
    session_title: str | None = None
    session_type: str | None = None
    scheduled_at: datetime | None = None


class ReportListResponse(BaseModel):
    reports: list[ReportResponse]
    total: int
