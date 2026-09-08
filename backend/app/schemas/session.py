"""세션 관리 Pydantic 스키마"""

from datetime import datetime
from typing import Literal
from uuid import UUID

from app.schemas.eeg import HRVMotionFeatures

from pydantic import BaseModel, EmailStr, Field, model_validator

SessionType = Literal["clinical", "hypnosis", "meditation", "custom"]
# SDD-015: 일정 없는 즉석 클래스의 대기 상태 "ready" 추가 (기존 "scheduled" 유지)
SessionStatus = Literal["ready", "scheduled", "in_progress", "paused", "completed", "cancelled"]
LocationType = Literal["online", "offline"]
ParticipantMode = Literal["one_on_one", "group"]
LinkbandMode = Literal["none", "required", "optional"]


class SessionCreateRequest(BaseModel):
    type: SessionType
    custom_type_name: str | None = Field(None, max_length=30)
    # SDD-015: 즉석 클래스는 일정 없이 생성 가능 (None 이면 status=ready)
    scheduled_at: datetime | None = None
    duration_min: int = Field(..., ge=1, le=600)
    title: str | None = None
    notes: str | None = None
    max_participants: int = Field(10, ge=1, le=100)
    location_type: LocationType = "offline"
    participant_mode: ParticipantMode = "one_on_one"
    linkband_mode: LinkbandMode = "none"
    sfu_enabled: bool = False
    participant_ids: list[str] = Field(default_factory=list)
    force: bool = False

    @model_validator(mode="after")
    def _validate_custom_type(self) -> "SessionCreateRequest":
        # type=custom 일 때 custom_type_name 필수
        if self.type == "custom" and not (self.custom_type_name and self.custom_type_name.strip()):
            raise ValueError("기타 유형 선택 시 유형 이름을 입력해야 합니다")
        return self


class SessionUpdateRequest(BaseModel):
    type: SessionType | None = None
    custom_type_name: str | None = Field(None, max_length=30)
    scheduled_at: datetime | None = None
    duration_min: int | None = Field(None, ge=1, le=600)
    title: str | None = None
    notes: str | None = None
    max_participants: int | None = Field(None, ge=1, le=100)
    location_type: LocationType | None = None
    participant_mode: ParticipantMode | None = None
    linkband_mode: LinkbandMode | None = None
    sfu_enabled: bool | None = None
    force: bool = False


class ParticipantInfo(BaseModel):
    # SDD-015: 게스트 참여자는 user_id가 없고 guest_name만 갖는다
    user_id: str | None = None
    guest_name: str | None = None
    is_guest: bool = False
    band_connected: bool = False
    linkband_device_id: str | None = None
    webrtc_peer_id: str | None = None
    consent_audio: bool = False
    consent_eeg: bool = False
    is_waitlisted: bool = False
    waitlist_position: int | None = None

    model_config = {"from_attributes": True}


class SessionResponse(BaseModel):
    id: str
    # SDD-028: 실행 회차 식별자(경량 SessionRun). 미설정 시 서비스가 session_id 를 채운다.
    run_id: str | None = None
    type: SessionType
    custom_type_name: str | None = None
    status: SessionStatus
    host_id: str
    scheduled_at: datetime | None = None
    access_code: str | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None
    duration_min: int
    title: str | None = None
    notes: str | None = None
    max_participants: int
    location_type: LocationType
    participant_mode: ParticipantMode
    linkband_mode: LinkbandMode
    webrtc_room_id: str | None = None
    sfu_enabled: bool = False
    created_at: datetime
    participants: list[ParticipantInfo] = []
    waitlist_count: int = 0

    model_config = {"from_attributes": True}


class SessionListResponse(BaseModel):
    sessions: list[SessionResponse]
    total: int


class InviteParticipantRequest(BaseModel):
    user_id: str


class MarkerRequest(BaseModel):
    timestamp_sec: float = Field(..., ge=0)
    note: str = Field(..., min_length=1, max_length=500)


# ---------------------------------------------------------------------------
# SDD-015: 클래스 코드 기반 조회 · 참여
# ---------------------------------------------------------------------------


class SessionByCodeResponse(BaseModel):
    """참여 전 클래스 확인 — 인증 없이 노출해도 되는 최소 정보만 담는다."""

    id: str
    access_code: str | None = None
    title: str | None = None
    type: SessionType
    custom_type_name: str | None = None
    status: SessionStatus
    host_name: str | None = None
    participant_mode: ParticipantMode
    linkband_mode: LinkbandMode
    location_type: LocationType
    participant_count: int = 0
    max_participants: int
    started_at: datetime | None = None
    scheduled_at: datetime | None = None

    model_config = {"from_attributes": True}


class JoinByCodeRequest(BaseModel):
    """게스트 참여 시 name 필수, 로그인 참여 시 생략 가능."""

    name: str | None = Field(None, min_length=1, max_length=100)


class JoinByCodeResponse(BaseModel):
    participant_token: str | None = None
    session: SessionResponse
    participant_id: str | None = None
    is_guest: bool = False


# ---------------------------------------------------------------------------
# SDD-021: 클래스 시작 프로세스 1.0 패리티
# ---------------------------------------------------------------------------

# 접촉/기기 상태 — Phase 2 EEG 연동 전까지는 placeholder("unknown")로 내려온다
DeviceStatus = Literal["ok", "lead_off", "disconnected", "unsupported", "unknown"]
# 데이터 업로드 현황 — 실제 EEG 스트리밍 연동 전까지는 "idle"
UploadStatus = Literal["idle", "streaming", "delayed", "failed", "completed"]
# 참가자별 진행 상태 (1.0 SessionLog 상태 대응)
ParticipantLogState = Literal["READY", "STARTED", "COMPLETED"]
# SDD-026: 신호품질(SQI) 상태 — 접촉(device_status)과 분리한 별도 축. null SQI 는 unknown(valid 승격 금지).
SignalQualityState = Literal["valid", "degraded", "invalid", "unknown"]


