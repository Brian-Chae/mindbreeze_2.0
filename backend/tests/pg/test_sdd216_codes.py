"""부모 클래스 코드와 기존 회차 코드의 공동 공간."""

import pytest
from app.services.class_code_service import generate_class_code
from tests.pg.sdd216_helpers import world

pytestmark = pytest.mark.pg


def test_class_code_reservation_is_seen_by_legacy_allocator(pg_session, monkeypatch):
    org, a, b, parent = world(pg_session)
    parent.access_code = "0042"
    pg_session.flush()
    numbers = iter([42, 43])
    monkeypatch.setattr(
        "app.services.class_code_service.secrets.randbelow", lambda space: next(numbers)
    )
    assert generate_class_code(pg_session) == "0043"
