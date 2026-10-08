"""SDD-192 — 웹 푸시(VAPID) QA.

verify.md: TS1(등록·갱신·해지), TS2(endpoint/keys 검증), TS3(발송), TS4(무효 구독),
TS5(미설정), TS6(혼합 기기), TS7(public-key). pywebpush 는 모킹해 네트워크를 쓰지 않는다.
"""

import pytest

from app.config import settings
from app.services import push_service, web_push_service
from app.tasks.push_task import process_push_outbox
from tests import agent_helpers as H

BASE = "/api/v1/devices"
ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123"
KEYS = {"p256dh": "BP-test-p256dh", "auth": "test-auth"}
PAYLOAD = {
    "title": "새 알림이 있어요",
    "body": "앱에서 확인해 주세요",
    "deeplink": "/app/ai",
    "message_id": "11111111-1111-1111-1111-111111111111",
}


@pytest.fixture(autouse=True)
def _vapid(monkeypatch):
    """기본: VAPID 설정됨 · FCM 미설정. 개별 테스트가 필요하면 덮어쓴다."""
    monkeypatch.setattr(settings, "vapid_public_key", "pub-key")
    monkeypatch.setattr(settings, "vapid_private_key", "priv-key")
    monkeypatch.setattr(push_service, "is_configured", lambda: False)


def _web_body(endpoint: str = ENDPOINT, **extra) -> dict:
    return {"token": endpoint, "platform": "web", "keys": KEYS, **extra}


def _row(token: str):
    from app.models.device_token import DeviceToken

    conn = H.db()
    try:
        return conn.query(DeviceToken).filter(DeviceToken.token == token).first()
    finally:
        conn.close()


def _enqueue(user_id: str) -> str:
    from app.models.notification_outbox import NotificationOutbox

    conn = H.db()
    try:
        row = NotificationOutbox(user_id=user_id, channel="push", payload=PAYLOAD, status="pending")
        conn.add(row)
        conn.commit()
        return str(row.id)
    finally:
        conn.close()


def _status(outbox_id: str):
    from app.models.notification_outbox import NotificationOutbox

    conn = H.db()
    try:
        row = conn.query(NotificationOutbox).filter(NotificationOutbox.id == outbox_id).first()
        return row.status, row.attempts
    finally:
        conn.close()


def _register(user_id: str, token: str, platform: str = "web") -> None:
    from app.services import device_service

    conn = H.db()
    try:
        device_service.register_token(
            conn,
            user_id,
            token=token,
            platform=platform,
            p256dh=KEYS["p256dh"] if platform == "web" else None,
            auth=KEYS["auth"] if platform == "web" else None,
        )
    finally:
        conn.close()


# ── TS1 ────────────────────────────────────────────────────


def test_TS1_웹_구독_등록_upsert_해지(client):
    user = H.register_counselor("ws-ts1-c@test.com")
    other = H.register_client(client, "ws-ts1-o@test.com")

    res = client.post(BASE, json=_web_body(), headers=user["h"])
    assert res.status_code == 200, res.text
    first_id = res.json()["id"]
    row = _row(ENDPOINT)
    assert row.platform == "web" and row.p256dh == KEYS["p256dh"] and row.auth == KEYS["auth"]

    res = client.post(BASE, json=_web_body(), headers=user["h"])
    assert res.json()["id"] == first_id  # 행이 늘지 않는다

    # endpoint 는 `/` 를 포함하므로 쿼리 파라미터로 해지한다.
    assert client.delete(BASE, params={"token": ENDPOINT}, headers=other["h"]).status_code == 404
    assert client.delete(BASE, params={"token": ENDPOINT}, headers=user["h"]).status_code == 204
    assert _row(ENDPOINT).revoked_at is not None


# ── TS2 ────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://fcm.googleapis.com/fcm/send/x",  # http
        "https://evil.example.com/push",  # 허용 외 도메인
        "https://fcm.googleapis.com.evil.com/x",  # 접미사 위장
        "https://169.254.169.254/latest/meta-data",  # 메타데이터 SSRF
        "https://user:pw@fcm.googleapis.com/x",  # 자격증명 포함
        "https://fcm.googleapis.com:8443/x",  # 비표준 포트
    ],
)
def test_TS2_허용되지_않은_endpoint는_422(client, endpoint):
    user = H.register_counselor("ws-ts2-c@test.com")
    res = client.post(BASE, json=_web_body(endpoint), headers=user["h"])
    assert res.status_code == 422, res.text


def test_TS2_keys_누락은_422_앱_토큰은_keys_없이_200(client):
    user = H.register_counselor("ws-ts2b-c@test.com")
    res = client.post(BASE, json={"token": ENDPOINT, "platform": "web"}, headers=user["h"])
    assert res.status_code == 422
    res = client.post(BASE, json={"token": "fcm-app-token", "platform": "android"}, headers=user["h"])
    assert res.status_code == 200, res.text


@pytest.mark.parametrize(
    "endpoint",
    [
        "https://updates.push.services.mozilla.com/wpush/v2/x",
        "https://web.push.apple.com/Qx",
        "https://wns2-par02p.notify.windows.com/w/?token=x",
    ],
)
def test_TS2_주요_브라우저_푸시_서비스는_허용(client, endpoint):
    user = H.register_counselor("ws-ts2c-c@test.com")
    assert client.post(BASE, json=_web_body(endpoint), headers=user["h"]).status_code == 200


