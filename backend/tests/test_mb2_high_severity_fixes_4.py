"""MB2 상(上) 기능 오류 3건 회귀 테스트 (6차).

[1] WS-01 — Socket.IO `AsyncServer` 에 Redis manager(`AsyncRedisManager`)를 부착해
    Celery 워커의 emit 이 웹 프로세스 소켓으로 전달되게 한다. Redis 미연결(테스트) 환경에서는
    import·emit 이 예외 없이 graceful 하게(로그만) 동작해야 한다(기존 1213 passed 유지).
[2] VB-02 — `EEGFeatureBatchRequest.features` 에 max_length=5000 상한을 추가해
    서비스 배치 순회 DoS 를 차단한다.
[3] MB2-ORM-IDX-06 — `notification_outbox` (status, channel, available_at) 복합 인덱스를
    모델 + alembic 마이그레이션으로 추가한다.
"""

import asyncio
import logging
from pathlib import Path

import pytest
import socketio
from pydantic import ValidationError

from tests.test_sdd023_eeg_ingestion import (
    _create_group_class,
    _join_guest,
    _register,
)

_BACKEND_ROOT = Path(__file__).resolve().parents[1]


# ─────────────────────────────────────────────────────────────────────────────
# [1] WS-01 — Redis manager 부착 + Redis 미연결 graceful
# ─────────────────────────────────────────────────────────────────────────────


def test_ws_build_client_manager_redis_미연결이면_None(monkeypatch):
    """Redis 연결이 불가하면 manager 를 부착하지 않는다(인메모리 동작)."""
    from app import ws

    monkeypatch.setattr(ws, "_redis_reachable", lambda url, timeout=0.5: False)
    assert ws._build_client_manager() is None


def test_ws_build_client_manager_redis_url_미설정이면_None(monkeypatch):
    """redis_url 자체가 비어 있어도 예외 없이 None 을 반환한다."""
    from app import ws
    from app.config import settings

    monkeypatch.setattr(settings, "redis_url", "")
    assert ws._build_client_manager() is None


def test_ws_build_client_manager_연결가능하면_AsyncRedisManager(monkeypatch):
    """Redis 연결이 가능하면 channel='mindbreeze' AsyncRedisManager 를 부착한다."""
    from app import ws
    from app.config import settings

    # pytest 가드(테스트 격리)를 우회해 운영 기동과 동일한 경로를 검증한다
    monkeypatch.setattr(ws, "_running_under_pytest", lambda: False)
    monkeypatch.setattr(settings, "redis_url", "redis://localhost:6379/0")
    monkeypatch.setattr(ws, "_redis_reachable", lambda url, timeout=0.5: True)

    manager = ws._build_client_manager()
    assert isinstance(manager, socketio.AsyncRedisManager)
    assert ws.REDIS_CHANNEL == "mindbreeze"
    # Celery 워커와 웹 프로세스가 같은 채널을 써야 메시지가 전달된다
    assert manager.channel == "mindbreeze"


def test_ws_build_client_manager_pytest에서는_부착안함(monkeypatch):
    """pytest 실행 중에는 Redis 가 켜져 있어도 manager 를 부착하지 않는다(테스트 격리)."""
    from app import ws

    monkeypatch.setattr(ws, "_running_under_pytest", lambda: True)
    monkeypatch.setattr(ws, "_redis_reachable", lambda url, timeout=0.5: True)
    assert ws._build_client_manager() is None


def test_ws_running_under_pytest_감지():
    from app import ws

    # pytest 로 실행 중이므로 True 여야 한다(=Redis manager 미부착 경로를 탄다)
    assert ws._running_under_pytest() is True


def test_ws_sio_import_및_emit_redis_미연결시_예외없음():
    """Redis 미연결 환경에서 sio import 와 emit 이 예외 없이 동작한다."""
    from app.ws import sio

    assert sio is not None
    # 전달 대상 소켓이 없어도 예외 없이 반환되어야 한다
    asyncio.run(
        sio.emit(
            "record_status",
            {"session_id": "sid-x", "status": "merging"},
            room="session:sid-x",
            namespace="/record",
        )
    )


