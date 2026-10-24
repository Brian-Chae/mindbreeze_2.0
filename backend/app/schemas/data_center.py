"""SDD-243 데이터 센터 공통 계약(B01 동결).

플랫폼·기관 관리자 공용 `/api/v1/data-center` 응답 형태. 이후 Task(B02~B07)는 이 형태를 additive 로만 확장한다.
- 모든 `*_us` 는 G1 계약과 같은 int64 10진 문자열, 시각은 UTC ISO-8601.
- 숫자 0 은 "확인된 0" 만 뜻한다. 미집계·미수집은 `Count.value=None` + 사유로 구별한다.
- 일반 목록 DTO 에는 PII 원문·원시 배열·자유 JSON·저장소 key 를 두지 않는다.
"""
from datetime import datetime
from typing import Annotated, Generic, Literal, TypeVar
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

T = TypeVar('T')

Role = Literal['platform_admin', 'org_admin']
Identity = Literal['pseudonymized', 'identified']
Purpose = Literal['operations', 'research']
ExportScope = Literal['participant', 'session', 'class', 'member', 'facilitator']
ExportInclude = Literal['eeg_raw', 'ppg_raw', 'acc_raw', 'features', 'indices']
SignalType = Literal['eeg', 'ppg', 'acc']
Availability = Literal['available', 'not_collected', 'unsupported_client', 'expired', 'withdrawn', 'lost', 'unknown', 'blocked']
TimeBasis = Literal['host_estimated', 'device_relative', 'utc_verified', 'session_relative', 'unknown']
DecimalInt = Annotated[str, StringConstraints(pattern=r'^-?(0|[1-9][0-9]{0,18})$')]
Tab = Literal['overview', 'subjects', 'classes', 'consents', 'retention', 'standard', 'jobs', 'audits']

# 허용 정렬·검색 필드는 서버 allowlist 로만 해석한다(자유 SQL 정렬 금지).
SortKey = Literal['time_desc', 'time_asc', 'name_asc']


class Contract(BaseModel):
    model_config = ConfigDict(extra='forbid')


# ── 공통 ────────────────────────────────────────────────────────────────

class Count(Contract):
    """확인된 0 과 미집계(null)를 구별한다. partial=True 는 메타데이터 기준 부분 집계."""
    value: int | None = None
    partial: bool = False
    unavailable_reason: str | None = None


class DataCenterPage(Contract, Generic[T]):
    """cursor 기반 목록. total 은 같은 as_of·필터 기준 전체 건수(없으면 None + total_reason)."""
    items: list[T]
    next_cursor: str | None = None
    total: int | None = None
    total_reason: str | None = None
    as_of: datetime
    filters_hash: str


class DataCenterQuery(Contract):
    """목록 질의. org/역할은 여기에 두지 않는다(서버 context 가 결정)."""
    limit: int = Field(25, ge=1, le=100)
    cursor: str | None = Field(None, max_length=512)
    q: str | None = Field(None, max_length=100)  # 허용 필드(식별번호·이름·이메일·제목)만 검색
    date_from: str | None = Field(None, pattern=r'^\d{4}-\d{2}-\d{2}$')  # KST 달력일, 시작 00:00 포함
    date_to: str | None = Field(None, pattern=r'^\d{4}-\d{2}-\d{2}$')  # KST 달력일, 다음날 00:00 미포함
    status: str | None = Field(None, max_length=30)
    kind: str | None = Field(None, max_length=30)
    group_by: Literal['org', 'role', 'type'] | None = None
    sort: SortKey = 'time_desc'


# ── 컨텍스트(#31) ───────────────────────────────────────────────────────

class OrgRef(Contract):
    id: UUID
    name: str


class Capabilities(Contract):
    """서버가 계산한 기능 스위치. FE 는 표시용으로만 쓰며 인가 증명으로 쓰지 않는다."""
    enabled: bool
    tabs: list[Tab]
    can_research: bool
    can_export_identified: bool
    can_reveal_contact: bool
    can_view_platform_audits: bool


class PolicyLimits(Contract):
    """FE 가 표시·검증에 쓰는 서버 정책값. 변경은 policy_version 으로 구분."""
    policy_version: str
    policy_hash: str
    default_identity: Identity
    require_reason: bool
    reason_min_length: int
    reason_max_length: int
    reauth_ttl_seconds: int
    artifact_ttl_seconds: int
    url_ttl_seconds: int
    preview_ttl_seconds: int
    max_active_jobs_per_actor: int
    member_facilitator_max_sessions: int
    part_max_bytes: int
    page_default: int = 25
    page_max: int = 100
    provisional: bool = True  # D1~D3 는 Brian 확정 전 잠정값


