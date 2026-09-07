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
    # SDD-027: 게스트 리포트는 user_id 가 없다(participant_id 로 소유)
    user_id: str | None = None
    participant_id: str | None = None
    type: str
    # SDD-027: 리포트 상태머신(pending_analysis/pending_review/completed/error) + 데이터 신뢰도
    status: str = "pending_analysis"
    data_credibility: str | None = None
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
