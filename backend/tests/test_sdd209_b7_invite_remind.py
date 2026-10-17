"""SDD-209 B7 — 초대·재발송 정합 (verify BT38~BT40, BT46, RV6-1·2, AZ21 일부, LG6).

- 초대 응답: 참여자 **등록 성공**과 **알림 요청 결과**를 분리한다. 알림 실패는 삼키되 결과 필드로 노출.
- 재발송: 호스트 전용·쿨다운·대상별 결과. 전달/수신을 확정하는 필드·문구가 없다(푸시 수신 약속 없음).
- 리마인더 본문: 4자리 코드 + /join 링크(코드는 URL 에 싣지 않음).
"""

import json
import uuid

import pytest

from tests.test_sdd015_class_code import _create_class, _open_class, _register
from tests.entry_helpers import enter_guest

FORBIDDEN_KEYS = {"delivered", "received", "read", "sent", "push", "delivery_confirmed", "success_count"}


def _db():
    from app.core.database import SessionLocal

    return SessionLocal()


def _keys(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield k
            yield from _keys(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _keys(v)


def _class(client, host, **kw):
    cls = _create_class(client, host["h"], participant_mode="group", max_participants=10, **kw)
    _open_class(client, cls, host["h"])
    return cls


def _invite(client, cls, host, member):
    return client.post(f"/api/v1/sessions/{cls['id']}/invite", json={"user_id": member["id"]}, headers=host["h"])


def _remind(client, cls, host, body=None):
    return client.post(f"/api/v1/sessions/{cls['id']}/invite/remind", json=body or {}, headers=host["h"])


def _notifs(user_id, **extra_match):
    from app.models.notification import Notification

    db = _db()
    try:
        rows = db.query(Notification).filter(Notification.user_id == uuid.UUID(user_id)).all()
        return [r for r in rows if all((r.extra or {}).get(k) == v for k, v in extra_match.items())]
    finally:
        db.close()


# ── BT38: 등록 성공과 알림 요청 결과 분리 ──────────────────────────────


def test_BT38_초대_응답은_등록_성공과_알림_요청_결과를_분리한다(client):
    host = _register(client, "b7h1@test.com")
    member = _register(client, "b7m1@test.com", role="client")
    cls = _class(client, host)
    r = _invite(client, cls, host, member)
    assert r.status_code == 200, r.text
    result = r.json()["invite_result"]
    assert result["registered"] is True and result["user_id"] == member["id"]
    assert result["channels"]["in_app"] == "queued"
    # 초대 이메일 선호는 기본 ON — '요청됨'일 뿐 전달 확정이 아니다
    assert result["channels"]["email"] == "queued"
    assert any(p["user_id"] == member["id"] for p in r.json()["participants"])


def test_BT38_알림_실패는_삼키되_결과_필드로_노출_등록은_유지(client, monkeypatch):
    from app.services import notification_service

    def boom(*a, **k):
        raise RuntimeError("채널 장애")

    monkeypatch.setattr(notification_service, "notify_event", boom)
    host = _register(client, "b7h2@test.com")
    member = _register(client, "b7m2@test.com", role="client")
    cls = _class(client, host)
    r = _invite(client, cls, host, member)
    assert r.status_code == 200, r.text
    result = r.json()["invite_result"]
    assert result["registered"] is True
    assert result["channels"]["in_app"] == "failed"
    assert any(p["user_id"] == member["id"] for p in r.json()["participants"]), "등록은 유지"


def test_BT38_알림_설정이_꺼진_회원은_skipped(client):
    from app.models.user import User

    host = _register(client, "b7h3@test.com")
    member = _register(client, "b7m3@test.com", role="client")
    db = _db()
    try:
        u = db.query(User).filter(User.id == uuid.UUID(member["id"])).first()
        u.notification_preferences = {"in_app": {"session_invited": False}, "email": {}}
        db.commit()
    finally:
        db.close()
    cls = _class(client, host)
    r = _invite(client, cls, host, member)
    assert r.json()["invite_result"]["channels"]["in_app"] == "skipped"


def test_BT38_이메일_선호가_꺼진_회원은_not_requested(client):
    from app.models.user import User

    host = _register(client, "b7h3b@test.com")
    member = _register(client, "b7m3b@test.com", role="client")
    db = _db()
    try:
        u = db.query(User).filter(User.id == uuid.UUID(member["id"])).first()
        u.notification_preferences = {"in_app": {}, "email": {"session_invited": False}}
        db.commit()
    finally:
        db.close()
    cls = _class(client, host)
    ch = _invite(client, cls, host, member).json()["invite_result"]["channels"]
    assert ch == {"in_app": "queued", "email": "not_requested"}


def test_초대_응답_외_다른_세션_응답에는_invite_result가_없다(client):
    host = _register(client, "b7h4@test.com")
    cls = _class(client, host)
    got = client.get(f"/api/v1/sessions/{cls['id']}", headers=host["h"]).json()
    assert got.get("invite_result") is None


# ── BT39: 재발송 ───────────────────────────────────────────────────────


def test_BT39_재발송은_호스트만_대상별_결과와_알림_행(client):
    host = _register(client, "b7h5@test.com")
    other = _register(client, "b7o5@test.com")
    m1 = _register(client, "b7m5a@test.com", role="client")
    m2 = _register(client, "b7m5b@test.com", role="client")
    cls = _class(client, host)
    _invite(client, cls, host, m1)
    _invite(client, cls, host, m2)

    assert client.post(f"/api/v1/sessions/{cls['id']}/invite/remind", json={}, headers=m1["h"]).status_code == 403
    assert _remind(client, cls, other).status_code in (403, 404)
    assert client.post(f"/api/v1/sessions/{cls['id']}/invite/remind", json={}).status_code == 401

    before = len(_notifs(m1["id"]))
    r = _remind(client, cls, host)
    assert r.status_code == 200, r.text
    body = r.json()
    by_user = {x["user_id"]: x for x in body["results"]}
    assert by_user[m1["id"]]["status"] == "queued" and by_user[m2["id"]]["status"] == "queued"
    assert body["summary"] == {"queued": 2, "skipped": 0, "failed": 0}
    assert len(_notifs(m1["id"])) == before + 1


def test_BT39_쿨다운_안의_재요청은_대상별로_건너뛴다(client):
    host = _register(client, "b7h6@test.com")
    m1 = _register(client, "b7m6@test.com", role="client")
    cls = _class(client, host)
    _invite(client, cls, host, m1)
    assert _remind(client, cls, host).json()["results"][0]["status"] == "queued"
    second = _remind(client, cls, host).json()
    assert second["results"][0]["status"] == "skipped_cooldown"
    assert second["summary"] == {"queued": 0, "skipped": 1, "failed": 0}
    assert len(_notifs(m1["id"], event_type="session_invited")) == 2, "초대 1 + 재발송 1 (쿨다운 건은 생성 없음)"


def test_BT39_대상_지정_게스트_대기자_미등록은_구분되고_알림_안_생김(client):
    host = _register(client, "b7h7@test.com")
    member = _register(client, "b7m7@test.com", role="client")
    cls = _create_class(client, host["h"], participant_mode="group", max_participants=1)
    _open_class(client, cls, host["h"])
    guest = enter_guest(client, cls["access_code"], "손님").json()  # 정원 1 → 활성
    _invite(client, cls, host, member)  # 정원 초과 → 대기열

    r = _remind(client, cls, host, {"participant_ids": [guest["participant_id"], str(uuid.uuid4())]}).json()
    statuses = {x["participant_id"]: x["status"] for x in r["results"]}
    assert statuses[guest["participant_id"]] == "skipped_no_account"
    assert sorted(statuses.values()) == ["not_found", "skipped_no_account"]

    all_members = _remind(client, cls, host).json()
    assert sorted(x["status"] for x in all_members["results"]) == ["skipped_no_account", "skipped_waitlisted"]


def test_BT39_종료_취소_클래스는_400(client):
    host = _register(client, "b7h8@test.com")
    cls = _class(client, host)
    assert client.post(f"/api/v1/sessions/{cls['id']}/cancel", headers=host["h"]).status_code == 200
    assert _remind(client, cls, host).status_code == 400


def test_BT39_알림_생성_실패는_대상별_failed로_노출(client, monkeypatch):
    from app.services import notification_service

    host = _register(client, "b7h9@test.com")
    m1 = _register(client, "b7m9@test.com", role="client")
    cls = _class(client, host)
    _invite(client, cls, host, m1)
    monkeypatch.setattr(notification_service, "notify_event", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
    r = _remind(client, cls, host).json()
    assert r["results"][0]["status"] == "failed"
    assert r["summary"] == {"queued": 0, "skipped": 0, "failed": 1}


# ── BT40: 성공 과장 금지 ───────────────────────────────────────────────


def test_BT40_전달_수신_확정_필드와_문구가_없다(client):
    host = _register(client, "b7h10@test.com")
    m1 = _register(client, "b7m10@test.com", role="client")
    cls = _class(client, host)
    inv = _invite(client, cls, host, m1).json()["invite_result"]
    rem = _remind(client, cls, host).json()
    for payload in (inv, rem):
        assert not (set(_keys(payload)) & FORBIDDEN_KEYS), set(_keys(payload)) & FORBIDDEN_KEYS
        text = json.dumps(payload, ensure_ascii=False)
        for word in ("전달됐", "전달되었", "수신", "푸시"):
            assert word not in text
    # 알림 본문도 푸시 수신·전달을 약속하지 않는다
    for n in _notifs(m1["id"]):
        assert "푸시" not in (n.body or "") and "전달" not in (n.body or "")


# ── BT46 / LG6: 리마인더 본문 ──────────────────────────────────────────


def _message(client, host, mutate=None):
    from app.models.session import Session
    from app.services import reminder_service

    cls = _class(client, host)
    db = _db()
    try:
        s = db.query(Session).filter(Session.id == uuid.UUID(cls["id"])).first()
        if mutate:
            mutate(s)
        return cls, reminder_service.build_reminder_message(s, 1440), reminder_service
    finally:
        db.close()


def test_BT46_리마인더_본문은_4자리_코드와_join_링크_코드는_URL에_없다(client):
    host = _register(client, "b7h11@test.com")
    cls, msg, _ = _message(client, host)
    code = cls["access_code"]
    assert len(code) == 4 and code.isdigit()
    body, html = msg["body_text"], msg["body_html"]
    assert f"코드: {code}" in body and code in html
    assert "/join" in body and "/join" in html
    # 코드는 링크(URL)에 싣지 않는다
    import re

    for text in (body, html):
        for url in re.findall(r"https?://[^\s\"<>']+", text):
            assert code not in url
    assert "------" not in body and "참여코드: " not in body


def test_BT46_구_6자리_코드는_본문과_extra에_노출하지_않는다(client):
    host = _register(client, "b7h12@test.com")

    def legacy(s):
        s.access_code = "123456"

    _, msg, svc = _message(client, host, legacy)
    assert "123456" not in msg["body_text"] and "123456" not in msg["body_html"]
    assert "상담사에게" in msg["body_text"]
    assert svc.public_access_code("123456") is None and svc.public_access_code("0042") == "0042"


def test_BT46_리마인더_알림_extra의_access_code는_4자리(client):
    from app.models.session import Session
    from app.services import reminder_service

    host = _register(client, "b7h13@test.com")
    m1 = _register(client, "b7m13@test.com", role="client")
    cls = _class(client, host)
    _invite(client, cls, host, m1)
    db = _db()
    try:
        s = db.query(Session).filter(Session.id == uuid.UUID(cls["id"])).first()
        reminder_service._dispatch_channels(s, 1440, {"user_id": m1["id"], "email": None, "name": "회원"}, db)
        db.commit()
    finally:
        db.close()
    rows = _notifs(m1["id"], event_type="session_reminder")
    assert rows and rows[0].extra["params"]["access_code"] == cls["access_code"]
    assert len(rows[0].extra["params"]["access_code"]) == 4