class DataCenterContext(Contract):
    role: Role
    actor_id: UUID
    current_org: OrgRef | None  # 기관 관리자는 선택한 기관 하나, 플랫폼은 선택적 좁힘
    allowed_orgs: list[OrgRef]  # 개인상담소 제외. 플랫폼은 빈 목록(전역)
    default_org_id: UUID | None
    capabilities: Capabilities
    limits: PolicyLimits


# ── 개요·인벤토리(#1~2) ─────────────────────────────────────────────────

class KpiItem(Contract):
    key: str
    label: str
    unit: str
    count: Count


class SummaryResponse(Contract):
    as_of: datetime
    scope_label: str
    kpis: list[KpiItem]


class InventoryItem(Contract):
    kind: str
    label: str
    storage_category: str
    retention_policy: str
    count: Count
    exportable: bool
    note: str | None = None


class InventoryResponse(Contract):
    as_of: datetime
    items: list[InventoryItem]


# ── 사용자 데이터(#3~5) ─────────────────────────────────────────────────

class SubjectListItem(Contract):
    subject_type: Literal['user', 'guest']
    subject_id: UUID
    display_name: str | None  # 스크럽된 비회원은 None(복원 금지)
    email: str | None
    role: str | None
    status: str | None
    org_names: list[str]
    member_type: Literal['member', 'non_member', 'unknown'] | None = None
    holdings: dict[str, Count]  # sessions / measurements / reports 등 종류별 건수
    contact_on_file: bool  # 연락처·생일이 존재하는지만 알린다(원문 없음)
    created_at: datetime | None


class HoldingEvent(Contract):
    at: datetime
    kind: str
    label: str
    session_id: UUID | None = None
    status: str | None = None


class SubjectHoldings(Contract):
    subject_type: Literal['user', 'guest']
    subject_id: UUID
    as_of: datetime
    events: list[HoldingEvent]
    counts: dict[str, Count]
    next_cursor: str | None = None


class ContactRevealRequest(Contract):
    fields: list[Literal['phone', 'birth_date']] = Field(min_length=1, max_length=2)


class ContactRevealResponse(Contract):
    """일시 반환. 응답은 Cache-Control: no-store, FE 는 화면 전환 즉시 폐기."""
    subject_type: Literal['user', 'guest']
    subject_id: UUID
    phone: str | None = None
    birth_date: str | None = None
    unavailable: list[str] = Field(default_factory=list)


# ── 클래스·회차·참여자 탐색(#26~30) ─────────────────────────────────────

class ClassListItem(Contract):
    class_id: UUID
    title: str | None
    org_id: UUID | None
    org_name: str | None
    status: str
    ended_session_count: Count
    stored_bytes: Count
    facilitator_aliases: list[str]  # 목록은 가명 별칭(F1…), 실명은 상세·식별 운영에서만
    attribution: Literal['confirmed', 'needs_confirmation']
    last_session_at: datetime | None


class SessionRow(Contract):
    session_id: UUID
    class_id: UUID | None
    seq: int | None
    title: str | None
    scheduled_at: datetime | None
    started_at: datetime | None
    ended_at: datetime | None
    status: str
    participant_count: Count
    measured_count: Count
    estimated_bytes: Count
    exportable: bool
    exclusion_reason: str | None = None  # 미종료·귀속 불명 등


class ClassSessionsResponse(Contract):
    class_id: UUID
    title: str | None
    org_name: str | None
    sessions: DataCenterPage[SessionRow]


class ParticipantRow(Contract):
    participant_id: UUID
    alias: str  # P01… 회차 안 별칭
    display_name: str | None  # 식별 허용 역할에만 값
    subject_type: Literal['user', 'guest'] | None
    subject_id: UUID | None
    attendance_status: str | None
    band_used: bool
    measurement: Literal['available', 'band_not_used', 'not_collected', 'partial', 'unknown']
    general_consent: Literal['agreed', 'withdrawn', 'none', 'unknown']
    research_consent: Literal['agreed', 'withdrawn', 'none', 'unknown', 'not_visible']
    retention_deadline: datetime | None
    selectable: bool
    unselectable_reason: str | None = None