def test_broadcast_record_status_emit_실패해도_예외없이_로깅(monkeypatch, caplog):
    """Redis manager 장애(emit 예외) 시 예외를 전파하지 않고 경고 로그만 남긴다."""
    from app.ws import record_namespace

    class _FailingSio:
        async def emit(self, *args, **kwargs):
            raise ConnectionError("redis down")

    monkeypatch.setattr(record_namespace, "_get_sio", lambda: _FailingSio())

    with caplog.at_level(logging.WARNING):
        # 예외가 새어 나오면 안 된다
        asyncio.run(record_namespace.broadcast_record_status("sid-1", "transcribing"))

    assert any("emit 실패" in r.getMessage() for r in caplog.records)


def test_broadcast_report_progress_emit_실패해도_예외없이_로깅(monkeypatch, caplog):
    """report:progress emit 예외도 파이프라인을 깨지 않고 로깅만 한다."""
    from app.ws import record_namespace

    class _FailingSio:
        async def emit(self, *args, **kwargs):
            raise ConnectionError("redis down")

    monkeypatch.setattr(record_namespace, "_get_sio", lambda: _FailingSio())

    with caplog.at_level(logging.WARNING):
        asyncio.run(
            record_namespace.broadcast_report_progress(
                "sid-2", {"generation_status": "processing", "progress": 50}
            )
        )

    assert any("emit 실패" in r.getMessage() for r in caplog.records)


# ─────────────────────────────────────────────────────────────────────────────
# [2] VB-02 — EEGFeatureBatchRequest.features 상한
# ─────────────────────────────────────────────────────────────────────────────


def test_eeg_feature_batch_상한초과_스키마거부():
    from app.schemas.session import EEGFeatureBatchRequest

    with pytest.raises(ValidationError):
        EEGFeatureBatchRequest(features=[{"second_offset": i} for i in range(5001)])


def test_eeg_feature_batch_상한이내_허용():
    from app.schemas.session import EEGFeatureBatchRequest

    req = EEGFeatureBatchRequest(features=[{"second_offset": i} for i in range(5000)])
    assert len(req.features) == 5000


def test_eeg_feature_batch_상한초과_엔드포인트422(client):
    """API 계층도 상한 초과 배치를 422 로 거부한다(서비스 순회 진입 차단)."""
    counselor = _register(client, "vb02-host@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "VB02게스트")

    body = {
        "participant_id": pid,
        "features": [{"second_offset": i} for i in range(5001)],
    }
    res = client.post(f"/api/v1/sessions/{cls['id']}/features", json=body)
    assert res.status_code == 422, res.text


# ─────────────────────────────────────────────────────────────────────────────
# [3] MB2-ORM-IDX-06 — notification_outbox 복합 인덱스
# ─────────────────────────────────────────────────────────────────────────────


def test_notification_outbox_복합인덱스_모델등록():
    from app.models.notification_outbox import NotificationOutbox

    idx = next(
        (
            i
            for i in NotificationOutbox.__table__.indexes
            if i.name == "ix_notification_outbox_status_channel_available"
        ),
        None,
    )
    assert idx is not None, "notification_outbox 복합 인덱스가 모델에 등록되어야 함"
    assert [c.name for c in idx.columns] == ["status", "channel", "available_at"]


def test_notification_outbox_인덱스_마이그레이션_헤드연결():
    """신규 마이그레이션이 기존 체인 헤드에 연결되어 있는지 확인."""
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    cfg = Config(str(_BACKEND_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(_BACKEND_ROOT / "alembic"))
    script = ScriptDirectory.from_config(cfg)

    heads = script.get_heads()
    # 6차 중(中) 후속: e036a0000034 가 새 헤드이며, IDX-06(e036a0000033)은 그 부모로 연결된다.
    assert heads == ["e036a0000034"], f"알렸 헤드 목록: {heads}"

    rev = script.get_revision("e036a0000033")
    assert rev.down_revision == "e036a0000032"
