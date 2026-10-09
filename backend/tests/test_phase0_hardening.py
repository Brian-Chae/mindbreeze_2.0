"""SDD-197 — Phase 0 즉시 방어 QA (verify.md TS3·TS4·TS5·TS6).

TS3 뇌파 영구 보관 / TS4 헬스체크 / TS5 운영 설정 검증 / TS6 업로드 실패 엄격화.
"""

import uuid
from datetime import datetime, timedelta

import pytest

from app.config import Settings, settings
from app.main import production_config_problems


# ── TS3: 뇌파 원본 영구 보관 ──────────────────────────────────


def _seed_chunks(client, email: str):
    from app.models.record import EEGRawChunk
    from tests.test_mb2_func_fixes_5th import _db
    from tests.test_video_record import _create_session, _register

    host = _register(client, email)
    sid = uuid.UUID(_create_session(client, host))
    now = datetime(2026, 1, 1, 12, 0, 0)

    db = _db()
    try:
        def chunk(index, status, created_at, uploaded_at=None):
            return EEGRawChunk(
                session_id=sid, participant_id=None, stream_id="s0", chunk_index=index,
                object_key=f"k{index}", upload_status=status,
                created_at=created_at, uploaded_at=uploaded_at,
            )

        db.add_all([
            chunk(0, "pending", now - timedelta(hours=25)),  # 고아
            chunk(1, "uploaded", now - timedelta(days=400), uploaded_at=now - timedelta(days=400)),  # 오래된 원본
        ])
        db.commit()
    finally:
        db.close()
    return sid, now


def test_TS3_기본값은_뇌파_원본을_삭제하지_않는다(client):
    """settings.eeg_raw_retention_days=0(기본) → 400일 지난 uploaded 원본도 유지, 고아 pending 만 정리."""
    from app.models.record import EEGRawChunk
    from app.services import eeg_raw_service
    from tests.test_mb2_func_fixes_5th import _db

    assert settings.eeg_raw_retention_days == 0
    sid, now = _seed_chunks(client, "p0-ts3@test.com")
    db = _db()
    try:
        result = eeg_raw_service.sweep_stale_eeg_raw(db, now=now)
        assert result == {"pending_deleted": 1, "failed_deleted": 0, "expired_deleted": 0}
        remaining = {c.chunk_index for c in db.query(EEGRawChunk).filter(EEGRawChunk.session_id == sid)}
        assert remaining == {1}
    finally:
        db.close()


def test_TS3_보관일수를_설정하면_해당_일수가_적용된다(client, monkeypatch):
    from app.models.record import EEGRawChunk
    from app.services import eeg_raw_service
    from tests.test_mb2_func_fixes_5th import _db

    monkeypatch.setattr(settings, "eeg_raw_retention_days", 365)
    sid, now = _seed_chunks(client, "p0-ts3b@test.com")
    db = _db()
    try:
        result = eeg_raw_service.sweep_stale_eeg_raw(db, now=now)
        assert result["expired_deleted"] == 1  # 400일 > 365일
        assert db.query(EEGRawChunk).filter(EEGRawChunk.session_id == sid, EEGRawChunk.chunk_index == 1).count() == 0
    finally:
        db.close()


# ── TS4: 헬스체크 ───────────────────────────────────────────


def test_TS4_기존_health는_호환된다(client):
    res = client.get("/health")
    assert res.status_code == 200 and res.json()["status"] == "ok"
    assert client.get("/health/live").status_code == 200


def test_TS4_ready_는_DB와_Redis가_정상이면_200(client, monkeypatch):
    class _Redis:
        async def ping(self):
            return True

    monkeypatch.setattr("app.core.redis.get_redis", lambda: _Redis())
    res = client.get("/health/ready")
    assert res.status_code == 200, res.text
    assert res.json() == {"status": "ok", "checks": {"database": "ok", "redis": "ok"}}


def test_TS4_ready_는_Redis_장애면_503이고_오류상세를_노출하지_않는다(client, monkeypatch):
    class _Redis:
        async def ping(self):
            raise ConnectionError("redis://secret-host:6379 refused")

    monkeypatch.setattr("app.core.redis.get_redis", lambda: _Redis())
    res = client.get("/health/ready")
    assert res.status_code == 503
    assert res.json()["checks"] == {"database": "ok", "redis": "fail"}
    assert "secret-host" not in res.text


def test_TS4_ready_는_DB_장애면_503(client, monkeypatch):
    class _Redis:
        async def ping(self):
            return True

    def boom():
        raise RuntimeError("db down")

    monkeypatch.setattr("app.core.redis.get_redis", lambda: _Redis())
    monkeypatch.setattr("app.core.database.SessionLocal", boom)
    res = client.get("/health/ready")
    assert res.status_code == 503
    assert res.json()["checks"]["database"] == "fail"


# ── TS5: 운영 설정 검증 ─────────────────────────────────────


def _cfg(**kw):
    base = dict(
        environment="production",
        frontend_base_url="https://mindbreeze.looxidlabs.com",
        report_email_base_url="https://mindbreeze.looxidlabs.com",
        debug=False,
        enable_dev_role_simulation=False,
        jwt_secret_key="x",
    )
    base.update(kw)
    return Settings(_env_file=None, **base)


def test_TS5_정상_운영_설정은_통과():
    assert production_config_problems(_cfg()) == []


@pytest.mark.parametrize(
    "kw,needle",
    [
        ({"frontend_base_url": "https://dev.mindbreeze.looxidlabs.com"}, "frontend_base_url"),
        ({"report_email_base_url": "https://dev-api.mindbreeze.looxidlabs.com"}, "report_email_base_url"),
        ({"report_email_base_url": "http://localhost:5175"}, "report_email_base_url"),
        ({"debug": True}, "DEBUG"),
        ({"enable_dev_role_simulation": True}, "역할 시뮬레이션"),
    ],
)
def test_TS5_운영에서_dev_설정이_섞이면_문제를_보고한다(kw, needle):
    problems = production_config_problems(_cfg(**kw))
    assert any(needle in p for p in problems), problems


def test_TS5_dev_환경과_기본값_환경은_검사하지_않는다():
    assert production_config_problems(_cfg(environment="development", debug=True)) == []
    # environment 를 명시하지 않은(기본값 production) 설정 — 로컬·테스트 환경
    implicit = Settings(_env_file=None, jwt_secret_key="x")
    assert implicit.environment == "production"
    assert production_config_problems(implicit) == []


# ── TS6: 업로드 실패 엄격화 ─────────────────────────────────


def test_TS6_실자격증명이면_환경과_무관하게_업로드_실패를_숨기지_않는다(monkeypatch):
    from app.services import storage_service

    monkeypatch.setattr(settings, "environment", "development")
    monkeypatch.setattr(storage_service, "_has_real_credentials", lambda: True)
    assert storage_service.should_fail_on_upload_failure() is True


def test_TS6_스텁_환경은_폴백을_유지한다(monkeypatch):
    from app.services import storage_service

    monkeypatch.setattr(storage_service, "_has_real_credentials", lambda: False)
    assert storage_service.should_fail_on_upload_failure() is False


def test_기본_debug는_꺼져있다():
    assert Settings(_env_file=None, jwt_secret_key="x").debug is False
