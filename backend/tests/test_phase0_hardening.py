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
        # SDD-210(T-2): 운영 정상값 — 확장된 fail-fast 를 통과하는 최소 구성
        s3_bucket="mindbreeze-prod",
        s3_use_instance_role=True,
        cors_allowed_origins="https://mindbreeze.looxidlabs.com,https://api.mindbreeze.looxidlabs.com,https://localhost,capacitor://localhost",
        resend_api_key="re_x",
        resend_from_email="MIND BREEZE <noreply@mindbreeze.looxidlabs.com>",
        livekit_host="wss://api.mindbreeze.looxidlabs.com/livekit",
        livekit_api_key="prodkey",
        livekit_api_secret="prodsecret",
        database_url="postgresql://u:p@mindbreeze-prod.example.ap-northeast-1.rds.amazonaws.com:5432/mindbreeze",
        research_id_key_v1="k",
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


@pytest.mark.parametrize(
    "kw,needle",
    [
        ({"s3_bucket": "mindbreeze-dev"}, "s3_bucket"),
        ({"s3_bucket": ""}, "s3_bucket"),
        ({"aws_access_key_id": "AKIAX", "aws_secret_access_key": "s"}, "AWS 액세스 키"),
        ({"s3_use_instance_role": False}, "S3_USE_INSTANCE_ROLE"),
        ({"cors_allowed_origins": ""}, "CORS_ALLOWED_ORIGINS 미설정"),
        ({"cors_allowed_origins": "*"}, "와일드카드"),
        ({"cors_allowed_origins": "https://mindbreeze.looxidlabs.com,https://dev.mindbreeze.looxidlabs.com"}, "개발 도메인"),
        ({"cors_allowed_origins": "http://mindbreeze.looxidlabs.com"}, "비 TLS"),
        ({"resend_from_email": "MIND BREEZE DEV <noreply@dev.mindbreeze.looxidlabs.com>"}, "resend_from_email"),
        ({"resend_from_email": "onboarding@resend.dev"}, "resend_from_email"),
        ({"resend_api_key": ""}, "resend_api_key"),
        ({"livekit_host": "ws://localhost:7880"}, "livekit_host"),
        ({"livekit_api_key": "devkey"}, "LiveKit"),
        ({"livekit_api_secret": "secret"}, "LiveKit"),
        ({"fcm_project_id": "mind-breeze-prod"}, "FCM"),
        ({"vapid_public_key": "pub"}, "VAPID"),
        ({"database_url": "postgresql://localhost:5432/mindbreeze_dev"}, "database_url"),
        ({"database_url": "postgresql://u:p@mindbreeze-dev.cqiucz9c6j63.ap-northeast-1.rds.amazonaws.com/x"}, "database_url"),
        ({"research_id_key_v1": ""}, "RESEARCH_ID_KEY_V1"),
        ({"research_export_enabled": True}, "RESEARCH_EXPORT_ACK_TOKEN"),
    ],
)
def test_T2_운영_확장_fail_fast_각_항목이_기동을_막는다(kw, needle):
    problems = production_config_problems(_cfg(**kw))
    assert any(needle in p for p in problems), problems


def test_T2_푸시를_양쪽_모두_설정하면_통과한다():
    cfg = _cfg(fcm_project_id="mb-prod", fcm_service_account_json="/etc/mindbreeze/fcm.json",
               vapid_public_key="pub", vapid_private_key="priv")
    assert production_config_problems(cfg) == []


def test_T2_문제_메시지에_비밀값을_싣지_않는다():
    problems = production_config_problems(
        _cfg(aws_access_key_id="AKIASECRETVALUE", aws_secret_access_key="topsecretvalue", research_id_key_v1="")
    )
    joined = " ".join(problems)
    assert "AKIASECRETVALUE" not in joined and "topsecretvalue" not in joined


def test_T2_dev_환경은_확장_검사를_받지_않는다():
    # dev 서버(ENVIRONMENT=development)는 S3 dev 버킷·CORS 미설정이어도 기동 가능
    assert production_config_problems(_cfg(environment="development", s3_bucket="mindbreeze-dev", cors_allowed_origins="")) == []


