"""report:progress 동기 emit — 반복 호출 시 loop 충돌 없이 올바른 room/namespace/payload 로 emit."""

from datetime import datetime, timezone
from unittest.mock import MagicMock

from app.ws import sync_emit


def _payload():
    return {
        "generation_status": "processing",
        "stage": "summary",
        "progress": 70,
        "updated_at": datetime.now(timezone.utc),
    }


def test_연속_호출이_예외없이_올바른_인자로_emit_한다(monkeypatch):
    manager = MagicMock()
    monkeypatch.setattr(sync_emit, "_get_manager", lambda: manager)

    for _ in range(3):
        assert sync_emit.emit_report_progress_sync("sid-1", _payload()) is True

    assert manager.emit.call_count == 3
    args, kwargs = manager.emit.call_args
    assert args[0] == "report:progress"
    assert kwargs["room"] == "session:sid-1"
    assert kwargs["namespace"] == "/record"
    assert args[1]["session_id"] == "sid-1"
    assert args[1]["progress"] == 70
    assert isinstance(args[1]["updated_at"], str)


def test_record_status_emit(monkeypatch):
    manager = MagicMock()
    monkeypatch.setattr(sync_emit, "_get_manager", lambda: manager)
    assert sync_emit.emit_record_status_sync("sid-2", "failed", {"reason": "x"}) is True
    args, kwargs = manager.emit.call_args
    assert args[0] == "record_status"
    assert args[1] == {"session_id": "sid-2", "status": "failed", "detail": {"reason": "x"}}
    assert kwargs == {"room": "session:sid-2", "namespace": "/record"}


def test_emit_실패는_예외없이_False(monkeypatch):
    manager = MagicMock()
    manager.emit.side_effect = RuntimeError("redis down")
    monkeypatch.setattr(sync_emit, "_get_manager", lambda: manager)
    assert sync_emit.emit_report_progress_sync("sid-3", _payload()) is False


def test_redis_없으면_False(monkeypatch):
    monkeypatch.setattr(sync_emit, "_manager", None)
    # pytest 환경에서는 manager 를 만들지 않는다
    assert sync_emit.emit_report_progress_sync("sid-4", _payload()) is False
