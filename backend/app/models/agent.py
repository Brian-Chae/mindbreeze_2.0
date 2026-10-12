"""SDD-188: AI 에이전트 양방향 채널 모델.

채널 분리가 이 모델의 핵심 전제다. AgentConversation 은 (사용자, 채널) 단위 대화방이며
내담자 채널(`client`)과 상담사 채널(`counselor`)은 서로의 메시지를 볼 수 없다.
내담자→상담사로 넘길 정보는 메시지를 직접 공유하지 않고 AgentRelayEvent(중계 이벤트)로만
옮긴다(상담사 열람 화면은 SDD-189).

AgentDeliveryLog 는 "같은 알림을 두 번 보내지 않는다"를 DB 유니크 제약으로 보장한다.
예약 노티 스윕(매 1분)과 리포트 승인 훅이 같은 대상을 재실행해도 1건만 남는다.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class AgentConversation(Base):
    """사용자별 AI 대화방 — (user_id, channel) 당 1개."""

    __tablename__ = "agent_conversations"
    __table_args__ = (
        UniqueConstraint("user_id", "channel", name="uq_agent_conversation_user_channel"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    # "client" = 내담자:AI 채널, "counselor" = 상담사:AI 채널(SDD-189)
    channel: Mapped[str] = mapped_column(String(20), nullable=False, default="client")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), onupdate=func.now())

    messages = relationship(
        "AgentMessage", back_populates="conversation", cascade="all, delete-orphan"
    )


class AgentMessage(Base):
    """대화방의 한 메시지. cta 는 메시지에 붙은 행동 버튼 목록(JSONB)이다."""

    __tablename__ = "agent_messages"
    __table_args__ = (
        Index("ix_agent_messages_conversation_created", "conversation_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("agent_conversations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # agent | user | system
    sender: Mapped[str] = mapped_column(String(10), nullable=False)
    # reminder_3h | reminder_1h | schedule_changed | report_ready | report_chat
    # | feedback_thanks | free
    kind: Mapped[str] = mapped_column(String(30), nullable=False, default="free")
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # AgentCta 목록. 빈 목록이면 버튼 없는 일반 메시지다.
    cta: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    # 메시지가 가리키는 대상 — session | report | None
    ref_type: Mapped[str | None] = mapped_column(String(20))
    ref_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    # 내담자가 읽은 시각. null 이면 미읽음(미읽음 배지 집계 대상).
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    conversation = relationship("AgentConversation", back_populates="messages")


class AgentRelayEvent(Base):
    """내담자 채널 → 상담사에게 넘기는 중계 이벤트.

    대화 원문을 상담사 채널에 직접 노출하지 않고, 목적이 정해진 이벤트로만 옮긴다.
    단 사후 피드백(kind="feedback")의 자유 서술은 D10 결정에 따라 요약·순화하지 않고
    payload["texts"] 에 원문 그대로 쌓는다.
    """

    __tablename__ = "agent_relay_events"
    __table_args__ = (
        Index("ix_agent_relay_events_target_created", "target_user_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # feedback | schedule_change_request | ack
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    source_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    # 전달 대상 상담사. 세션 host 를 넣는다(없으면 null).
    target_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True
    )
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=True, index=True
    )
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # pending(미열람) → read(상담사 열람, SDD-189)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    # SDD-189: 상담사가 "처리 완료"로 표시한 시각. null 이면 미처리(목록 상단 노출 대상).
    # status 와 축이 다르다 — status 는 열람 여부, handled_at 은 상담사의 처리 선언이다.
    handled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class AgentDeliveryLog(Base):
    """에이전트 선발화(먼저 거는 메시지) 발송 로그 — 중복 발송 차단용.

    (kind, ref_id, offset_min, user_id) 유니크. 예약 노티는 offset_min 에 시점(180/60)을,
    리포트 알림은 0 을, 일정 정정 안내는 "새 예약 시각의 분 단위 epoch"를 넣어
    같은 변경에 대한 정정이 1회만 나가도록 한다.
    payload 에는 발송 당시의 사실(예: announced_at)을 남겨 일정 변경 감지에 쓴다.
    """

    __tablename__ = "agent_delivery_logs"
    __table_args__ = (
        UniqueConstraint(
            "kind", "ref_id", "offset_min", "user_id", name="uq_agent_delivery_log"
        ),
        Index("ix_agent_delivery_logs_ref", "ref_id", "kind"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    # 대상 엔티티 id (세션 또는 리포트)
    ref_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    offset_min: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class AgentCounselorSettings(Base):
    """SDD-189: 상담사별 브리핑 설정 — 상담사당 1행.

    시각은 "HH:MM" 문자열로 두고 **한국 시간(KST)** 으로 해석한다. 서버 타임존이
    바뀌어도 상담사가 지정한 생활 시간대가 흔들리지 않게 하려는 선택이다.
    행이 없는 상담사는 DEFAULT_* 값으로 동작하며, 설정 조회 시 행을 자동 생성한다.
    """

    __tablename__ = "agent_counselor_settings"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_agent_counselor_settings_user"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    morning_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    morning_time: Mapped[str] = mapped_column(
        String(5), nullable=False, default="08:00", server_default="08:00"
    )
    evening_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    evening_time: Mapped[str] = mapped_column(
        String(5), nullable=False, default="21:00", server_default="21:00"
    )
    # true 면 해당 일에 일정이 없을 때 브리핑을 만들지 않는다(기획 §2.2 — 빈 알림 방지).
    skip_no_session_days: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), onupdate=func.now())


class AgentBriefingLog(Base):
    """SDD-189: 브리핑 발송 로그 — (상담사, 종류, 기준일) UNIQUE 로 1일 1회를 보장한다.

    매 1분 cron 이 지정 시각 이후 30분까지 보정 발송을 시도하므로, 멱등은 이 제약에만
    의존한다(스윕이 겹쳐도 메시지는 1건).
    """

    __tablename__ = "agent_briefing_logs"
    __table_args__ = (
        UniqueConstraint("user_id", "kind", "briefing_date", name="uq_agent_briefing_log"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    # morning | evening
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    # 브리핑 기준일(KST 날짜)
    briefing_date: Mapped[date] = mapped_column(Date, nullable=False)
    message_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


# ---------------------------------------------------------------------------
# SDD-191: 안부 대화(체크인) · 상담사 전용 프로파일 · 조용한 위험 신호
# ---------------------------------------------------------------------------
#
# D5=② 결정에 따라 안부 대화는 **상담사가 내담자별로 켠 경우에만** 동작한다
# (`AgentCheckinEnablement`). 내담자는 켜고 끄는 주체가 아니고 "일시 중지"만 할 수 있다
# (`AgentCheckinPref`) — 안부를 보낼 수 있는지는 상담사 결정, 받을지는 내담자 선택이다.
#
# D4 결정에 따라 위험 신호(`AgentRiskSignal`)와 프로파일(`AgentProfileItem`)은
# **상담사 전용**이다. 내담자 채널 API 는 이 두 테이블을 조회하지 않는다.
# 프로파일·위험 신호는 (내담자, 상담사) 쌍으로 나뉘어 상담사 간에도 섞이지 않는다.


class AgentCheckinEnablement(Base):
    """상담사가 내담자별로 켠 안부 대화 스위치 — (상담사, 내담자) 당 1행(D5=②)."""

    __tablename__ = "agent_checkin_enablements"
    __table_args__ = (
        UniqueConstraint(
            "counselor_id", "client_id", name="uq_agent_checkin_enablement_pair"
        ),
        Index("ix_agent_checkin_enablements_client", "client_id", "enabled"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    counselor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    client_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), onupdate=func.now())


class AgentCheckinPref(Base):
    """내담자의 안부 일시 중지 설정 — 내담자당 1행.

    paused=True 여도 **대화 자체는 막지 않는다**. 막는 것은 AI 가 먼저 거는 아웃리치뿐이다
    (Edge Case: "내담자가 체크인 중 일시중지 → 아웃리치 중단, 대화는 가능").
    """

    __tablename__ = "agent_checkin_prefs"
    __table_args__ = (UniqueConstraint("client_id", name="uq_agent_checkin_prefs_client"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    client_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    paused: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), onupdate=func.now())


class AgentCheckin(Base):
    """안부 대화 1회분. closed_at 이 null 인 행이 "열린 체크인"이다.

    열린 체크인이 있으면 아웃리치를 새로 시작하지 않는다(중복 말걸기 방지).
    summary/mood_direction 은 마무리 시점에 채워지며 **상담사만** 열람한다(D1 — 원문 아님).
    """

    __tablename__ = "agent_checkins"
    __table_args__ = (
        Index("ix_agent_checkins_client_started", "client_id", "started_at"),
        Index("ix_agent_checkins_open", "client_id", "closed_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    client_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    # 이 체크인을 유발한 상담사(enablement 소유자). 요약 열람 권한의 기준이 된다.
    counselor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    # 아웃리치 트리거 — no_response | hard_feeling | after_session | usual_time
    trigger: Mapped[str] = mapped_column(String(20), nullable=False, default="no_response")
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # 내담자(user sender) 발화 수. 마무리 판정(5~10턴)의 기준.
    turn_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    summary: Mapped[str | None] = mapped_column(Text)
    # better | same | watch — 숫자 척도를 쓰지 않는다(기획 §3.3).
    mood_direction: Mapped[str | None] = mapped_column(String(10))


class AgentProfileItem(Base):
    """상담사 전용 내담자 프로파일 항목 — AI 추정(ai_estimate) → 상담사 확정/기각.

    내담자에게 **절대 노출되지 않는다**(내담자 API 경로에 조회가 없고, 상담사 API 는
    소유자 검증을 거친다). evidence 에는 근거 메시지 id 목록만 담고 원문은 담지 않는다.
    """

    __tablename__ = "agent_profile_items"
    __table_args__ = (
        Index("ix_agent_profile_items_owner", "counselor_id", "client_id", "category"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    client_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    counselor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    # sleep | stress | emotion | coping | people_events
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    # ai_estimate | confirmed | dismissed
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="ai_estimate", server_default="ai_estimate"
    )
    # 근거 메시지 id 목록(JSON 배열). 원문 문장은 저장하지 않는다.
    evidence: Mapped[list] = mapped_column(
        JSONB, nullable=False, default=list, server_default="[]"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), onupdate=func.now())


class AgentRiskSignal(Base):
    """위험 표현 감지 신호 — 상담사 전용(D4: 내담자에게 감지 사실 비노출).

    excerpt 는 상담사가 판단하는 데 필요한 **감지된 문장만**(최대 200자) 담는다.
    같은 (내담자, 상담사, level) 조합이 30분 안에 재발하면 새 행을 만들지 않고,
    레벨이 올라가면(watch→high) 새 신호를 만든다.
    """

    __tablename__ = "agent_risk_signals"
    __table_args__ = (
        Index("ix_agent_risk_signals_owner_created", "counselor_id", "created_at"),
        Index("ix_agent_risk_signals_client_level", "client_id", "level", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    client_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    counselor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    # 감지의 근거가 된 내담자 메시지
    message_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("agent_messages.id", ondelete="SET NULL"), nullable=True
    )
    # watch | high
    level: Mapped[str] = mapped_column(String(10), nullable=False)
    excerpt: Mapped[str] = mapped_column(Text, nullable=False)
    # open(미처리) → handled(상담사 처리 선언)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="open", server_default="open"
    )
    handled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class AgentMemoryItem(Base):
    """SDD-198: 루시 전용 구조화 장기기억 — 사실·선호·관계·감정 트렌드.

    내담자별로 (category, key) 당 최신 1건을 유지한다. 루시가 대화에서 인출해
    "기억하는 동반자"가 되는 기반이다. 상담사 전용 프로파일(AgentProfileItem)과 달리
    루시 대화 컨텍스트에 직접 노출된다(내담자 본인 것만).
    """

    __tablename__ = "agent_memory_items"
    __table_args__ = (
        UniqueConstraint("client_id", "category", "key", name="uq_agent_memory_item_key"),
        Index("ix_agent_memory_items_client", "client_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    client_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    # fact(사실) | preference(선호) | relation(관계) | emotion_trend(감정 트렌드)
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    # 주제명 — 예: "자녀", "직업", "선호 대화 방식"
    key: Mapped[str] = mapped_column(String(80), nullable=False)
    # 내용 — 예: "이서(딸), 이준(아들)"
    value: Mapped[str] = mapped_column(Text, nullable=False)
    # 근거 메시지 id 목록(JSON 배열). 원문은 저장하지 않는다.
    evidence: Mapped[list] = mapped_column(
        JSONB, nullable=False, default=list, server_default="[]"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), onupdate=func.now())