# ── TS3 ~ TS6 ──────────────────────────────────────────────


def test_TS3_웹_구독으로_발송되고_payload는_비식별(client, monkeypatch):
    user = H.register_counselor("ws-ts3-c@test.com")
    _register(user["id"], ENDPOINT)
    sent = {}

    def fake_webpush(**kwargs):
        sent.update(kwargs)

    import pywebpush

    monkeypatch.setattr(pywebpush, "webpush", fake_webpush)
    oid = _enqueue(user["id"])

    result = process_push_outbox()

    assert result["sent"] == 1
    assert _status(oid)[0] == "sent"
    assert sent["subscription_info"]["endpoint"] == ENDPOINT
    assert sent["vapid_private_key"] == "priv-key"
    import json

    body = json.loads(sent["data"])
    assert body["title"] == PAYLOAD["title"]
    assert body["data"] == {"deeplink": "/app/ai", "message_id": PAYLOAD["message_id"]}


def test_TS4_410이면_구독_해지_전부_실패면_재시도(client, monkeypatch):
    import pywebpush

    class _Resp:
        status_code = 410

    def gone(**kwargs):
        raise pywebpush.WebPushException("gone", response=_Resp())

    monkeypatch.setattr(pywebpush, "webpush", gone)
    user = H.register_counselor("ws-ts4-c@test.com")
    _register(user["id"], ENDPOINT)
    oid = _enqueue(user["id"])

    result = process_push_outbox()

    assert result["revoked"] == 1
    assert _row(ENDPOINT).revoked_at is not None
    assert _status(oid) == ("pending", 1)


def test_TS5_VAPID_미설정이면_행을_유지하고_발송하지_않는다(client, monkeypatch):
    monkeypatch.setattr(settings, "vapid_private_key", "")
    import pywebpush

    monkeypatch.setattr(pywebpush, "webpush", lambda **k: pytest.fail("발송되면 안 된다"))
    user = H.register_counselor("ws-ts5-c@test.com")
    _register(user["id"], ENDPOINT)
    oid = _enqueue(user["id"])

    result = process_push_outbox()

    assert result["configured"] is False
    assert _status(oid) == ("pending", 0)


def test_TS5_FCM_미설정이어도_웹_푸시는_발송된다(client, monkeypatch):
    import pywebpush

    calls = []
    monkeypatch.setattr(pywebpush, "webpush", lambda **k: calls.append(k))
    user = H.register_counselor("ws-ts5b-c@test.com")
    _register(user["id"], ENDPOINT)
    oid = _enqueue(user["id"])

    process_push_outbox()

    assert len(calls) == 1 and _status(oid)[0] == "sent"


def test_TS5_웹만_설정된_환경에서_앱_토큰_전용_사용자는_행을_유지한다(client, monkeypatch):
    import pywebpush

    monkeypatch.setattr(pywebpush, "webpush", lambda **k: pytest.fail("웹 발송 아님"))
    user = H.register_counselor("ws-ts5c-c@test.com")
    _register(user["id"], "fcm-app-token-ts5c", platform="android")
    oid = _enqueue(user["id"])

    process_push_outbox()

    assert _status(oid) == ("pending", 0)  # FCM 미설정 → 건드리지 않음


def test_TS6_앱과_웹_기기를_모두_발송한다(client, monkeypatch):
    import pywebpush

    web_calls, fcm_calls = [], []
    monkeypatch.setattr(pywebpush, "webpush", lambda **k: web_calls.append(k))
    monkeypatch.setattr(push_service, "is_configured", lambda: True)
    monkeypatch.setattr(
        push_service,
        "send_to_token",
        lambda token, **kw: (fcm_calls.append(token), push_service.PushResult(ok=True))[1],
    )
    user = H.register_counselor("ws-ts6-c@test.com")
    _register(user["id"], ENDPOINT)
    _register(user["id"], "fcm-app-token-ts6", platform="android")
    oid = _enqueue(user["id"])

    process_push_outbox()

    assert len(web_calls) == 1 and fcm_calls == ["fcm-app-token-ts6"]
    assert _status(oid)[0] == "sent"


# ── TS7 ────────────────────────────────────────────────────


def test_TS7_public_key(client, monkeypatch):
    user = H.register_counselor("ws-ts7-c@test.com")
    res = client.get(f"{BASE}/web-push/public-key", headers=user["h"])
    assert res.status_code == 200 and res.json() == {"public_key": "pub-key"}

    monkeypatch.setattr(settings, "vapid_private_key", "")
    assert client.get(f"{BASE}/web-push/public-key", headers=user["h"]).status_code == 503
    assert client.get(f"{BASE}/web-push/public-key").status_code in (401, 403)


def test_VAPID_실제_키로_서명이_만들어진다():
    """pywebpush 가 우리가 쓸 raw base64url 개인키 형식을 실제로 받아들이는지 확인(네트워크 없음)."""
    import base64

    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from py_vapid import Vapid02

    key = ec.generate_private_key(ec.SECP256R1())
    raw = key.private_numbers().private_value.to_bytes(32, "big")
    priv = base64.urlsafe_b64encode(raw).decode().rstrip("=")
    pub = key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    assert len(pub) == 65
    vapid = Vapid02.from_string(priv)
    headers = vapid.sign({"sub": "mailto:a@b.com", "aud": "https://fcm.googleapis.com"})
    assert "Authorization" in headers
