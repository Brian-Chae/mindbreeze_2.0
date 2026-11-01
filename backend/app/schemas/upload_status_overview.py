"""SDD-263 — 전체 회차 업로드 현황 목록 응답 스키마(서버 수신 기준, specs/sdd-263-upload-status-overview/contract.md)."""

from typing import Literal

from pydantic import BaseModel

from app.services.upload_progress_service import AggregateProgress

OverviewStatus = Literal["needs_attention", "uploading", "received_unreconciled", "no_data"]


class OverviewSummary(BaseModel):
    sessions: int
    in_progress: int
    needs_attention: int
    uploading: int
    received_unreconciled: int
    no_data: int


class OverviewItem(BaseModel):
    session_id: str
    class_id: str
    class_title: str | None
    session_title: str | None
    seq: int | None
    organization_id: str | None
    organization_name: str | None
    session_status: str
    started_at: str | None
    ended_at: str | None
    participants: int
    needs_attention: int
    uploading: int
    received_unreconciled: int
    no_data: int
    excluded: int
    band_not_connected: int
    last_received_at: str | None
    status: OverviewStatus
    progress: AggregateProgress  # SDD-264: 폰 보고 기대량 대비 수신(회차 합계)
    # SDD-265: 숫자 중심 상황판 가산 필드
    participants_expected: int = 0
    participants_arrived: int = 0
    bytes_arrived: int = 0
    bytes_expected: int | None = None
    bytes_basis: Literal["estimate"] | None = None
    duration_min: int | None = None
    participant_minutes_total: int = 0


class UploadStatusOverviewResponse(BaseModel):
    as_of: str
    basis: Literal["server_received"] = "server_received"
    poll_interval_sec: int
    etag: str
    since: str
    limit: int
    total_candidates: int
    truncated: bool
    summary: OverviewSummary
    items: list[OverviewItem]
    progress: AggregateProgress  # SDD-264: items 전체 합계
    next_cursor: str | None = None   # SDD-265
    has_more: bool = False
    scan_limited: bool = False
