"""SDD-190: 디바이스 토큰 등록/해지 Pydantic 스키마.

필드명·enum 값은 plan.md §Contract 와 1:1 대응한다(앱이 그대로 소비). 변경 금지.
"""

from typing import Literal

from pydantic import BaseModel, Field

DevicePlatform = Literal["ios", "android"]


class DeviceRegisterRequest(BaseModel):
    token: str = Field(min_length=1, max_length=512)
    platform: DevicePlatform
    app_version: str | None = Field(default=None, max_length=50)
    device_label: str | None = Field(default=None, max_length=100)


class DeviceRegisterResponse(BaseModel):
    id: str
    token: str
    platform: DevicePlatform
