"""AI 기록 관련 Pydantic 스키마"""

from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, Field, field_validator, model_validator


class AudioStartRequest(BaseModel):
    # SDD-085: consent_audio=false 는 400이 아니라 "마이크 오프(수동 기록)" 선언 —
    # SessionRecord.status='manual' 기록 후 200 응답
    consent_audio: bool = True


class AudioStartResponse(BaseModel):
    session_id: str
    # idle/recording/processing/completed/failed/manual (SDD-085: manual 추가)
    status: str
    started_at: datetime | None = None


class ChunkUploadResponse(BaseModel):
    chunk_index: int
    received_bytes: int
    total_chunks: int


class AudioStopResponse(BaseModel):
    session_id: str
    status: str
    total_chunks: int
    ended_at: datetime | None = None


class VideoStartRequest(BaseModel):
    consent_video: bool = True


class VideoStartResponse(BaseModel):
    session_id: str
    status: str
    started_at: datetime | None = None


class VideoStopResponse(BaseModel):
    session_id: str
    status: str
    total_chunks: int
    ended_at: datetime | None = None


class TranscriptSegment(BaseModel):
    speaker: str
    text: str
    start: float
    end: float


class TranscriptResponse(BaseModel):
    session_id: str
    status: str
    segments: list[TranscriptSegment] = Field(default_factory=list)
    raw_text: str | None = None


class RecordResponse(BaseModel):
    session_id: str
    status: str
    transcript: str | None = None
    ai_summary: dict[str, Any] = Field(default_factory=dict)
    counselor_notes: str | None = None
    markers: list[dict[str, Any]] = Field(default_factory=list)
    is_edited: bool = False
    edit_history: list[dict[str, Any]] = Field(default_factory=list)
    # SDD-096: 셀프 체크인(주관 상태) — 상담사(호스트)는 세션 전체(scope=session),
    # 참여자는 본인 슬롯만(scope=participant). 미입력이면 None.
    subjective_state: dict[str, Any] | None = None


class RecordUpdateRequest(BaseModel):
    counselor_notes: str | None = None
    ai_summary: dict[str, Any] | None = None


# ---------------------------------------------------------------------------
# SDD-096: 세션 직후 1탭 셀프 체크인 (SAM 2축 5단계 + 한 줄 소감)
# ---------------------------------------------------------------------------


class CheckinRequest(BaseModel):
    """종료 화면 1탭 체크인 요청.

    - phase: 'after'(기본, 세션 직후) / 'before'(수업 전 예상)
    - arousal(각성)·valence(정서): 각 1~5 단계. 한 축만 남겨도 저장한다(null 보존).
    - note: 선택형 한 줄 소감(최대 200자).
    - 소유 증명: 로그인 회원은 액세스 토큰으로 본인 참여자를 증명하고,
      게스트는 participant_id + participant_token 이 필요하다.
    """

    phase: Literal["before", "after"] = "after"
    arousal: int | None = Field(default=None, ge=1, le=5)
    valence: int | None = Field(default=None, ge=1, le=5)
    note: str | None = Field(default=None, max_length=200)
    participant_id: str | None = None
    participant_token: str | None = None

    @field_validator("note")
    @classmethod
    def _normalize_note(cls, value: str | None) -> str | None:
        """공백만 있는 소감은 None 으로 정규화한다(빈 문자열 저장 금지)."""
        if value is None:
            return None
        trimmed = value.strip()
        return trimmed or None

    @model_validator(mode="after")
    def _require_axis(self) -> "CheckinRequest":
        """두 축이 모두 없으면 체크인할 내용이 없다 — 422."""
        if self.arousal is None and self.valence is None:
            raise ValueError("각성·정서 중 최소 한 축을 선택해 주세요")
        return self


class SubjectiveSlot(BaseModel):
    """한 시점(수업 전/후)의 주관 값 — null 보존."""

    arousal: int | None = Field(default=None, ge=1, le=5)
    valence: int | None = Field(default=None, ge=1, le=5)
    note: str | None = None
    recorded_at: datetime | None = None


class CheckinResponse(BaseModel):
    session_id: str
    participant_id: str | None = None
    phase: str
    # {"scope": "participant", "before": {...}|None, "after": {...}|None}
    subjective_state: dict[str, Any]
