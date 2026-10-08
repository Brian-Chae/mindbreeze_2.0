"""SDD-190 — push 아웃박스 소비 cron QA.

verify.md: TS3(발송·payload), TS4(실패·재시도·UNREGISTERED revoke), TS5(토큰 없음·만료),
TS6(미설정 시 행 유지), TS7(email/ws 채널과 소비 충돌 없음)
+ Edge(다기기, payload 비식별).

FCM 은 push_service.send_to_token 모킹으로 대체한다(네트워크·자격증명 사용 없음).
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.services import push_service
from app.tasks.push_task import MAX_ATTEMPTS, process_push_outbox
from tests import agent_helpers as H

PUSH_PAYLOAD = {
    "title": "새 알림이 있어요",
    "body": "앱에서 확인해 주세요",
    "deeplink": "/app/ai",
    "message_id": "11111111-1111-1111-1111-111111111111",
}


@pytest.fixture(autouse=True)
def _fcm_configured(monkeypatch):
    """기본은 FCM 설정된 상태 — TS6 만 명시적으로 미설정으로 되돌린다."""
    monkeypatch.setattr(push_service, "is_configured", lambda: True)
    # 어떤 테스트도 실제 HTTP 를 타지 않게 기본 발송기를 명시적으로 막는다.
    monkeypatch.setattr(
        push_service.httpx,
        "Client",
        lambda *a, **kw: pytest.fail("실제 HTTP 호출이 발생했다"),
    )
    yield


def _register_token(user_id: str, token: str, *, platform: str = "android") -> None:
    from app.services import device_service

    conn = H.db()
    try:
        device_service.register_token(conn, user_id, token=token, platform=platform)
    finally:
        conn.close()


def _enqueue(user_id: str, channel: str, payload: dict, **overrides) -> str:
    from app.models.notification_outbox import NotificationOutbox

    conn = H.db()
    try:
        row = NotificationOutbox(
            user_id=user_id, channel=channel, payload=payload, status="pending", **overrides
        )
        conn.add(row)
        conn.commit()
        return str(row.id)
    finally:
        conn.close()


def _row(outbox_id: str):
    from app.models.notification_outbox import NotificationOutbox

    conn = H.db()
    try:
        return conn.query(NotificationOutbox).filter(NotificationOutbox.id == outbox_id).first()
    finally:
        conn.close()


def _token_row(token: str):
    from app.models.device_token import DeviceToken

    conn = H.db()
    try:
        return conn.query(DeviceToken).filter(DeviceToken.token == token).first()
    finally:
        conn.close()


def _stub_sender(monkeypatch, results: dict[str, push_service.PushResult]):
    """토큰별 결과를 미리 정해 두고 호출 기록을 돌려준다."""
    calls: list[dict] = []

    def _send(token, *, title, body, data):
        calls.append({"token": token, "title": title, "body": body, "data": data})
        return results.get(token, push_service.PushResult(ok=True))

    monkeypatch.setattr(push_service, "send_to_token", _send)
    return calls


# ── TS3: 발송 ────────────────────────────────────────────────


def test_TS3_활성_토큰_전체에_발송하고_sent_로_기록한다(client, monkeypatch):
    user = H.register_counselor("push-ts3-c@test.com")
    _register_token(user["id"], "tok-ts3-a")
    _register_token(user["id"], "tok-ts3-b", platform="ios")
    outbox_id = _enqueue(user["id"], "push", PUSH_PAYLOAD)

    calls = _stub_sender(monkeypatch, {})
    result = process_push_outbox()

    assert result["processed"] == 1
    assert result["sent"] == 1
    assert len(calls) == 2  # Edge: 다기기 — 토큰 수만큼 호출
    assert sorted(call["token"] for call in calls) == ["tok-ts3-a", "tok-ts3-b"]

    # data 에 deeplink·message_id 가 들어간다
    for call in calls:
        assert call["data"] == {
            "deeplink": "/app/ai",
            "message_id": PUSH_PAYLOAD["message_id"],
        }
        # Edge/Security: 본문은 비식별 고정 문구 — 이름·상담 내용이 없다
        assert call["title"] == PUSH_PAYLOAD["title"]
        assert call["body"] == PUSH_PAYLOAD["body"]
        assert "김상담" not in call["body"] and "박내담" not in call["body"]

    row = _row(outbox_id)
    assert row.status == "sent"
    assert row.sent_at is not None
    assert row.last_error is None


def test_TS3_해지된_토큰은_발송_대상이_아니다(client, monkeypatch):
    user = H.register_counselor("push-ts3b-c@test.com")
    _register_token(user["id"], "tok-ts3b-live")
    _register_token(user["id"], "tok-ts3b-dead")

    from app.services import device_service

    conn = H.db()
    try:
        device_service.revoke_token(conn, user["id"], "tok-ts3b-dead")
    finally:
        conn.close()

    _enqueue(user["id"], "push", PUSH_PAYLOAD)
    calls = _stub_sender(monkeypatch, {})
    process_push_outbox()

    assert [call["token"] for call in calls] == ["tok-ts3b-live"]


# ── TS4: 실패·재시도·revoke ───────────────────────────────────


def test_TS4_전부_실패하면_attempts_증가와_백오프_후_failed(client, monkeypatch):
    user = H.register_counselor("push-ts4-c@test.com")
    _register_token(user["id"], "tok-ts4")
    outbox_id = _enqueue(user["id"], "push", PUSH_PAYLOAD)

    _stub_sender(
        monkeypatch,
        {"tok-ts4": push_service.PushResult(ok=False, error="FCM 500 INTERNAL")},
    )

    previous_available = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        # 백오프로 미래로 밀린 available_at 을 현재로 되돌려 다음 시도를 집게 한다
        if previous_available is not None:
            _reset_available(outbox_id)
        process_push_outbox()
        row = _row(outbox_id)
        assert row.attempts == attempt
        if attempt < MAX_ATTEMPTS:
            assert row.status == "pending"
            assert _aware(row.available_at) > datetime.now(timezone.utc)
            previous_available = row.available_at
        else:
            assert row.status == "failed"

    row = _row(outbox_id)
    # Security: 실패 사유에 토큰 전체 값이 없다(접두사+길이만)
    assert "tok-ts4" not in row.last_error
    assert "len=" in row.last_error


def _aware(value: datetime) -> datetime:
    """SQLite 는 naive datetime 을 돌려주므로 UTC 로 간주해 비교한다."""
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _reset_available(outbox_id: str) -> None:
    from app.models.notification_outbox import NotificationOutbox

    conn = H.db()
    try:
        row = conn.query(NotificationOutbox).filter(NotificationOutbox.id == outbox_id).first()
        row.available_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        conn.commit()
    finally:
        conn.close()


def test_TS4_백오프_이전에는_집지_않는다(client, monkeypatch):
    user = H.register_counselor("push-ts4b-c@test.com")
    _register_token(user["id"], "tok-ts4b")
    outbox_id = _enqueue(user["id"], "push", PUSH_PAYLOAD)

    _stub_sender(monkeypatch, {"tok-ts4b": push_service.PushResult(ok=False, error="FCM 500")})
    process_push_outbox()
    assert _row(outbox_id).attempts == 1

    # available_at 이 미래 → 같은 cron 주기에 다시 집히지 않는다
    assert process_push_outbox()["processed"] == 0
    assert _row(outbox_id).attempts == 1


def test_TS4_UNREGISTERED_토큰은_해지하고_나머지_토큰은_계속_발송한다(client, monkeypatch):
    user = H.register_counselor("push-ts4c-c@test.com")
    _register_token(user["id"], "tok-ts4c-dead")
    _register_token(user["id"], "tok-ts4c-live")
    outbox_id = _enqueue(user["id"], "push", PUSH_PAYLOAD)

    calls = _stub_sender(
        monkeypatch,
        {
            "tok-ts4c-dead": push_service.PushResult(
                ok=False, error="FCM 404 UNREGISTERED", token_invalid=True
            )
        },
    )
    result = process_push_outbox()

    # 무효 토큰 때문에 루프가 끊기지 않는다
    assert sorted(call["token"] for call in calls) == ["tok-ts4c-dead", "tok-ts4c-live"]
    assert result["revoked"] == 1
    assert _token_row("tok-ts4c-dead").revoked_at is not None
    assert _token_row("tok-ts4c-live").revoked_at is None

    # 1개라도 성공했으면 sent (중복 푸시 방지)
    row = _row(outbox_id)
    assert row.status == "sent"
    assert row.attempts == 0

    # 다음 발송부터는 해지된 토큰이 제외된다
    _enqueue(user["id"], "push", PUSH_PAYLOAD)
    calls.clear()
    process_push_outbox()
    assert [call["token"] for call in calls] == ["tok-ts4c-live"]


# ── TS5: 토큰 없음 · 만료 ─────────────────────────────────────


def test_TS5_활성_토큰이_없으면_skipped(client, monkeypatch):
    user = H.register_counselor("push-ts5-c@test.com")
    outbox_id = _enqueue(user["id"], "push", PUSH_PAYLOAD)

    calls = _stub_sender(monkeypatch, {})
    result = process_push_outbox()

    assert result["skipped"] == 1
    assert calls == []
    row = _row(outbox_id)
    assert row.status == "skipped"
    assert row.attempts == 0


def test_TS5_24시간_초과_pending_은_expired(client, monkeypatch):
    user = H.register_counselor("push-ts5b-c@test.com")
    _register_token(user["id"], "tok-ts5b")
    old_id = _enqueue(
        user["id"],
        "push",
        PUSH_PAYLOAD,
        created_at=datetime.now(timezone.utc) - timedelta(hours=25),
    )
    fresh_id = _enqueue(user["id"], "push", PUSH_PAYLOAD)

    calls = _stub_sender(monkeypatch, {})
    result = process_push_outbox()

    assert result["expired"] == 1
    assert _row(old_id).status == "expired"
    assert _row(fresh_id).status == "sent"
    assert [call["token"] for call in calls] == ["tok-ts5b"]


def test_TS5_만료_마킹은_FCM_미설정에도_동작한다(client, monkeypatch):
    user = H.register_counselor("push-ts5c-c@test.com")
    monkeypatch.setattr(push_service, "is_configured", lambda: False)
    old_id = _enqueue(
        user["id"],
        "push",
        PUSH_PAYLOAD,
        created_at=datetime.now(timezone.utc) - timedelta(hours=30),
    )

    result = process_push_outbox()
    assert result["expired"] == 1
    assert result["configured"] is False
    assert _row(old_id).status == "expired"


# ── TS6: 자격증명 미설정 ──────────────────────────────────────


def test_TS6_미설정이면_행을_건드리지_않고_예외도_없다(client, monkeypatch, caplog):
    user = H.register_counselor("push-ts6-c@test.com")
    _register_token(user["id"], "tok-ts6")
    outbox_id = _enqueue(user["id"], "push", PUSH_PAYLOAD)

    monkeypatch.setattr(push_service, "is_configured", lambda: False)
    calls = _stub_sender(monkeypatch, {})

    with caplog.at_level("INFO"):
        result = process_push_outbox()

    assert result["configured"] is False
    assert result["processed"] == 0
    assert calls == []
    row = _row(outbox_id)
    assert row.status == "pending"
    assert row.attempts == 0
    assert row.sent_at is None
    assert "FCM 미설정" in caplog.text


# ── TS7: 채널 소비 충돌 없음 ──────────────────────────────────


def test_TS7_push_cron_은_email_ws_행을_건드리지_않는다(client, monkeypatch):
    user = H.register_counselor("push-ts7-c@test.com")
    _register_token(user["id"], "tok-ts7")
    push_id = _enqueue(user["id"], "push", PUSH_PAYLOAD)
    email_id = _enqueue(
        user["id"], "email", {"subject": "제목", "body": "본문"}, recipient="push-ts7-c@test.com"
    )
    ws_id = _enqueue(user["id"], "ws", {"id": "n1", "title": "제목", "body": "본문"})

    _stub_sender(monkeypatch, {})
    process_push_outbox()

    assert _row(push_id).status == "sent"
    assert _row(email_id).status == "pending"
    assert _row(ws_id).status == "pending"


def test_TS7_email_소비자는_push_행을_건드리지_않는다(client, monkeypatch):
    user = H.register_counselor("push-ts7b-c@test.com")
    push_id = _enqueue(user["id"], "push", PUSH_PAYLOAD)
    email_id = _enqueue(
        user["id"], "email", {"subject": "제목", "body": "본문"}, recipient="push-ts7b-c@test.com"
    )

    from app.tasks import outbox as outbox_task

    monkeypatch.setattr(outbox_task, "send_email_notification", lambda *a, **kw: True)
    result = outbox_task.process_email_outbox()

    assert result["processed"] == 1
    assert _row(email_id).status == "sent"
    assert _row(push_id).status == "pending"


def test_TS7_ws_소비자_쿼리는_ws_채널만_조회한다(client):
    """ws 워커는 channel=="ws" 필터로 조회한다 — push 행이 섞이지 않는지 쿼리로 고정."""
    user = H.register_counselor("push-ts7c-c@test.com")
    push_id = _enqueue(user["id"], "push", PUSH_PAYLOAD)
    ws_id = _enqueue(user["id"], "ws", {"id": "n1", "title": "제목", "body": "본문"})

    from app.models.notification_outbox import NotificationOutbox

    conn = H.db()
    try:
        ids = {
            str(row.id)
            for row in conn.query(NotificationOutbox)
            .filter(
                NotificationOutbox.status == "pending",
                NotificationOutbox.channel == "ws",
            )
            .all()
        }
    finally:
        conn.close()

    assert ws_id in ids
    assert push_id not in ids
