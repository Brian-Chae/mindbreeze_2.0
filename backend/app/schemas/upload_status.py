"""SDD-261 — 회차 업로드 현황 응답 스키마(서버 수신 기준, specs/sdd-261-upload-status-screens/contract.md).

SDD-264: 폰 보고 기대량으로 `expected`·`completeness`·`phone_report`·`progress` 가 채워진다(가산 변경,
specs/sdd-264-upload-progress-expected/contract.md). 보고가 없으면 기존 값(null/unknown) 그대로다.
"""

from typing import Literal

from pydantic import BaseModel

from app.services.upload_progress_service import AggregateProgress, ParticipantProgress

UploadStatusState = Literal["needs_attention", "excluded", "uploading", "received_unreconciled", "no_data"]
CollectionState = Literal["eligible", "excluded", "unknown"]
SignalType = Literal["eeg", "ppg", "acc"]
Completeness = Literal["unknown", "all_received", "short"]


class FeatureReceipt(BaseModel):
    received: int
    legacy_count: int
    internal_missing: int
    expected: int | None = None
    expected_basis: Literal["unknown", "phone_report"] = "unknown"
    completeness: Completeness = "unknown"
    last_received_at: str | None


class RawSignalReceipt(BaseModel):
    signal_type: SignalType
    registered: int
    uploaded: int
    pending: int
    failed: int
    internal_missing: int
    oldest_pending_at: str | None
    expected: int | None = None


class RawReceipt(BaseModel):
    signals: list[RawSignalReceipt]
    last_received_at: str | None
    completeness: Completeness = "unknown"


class PhoneReport(BaseModel):
    reported_at: str
    final: bool


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
    phone_report: PhoneReport | None = None
    status: UploadStatusState
    reasons: list[str]
    progress: ParticipantProgress
    # SDD-265
    bytes_arrived: int = 0
    measured_min: int = 0
    # SDD-326: 연결한 밴드 시리얼·펌웨어(미보고 시 None = 미수집)
    band_serial: str | None = None
    band_firmware: str | None = None


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
    progress: AggregateProgress
    # SDD-265: 숫자 중심 상황판 가산 필드(목록 항목과 같은 정의·같은 계산)
    participants_expected: int = 0
    participants_arrived: int = 0
    bytes_arrived: int = 0
    bytes_expected: int | None = None
    bytes_basis: Literal["estimate"] | None = None
    duration_min: int | None = None
    participant_minutes_total: int = 0
