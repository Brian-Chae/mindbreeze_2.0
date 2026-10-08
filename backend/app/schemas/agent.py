"""SDD-188: AI 에이전트 채널 Pydantic 스키마.

필드명·enum 값은 plan.md §Contract 와 1:1 대응한다(프론트가 그대로 소비). 변경 금지.
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
]

# plan.md §Contract — AgentMessage.kind
AgentMessageKind = Literal[
    "reminder_3h",
    "reminder_1h",
    "schedule_changed",
    "report_ready",
    "report_chat",
    "feedback_thanks",
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
