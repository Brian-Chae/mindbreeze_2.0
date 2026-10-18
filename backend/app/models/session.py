"""Session & SessionParticipant Models"""

import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import String, Integer, Date, DateTime, Text, Boolean, ForeignKey, UniqueConstraint, Index, func, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Session(Base):
    __tablename__ = "sessions"
    # SDD-095: 일반 클래스 목록/템플릿 목록 조회를 (host_id, is_template) 로 좁힌다.
    __table_args__ = (
        Index("ix_sessions_host_is_template", "host_id", "is_template"),
        # SDD-214: 부모 안 회차 번호 유일. NULL 은 서로 다르므로 템플릿·부모 없는 행은 영향 없다.
        # 부모 정확히 하나(ck_sessions_one_parent)와 진행자 복합 FK 는 PG 마이그레이션(055)에만 있다(ORM 미선언).
        UniqueConstraint("class_id", "seq", name="uq_sessions_class_seq"),
        UniqueConstraint("counseling_relationship_id", "seq", name="uq_sessions_relationship_seq"),
        # SDD-209(B4): 4자리 코드는 활성(입장 가능) 클래스 사이에서만 유일하다. 종료·취소·숨김·템플릿은
        # 제외하므로 코드 값이 재사용될 수 있고, 과거 값은 행에 그대로 보존된다.
        Index(
            "uq_sessions_active_access_code",
            "access_code",
            unique=True,
            postgresql_where=text(
                "access_code IS NOT NULL AND is_template = false AND hidden_at IS NULL "
                "AND status NOT IN ('completed', 'cancelled')"
            ),
            sqlite_where=text(
                "access_code IS NOT NULL AND is_template = 0 AND hidden_at IS NULL "
                "AND status NOT IN ('completed', 'cancelled')"
            ),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # SDD-028: 반복 실행 회차 식별자(경량 SessionRun). 기본값 = session_id.
    # 같은 수업 정의를 "새 실행(명시적)"으로 열 때만 새 run_id 를 발급하고,
    # 재접속·pause/resume·이어하기는 기존 run_id 를 유지한다. EEG/리포트는 여전히
    # session_id 기반이므로 run_id 는 조회·집계의 그룹핑 키로만 활용한다(대규모 마이그레이션 회피).
    # 직접 생성(테스트 등)에서 미지정 시 None 으로 남으며, 그 경우 session_id 를 회차로 간주한다.
    run_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    type: Mapped[str] = mapped_column(String(20), nullable=False)  # clinical, hypnosis, meditation, custom
    custom_type_name: Mapped[str | None] = mapped_column(String(30))  # type=custom 시 필수
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="scheduled")
    # SDD-026: 상태 계약 버전. 상태전이(start/pause/resume/end/cancel)마다 +1 증가시켜
    # join snapshot / session_state_changed 이벤트의 중복·역순 처리를 가능케 한다.
    state_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    host_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    # SDD-015: 즉석 클래스는 일정 없이 생성되므로 nullable
    # 생성 당시 기관 귀속. 기존 데이터는 추정하여 보완하지 않는다.
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True, index=True
    )
    organization_attribution_known: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # SDD-015: 참여자가 입력하는 6자리 클래스 코드 (생성 시 자동 발급)
    # SDD-209(B4): 로그인 없는 공통 4자리 숫자 코드(문자열, 선행 0 보존). 활성 클래스 사이에서만 유일.
    # 길이 6 은 과거 6자리 값 보존용 — 과거 값은 입장에 쓰이지 않는다.
    access_code: Mapped[str | None] = mapped_column(String(6), index=True)
    # SDD-209(B4/DS-1): 재발급 시 이전 6자리 값을 보존하는 컬럼(읽기 전용 보존, 입장 불가).
    legacy_access_code: Mapped[str | None] = mapped_column(String(6), nullable=True)
    # SDD-088: 클래스 오픈(대기실 개방) 시각 — 대기 경과 표시·오픈→시작 소요 지표용
    opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_min: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str | None] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text)
    max_participants: Mapped[int] = mapped_column(Integer, default=1)
    # 진행 형태 설정
    location_type: Mapped[str] = mapped_column(String(20), nullable=False, default="offline")  # online, offline
    # SDD-188(D8): 오프라인 클래스의 실제 방문 주소. 내담자 AI 비서의 길찾기 CTA 가 이 값을 쓴다.
    # 생성 시 미지정이면 서버가 기관 주소 → 상담사 프로필 주소 순으로 기본값을 채운다.
    # 온라인 클래스는 항상 null(장소 개념이 없다).
    location_address: Mapped[str | None] = mapped_column(String(300), nullable=True)
    participant_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="one_on_one")  # one_on_one, group
    linkband_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="none")  # none, required, optional
    # 온라인(WebRTC) 설정 — location_type=online 시 자동 생성
    webrtc_room_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    sfu_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # AI 클래스 분석 — 영상/음성 녹화 여부(기본 On). Off 시 해당 미디어 리포트 미생성
    record_audio: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    record_video: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    # 클래스 실시간 채팅 사용 여부 — 상담사가 클래스별로 켜고 끈다(기본 off).
    # 세션 채팅방(ChatRoom.room_type="session")은 클래스 생성 시 자동 개설되며,
    # chat_enabled=False 이면 참여자(비 host)의 발신이 차단된다(host 는 항상 가능).
    chat_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # SDD-095: 클래스 템플릿 여부 — 상담사가 반복 클래스를 빠르게 다시 만들기 위한 "유형 설정 저장본".
    # is_template=True 인 행은 실제 진행 대상이 아니다: 일정·참여코드·채팅방이 없고 일반 클래스
    # 목록에서 제외된다. 복제(duplicate) 산출물은 항상 is_template=False 인 실제 클래스다.
    is_template: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # SDD-097: 예약 클래스 사전 안내(리마인더) 시점 목록 — 시작 시각 기준 N분 전 정수 목록.
    # 예: [1440, 60] = 24시간 전·1시간 전. 빈 목록("[]") = 리마인더 끔.
    # 일정(scheduled_at) 없는 즉석 클래스에서는 예약 시점이 없어 발송되지 않는다.
    reminder_offsets: Mapped[list] = mapped_column(
        JSONB, nullable=False, default=list, server_default="[]"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # SDD-209(B1): 일반 클래스 삭제는 숨김(보존 전환). 값이 있으면 모든 ORM 조회에서 제외된다
    # (app/core/database.py 의 do_orm_execute 필터). 원본은 보관 스위프/플랫폼 관리자만 삭제한다.
    hidden_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # SDD-214: 세션의 상위. 비템플릿 세션은 둘 중 정확히 하나를 가진다(DB CHECK). 템플릿은 둘 다 NULL.
    class_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("classes.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    counseling_relationship_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("counseling_relationships.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    # 부모 안의 회차 번호(1부터). 재사용하지 않는다.
    seq: Mapped[int | None] = mapped_column(Integer, nullable=True)
    session_kind: Mapped[str] = mapped_column(String(10), nullable=False, default="regular", server_default="regular")  # regular, makeup
    # 진행 강사 상태: assigned, pending_ack, needs_reassign. host_id 는 항상 NOT NULL.
    host_state: Mapped[str | None] = mapped_column(String(20), nullable=True)

    host = relationship("User", back_populates="hosted_sessions", foreign_keys=[host_id])
    participants = relationship(
        "SessionParticipant", back_populates="session", cascade="all, delete-orphan",
        foreign_keys="SessionParticipant.session_id",
    )
    record = relationship("SessionRecord", back_populates="session", uselist=False, cascade="all, delete-orphan")
    eeg_records = relationship("EEGRecord", back_populates="session", cascade="all, delete-orphan")
    reports = relationship("Report", back_populates="session", cascade="all, delete-orphan")


class SessionParticipant(Base):
    __tablename__ = "session_participants"

    # SDD-015: 게스트는 user_id가 NULL이므로 복합 PK를 유지할 수 없다.
    # 대리 키(id)를 PK로 두고 (session_id, user_id)는 UNIQUE 제약으로 강등한다.
    # PostgreSQL의 UNIQUE는 NULL을 서로 다른 값으로 취급하므로 게스트 중복 참여가 허용된다.
    __table_args__ = (
        UniqueConstraint("session_id", "user_id", name="uq_session_participant_user"),
        # SDD-214: 같은 회차에 같은 멤버십의 출석 행은 최대 1개(member_id NULL 은 영향 없음).
        UniqueConstraint("session_id", "member_id", name="uq_session_participants_session_member"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    # SDD-015: 회원가입 없이 참여하는 게스트의 표시 이름 (user_id가 NULL일 때만 사용)
    guest_name: Mapped[str | None] = mapped_column(String(100))
    gender: Mapped[str | None] = mapped_column(String(20), nullable=True)
    birth_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # SDD-029: 인증 완료된 리포트 수신 이메일과 실제 발송 결과
    report_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    report_email_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    report_email_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    joined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())
    band_connected: Mapped[bool] = mapped_column(Boolean, default=False)  # LINK BAND 실연결 여부
    # SDD-026: 밴드 배터리(%) 최신값. null 보존(미상 시 None, 0 치환 금지). device_status_changed 이벤트로 전달.
    band_battery: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    linkband_device_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    webrtc_peer_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    consent_audio: Mapped[bool] = mapped_column(Boolean, default=False)
    consent_eeg: Mapped[bool] = mapped_column(Boolean, default=False)
    is_waitlisted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    waitlist_position: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # SDD-094: 발언권 관리 — 회원 손들기/상담사 발언권 부여 상태.
    # online 그룹(≤20) 회원은 기본 뮤트이며 speaking=True 일 때만 송신(can_publish) 허용.
    raise_hand: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    speaking: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # SDD-209(B1): 호스트의 참여자 제거는 행 삭제가 아니라 제거 시각 기록(보존 전환) —
    # 행을 지우면 FK CASCADE 로 EEG raw·지표·리포트가 영구 삭제된다. 값이 있으면 모든 ORM 조회에서 제외.
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # SDD-209(B2): 리포트 반영 선택(P2). 기본 제외 — 명시 선택 시에만 포함. consent_audio/eeg 와 별개.
    report_included: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # 고지 확인 증빙(선택 이력과 분리 저장): 마지막으로 확인한 시각과 고지 문구 버전.
    report_notice_ack_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    report_notice_version: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # SDD-209(B5a): 입장 자격 폐기용 버전 — 자격(JWT)의 ver 와 일치해야 유효. 올리면 이전 자격이 모두 무효.
    entry_ver: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # SDD-209(B6): 대기 취소 시각. 행을 지우지 않고 기록만 한다 — 값이 있으면 removed_at 과 같이 모든 ORM 조회에서
    # 제외(정원·순번·승격·토큰·상태 접근 대상 아님). 재대기하면 같은 행을 되살려 NULL 로 되돌리고 끝 순번을 준다.
    waitlist_cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # SDD-209(B12): 비회원 개인정보(이름·성별·생년월일·이메일)를 보관 스위프가 비운 시각. 행·세션 참조는 유지.
    pii_scrubbed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # SDD-209(B9/BE-11): 코드/초대 입장으로 실제 클래스에 들어온 최초 시각. 초대만 받고 들어오지 않았으면 NULL.
    # (이 컬럼 도입 전 참여자는 NULL — 입장 여부를 알 수 없다.) 이후 값은 바뀌지 않는다.
    entered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # SDD-214: 출석 모델. member_id(명상 멤버십) 와 guest_client_id(상담 비회원) 는 동시에 채우지 않는다(DB CHECK).
    # Phase 4 전까지 쓰는 코드가 없어 비어 있다.
    member_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("class_members.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    guest_client_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("counseling_guests.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    # expected, attended, absent, excused, withdrawn
    attendance_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # regular, makeup, guest_pass
    attendance_kind: Mapped[str] = mapped_column(String(10), nullable=False, default="regular", server_default="regular")
    makeup_for_session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True
    )
    # system, host, self
    attendance_marked_by: Mapped[str | None] = mapped_column(String(20), nullable=True)
    absence_reason: Mapped[str | None] = mapped_column(String(200), nullable=True)

    session = relationship("Session", back_populates="participants", foreign_keys=[session_id])


class SessionReminderLog(Base):
    """SDD-097: 리마인더 발송 로그 — (세션, 시점, 수신자, 채널) 단위로 중복 발송을 막는다.

    예약 클래스의 사전 안내는 ETA 태스크로 T-24h/T-1h 등에 발송되는데, 워커 재시도·스윕
    폴백으로 같은 시점이 두 번 실행될 수 있다. 이 로그에 이미 기록된 (session, offset,
    user, channel) 조합은 재발송하지 않는다.
    """

    __tablename__ = "session_reminder_logs"
    __table_args__ = (
        UniqueConstraint(
            "session_id", "offset_min", "user_id", "channel",
            name="uq_session_reminder_delivery",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # 수신자 회원. 게스트(비회원)는 발송 대상이 아니므로 nullable 로 둔다.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True
    )
    # 리마인더 시점(시작 N분 전). scheduled_at - offset_min 이 발송 예정 시각.
    offset_min: Mapped[int] = mapped_column(Integer, nullable=False)
    channel: Mapped[str] = mapped_column(String(10), nullable=False)  # email | ws
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="sent")  # sent | failed
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ReportChoiceEvent(Base):
    """SDD-209(B2): 리포트 반영 선택 변경 이력(불변, append-only).

    세션/참여자 삭제·스크럽 뒤에도 이력이 남도록 FK 없이 UUID 값만 보관한다.
    고지 확인 증빙(시각/버전)은 session_participants 의 별도 컬럼에 둔다(RV2-7: 분리 저장).
    """

    __tablename__ = "report_choice_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    participant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    previous_included: Mapped[bool] = mapped_column(Boolean, nullable=False)
    new_included: Mapped[bool] = mapped_column(Boolean, nullable=False)
    # 변경 주체: self(참여자 본인). 후속 확장 대비 문자열.
    actor_kind: Mapped[str] = mapped_column(String(20), nullable=False, default="self")
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
