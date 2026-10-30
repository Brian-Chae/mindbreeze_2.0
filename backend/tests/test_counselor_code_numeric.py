"""코치(상담사) 코드 6자리 숫자 발급 및 하위호환 검증 테스트."""

from __future__ import annotations

import re
import string
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session

from app.models.counselor_profile import CounselorProfile
from app.models.organization import Organization
from app.models.user import User
from app.services import code_service, onboarding_service, signup_application_service


def _db() -> Session:
    from app.core.database import get_db
    from app.main import app as fastapi_app

    return next(fastapi_app.dependency_overrides[get_db]())


def test_code_service_default_keeps_alphanumeric():
    """code_service.generate_unique_code 의 기본값은 기존 대문자+숫자 6자리를 유지한다."""
    code = code_service.random_code()
    assert len(code) == 6
    assert re.match(r"^[A-Z0-9]{6}$", code)


def test_generate_counselor_code_is_6_digits(client):
    """상담사 코드는 6자리 숫자(000000~999999)로 발급된다."""
    db = _db()
    for _ in range(20):
        code = onboarding_service.generate_counselor_code(db)
        assert len(code) == 6
        assert re.match(r"^\d{6}$", code), f"코드가 숫자 6자리가 아닙니다: {code}"


def test_generate_counselor_code_retry_on_collision(client):
    """코드 충돌 시 MAX_CODE_RETRY 내에서 재시도하여 유니크한 코드를 반환한다."""
    db = _db()

    # 첫 번째 난수는 충돌하는 코드(이미 존재하는 코드)를 반환하고, 두 번째는 유니크한 코드를 반환하게 mock
    mock_returns = ["111111", "222222"]
    with patch("app.services.code_service.random_code", side_effect=mock_returns) as mock_random:
        # DB에 "111111" 임의 등록
        user = User(
            email="test_counselor_collision@example.com",
            name="상담사1",
            role="counselor",
            password_hash="dummy_hash",
        )
        db.add(user)
        db.flush()
        db.add(CounselorProfile(user_id=user.id, counselor_code="111111", specialties=[]))
        db.commit()

        new_code = onboarding_service.generate_counselor_code(db)
        assert new_code == "222222"
        assert mock_random.call_count == 2


def test_legacy_alphanumeric_counselor_code_lookup(client):
    """기존 영숫자(알파벳+숫자) 코드도 하위호환으로 정상 조회/검증된다 (대소문자 무시)."""
    db = _db()

    # 기존 영숫자 코드를 가진 상담사 생성
    user = User(
        email="legacy_counselor@example.com",
        name="레거시상담사",
        role="counselor",
        password_hash="dummy_hash",
        status="active",
        verified_tier="verified",
    )
    db.add(user)
    db.flush()
    db.add(CounselorProfile(user_id=user.id, counselor_code="ABC123", specialties=[]))
    db.commit()

    # 1. signup_application_service.validate_counselor_code 로 대문자 조회
    counselor, profile, _ = signup_application_service.validate_counselor_code("ABC123", db)
    assert counselor.id == user.id
    assert profile.counselor_code == "ABC123"

    # 2. 소문자 입력("abc123")도 대소문자 무시(normalize_code)로 성공
    counselor_lower, profile_lower, _ = signup_application_service.validate_counselor_code("abc123", db)
    assert counselor_lower.id == user.id
    assert profile_lower.counselor_code == "ABC123"
