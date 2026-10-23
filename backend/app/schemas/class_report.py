"""SDD-237 클래스 리포트·요약 응답 스키마 (plan.md §4 계약).

FE 목 fixture(`frontend/src/lib/class-report/fixtures/*.json`)가 이 계약의 단일 사본이며,
`tests/test_class_report_contract.py` 가 같은 모델로 검증해 드리프트를 막는다.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

Direction = Literal["up", "down", "stable"]
ClassStatus = Literal["zero", "pending", "error", "unworn", "lost", "single", "poor_signal", "partial", "measured"]
Flag = Literal["partial", "lost", "poor_signal"]
MetricState = Literal["ok", "single", "missing", "poor_signal", "lost", "unworn"]
ChipState = Literal["ok", "single", "missing", "poor_signal"]
Source = Literal["rule", "ai", "edited"]
MetricKey = Literal["respiration", "bpm", "hrv", "focus", "relaxation", "emotional"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ── 안내 상태 / 설정 ────────────────────────────────────────────────
class NotePromptClaimResponse(_Strict):
    show: bool


class NotePromptDismissResponse(_Strict):
    dismissed_at: datetime


class NotePromptSettingResponse(_Strict):
    enabled: bool


class NotePromptSettingUpdate(_Strict):
    enabled: bool


# ── 공통 조각 ───────────────────────────────────────────────────────
class ReportInfo(_Strict):
    id: str | None
    generation_status: str
    state: Literal["ready", "processing", "error"]
    narrative_pending: bool


class Scope(_Strict):
    attended: int
    measured: int
    included: int
    duration_min: int
    bucket_min: int
    split_min: float | None = None


class SeriesPoint(_Strict):
    t_min: int
    v: float | None
    n: int


class MetricStat(_Strict):
    unit: str
    state: MetricState
    measured: int
    compared: int
    mean: float | None
    min: float | None
    max: float | None
    early: float | None
    late: float | None
    delta: float | None
    direction: Direction | None
    valid_min: float | None
    valid_ratio: float | None
    agreement: dict[str, int] | None
    missing_reason: str | None
    series: list[SeriesPoint]


class PresentedField(_Strict):
    text: str
    source: Source
    ai_draft: str | None
    rule_text: str | None
    edited_text: str | None
    edited_by: str | None
    edited_by_name: str | None
    edited_at: str | None
    stale: bool
    max_len: int


class AiAttempt(_Strict):
    hash: str
    outcome: str
    at: str


class Narrative(_Strict):
    prompt_version: str
    model: str | None
    input_hash: str
    generated_at: str | None
    ai_attempt: AiAttempt | None
    fields: dict[str, PresentedField]
    fallback_fields: list[str]


class BlockParticipantMetric(_Strict):
    mean: float | None
    early: float | None
    late: float | None
    delta: float | None
    direction: Direction | None
    valid_min: float | None
    valid_ratio: float | None


class BlockParticipant(_Strict):
    participant_id: str
    state: Literal["measured", "unworn", "poor_signal", "lost"]
    metrics: dict[str, BlockParticipantMetric]


class ClassReportBlock(_Strict):
    schema_version: int
    status: ClassStatus
    flags: list[Flag]
    normalization_version: str | None
    scope: Scope
    metrics: dict[str, MetricStat]
    narrative: Narrative
    participants: list[BlockParticipant]


# ── 요약 ────────────────────────────────────────────────────────────
class SummarySession(_Strict):
    id: str
    class_id: str
    class_name: str | None
    seq: int | None
    started_at: datetime | None
    ended_at: datetime | None
    duration_min: int | None
    domain: Literal["meditation"]


class Headcount(_Strict):
    attended: int
    measured: int | None
    report_targets: int
    excluded: int


class Headline(_Strict):
    text: str
    source: Source
    edited_by_name: str | None
    edited_at: str | None


class Chip(_Strict):
    key: MetricKey
    direction: Direction | None
    state: ChipState


class Chips(_Strict):
    body: list[Chip]
    mind: list[Chip]


class SummaryClassReport(_Strict):
    available: bool
    status: ClassStatus
    flags: list[Flag]
    scope: Scope | None
    headline: Headline | None
    chips: Chips


class AutoApprove(_Strict):
    enabled: bool
    grace_minutes: int


class ApprovalCounts(_Strict):
    generating: int
    pending_review: int
    approved: int
    error: int
    no_data_manual: int


class Approval(_Strict):
    auto_approve: AutoApprove
    counts: ApprovalCounts
    participants_total: int


class NotePromptState(_Strict):
    eligible: bool
    has_note: bool
    seen: bool
    dismissed: bool
    user_enabled: bool


class NextSession(_Strict):
    id: str
    seq: int | None
    scheduled_at: datetime | None


class SummaryCapabilities(_Strict):
    can_edit_narrative: bool
    can_write_note: bool
    can_approve: bool


class ClassSummaryResponse(_Strict):
    session: SummarySession
    headcount: Headcount
    report: ReportInfo
    class_report: SummaryClassReport
    approval: Approval
    note_prompt: NotePromptState
    next_session: NextSession | None
    capabilities: SummaryCapabilities
    fetched_at: datetime


# ── 클래스 리포트 ───────────────────────────────────────────────────
class ReportSession(_Strict):
    id: str
    class_name: str | None
    seq: int | None
    ended_at: datetime | None
    duration_min: int | None


class ParticipantReport(_Strict):
    id: str | None
    generation: Literal["pending", "processing", "ready", "failed", "none"]
    approval: Literal["pending_analysis", "pending_review", "completed", "error", "none"]
    delivery: Literal["not_requested", "waiting", "sent", "failed", "no_address", "unknown"]


class ParticipantRow(_Strict):
    participant_id: str
    display_name: str | None
    kind: Literal["member", "guest"]
    order: int
    included: bool
    exclusion: Literal["not_included", "absent"] | None
    measurement: Literal["measured", "unworn", "poor_signal", "lost", "excluded"]
    report: ParticipantReport
    narrative_field: str


class ReportCapabilities(_Strict):
    can_edit_narrative: bool


class ClassReportResponse(_Strict):
    session: ReportSession
    report: ReportInfo
    block: ClassReportBlock | None
    participants: list[ParticipantRow]
    capabilities: ReportCapabilities
    fetched_at: datetime


# ── 서사 문장 수정 ──────────────────────────────────────────────────
class NarrativeEditRequest(_Strict):
    field: str
    text: str | None = None
    revert: bool = False
    base_edited_at: str | None = None


class NarrativeEditResponse(_Strict):
    field: str
    value: PresentedField
    fetched_at: datetime
