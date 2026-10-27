"""SDD-248 — 기관 도입 문의 접수·메일 알림 QA (verify.md V1~V10)"""

import asyncio
import re
import uuid
from unittest.mock import MagicMock

import pytest

URL = "/api/v1/public/org-inquiries"


def _payload(**over):
    base = {
        "org_name": "마음숲 상담센터",
        "contact_name": "홍길동",
        "email": "Hong@Example.com",
        "phone": "010-1234-5678",
        "org_type": "counseling_center",
        "expected_users": 30,
        "band_interest": True,
        "message": "도입 상담 요청드립니다.",
        "privacy_consent": True,
    }
    base.update(over)
    return base


def _db():
    from app.core.database import get_db
    from app.main import app as fastapi_app

    return next(fastapi_app.dependency_overrides[get_db]())


@pytest.fixture(autouse=True)
def _no_celery(monkeypatch):
    from app.tasks import report_email_task

    mock = MagicMock()
    monkeypatch.setattr(report_email_task.org_inquiry_notice_task, "apply_async", mock)
    return mock


def _rows():
    from app.models.org_inquiry import OrgInquiry

    db = _db()
    try:
        return db.query(OrgInquiry).all()
    finally:
        db.close()


@pytest.mark.parametrize(
    "over",
    [
        {"org_name": ""},
        {"contact_name": "   "},
        {"email": "not-an-email"},
        {"phone": ""},
        {"org_type": "unknown"},
        {"message": "가" * 2001},
        {"expected_users": -1},
        {"org_name": "가" * 201},
    ],
)
def test_V1_검증_실패는_422(app_client, over):
    client, _ = app_client
    assert client.post(URL, json=_payload(**over)).status_code == 422
    assert _rows() == []


def test_V1_필수_필드_누락은_422(app_client):
    client, _ = app_client
    body = _payload()
    del body["email"]
    assert client.post(URL, json=body).status_code == 422


def test_V2_동의_없으면_422(app_client):
    client, _ = app_client
    assert client.post(URL, json=_payload(privacy_consent=False)).status_code == 422
    body = _payload()
    del body["privacy_consent"]
    assert client.post(URL, json=body).status_code == 422
    assert _rows() == []


def test_V3_허니팟은_거절_저장_안됨(app_client, _no_celery):
    client, _ = app_client
    assert client.post(URL, json=_payload(website="http://spam.example")).status_code == 422
    assert _rows() == []
    _no_celery.assert_not_called()


def test_V3_허니팟_빈값은_통과(app_client):
    client, _ = app_client
    assert client.post(URL, json=_payload(website="")).status_code == 201


def test_V4_정상_접수_저장(app_client):
    client, _ = app_client
    res = client.post(URL, json=_payload())
    assert res.status_code == 201, res.text
    rows = _rows()
    assert len(rows) == 1
    r = rows[0]
    assert res.json() == {"inquiry_id": str(r.id), "status": "new"}
    assert r.status == "new" and r.email == "hong@example.com"
    assert r.consented_at is not None and r.org_type == "counseling_center"
    assert not hasattr(r, "ip") and not hasattr(r, "ip_address")


def test_V4_선택_필드_없이도_접수(app_client):
    client, _ = app_client
    body = {k: v for k, v in _payload().items() if k in ("org_name", "contact_name", "email", "phone", "privacy_consent")}
    assert client.post(URL, json=body).status_code == 201


def test_V5_IP당_10분_5건_초과는_429(app_client):
    client, fake = app_client
    for _ in range(5):
        assert client.post(URL, json=_payload()).status_code == 201
    assert client.post(URL, json=_payload()).status_code == 429
    assert len(_rows()) == 5
    keys = asyncio.run(fake.keys("org_inquiry_rl:*"))
    assert len(keys) == 1


def test_V6_메일_태스크_호출(app_client, _no_celery):
    client, _ = app_client
    res = client.post(URL, json=_payload())
    assert res.status_code == 201
    _no_celery.assert_called_once()
    assert _no_celery.call_args.kwargs["args"] == [res.json()["inquiry_id"]]
    assert _rows()[0].notify_status == "queued"


