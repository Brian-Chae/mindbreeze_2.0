"""SDD-071 데이터 내보내기 API 계약."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class DataExportCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    include: list[Literal['features', 'report']] = Field(default_factory=lambda: ['features', 'report'], min_length=1, max_length=2)
    purpose: str = Field(min_length=2, max_length=500)

    @field_validator('purpose')
    @classmethod
    def validate_purpose(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError('활용 목적을 입력해 주세요')
        return value

    @field_validator('include')
    @classmethod
    def normalize_include(cls, value: list[str]) -> list[str]:
        return sorted(set(value))


class DataExportStatus(BaseModel):
    export_id: str
    status: Literal['queued', 'preparing', 'ready', 'ready_with_warnings', 'failed', 'expired', 'cancelled']
    stage: str
    target_count: int = 1
    completed_count: int
    size_bytes: int | None
    warnings: list[str]
    error_code: str | None
    expires_at: datetime
    snapshot_at: datetime | None
    status_url: str


class DataExportDownload(BaseModel):
    url: str
    expires_at: datetime
