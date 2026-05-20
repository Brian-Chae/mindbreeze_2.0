"""AI 기록 관련 Pydantic 스키마"""

from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field


class AudioStartRequest(BaseModel):
    consent_audio: bool = True


class AudioStartResponse(BaseModel):
    session_id: str
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


class RecordUpdateRequest(BaseModel):
    counselor_notes: str | None = None
    ai_summary: dict[str, Any] | None = None
