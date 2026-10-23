"""SDD-237 클래스 리포트·요약 응답 스키마 (plan.md §4 계약)."""

from datetime import datetime

from pydantic import BaseModel


class NotePromptClaimResponse(BaseModel):
    show: bool


class NotePromptDismissResponse(BaseModel):
    dismissed_at: datetime


class NotePromptSettingResponse(BaseModel):
    enabled: bool


class NotePromptSettingUpdate(BaseModel):
    enabled: bool
