"""SDD-261 — 회차 업로드 현황 응답 스키마(서버 수신 기준, specs/sdd-261-upload-status-screens/contract.md)."""

from typing import Literal

from pydantic import BaseModel

UploadStatusState = Literal["needs_attention", "excluded", "uploading", "received_unreconciled", "no_data"]
CollectionState = Literal["eligible", "excluded", "unknown"]
SignalType = Literal["eeg", "ppg", "acc"]


class FeatureReceipt(BaseModel):
    received: int
    legacy_count: int
    internal_missing: int
    expected: None = None
    expected_basis: Literal["unknown"] = "unknown"
    completeness: Literal["unknown"] = "unknown"
    last_received_at: str | None


class RawSignalReceipt(BaseModel):
    signal_type: SignalType
    registered: int
    uploaded: int
    pending: int
    failed: int
    internal_missing: int
    oldest_pending_at: str | None


class RawReceipt(BaseModel):
    signals: list[RawSignalReceipt]
    last_received_at: str | None
    completeness: Literal["unknown"] = "unknown"


class UploadStatusParticipant(BaseModel):
    participant_id: str
    display_name: str | None
    is_guest: bool
    participation_status: Literal["active", "waitlisted"]
    collection_state: CollectionState
    band_connected: bool
    report_included: bool
    feature: FeatureReceipt
    raw: RawReceipt
    phone_report: None = None
    status: UploadStatusState
    reasons: list[str]


class UploadStatusSummary(BaseModel):
    participants: int
    needs_attention: int
    uploading: int
    received_unreconciled: int
    no_data: int
    excluded: int


class UploadStatusResponse(BaseModel):
    class_id: str
    session_id: str
    session_status: str
    as_of: str
    basis: Literal["server_received"] = "server_received"
    poll_interval_sec: int
    etag: str
    summary: UploadStatusSummary
    participants: list[UploadStatusParticipant]
