"""SDD-218 클래스 리포트 일괄 작업 요청·응답 스키마 (plan.md §2)."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class ReportJobCommand(BaseModel):
    action: Literal["approve", "regenerate", "resend_email"]
    operation_key: str = Field(min_length=8, max_length=100)
    targets: list[UUID] = Field(min_length=1, max_length=500)
    session_id: UUID | None = None


class ReportJobItem(BaseModel):
    report_id: str
    state: Literal["pending", "succeeded", "failed", "excluded"]
    reason_code: str | None = None
    # 재시도 수단 노출 여부는 서버가 정한다. excluded 는 언제나 False.
    retriable: bool
    approved_by: str | None = None
    processed_at: str | None = None
    error_message: str | None = None


class ReportJobResponse(BaseModel):
    job_id: str
    class_id: str
    action: str
    status: Literal["accepted", "running", "completed"]
    on_behalf: bool
    accepted: int
    excluded: list[ReportJobItem]
    items: list[ReportJobItem]