class SessionParticipantsResponse(Contract):
    session: SessionRow
    participants: DataCenterPage[ParticipantRow]


class SessionBatch(Contract):
    """회원·상담사 50회차 묶음 선택용: 1~50 / 51~100 …"""
    index: int
    first: int
    last: int
    count: int


class SubjectSessionsResponse(Contract):
    """회원/진행자 단위 회차 목록. total·묶음은 같은 as_of·필터 기준 고정 스냅샷."""
    subject_id: UUID
    as_of: datetime
    total: int
    max_sessions_per_request: int
    batches: list[SessionBatch]
    sessions: DataCenterPage[SessionRow]


# ── 측정 목록·상세(#6~7) ────────────────────────────────────────────────

class SignalHolding(Contract):
    signal: SignalType
    availability: Availability
    unavailable_reason: str | None = None
    sample_count: Count


class MeasurementListItem(Contract):
    session_id: UUID
    participant_id: UUID
    alias: str
    class_id: UUID | None
    started_at: datetime | None
    signals: list[SignalHolding]
    feature_windows: Count
    quality: Literal['good', 'degraded', 'poor', 'unknown']
    band_used: bool


class MeasurementDetail(Contract):
    session_id: UUID
    participant_id: UUID
    alias: str
    as_of: datetime
    manifest_revision: int | None  # T06 전에는 None + manifest_state
    manifest_state: Literal['available', 'pending_upload', 'partial', 'not_available', 'not_connected']
    signals: list[SignalHolding]
    feature_windows: Count
    consent: Literal['agreed', 'withdrawn', 'none', 'unknown']
    retention_deadline: datetime | None
    allowed_formats: list[Literal['csv', 'parquet']]
    band_used: bool
    default_view: Literal['participant_player', 'session_player', 'unavailable']


# ── 동의·보관·표준(#8~15, 플랫폼 전용은 #9~15) ───────────────────────────

class ConsentItem(Contract):
    scope: Literal['collection', 'research']
    session_id: UUID | None
    participant_id: UUID | None
    subject_ref: str  # 가명 참조(원 사용자 ID 역연결 금지)
    notice_version: str | None
    state: Literal['agreed', 'withdrawn', 'none']
    at: datetime | None
    export_state: str | None = None


class ResearchBatchItem(Contract):
    batch_id: UUID
    status: str
    created_at: datetime
    uploaded_at: datetime | None
    acked_at: datetime | None
    file_count: int
    total_bytes: int
    attempt: int


class ResearchBatchDetail(ResearchBatchItem):
    session_id: UUID | None
    error_summary: str | None  # 정제 문구만(원문 오류·manifest·S3 key 제외)
    history: list[HoldingEvent]


class RetentionRunItem(Contract):
    run_id: UUID
    mode: Literal['dry_run', 'execute']
    status: str
    trigger: str
    started_at: datetime
    finished_at: datetime | None


class RetentionRunDetail(RetentionRunItem):
    cutoff_at: datetime | None
    blocked_reason: str | None = None  # sweep_disabled / apply_from_unset / dry_run_requested 등 허용 목록 값만
    summary: dict[str, Count]  # report allowlist 투영: 후보/처리/보류/실패/미확인
    error_summary: str | None


class RetentionCandidate(Contract):
    kind: str
    ref: str  # 가명 참조
    deadline: datetime | None
    reason: Literal['due', 'near_due', 'research_hold', 'unknown_deadline']


class AccountDeletionItem(Contract):
    source: Literal['request', 'ledger']  # 공개 접수와 실제 탈퇴 원장을 섞지 않는다
    ref: str
    status: str
    received_at: datetime | None
    grace_until: datetime | None
    retained_reasons: dict[str, int] = Field(default_factory=dict)
    object_counts: dict[str, int] = Field(default_factory=dict)


class BaselineItem(Contract):
    """개인정보·장비 ID·개별 feature 없음. 기준 측정 ID·구간·파이프라인·생성시각만."""
    baseline_id: int
    pipeline_version: str | None
    is_active: bool
    created_at: datetime


# ── 측정 시계열(#16~18, #32) ────────────────────────────────────────────

class MeasurementSelection(Contract):
    """회차×참여자 + 구간 [from_us, to_us). 시각은 측정 시작 기준 상대 µs(10진 문자열)."""
    session_id: UUID
    participant_id: UUID
    from_us: DecimalInt | None = None
    to_us: DecimalInt | None = None


