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


# ARRAY/JSONB는 SQLite에 list/dict 그대로 바인딩 불가 → JSON 직렬화 처리기 부착
import json as _json


def _json_bind_processor(self, dialect):
    def process(value):
        if value is None:
            return None
        return _json.dumps(value)
    return process


def _json_result_processor(self, dialect, coltype):
    def process(value):
        if value is None or value == "":
            return None
        if isinstance(value, (list, dict)):
            return value
        try:
            return _json.loads(value)
        except (TypeError, ValueError):
            return value
    return process


ARRAY.bind_processor = _json_bind_processor
ARRAY.result_processor = _json_result_processor
JSONB.bind_processor = _json_bind_processor
JSONB.result_processor = _json_result_processor


# postgresql UUID는 SQLite에서 bind/result 변환기가 없어 str 입력 시 `value.hex`로 폭발한다.
# DDL만 CHAR(36)으로 바꾸는 것으로는 부족하므로 값 변환기도 SQLite 전용으로 부착한다.
import uuid as _uuid

_pg_uuid_bind = UUID.bind_processor
_pg_uuid_result = UUID.result_processor


def _uuid_bind_processor(self, dialect):
    if dialect.name != "sqlite":
        return _pg_uuid_bind(self, dialect)

    def process(value):
        if value is None:
            return None
        if isinstance(value, _uuid.UUID):
            return str(value)
        # str/기타 입력도 UUID로 정규화해 저장 표현을 일치시킨다
        return str(_uuid.UUID(str(value)))

    return process


def _uuid_result_processor(self, dialect, coltype):
    if dialect.name != "sqlite":
        return _pg_uuid_result(self, dialect, coltype)

    def process(value):
        if value is None:
            return None
        if not getattr(self, "as_uuid", True):
            return str(value)
        if isinstance(value, _uuid.UUID):
            return value
        return _uuid.UUID(str(value))

    return process


UUID.bind_processor = _uuid_bind_processor
UUID.result_processor = _uuid_result_processor


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


def create_test_org(name: str = "테스트 기관") -> str:
    """SDD-015 — 테스트용 기관을 만들고 6자리 기관 코드를 반환한다.

    상담사 가입에 유효한 기관 코드가 필요해졌으므로, client fixture가 활성인 상태에서
    호출해 같은 인메모리 DB에 기관을 생성한다.
    """
    from app.core.database import get_db
    from app.main import app as fastapi_app
    from app.services import org_service

    db = next(fastapi_app.dependency_overrides[get_db]())
    try:
        return org_service.admin_create_organization(name, db).org_code
    finally:
        db.close()


@pytest.fixture
def org_code():
    """상담사 가입용 기관 코드 fixture."""
    return create_test_org()


class _FakeRegisterResponse:
    """post_register 가 counselor 를 DB 직접 생성으로 대체할 때 반환하는 유사 Response."""

    def __init__(self, status_code: int, body: dict):
        self.status_code = status_code
        self._body = body
        self.text = str(body)

    def json(self) -> dict:
        return self._body


def post_register(client, role: str, payload: dict):
    """테스트용 가입 헬퍼 — SDD-073 로 상담사 직접 가입 API 가 차단되어,

    counselor 역할은 DB 직접 생성으로 대체하고 기존 register 응답과 같은
    형태의 body 를 돌려준다. 그 외 역할은 실제 API 를 그대로 호출한다.
    """
    if role != "counselor":
        return client.post(f"/api/v1/auth/register/{role}", json=payload)

    created = create_test_counselor(
        payload["email"],
        name=payload.get("name", "상담사"),
        org_code=payload.get("org_code"),
    )
    body = {
        "user": {"id": created["id"], "role": "counselor"},
        "access_token": created["access_token"],
        "tokens": {"access_token": created["access_token"]},
    }
    return _FakeRegisterResponse(201, body)


def create_test_counselor(
    email: str,
    name: str = "상담사",
    password: str = "Passw0rd!",
    org_code: str | None = None,
) -> dict:
    """SDD-073 — 상담사 직접 가입 API가 차단되어 테스트용 상담사는 DB에 직접 만든다.

    active 상태의 counselor User를 생성하고 {id, access_token}을 반환한다.
    org_code를 주면 해당 기관 소속으로 만든다.
    """
    from app.core.database import get_db
    from app.core.security import create_access_token, hash_password
    from app.main import app as fastapi_app
    from app.models.organization import Organization
    from app.models.user import User

    db = next(fastapi_app.dependency_overrides[get_db]())
    try:
        org_id = None
        if org_code:
            org = db.query(Organization).filter(Organization.org_code == org_code).first()
            org_id = org.id if org else None
        user = User(
            email=email,
            password_hash=hash_password(password),
            name=name,
            role="counselor",
            status="active",
            verified_tier="email",
            org_id=org_id,
        )
        db.add(user)
        db.flush()
        # SDD-079: 소속은 membership 이 진실의 원천 — org 소속 시 membership 도 생성
        if org_id is not None:
            from app.services import membership_service

            membership_service.add_membership(db, user, org_id, status_="active")
        db.commit()
        db.refresh(user)
        return {"id": str(user.id), "access_token": create_access_token(subject=str(user.id))}
    finally:
        db.close()
