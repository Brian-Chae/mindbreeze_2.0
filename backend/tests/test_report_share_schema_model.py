"""SDD-327 T11 — 리포트 공유 스키마·모델 단위 테스트."""

import uuid

import pytest
from pydantic import ValidationError

from app.models.report_share_event import ReportShareEvent
from app.schemas.report_share import (
    ReportShareHistoryItem,
    ReportShareRequest,
    mask_recipient,
)


def test_recipients_dedupe_lowercase():
    r = ReportShareRequest(recipients=["A@x.com", "a@x.com ", "b@y.org"])
    assert r.recipients == ["a@x.com", "b@y.org"]
    assert r.attach_pdf is True


def test_recipients_max_3_and_min_1():
    with pytest.raises(ValidationError):
        ReportShareRequest(recipients=["a@x.com", "b@x.com", "c@x.com", "d@x.com"])
    with pytest.raises(ValidationError):
        ReportShareRequest(recipients=[])


def test_invalid_address_passes_schema_for_service_to_reject():
    # 형식 오류 판정은 서비스가 주소별로 한다(부분 수락). 빈 주소만 스키마에서 거른다.
    assert ReportShareRequest(recipients=["a@x.com", "not-an-email"]).recipients == ["a@x.com", "not-an-email"]
    with pytest.raises(ValidationError):
        ReportShareRequest(recipients=["  "])


def test_message_limit_200():
    assert ReportShareRequest(recipients=["a@x.com"], message="가" * 200).message
    with pytest.raises(ValidationError):
        ReportShareRequest(recipients=["a@x.com"], message="가" * 201)
    assert ReportShareRequest(recipients=["a@x.com"], message="   ").message is None


def test_mask_format():
    assert mask_recipient("alice@domain.com") == "a***@d***.com"
    assert mask_recipient("x") == "***"


def test_history_item_exposes_only_masked():
    fields = set(ReportShareHistoryItem.model_fields)
    assert "recipient_masked" in fields
    assert not fields & {"recipient", "recipient_hash", "jti", "email"}


def test_model_columns_no_raw_address():
    cols = set(ReportShareEvent.__table__.columns.keys())
    assert {"recipient_masked", "recipient_hash", "jti", "status"} <= cols
    assert "recipient" not in cols and "email" not in cols
    assert ReportShareEvent.__tablename__ == "report_share_events"
    assert uuid  # noqa
