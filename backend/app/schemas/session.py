"""세션 관리 Pydantic 스키마"""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from app.schemas.eeg import HRVMotionFeatures

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

SessionType = Literal["clinical", "hypnosis", "meditation", "custom"]
# SDD-015: 일정 없는 즉석 클래스의 대기 상태 "ready" 추가 (기존 "scheduled" 유지)
# SDD-088: 오픈/대기 상태 "open" 추가 — 상담사가 클래스를 열어 회원 입장을 받는 단계
SessionStatus = Literal["ready", "scheduled", "open", "in_progress", "paused", "completed", "cancelled"]
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
    # AI 클래스 분석 — 영상/음성 녹화 여부(기본 On). Off 시 해당 미디어 리포트 미생성
    record_audio: bool = True
    record_video: bool = True
    participant_ids: list[str] = Field(default_factory=list)
    force: bool = False
    # SDD-095: 템플릿으로 저장 — true 면 일정·참여자·코드 없이 설정만 보관한다.
    is_template: bool = False
    # SDD-097: 예약 클래스 사전 안내(리마인더) 시점 — 시작 N분 전 정수 목록(예: [1440, 60]).
    # 빈 배열([])이면 끔. 일정 없는 즉시 클래스에서는 저장만 되고 발송되지 않는다.
    reminder_offsets: list[int] = Field(default_factory=list)

    @field_validator("reminder_offsets")
    @classmethod
    def _normalize_reminder_offsets(cls, value: list[int]) -> list[int]:
        # 5분~14일 범위만 허용하고, 중복 제거 후 큰 간격(이른 안내) 우선으로 정렬한다.
        cleaned = {
            int(v) for v in (value or [])
            if isinstance(v, int) and 5 <= v <= 60 * 24 * 14
        }
        return sorted(cleaned, reverse=True)[:5]

    @model_validator(mode="after")
    def _validate_custom_type(self) -> "SessionCreateRequest":
        # type=custom 일 때 custom_type_name 필수
        if self.type == "custom" and not (self.custom_type_name and self.custom_type_name.strip()):
            raise ValueError("기타 유형 선택 시 유형 이름을 입력해야 합니다")
        return self

    @model_validator(mode="after")
    def _validate_online_group_capacity(self) -> "SessionCreateRequest":
        # 온라인 그룹 클래스는 양방향 영상 품질 보호를 위해 최대 50명까지 허용한다.
        if (
            self.location_type == "online"
            and self.participant_mode == "group"
            and self.max_participants > 50
        ):
            raise ValueError("온라인 그룹 클래스는 최대 50명까지 설정할 수 있습니다")
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
    record_audio: bool | None = None
    record_video: bool | None = None
    # 클래스 실시간 채팅 on/off — host 상담사만 변경 가능(세션 채팅방은 자동 개설 유지)
    chat_enabled: bool | None = None
    force: bool = False
    # SDD-097: 리마인더 시점 재설정 — 주어졌을 때만 교체하고 ETA 를 다시 예약한다(None 이면 기존 유지).
    reminder_offsets: list[int] | None = None

    @field_validator("reminder_offsets")
    @classmethod
    def _normalize_reminder_offsets(cls, value: list[int] | None) -> list[int] | None:
        if value is None:
            return None
        cleaned = {
            int(v) for v in value
            if isinstance(v, int) and 5 <= v <= 60 * 24 * 14
        }
        return sorted(cleaned, reverse=True)[:5]

    @model_validator(mode="after")
    def _validate_online_group_capacity(self) -> "SessionUpdateRequest":
        # 온라인 그룹 클래스는 최대 50명 — 부분 수정이므로 max_participants 가 주어졌을 때만 검사한다.
        if (
            self.max_participants is not None
            and self.location_type == "online"
            and self.participant_mode == "group"
            and self.max_participants > 50
        ):
            raise ValueError("온라인 그룹 클래스는 최대 50명까지 설정할 수 있습니다")
        return self


