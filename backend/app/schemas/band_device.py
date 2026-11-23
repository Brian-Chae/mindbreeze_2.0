"""SDD-326 — 밴드 시리얼 보고·역조회 계약 (FE/BE 공용 정본).

- 시리얼 = BLE 광고 이름(예 ``LXB-0263008A``). 정규화: trim + 대문자.
- 실기기 이름 형식은 미확인(T1) → ``LXB-`` + 16진수 8자리는 표준형, 그 외 ``LXB`` 접두 이름도 허용(영숫자·``._:-``, 최대 64자).
- 이메일 등 개인정보 형태(``@``)·공백·한글·스크립트 문자열은 422.
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator

BandPlatform = Literal["web", "android", "ios"]

SERIAL_PATTERN = re.compile(r"^LXB[A-Za-z0-9._:-]{0,61}$", re.IGNORECASE)
SERIAL_STANDARD_PATTERN = re.compile(r"^LXB-[0-9A-F]{8}$")  # 대표 형식(정규화 후 대문자 기준)
FIRMWARE_PATTERN = re.compile(r"^[A-Za-z0-9._+-]{1,32}$")
# SDD-332: 앱 빌드·OS 정보는 부가 정보 — 형식이 안 맞으면 422 대신 버리고(None) 시리얼 보고는 살린다.
APP_VERSION_PATTERN = re.compile(r"^[A-Za-z0-9._+-]{1,32}$")
APP_BUILD_PATTERN = re.compile(r"^[0-9A-Za-z._-]{1,16}$")
OS_NAME_PATTERN = re.compile(r"^[A-Za-z0-9 ._-]{1,16}$")
OS_VERSION_PATTERN = re.compile(r"^[A-Za-z0-9._+-]{1,32}$")
DEVICE_MODEL_PATTERN = re.compile(r"^[A-Za-z0-9 ._,+/()-]{1,64}$")


def _clean_optional(v: str | None, pattern: re.Pattern[str]) -> str | None:
    if v is None:
        return None
    n = v.strip()
    if not n or not pattern.fullmatch(n):
        return None
    return n


def normalize_serial(value: str) -> str:
    """trim + 대문자. 검증은 하지 않는다(검증은 validate_serial)."""
    return value.strip().upper()


class BandDeviceReportRequest(BaseModel):
    """PUT /sessions/{session_id}/entry/band-device 요청 본문."""

    model_config = ConfigDict(extra="forbid")

    serial: str
    firmware: str | None = None
    platform: BandPlatform
    app_version: str | None = None
    app_build: str | None = None
    os_name: str | None = None
    os_version: str | None = None
    device_model: str | None = None

    @field_validator("app_version", mode="before")
    @classmethod
    def _app_version(cls, v):
        return _clean_optional(v if isinstance(v, str) else None, APP_VERSION_PATTERN)

    @field_validator("app_build", mode="before")
    @classmethod
    def _app_build(cls, v):
        return _clean_optional(str(v) if isinstance(v, (str, int)) else None, APP_BUILD_PATTERN)

    @field_validator("os_name", mode="before")
    @classmethod
    def _os_name(cls, v):
        return _clean_optional(v if isinstance(v, str) else None, OS_NAME_PATTERN)

    @field_validator("os_version", mode="before")
    @classmethod
    def _os_version(cls, v):
        return _clean_optional(v if isinstance(v, str) else None, OS_VERSION_PATTERN)

    @field_validator("device_model", mode="before")
    @classmethod
    def _device_model(cls, v):
        return _clean_optional(v if isinstance(v, str) else None, DEVICE_MODEL_PATTERN)

    @field_validator("serial")
    @classmethod
    def _serial(cls, v: str) -> str:
        n = normalize_serial(v)
        if not SERIAL_PATTERN.fullmatch(n):
            raise ValueError("serial 형식이 올바르지 않습니다")
        return n

    @field_validator("firmware")
    @classmethod
    def _firmware(cls, v: str | None) -> str | None:
        if v is None:
            return None
        n = v.strip()
        if not n:
            return None
        if not FIRMWARE_PATTERN.fullmatch(n):
            raise ValueError("firmware 형식이 올바르지 않습니다")
        return n


class BandDeviceReportResponse(BaseModel):
    """멱등 — 같은 값을 다시 보고해도 동일 응답."""

    ok: bool = True


class BandDeviceUsageItem(BaseModel):
    """한 시리얼이 쓰인 (회차, 참가자) 한 건."""

    session_id: str
    session_title: str | None
    session_started_at: str | None  # ISO8601
    participant_id: str
    display_name: str | None
    firmware: str | None
    platform: str | None
    app_version: str | None = None
    app_build: str | None = None
    os_name: str | None = None
    os_version: str | None = None
    device_model: str | None = None
    first_seen_at: str
    last_seen_at: str
    is_current: bool          # 이 시리얼이 참가자의 현재 기기(linkband_device_id)인가
    stream_count: int         # 해당 참가자의 capture_stream 세대 수(회차 전체)
    superseded_count: int     # 그중 status='superseded' 인 수
    # 이 기기 사용 구간(서버 수신 시각 기준)의 측정 끊김. 참가자 시리얼이 1개면 회차 전체,
    # 교체 이력이 있으면 [first_seen_at, 다음 시리얼 first_seen_at) 구간. 근거: biosignal_gap_events.
    gap_count: int = 0
    gap_reasons: dict[str, int] = {}   # reason(packet_gap, ble_disconnect, ...) → 횟수


class BandDeviceUsageResponse(BaseModel):
    """GET /band-devices/{serial}/usage — 코치·기관관리자·플랫폼 관리자 전용."""

    serial: str
    items: list[BandDeviceUsageItem]
    truncated: bool = False   # 상한(200건) 초과 시 true