# ── T-2: CORS 변수화 ────────────────────────────────────────


def test_T2_CORS_미설정이면_기존_기본_목록과_Socket_IO_와일드카드를_유지한다():
    from app.core.cors import DEFAULT_CORS_ORIGINS, http_cors_origins, socketio_cors_origins

    cfg = Settings(_env_file=None, jwt_secret_key="x")
    assert http_cors_origins(cfg) == list(DEFAULT_CORS_ORIGINS)
    assert "https://dev.mindbreeze.looxidlabs.com" in DEFAULT_CORS_ORIGINS
    assert "https://localhost" in DEFAULT_CORS_ORIGINS and "capacitor://localhost" in DEFAULT_CORS_ORIGINS
    assert socketio_cors_origins(cfg) == "*"


def test_T2_CORS_명시하면_HTTP_와_Socket_IO_가_같은_목록을_쓴다():
    from app.core.cors import http_cors_origins, socketio_cors_origins

    cfg = _cfg(cors_allowed_origins=" https://a.example.com/ ,https://b.example.com,,https://a.example.com")
    assert http_cors_origins(cfg) == ["https://a.example.com", "https://b.example.com"]
    assert socketio_cors_origins(cfg) == ["https://a.example.com", "https://b.example.com"]


def test_T2_실제_앱_CORS_응답은_허용_오리진만_반영한다():
    from fastapi.testclient import TestClient
    from app.main import app

    c = TestClient(app)
    ok = c.options("/health", headers={"Origin": "https://dev.mindbreeze.looxidlabs.com",
                                       "Access-Control-Request-Method": "GET"})
    assert ok.headers.get("access-control-allow-origin") == "https://dev.mindbreeze.looxidlabs.com"
    bad = c.options("/health", headers={"Origin": "https://evil.example.com",
                                        "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in bad.headers


# ── T-2: storage 빈 키 → 기본 자격 체인 ─────────────────────


def test_T2_storage_키가_비면_boto3_에_자격증명_인자를_넘기지_않는다(monkeypatch):
    from app.services import storage_service

    monkeypatch.setattr(storage_service.settings, "aws_access_key_id", "")
    monkeypatch.setattr(storage_service.settings, "aws_secret_access_key", "")
    assert storage_service._credential_kwargs() == {}
    monkeypatch.setattr(storage_service.settings, "aws_access_key_id", "AKIAX")
    monkeypatch.setattr(storage_service.settings, "aws_secret_access_key", "sec")
    assert storage_service._credential_kwargs() == {"aws_access_key_id": "AKIAX", "aws_secret_access_key": "sec"}


def test_T2_storage_인스턴스_역할_플래그는_키_없이도_설정됨으로_본다(monkeypatch):
    from app.services import storage_service

    monkeypatch.setattr(storage_service.settings, "aws_access_key_id", "")
    monkeypatch.setattr(storage_service.settings, "aws_secret_access_key", "")
    monkeypatch.setattr(storage_service.settings, "s3_use_instance_role", False)
    assert storage_service.storage_configured() is False  # 기존 동작(로컬/테스트 스텁) 유지
    monkeypatch.setattr(storage_service.settings, "s3_use_instance_role", True)
    assert storage_service.storage_configured() is True


def test_T2_storage_인스턴스_역할이면_boto3_client_가_키_인자_없이_생성된다(monkeypatch):
    import boto3
    from app.services import storage_service

    captured: dict = {}

    class _C:
        def generate_presigned_url(self, *a, **k):
            return "https://signed.example/x"

    def fake_client(service, **kw):
        captured.update(kw)
        return _C()

    monkeypatch.setattr(boto3, "client", fake_client)
    monkeypatch.setattr(storage_service.settings, "aws_access_key_id", "")
    monkeypatch.setattr(storage_service.settings, "aws_secret_access_key", "")
    monkeypatch.setattr(storage_service.settings, "s3_use_instance_role", True)
    assert storage_service.generate_presigned_put("k", content_type="text/plain") == "https://signed.example/x"
    assert "aws_access_key_id" not in captured and "aws_secret_access_key" not in captured


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