class ParticipantInfo(BaseModel):
    # SDD-094: 게스트/회원 공통 식별자 — 상담사 UI가 참가자별 상태를 매핑하는 데 사용
    participant_id: str
    # SDD-015: 게스트 참여자는 user_id가 없고 guest_name만 갖는다
    user_id: str | None = None
    guest_name: str | None = None
    gender: str | None = None
    birth_date: date | None = None
    is_guest: bool = False
    band_connected: bool = False
    linkband_device_id: str | None = None
    webrtc_peer_id: str | None = None
    consent_audio: bool = False
    consent_eeg: bool = False
    is_waitlisted: bool = False
    waitlist_position: int | None = None
    # SDD-094: 발언권 관리 — 손들기/발언권 부여 상태(상담사 UI 표시용)
    raise_hand: bool = False
    speaking: bool = False

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
    # SDD-088: 클래스 오픈(대기실 개방) 시각
    opened_at: datetime | None = None
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
    record_audio: bool = True
    record_video: bool = True
    # 클래스 실시간 채팅 사용 여부(상담사가 켠다) + 세션 채팅방 ID(프론트 실시간 채팅 연결용)
    chat_enabled: bool = False
    chat_room_id: str | None = None
    # SDD-095: 클래스 템플릿 여부 — true 면 실제 진행 대상이 아니라 "유형 설정 저장본"이다.
    is_template: bool = False
    # SDD-097: 예약 클래스 사전 안내(리마인더) 시점 — 시작 N분 전 정수 목록. 빈 배열이면 끔.
    reminder_offsets: list[int] = []
    created_at: datetime
    participants: list[ParticipantInfo] = []
    waitlist_count: int = 0

    model_config = {"from_attributes": True}


class SessionListResponse(BaseModel):
    sessions: list[SessionResponse]
    total: int


class InviteParticipantRequest(BaseModel):
    user_id: str


# ---------------------------------------------------------------------------
# SDD-095: 클래스 템플릿 · 복제
# ---------------------------------------------------------------------------


class SessionDuplicateRequest(BaseModel):
    """클래스 복제 요청 — 유형 설정은 원본에서 복사하고 일정/제목만 선택적으로 덮어쓴다.

    scheduled_at 을 주면 그 일정으로 새 예약 클래스를 만든다(미지정 시 즉석 클래스 ready).
    """

    scheduled_at: datetime | None = None
    title: str | None = Field(None, max_length=200)
    force: bool = False


class SessionTemplateSaveRequest(BaseModel):
    """현재 클래스 설정을 템플릿으로 저장할 때의 선택 제목."""

    title: str | None = Field(None, max_length=200)


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
    # 클래스 실시간 채팅 사용 여부 — 참여자가 입장 전에 채팅 가능 여부를 알 수 있게 노출
    chat_enabled: bool = False

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# 클래스 실시간 채팅 (세션 채팅방 · on/off 토글)
# ---------------------------------------------------------------------------


class SessionChatEnabledRequest(BaseModel):
    """클래스 채팅 켜기/끄기 요청 — host(상담사) 전용."""

    enabled: bool


class SessionChatRoomResponse(BaseModel):
    """세션 채팅방 정보 — 프론트가 room_id 로 실시간 채팅(/chat 네임스페이스)에 연결한다."""

    session_id: str
    chat_enabled: bool = False
    room_id: str | None = None
    room_type: str = "session"


class JoinByCodeRequest(BaseModel):
    """게스트 참여 시 name 필수, 로그인 참여 시 생략 가능."""

    name: str | None = Field(None, min_length=1, max_length=100)
    gender: Literal["male", "female", "other"] | None = None
    birth_date: str | None = None


class JoinByCodeResponse(BaseModel):
    participant_token: str | None = None
    session: SessionResponse
    participant_id: str | None = None
    is_guest: bool = False


class MemberLiveKitTokenRequest(BaseModel):
    """회원/게스트 구독 전용 LiveKit 토큰 요청 — 게스트는 participant_token 소유 증명."""

    participant_id: str
    participant_token: str | None = None


class MemberLiveKitTokenResponse(BaseModel):
    livekit_token: str
    webrtc_room_id: str
    # 온라인 양방향 영상 규칙에 따른 송신 가능 여부 — 프론트가 마이크/카메라 UI 제어에 사용.
    can_publish: bool = False


# ---------------------------------------------------------------------------
# SDD-094: 발언권 관리 (손들기 → 부여/해제)
# ---------------------------------------------------------------------------


class SpeakingRequest(BaseModel):
    """상담사 발언권 부여(granted=True)/해제(False) 요청."""

    granted: bool


class RaiseHandRequest(BaseModel):
    """회원/게스트 손들기 요청 — 게스트는 participant_token 으로 소유를 증명한다."""

    participant_token: str | None = None


class SpeakingStateResponse(BaseModel):
    """손들기/발언권 상태 응답 — 변경 결과를 호스트/회원 UI 에 되돌려준다."""

    participant_id: str
    raise_hand: bool = False
    speaking: bool = False
    # 부여 시 raise_hand 는 자동 해제된다(한 흐름) — 클라이언트 정합용으로 함께 내린다.
    can_publish: bool = False


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
    # 클래스 실시간 채팅 활성 여부 — 로그인 회원이 대기/명상 화면에서 채팅 가능 여부 판단용
    chat_enabled: bool = False


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