class GapRange(Contract):
    start_us: DecimalInt
    end_us: DecimalInt | None
    reason: str
    observed_or_estimated: Literal['observed', 'estimated', 'unknown']


class WaveformSegment(Contract):
    """stream/segment 경계. FE 는 segment 사이를 선으로 잇지 않는다."""
    stream_id: str
    segment_id: str
    point_start: int  # 채널 배열 안의 반환 인덱스 범위 [start, end)
    point_end: int
    first_sample_index: int
    end_sample_index_exclusive: int


class WaveformChannel(Contract):
    name: str
    unit: str
    values: list[float | None] | None = None  # method=raw
    min: list[float | None] | None = None  # method=minmax_envelope
    max: list[float | None] | None = None


class WaveformResponse(Contract):
    session_id: UUID
    participant_id: UUID
    signal_type: SignalType
    availability: Availability
    unavailable_reason: str | None = None
    manifest_revision: int | None = None
    from_us: DecimalInt | None = None
    to_us: DecimalInt | None = None
    method: Literal['raw', 'minmax_envelope', 'none'] = 'none'
    max_points: int
    source_sample_count: int = 0
    returned_count: int = 0
    nominal_rate_hz: float | None = None
    observed_rate_hz: float | None = None
    time_basis: TimeBasis = 'unknown'
    t_us: list[DecimalInt] = Field(default_factory=list)  # 포인트(또는 버킷 시작) 상대 시각
    channels: list[WaveformChannel] = Field(default_factory=list)
    segments: list[WaveformSegment] = Field(default_factory=list)
    gaps: list[GapRange] = Field(default_factory=list)
    null_reasons: dict[str, str] = Field(default_factory=dict)


class FeatureRow(Contract):
    window_index: int
    t_rel_ms: int | None
    quality: str
    source: Literal['scalar_1hz', 'detail_emit']
    values: dict[str, float | None]  # 원천 float 보존, null 은 null
    units: dict[str, str] = Field(default_factory=dict)


class FeaturePage(Contract):
    session_id: UUID
    participant_id: UUID
    as_of: datetime
    # 상세 emit JSONL(전체 emit inventory)은 SDD-244 artifact 연결 후 제공. 1Hz 스칼라와 혼동하지 않는다.
    detail_emit: Literal['available', 'not_connected'] = 'not_connected'
    # scalar_1hz 의 t_rel_ms 원점. manifest 원점이 연결되면 'manifest_origin' 으로 바뀐다.
    time_origin: Literal['first_feature_window', 'manifest_origin'] = 'first_feature_window'
    algorithm_versions: dict[str, str] = Field(default_factory=dict)
    items: list[FeatureRow]
    next_cursor: str | None = None
    total: int | None = None


IndexStatus = Literal['snapshot', 'null', 'held', 'stale', 'display_history_missing', 'unverified', 'insufficient_window']
IndexSource = Literal['participant_player', 'session_player', 'reconstructed', 'report_aggregate', 'none']


class IndexMetric(Contract):
    value: int | None  # 표시 정수 그대로(재계산·반올림 금지)
    status: IndexStatus
    source: IndexSource
    reason: str | None = None


class IndexRow(Contract):
    t_rel_ms: int | None
    focus: IndexMetric
    relaxation: IndexMetric
    emotional_balance: IndexMetric
    bpm: IndexMetric
    respiration: IndexMetric
    hrv_sdnn_ms: IndexMetric  # HRV 는 SDNN(ms) 고정
    model_version: str | None = None
    display_input: dict[str, float | None] | None = None


class IndicesPage(Contract):
    session_id: UUID
    participant_id: UUID
    as_of: datetime
    view: Literal['participant_player', 'session_player', 'unavailable']
    items: list[IndexRow]
    next_cursor: str | None = None
    note: str | None = None


class SpectrumChannel(Contract):
    name: str
    psd: list[float]


class SpectrumResponse(Contract):
    session_id: UUID
    participant_id: UUID
    computable: bool
    reason: str | None = None
    method: Literal['dc-welch-v1'] = 'dc-welch-v1'
    unit: Literal['uV2/Hz'] = 'uV2/Hz'
    window_sec: float = 2.0
    overlap: float = 0.5
    from_us: DecimalInt | None = None
    to_us: DecimalInt | None = None
    freq_hz: list[float] = Field(default_factory=list)
    channels: list[SpectrumChannel] = Field(default_factory=list)