class SessionLiveMetric(BaseModel):
    """호스트 모니터링 테이블의 참가자 1행.

    뇌파 값(battery/efficiency 등)은 이번 단계에서 null placeholder 다.
    실제 EEG 연동은 Phase 2 에서 채운다.
    """

    participant_id: str
    user_id: str | None = None
    is_guest: bool = False
    display_name: str
    # 자리번호: 기본 생략, 운영자 장비 배정용으로 nullable 만 선반영 (현재 항상 None)
    seat_number: int | None = None
    consent_eeg: bool = False
    session_log_state: ParticipantLogState = "READY"
    band_connected: bool = False
    # SDD-026: device_status 는 접촉/연결 축(ok/lead_off/disconnected/unknown).
    # 신호품질(SQI)은 아래 signal_quality/signal_state 로 분리 표시한다.
    device_status: DeviceStatus = "unknown"
    band_battery: int | None = None
    # SDD-026: 신호품질 원시값(0~1)·상태 — WS/REST 동일 계약. null 보존(unknown, valid 승격 금지).
    signal_quality: float | None = None
    signal_state: SignalQualityState = "unknown"
    avg_efficiency: float | None = None
    current_efficiency: float | None = None
    upload_status: UploadStatus = "idle"
    last_eeg_at: datetime | None = None


class SessionLiveMetricsSummary(BaseModel):
    """DashboardBox 4종 대응 집계 — placeholder 단계에서는 0."""

    participant_count: int = 0
    contact_fail_count: int = 0
    device_fail_count: int = 0
    band_low_count: int = 0


class SessionLiveMetricsResponse(BaseModel):
    """호스트 전용 실시간 모니터링 응답 (일반 상세/목록과 분리)."""

    session_id: str
    status: SessionStatus
    # SDD-026: 상태 계약 버전 + 시작 시각 — join snapshot/이벤트 순서 판정용
    version: int = 0
    started_at: datetime | None = None
    access_code: str | None = None
    metrics: list[SessionLiveMetric] = []
    summary: SessionLiveMetricsSummary


class GuestSessionStateResponse(BaseModel):
    """게스트가 인증 없이 대기→명상 전이를 감지하기 위한 최소 상태.

    민감한 참가자 목록은 포함하지 않는다.
    SDD-023: 게스트 명상 화면 실데이터(최신 윈도우) 필드를 추가한다. 미착용/미수집 시 null.
    """

    session_id: str
    status: SessionStatus
    in_progress: bool = False
    ended: bool = False
    participant_state: ParticipantLogState | None = None
    # SDD-026: 상태 계약 버전 (게스트도 폴백 중단/역순 판정에 사용)
    version: int = 0
    # SDD-023: 본인(participant_id)의 최신 EEG feature 윈도우 실값 (없으면 null)
    band_connected: bool = False
    # SDD-026: 접촉/연결 축(device_status)과 신호품질 축(signal_state) 분리 + 배터리
    device_status: DeviceStatus = "unknown"
    signal_state: SignalQualityState = "unknown"
    band_battery: int | None = None
    relaxation_index: float | None = None
    focus_index: float | None = None
    stress_index: float | None = None
    signal_quality: float | None = None
    last_eeg_at: datetime | None = None


# ---------------------------------------------------------------------------
# SDD-023: LINK BAND 실연동 — EEG feature ingestion
# ---------------------------------------------------------------------------


class EEGFeatureItem(HRVMotionFeatures):
    """1초 단위 EEG feature. 산출 불가 값은 null 로 보낸다(0 치환 금지)."""

    # 세션 내 0-based 초 인덱스 (윈도우 순서)
    second_offset: int = Field(..., ge=0)
    # 디바이스 원시 타임스탬프(ms epoch) — 선택
    timestamp: float | None = None
    # 밴드파워
    delta_power: float | None = None
    theta_power: float | None = None
    alpha_power: float | None = None
    beta_power: float | None = None
    gamma_power: float | None = None
    total_power: float | None = None
    # 지표
    focus_index: float | None = None
    relaxation_index: float | None = None
    stress_index: float | None = None
    meditation_level: float | None = None
    attention_level: float | None = None
    cognitive_load: float | None = None
    emotional_stability: float | None = None
    hemispheric_balance: float | None = None
    # 신호 품질 원시값(0~1)
    signal_quality: float | None = None
    # SDD-026: 실행 세그먼트 식별자(play/resume 마다 새 값). pause/resume window_index 충돌 방지.
    play_group_id: str | None = None
    # SDD-026: 밴드 배터리(%) — 프레임에 실릴 때만. null 보존(0 치환 금지).
    band_battery: int | None = Field(default=None, ge=0, le=100)


class EEGFeatureBatchRequest(BaseModel):
    """5초 배치 업로드 — 초당 1개 feature 배열.

    participant_id: 게스트/특정 참가자 식별용. 미지정 시 인증 사용자를 참가자로 해석한다.
    """

    participant_id: str | None = None
    features: list[EEGFeatureItem] = Field(..., min_length=1)


class EEGFeatureBatchResponse(BaseModel):
    session_id: str
    # 실제 저장된 윈도우 수 (중복 초 인덱스는 제외)
    saved: int


# SDD-029: 이메일 OTP 인증 결과와 참가자 소유 증명을 함께 제출한다.
class ReportEmailRequest(BaseModel):
    participant_id: UUID
    email: EmailStr
    email_verify_token: str | None = None
    participant_token: str | None = None


class ReportEmailResponse(BaseModel):
    status: str
    message: str
