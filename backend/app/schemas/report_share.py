"""리포트 공유 메일 스키마 (SDD-327 T11).

- 요청: 받는 주소 1~3개(중복 제거·소문자), 책 PDF 첨부, 메시지 ≤200자.
- 응답/이력: 주소는 마스킹 표기(a***@d***.com)만 노출한다. 원문 노출 금지.
"""

import re
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

MAX_RECIPIENTS = 3
MAX_MESSAGE_LEN = 200
MAX_SENDER_NAME_LEN = 20

ShareStatus = Literal["queued", "sent", "failed"]

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def mask_recipient(email: str) -> str:
    """주소 마스킹: 로컬·도메인 첫 글자만 남김 (예: a***@d***.com)."""
    if not email or "@" not in email:
        return "***"
    local, _, domain = email.strip().rpartition("@")
    host, dot, tld = domain.rpartition(".")
    if not local or not domain:
        return "***"
    if not dot:
        return f"{local[0]}***@{domain[0]}***"
    return f"{local[0]}***@{(host or domain)[0]}***.{tld}"


class ReportShareRequest(BaseModel):
    recipients: list[str] = Field(min_length=1, max_length=MAX_RECIPIENTS)
    attach_pdf: bool = True
    message: str | None = Field(default=None, max_length=MAX_MESSAGE_LEN)
    # 보내는 사람 표시 이름(선택, 20자). 비면 서비스가 대체 문구를 쓴다. 이력에는 저장하지 않는다.
    sender_name: str | None = Field(default=None, max_length=MAX_SENDER_NAME_LEN)

    @field_validator("sender_name")
    @classmethod
    def _strip_sender_name(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None

    @field_validator("recipients")
    @classmethod
    def _normalize_recipients(cls, v: list[str]) -> list[str]:
        out: list[str] = []
        for raw in v:
            addr = raw.strip().lower()
            # 형식 오류는 여기서 거르지 않는다 — 서비스가 그 주소만 rejected(invalid)로 응답한다.
            if not addr:
                raise ValueError("빈 주소는 보낼 수 없습니다")
            if addr not in out:
                out.append(addr)
        return out

    @field_validator("message")
    @classmethod
    def _strip_message(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None


class ReportShareResponse(BaseModel):
    accepted_count: int
    attached: bool
    delivery_delayed: bool = False
    daily_remaining: int | None = None
    events: list["ReportShareHistoryItem"] = []


class ReportShareHistoryItem(BaseModel):
    id: uuid.UUID
    recipient_masked: str
    attached: bool
    status: ShareStatus
    created_at: datetime
    sent_at: datetime | None = None

    model_config = {"from_attributes": True}


class ReportShareHistoryResponse(BaseModel):
    items: list[ReportShareHistoryItem]


ReportShareResponse.model_rebuild()
