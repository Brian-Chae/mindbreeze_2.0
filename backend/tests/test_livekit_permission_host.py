"""발언권 부여 시 LiveKit 권한 갱신이 서버 내부 API 주소를 쓰는지 검증(공개 wss 주소는 /livekit 접두사 때문에 404)."""
from unittest.mock import AsyncMock, MagicMock, patch

from app.config import settings
from app.services import class_participation_service as cps


def test_publish_permission_uses_server_api_url(monkeypatch):
    monkeypatch.setattr(settings, "livekit_host", "wss://api.example.com/livekit")
    monkeypatch.setattr(settings, "livekit_api_url", "http://127.0.0.1:7880")
    client = MagicMock()
    client.room.update_participant = AsyncMock()
    client.aclose = AsyncMock()
    with patch("livekit.api.LiveKitAPI", return_value=client) as ctor:
        assert cps.apply_livekit_publish_permission("room", "pid", True) is True
    assert ctor.call_args.args[0] == "http://127.0.0.1:7880"
