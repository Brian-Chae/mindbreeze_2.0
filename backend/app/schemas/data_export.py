"""SDD-071 데이터 내보내기 API 계약."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class DataExportCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    include: list[Literal['features', 'report']] = Field(default_factory=lambda: ['features', 'report'], min_length=1, max_length=2)
    purpose: str = Field(min_length=2, max_length=500)

    @field_validator('purpose')
    @classmethod
    def validate_purpose(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError('활용 목적을 입력해 주세요')
        return value

    @field_validator('include')
    @classmethod
    def normalize_include(cls, value: list[str]) -> list[str]:
        return sorted(set(value))


class DataExportStatus(BaseModel):
    export_id: str
    status: Literal['queued', 'preparing', 'ready', 'ready_with_warnings', 'failed', 'expired', 'cancelled']
    stage: str
    target_count: int = 1
    completed_count: int
    size_bytes: int | None
    warnings: list[str]
    error_code: str | None
    expires_at: datetime
    snapshot_at: datetime | None
    status_url: str


class DataExportDownload(BaseModel):
    url: str
    expires_at: datetime


# ── SDD-243 데이터 센터 일괄 반출 계약(B01 동결). 기존 단건 DTO 는 위 그대로 유지한다. ──
from typing import Annotated  # noqa: E402
from uuid import UUID  # noqa: E402

from pydantic import StringConstraints  # noqa: E402

from app.schemas.data_center import (  # noqa: E402
    Contract, ExportInclude, ExportScope, Identity, Purpose,
)

DateStr = Annotated[str, StringConstraints(pattern=r'^\d{4}-\d{2}-\d{2}$')]


class ExportSelectionRange(Contract):
    """회차 선택 범위. 날짜는 KST 달력일(시작일 00:00 포함 ~ 종료일 다음날 00:00 미포함)."""
    date_from: DateStr | None = None
    date_to: DateStr | None = None
    batch_index: int | None = Field(None, ge=1)  # 50회차 묶음(1=1~50, 2=51~100 …)
    session_ids: list[UUID] | None = Field(None, max_length=10000)


class DataCenterExportRequest(Contract):
    """report/상담 본문 include 는 존재하지 않는다(extra=forbid + Literal 5종)."""
    scope: ExportScope
    target_id: UUID  # participant=participant_id, session=session_id, class=class_id, member/facilitator=user id
    session_id: UUID | None = None  # scope=participant 에서 회차 지정
    participant_ids: list[UUID] | None = Field(None, max_length=1000)  # 회차 안 참여자 축소 선택
    range: ExportSelectionRange = Field(default_factory=ExportSelectionRange)
    from_us: str | None = Field(None, pattern=r'^-?(0|[1-9][0-9]{0,18})$')  # [from,to) 구간(상대 µs)
    to_us: str | None = Field(None, pattern=r'^-?(0|[1-9][0-9]{0,18})$')
    include: list[ExportInclude] = Field(min_length=1, max_length=5)
    eeg_format: Literal['csv', 'parquet'] = 'csv'
    include_raw_bin: bool = False
    identity: Identity = 'pseudonymized'
    purpose: Purpose = 'operations'
    allow_partial: bool = False
    scope_org_id: UUID | None = None  # 기관 관리자 현재 기관, 서버가 membership 으로 재검증

    @field_validator('include')
    @classmethod
    def _unique_include(cls, value: list[str]) -> list[str]:
        return sorted(set(value))


class ExportExclusion(Contract):
    session_id: UUID | None = None
    participant_id: UUID | None = None
    signal: str | None = None
    reason: Literal[
        'not_completed', 'attribution_unknown', 'not_collected', 'unsupported_client', 'expired', 'withdrawn',
        'lost', 'unknown', 'band_not_used', 'consent_missing', 'retention_deadline_unknown', 'out_of_range',
        'pending_upload', 'policy_blocked', 'manifest_not_connected',
    ]


class ExportTargetRef(Contract):
    """preview 에서 고정한 대상. 이후 새 회차·후발 ACK 는 자동 포함되지 않는다."""
    ordinal: int
    session_id: UUID
    participant_id: UUID
    manifest_revision: int | None = None


class ExportPreview(Contract):
    preview_token: str
    expires_at: datetime
    request_hash: str
    as_of: datetime
    sort: str = 'started_at_asc,id_asc'
    scope: ExportScope
    purpose: Purpose
    identity: Identity
    session_count: int
    participant_count: int
    targets: list[ExportTargetRef]  # 최대 한 응답 상한(targets_truncated 참조)
    targets_truncated: bool = False
    exclusions: list[ExportExclusion]
    estimated_bytes: int | None = None
    estimated_part_count: int | None = None
    extra_range_notices: list[str] = Field(default_factory=list)
    exclusion_counts: dict[str, int] = Field(default_factory=dict)  # 사유별 전체 건수(exclusions 는 일부만 상세)
    exclusions_truncated: bool = False
    raw_bin: Literal['not_requested', 'included', 'redacted_packet_view'] = 'not_requested'
    policy_version: str
    policy_hash: str
    eligible: bool
    blocked_reason: str | None = None


class DataCenterExportCreate(Contract):
    preview_token: str = Field(min_length=16, max_length=256)
    reason: str = Field(min_length=1, max_length=2000)  # trim 후 정책 범위(2~500자)를 서버가 검사
    reauth_proof: str | None = Field(None, max_length=2048)


class ExportPartStatus(Contract):
    part_id: UUID
    part_no: int
    status: Literal['pending', 'building', 'ready', 'failed', 'expired']
    size_bytes: int | None = None
    # 객체 key·URL·ZIP hash 는 이 응답에 없다(URL 은 download-url POST 만)


class DataCenterExportStatus(Contract):
    export_id: UUID
    status: Literal['queued', 'preparing', 'ready', 'ready_with_warnings', 'failed', 'expired', 'cancelled']
    scope: ExportScope
    purpose: Purpose
    identity: Identity
    session_count: int
    participant_count: int
    completed_count: int
    parts: list[ExportPartStatus]
    expected_part_count: int | None = None
    warnings: list[str] = Field(default_factory=list)
    error_code: str | None = None
    created_at: datetime
    expires_at: datetime
    policy_version: str


class DataCenterExportPage(Contract):
    items: list[DataCenterExportStatus]
    next_cursor: str | None = None


class ExportReauthRequest(Contract):
    """반출 전용 재인증. 이메일 계정은 비밀번호(credential), 소셜 계정은 소셜 재로그인으로 받은 1회용 proof(social_proof).
    비밀번호·proof 는 저장·로그 금지."""
    credential: str | None = Field(None, min_length=1, max_length=512)
    social_proof: str | None = Field(None, min_length=1, max_length=512)
    request_hash: str | None = Field(None, min_length=64, max_length=64)
    job_id: UUID | None = None
    scope_org_id: UUID | None = None

    @model_validator(mode='after')
    def _one_method(self):
        if bool(self.credential) == bool(self.social_proof):
            raise ValueError('credential 또는 social_proof 중 하나만 전달해야 합니다')
        return self


class ExportProof(Contract):
    proof: str
    expires_at: datetime


class PartDownloadRequest(Contract):
    part_id: UUID
    reauth_proof: str | None = Field(None, max_length=2048)


class PartDownload(Contract):
    url: str
    expires_at: datetime
    part_no: int
    # S3 URL 은 일회용·즉시 철회 보장이 없다(최대 TTL 동안 잔여 접근 가능).
    revocable: Literal[False] = False


class DownloadAuditItem(Contract):
    event_id: UUID
    event: str
    result: str
    at: datetime
    actor_id: UUID
    actor_role: str
    org_id: UUID | None
    job_id: UUID | None
    purpose: str | None
    identity: str | None
    reason: str | None
    part_no: int | None
    session_count: int | None
    size_bytes: int | None
    policy_version: str | None
