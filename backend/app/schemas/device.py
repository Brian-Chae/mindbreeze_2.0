"""SDD-190/192: 디바이스 토큰 등록/해지 Pydantic 스키마.

필드명·enum 값은 plan.md §Contract 와 1:1 대응한다(앱이 그대로 소비). 변경 금지.
SDD-192: platform="web" 은 token=구독 endpoint + keys(p256dh, auth) 필수.
"""

from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field, model_validator

DevicePlatform = Literal["ios", "android", "web"]

# 브라우저 푸시 서비스 도메인(접미사). 서버가 endpoint 로 직접 POST 하므로 임의 URL 은 SSRF 가 된다.
WEB_PUSH_HOST_SUFFIXES = (
    "fcm.googleapis.com",  # Chrome/Edge/Opera 등 Chromium
    "android.googleapis.com",
    "push.services.mozilla.com",  # Firefox
    "push.apple.com",  # Safari
    "notify.windows.com",  # Edge(WNS)
)


def is_allowed_web_push_endpoint(endpoint: str) -> bool:
    """https + 허용된 푸시 서비스 도메인(정확히 일치 또는 서브도메인)만 통과."""
    try:
        parsed = urlparse(endpoint)
    except ValueError:
        return False
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not host or parsed.username or parsed.password:
        return False
    if parsed.port not in (None, 443):
        return False
    return any(host == s or host.endswith("." + s) for s in WEB_PUSH_HOST_SUFFIXES)


class WebPushKeys(BaseModel):
    p256dh: str = Field(min_length=1, max_length=255)
    auth: str = Field(min_length=1, max_length=64)


class DeviceRegisterRequest(BaseModel):
    token: str = Field(min_length=1, max_length=512)
    platform: DevicePlatform
    keys: WebPushKeys | None = None
    app_version: str | None = Field(default=None, max_length=50)
    device_label: str | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def _validate_web(self) -> "DeviceRegisterRequest":
        if self.platform == "web":
            if self.keys is None:
                raise ValueError("웹 푸시 구독에는 keys 가 필요합니다")
            if not is_allowed_web_push_endpoint(self.token):
                raise ValueError("허용되지 않은 푸시 endpoint 입니다")
        return self


class DeviceRegisterResponse(BaseModel):
    id: str
    token: str
    platform: DevicePlatform


class WebPushPublicKeyResponse(BaseModel):
    public_key: str