def test_V7_큐_적재_실패해도_201(app_client, _no_celery):
    client, _ = app_client
    _no_celery.side_effect = ConnectionError("broker down")
    res = client.post(URL, json=_payload())
    assert res.status_code == 201
    assert len(_rows()) == 1
    assert _rows()[0].notify_status == "pending"


def _seed(**over):
    from app.services import org_inquiry_service as svc
    from app.schemas.org_inquiry import OrgInquiryCreate

    db = _db()
    row = svc.create_inquiry(OrgInquiryCreate(**_payload(**over)), db)
    return db, str(row.id)


def test_V8_메일_내용(app_client, monkeypatch):
    from app.config import settings
    from app.services import org_inquiry_service as svc
    from app.tasks import email as email_mod

    app_client  # noqa: B018
    monkeypatch.setattr(settings, "org_inquiry_notify_email", "a@x.com, b@x.com")
    sent = {}

    def fake_send(to, subject, text, html=None, reply_to=None):
        sent.update(to=to, subject=subject, text=text, html=html, reply_to=reply_to)
        return True

    monkeypatch.setattr(email_mod, "_send_email", fake_send)
    db, iid = _seed(org_name="<script>alert(1)</script>", message="줄1\n<b>굵게</b>")
    try:
        assert svc.deliver_org_inquiry_notice(iid, db) == "sent"
        assert sent["to"] == ["a@x.com", "b@x.com"]
        assert sent["subject"] == "[MIND BREEZE] 기관 도입 문의 — <script>alert(1)</script>"
        assert sent["reply_to"] == "hong@example.com"
        for token in ("홍길동", "010-1234-5678", "상담센터", "30명", "관심 있음", "줄1"):
            assert token in sent["text"], token
        assert re.search(r"접수 일시\(KST\): \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", sent["text"])
        assert "<script>" not in sent["html"] and "&lt;script&gt;" in sent["html"]
        assert "&lt;b&gt;" in sent["html"]
        assert "IP" not in sent["text"]
        from app.models.org_inquiry import OrgInquiry

        row = db.query(OrgInquiry).first()
        assert row.notify_status == "sent" and row.notified_at is not None
    finally:
        db.close()


def test_V9_발송_실패_재시도(app_client, monkeypatch):
    from app.tasks import email as email_mod
    from app.tasks.report_email_task import org_inquiry_notice_task

    monkeypatch.setattr(email_mod, "_send_email", lambda *a, **k: False)
    db, iid = _seed()
    db.close()
    with pytest.raises(RuntimeError):
        org_inquiry_notice_task.run(iid)
    from app.models.org_inquiry import OrgInquiry

    db = _db()
    try:
        assert db.query(OrgInquiry).first().notify_status == "failed"
    finally:
        db.close()


def test_V9_다중수신_Resend_payload(monkeypatch):
    import httpx

    from app.tasks import email as email_mod

    captured = {}

    class _Resp:
        is_success = True

        def json(self):
            return {"id": "x"}

    class _Client:
        def __init__(self, *a, **k): ...
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def post(self, url, headers=None, json=None):
            captured.update(json)
            return _Resp()

    monkeypatch.setattr(httpx, "Client", _Client)
    monkeypatch.setattr(email_mod.settings, "debug", False)
    assert email_mod._send_email(["a@x.com", "b@x.com"], "s", "t", None, reply_to="r@x.com")
    assert captured["to"] == ["a@x.com", "b@x.com"] and captured["reply_to"] == "r@x.com"


def test_V10_마이그레이션_head_단일():
    import glob

    revs, downs = {}, set()
    for f in glob.glob("alembic/versions/*.py"):
        t = open(f, encoding="utf-8").read()
        r = re.search(r"^revision(?:: \w+)?\s*=\s*['\"](\w+)", t, re.M)
        d = re.findall(r"^down_revision[^=]*=\s*(.*)$", t, re.M)
        if r:
            revs[r.group(1)] = f
            downs.update(re.findall(r"['\"](\w+)['\"]", d[0] if d else ""))
    assert [r for r in revs if r not in downs] == ["e261027a0248"]
