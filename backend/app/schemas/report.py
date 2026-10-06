"""AI 리포트 Pydantic 스키마"""

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, EmailStr, Field

from app.schemas.eeg import HRVMotionSummary


class ReportCreate(BaseModel):
    type: str = "counselor"  # counselor | client
    # FUNC-02: client 리포트는 대상 참가자를 명시한다(미지정 시 400).
    participant_id: str | None = None


class ReportUpdate(BaseModel):
    content: dict[str, Any] | None = None


class ReportApprovalRequest(BaseModel):
    note: str | None = None


class ReportCommentUpdate(BaseModel):
    """SDD-087: 상담사 코멘트 갱신 — null = 삭제, 1000자 초과는 422."""

    comment: str | None = Field(default=None, max_length=1000)


class ReportCommentDraftResponse(BaseModel):
    """SDD-087: AI 코멘트 초안 — source 는 llm(Gemini) | rule(템플릿 폴백)."""

    draft: str
    source: str


class ReportEmailResendRequest(BaseModel):
    email: EmailStr


class ReportEmailResendResponse(BaseModel):
    success: bool


class ReportAutoApproveSetting(BaseModel):
    enabled: bool


class ReportResponse(HRVMotionSummary):
    """몸 지표 평균·심박수 최소/최대는 공통 요약 계약을 상속한다."""

    # 리포트 미생성 세션 합성 노출 시 id 는 null 이다(목록에서 '생성 실패' 상태로 표시).
    id: str | None = None
    session_id: str
    # SDD-027: 게스트 리포트는 user_id 가 없다(participant_id 로 소유)
    user_id: str | None = None
    participant_id: str | None = None
    report_email: str | None = None
    type: str
    # SDD-027: 리포트 상태머신(pending_analysis/pending_review/completed/error) + 데이터 신뢰도
    status: str | None = None
    # SDD-095: 생성 진행 상태(pending/processing/ready/partial) — 승인 상태와 독립 축
    generation_status: str = "pending"
    # SDD-101: 생성 실패 사유·시작 시각 — /reports 목록에서 로그로 노출
    generation_error: str | None = None
    generation_started_at: datetime | None = None
    data_credibility: str | None = None
    content: dict[str, Any] = Field(default_factory=dict)
    pdf_url: str | None = None
    sent_at: datetime | None = None
    is_read: bool = False
    created_at: datetime | None = None
    session_title: str | None = None
    counselor_name: str | None = None
    session_type: str | None = None
    scheduled_at: datetime | None = None
    participant_name: str | None = None
    gender: str | None = None
    birth_date: date | None = None
    is_guest: bool | None = None
    # SDD-096: 셀프 체크인(주관 상태) — 내담자 리포트는 본인 슬롯(scope=participant),
    # 상담사 리포트는 세션 전체(scope=session). 미입력이면 None.
    subjective_state: dict[str, Any] | None = None


class ReportListResponse(BaseModel):
    reports: list[ReportResponse]
    total: int
    page: int | None = None
    limit: int | None = None


# ── SDD-095: 리포트 생성 진행 상태 계약 ────────────────────────────────
class ReportProgressStep(BaseModel):
    """스텝퍼 1스텝 — key: save|stt|summary|ready, state: pending|active|done|skipped|failed."""

    key: str
    label: str
    state: str


class ReportStatusResponse(BaseModel):
    """세션의 리포트 생성 진행 상태 — REST 조회/Socket.IO `report:progress` 공통 계약."""

    session_id: str
    # pending | processing | ready | partial
    generation_status: str
    # 현재 진행 단계 (save | stt | summary | ready)
    stage: str
    # 0~100 진행률
    progress: int
    # partial/차단 사유 (mic_off | low_confidence | no_transcript | stt_failed | summary_failed | report_failed)
    reason: str | None = None
    # 승인 게이트 상태(참고) — 리포트별 상태가 갈리면 null
    report_status: str | None = None
    steps: list[ReportProgressStep] = Field(default_factory=list)
    updated_at: datetime | None = None
