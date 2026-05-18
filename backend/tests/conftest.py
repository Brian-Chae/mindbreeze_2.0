"""테스트 공통 설정 — SQLite 인메모리 DB + fakeredis"""

import fakeredis.aioredis
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


# postgresql 전용 타입을 SQLite에서도 동작하도록 DDL 컴파일러 등록
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID

@compiles(UUID, "sqlite")
def _compile_uuid_sqlite(element, compiler, **kw):
    return "CHAR(36)"

@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(element, compiler, **kw):
    return "TEXT"

@compiles(ARRAY, "sqlite")
def _compile_array_sqlite(element, compiler, **kw):
    return "TEXT"


@pytest.fixture(scope="function")
def app_client():
    from app.main import app as fastapi_app
    # 모든 모델을 import해야 Base.metadata에 등록됨
    from app.core.database import Base, get_db
    from app.core.redis import get_redis
    import app.models  # noqa: F401

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    fake = fakeredis.aioredis.FakeRedis(decode_responses=True)

    def _override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    def _override_get_redis():
        return fake

    fastapi_app.dependency_overrides[get_db] = _override_get_db
    fastapi_app.dependency_overrides[get_redis] = _override_get_redis

    client = TestClient(fastapi_app)
    yield client, fake

    fastapi_app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client(app_client):
    return app_client[0]


@pytest.fixture
def redis(app_client):
    return app_client[1]


@pytest.fixture
def verified_email_token():
    """OTP 검증 통과 후 발급되는 email_verify_token (테스트용)"""
    from app.services import email_verify_service
    return lambda email: email_verify_service.generate_email_verify_token(email)
