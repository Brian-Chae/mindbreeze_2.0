"""SDD-188/189: AI 에이전트 채널 Pydantic 스키마.

필드명·enum 값은 plan.md §Contract 와 1:1 대응한다(프론트가 그대로 소비). 변경 금지.
SDD-189 는 상담사 채널 값을 **추가**만 한다 — 기존 값을 바꾸면 내담자 채널이 회귀한다.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

# plan.md §Contract — AgentCtaAction
AgentCtaAction = Literal[
    "ack",
    "open_map",
    "join_session",
    "request_change",
    "open_chat",
    "call_counselor",
    "open_report",
    "feedback_choice",
    # SDD-189 상담사 채널 — 모두 화면 이동용(서버 상태 변경 없음)
    "open_schedule",
    "open_client",
    "open_record",
    "open_change_requests",
    # SDD-191 — 내담자: 담당 상담사와의 direct 채팅방으로 이동
    "talk_to_counselor",
    # SDD-191 — 상담사: 확인이 필요한 알림 목록으로 이동
    "open_risk_signals",
]

# plan.md §Contract — AgentMessage.kind
AgentMessageKind = Literal[
    "reminder_3h",
    "reminder_1h",
    "schedule_changed",
    "report_ready",
    "report_chat",
    "feedback_thanks",
    # SDD-189 상담사 채널 브리핑
    "briefing_morning",
    "briefing_evening",
    # SDD-191 안부 대화(내담자 채널) · 위험 알림(상담사 채널)
    "checkin",
    "checkin_closing",
    "risk_alert",
    "free",
]

AgentMessageSender = Literal["agent", "user", "system"]
AgentRefType = Literal["session", "report"]
FeedbackChoice = Literal["helpful", "neutral", "disappointed"]


class AgentCtaPayload(BaseModel):
    """CTA 실행에 필요한 부가 정보 — 액션별로 쓰이는 키가 다르다."""

    # open_map: 지도 검색 URL, open_report: 리포트 뷰 경로, join_session/open_chat: 이동 경로
    url: str | None = None
    session_id: str | None = None
    room_id: str | None = None
    tel: str | None = None
    choice: FeedbackChoice | None = None
    # SDD-189 상담사 채널 CTA 대상 — open_client / open_record / open_report
    client_id: str | None = None
    record_id: str | None = None
    report_id: str | None = None


class AgentCta(BaseModel):
    id: str
    action: AgentCtaAction
    label: str
    payload: AgentCtaPayload | None = None
    # 이미 수행됨(확인했어요·피드백 선택 등) → 프론트에서 비활성 처리
    done: bool | None = None


class AgentMessageResponse(BaseModel):
    id: str
    sender: AgentMessageSender
    kind: AgentMessageKind
    content: str
    cta: list[AgentCta] = []
    ref_type: AgentRefType | None = None
    ref_id: str | None = None
    read_at: datetime | None = None
    created_at: datetime


class AgentMessageListResponse(BaseModel):
    """최신순(created_at desc) 정렬. before 커서로 과거를 더 불러온다."""

    items: list[AgentMessageResponse] = []
    has_more: bool = False


class AgentConsentResponse(BaseModel):
    agreed: bool
    version: str


class AgentConsentRequest(BaseModel):
    agreed: bool = True


class AgentSendMessageRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=1000)


class AgentSendMessageResponse(BaseModel):
    user_message: AgentMessageResponse
    agent_message: AgentMessageResponse


class AgentReadRequest(BaseModel):
    """up_to 미지정이면 전체를 읽음 처리한다."""

    up_to: datetime | None = None


class AgentUnreadResponse(BaseModel):
    unread: int


class AgentCtaExecuteRequest(BaseModel):
    """request_change 는 reason(1~500자) 필수. 그 외 액션에서는 생략한다."""

    reason: str | None = Field(None, max_length=500)
    text: str | None = Field(None, max_length=1000)


class AgentCtaExecuteResponse(BaseModel):
    cta: AgentCta
    agent_message: AgentMessageResponse | None = None


# ---------------------------------------------------------------------------
# SDD-189: 상담사 채널 (plan.md §Contract)
# ---------------------------------------------------------------------------

AgentRelayKind = Literal["feedback", "schedule_change_request", "ack"]
RelayEventStatusFilter = Literal["open", "all"]

# "HH:MM" 24시간 표기만 허용 — "25:00"·"8:0" 은 422.
_TIME_PATTERN = r"^(?:[01]\d|2[0-3]):[0-5]\d$"


class BriefingSettings(BaseModel):
    """상담사 브리핑 설정 — 시각은 KST 로 해석한다."""

    morning_enabled: bool = True
    morning_time: str = Field("08:00", pattern=_TIME_PATTERN)
    evening_enabled: bool = True
    evening_time: str = Field("21:00", pattern=_TIME_PATTERN)
    # true 면 일정이 없는 날에는 브리핑을 만들지 않는다.
    skip_no_session_days: bool = True


class RelayEventPayload(BaseModel):
    """중계 이벤트 부가 정보 — 자유 서술(texts)·변경 사유(reason)는 원문 그대로다(D10)."""

    choice: FeedbackChoice | None = None
    texts: list[str] = []
    reason: str | None = None
    message_id: str | None = None
    report_id: str | None = None


class RelayEventResponse(BaseModel):
    id: str
    kind: AgentRelayKind
    client_id: str
    # D12: 상담사 채널은 내담자 실명을 쓴다.
    client_name: str
    session_id: str | None = None
    session_title: str | None = None
    scheduled_at: datetime | None = None
    payload: RelayEventPayload = RelayEventPayload()
    handled_at: datetime | None = None
    created_at: datetime


class RelayEventListResponse(BaseModel):
    items: list[RelayEventResponse] = []


class CounselorCtaExecuteResponse(BaseModel):
    """상담사 CTA 는 화면 이동만 하므로 실행 기록(cta)만 돌려준다."""

    cta: AgentCta


# ---------------------------------------------------------------------------
# SDD-191: 안부 대화 · 상담사 전용 프로파일 · 위험 신호 (plan.md §Contract)
# ---------------------------------------------------------------------------

MoodDirection = Literal["better", "same", "watch"]
ProfileCategory = Literal["sleep", "stress", "emotion", "coping", "people_events"]
ProfileItemStatus = Literal["ai_estimate", "confirmed", "dismissed"]
RiskLevel = Literal["watch", "high"]
RiskSignalStatusFilter = Literal["open", "all"]


class CheckinPrefs(BaseModel):
    """내담자용 — available 은 "상담사가 안부를 켰는지"다(D5=②).

    감지·위험과 관련된 어떤 필드도 두지 않는다(D4 — 내담자에게 비노출).
    """

    available: bool = False
    paused: bool = False


class CheckinPrefsUpdateRequest(BaseModel):
    paused: bool


class CheckinClient(BaseModel):
    """상담사용 안부 대상 목록 한 줄."""

    client_id: str
    client_name: str
    enabled: bool
    last_checkin_at: datetime | None = None
    open_risk_count: int = 0


class CheckinClientListResponse(BaseModel):
    items: list[CheckinClient] = []


class CheckinEnableRequest(BaseModel):
    enabled: bool


class ProfileItem(BaseModel):
    """상담사 전용 프로파일 항목 — 근거는 개수만 노출한다(원문·id 비노출)."""

    id: str
    category: ProfileCategory
    text: str
    status: ProfileItemStatus
    evidence_count: int = 0
    updated_at: datetime


class ProfileItemListResponse(BaseModel):
    items: list[ProfileItem] = []


class ProfileItemUpdateRequest(BaseModel):
    """확정/기각 또는 문구 수정. 둘 다 생략하면 400."""

    status: Literal["confirmed", "dismissed"] | None = None
    text: str | None = Field(None, min_length=1, max_length=300)


class CheckinSummary(BaseModel):
    """체크인 요약 — 상담사에게는 원문이 아니라 요약만 전달한다(D1)."""

    id: str
    client_id: str
    started_at: datetime
    closed_at: datetime | None = None
    summary: str = ""
    mood_direction: MoodDirection | None = None


class CheckinSummaryListResponse(BaseModel):
    items: list[CheckinSummary] = []


class RiskSignal(BaseModel):
    """위험 신호 — 상담사 전용. excerpt 는 감지된 문장만(최대 200자)."""

    id: str
    client_id: str
    client_name: str
    level: RiskLevel
    excerpt: str
    created_at: datetime
    handled_at: datetime | None = None


class RiskSignalListResponse(BaseModel):
    items: list[RiskSignal] = []
