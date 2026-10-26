"""[MB261026][FIX] 채팅 신고 운영 처리(D4) — verify V-01~V-18, V-27~V-28, V-39~V-41.

- 플랫폼 관리자만 신고 목록·상세·상태 전이를 쓴다. 열람·처리는 verification_audits 에 남는다.
- 처리 상태는 기록일 뿐이다. 자동 삭제·자동 정지·자동 차단은 없다.
- 운영 전용 수신 주소(moderation_notice_email)가 없으면 메일 outbox 를 만들지 않는다.
- 실제 메일은 보내지 않는다(발송 함수·HTTP 클라이언트·outbox 소비자 호출 0 을 확인한다).
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.config import settings
from app.models.chat import ChatBlock, ChatMessage, ChatReport
from app.models.credential import VerificationAudit
from app.models.notification_outbox import NotificationOutbox
from app.models.user import User
from tests.test_chat import _close_db, _link, _register, _test_db

OPS_EMAIL = "ops-test@example.invalid"
SECRET_TEXT = "신고된 문제 발언 원문"


@pytest.fixture(autouse=True)
def _no_mail(monkeypatch):
    """메일 발송 경로 전체를 가로채 호출 수를 센다. 어떤 시나리오에서도 0 이어야 한다(V-41)."""
    import app.tasks.email as email_tasks
    import app.tasks.outbox as outbox_tasks

    calls: list[str] = []

    def _fake(name):
        def _inner(*args, **kwargs):
            calls.append(name)
            return True

        return _inner

    monkeypatch.setattr(email_tasks, "_send_email", _fake("_send_email"))
    if hasattr(email_tasks, "send_email_notification"):
        monkeypatch.setattr(email_tasks, "send_email_notification", _fake("send_email_notification"))
    monkeypatch.setattr(outbox_tasks, "send_email_notification", _fake("outbox.send_email_notification"))
    monkeypatch.setattr(outbox_tasks, "process_email_outbox", _fake("process_email_outbox"))
    monkeypatch.setattr(email_tasks.httpx, "Client", _fake("httpx.Client"))
    monkeypatch.setattr(settings, "moderation_notice_email", OPS_EMAIL)
    yield calls
    assert calls == [], f"메일 발송 경로가 호출됨: {calls}"


# ── 헬퍼 ──


def _set_role(user_id, role):
    db_gen, db = _test_db()
    try:
        user = db.query(User).filter(User.id == uuid.UUID(user_id)).first()
        user.role = role
        db.commit()
    finally:
        _close_db(db_gen)


def _admin(client, email="cr-admin@test.com"):
    admin = _register(client, email, "counselor")
    _set_role(admin["id"], "platform_admin")
    return admin


def _pair(client, tag):
    host = _register(client, f"{tag}@test.com", role="counselor")
    member = _register(client, f"{tag}-m@test.com", role="client")
    _link(host["id"], member["id"])
    res = client.post(
        "/api/v1/chat/rooms",
        json={"room_type": "direct", "client_id": member["id"]},
        headers=host["auth"],
    )
    assert res.status_code == 201, res.text
    return host, member, res.json()["id"]


def _reported(client, tag, text=SECRET_TEXT, reason="abuse"):
    """상담사(host)의 메시지를 회원(member)이 신고한다. (host, member, room_id, report_id)"""
    host, member, room = _pair(client, tag)
    msg = client.post(
        f"/api/v1/chat/rooms/{room}/messages",
        json={"content": text, "type": "text"},
        headers=host["auth"],
    ).json()
    res = client.post(
        "/api/v1/chat/reports",
        json={"target_user_id": host["id"], "room_id": room, "message_id": msg["id"], "reason": reason, "operation_key": f"op-{tag}"},
        headers=member["auth"],
    )
    assert res.status_code == 201, res.text
    return host, member, room, res.json()["report_id"]


def _list(client, admin, **params):
    return client.get("/api/v1/admin/chat-reports", params=params, headers=admin["auth"])


def _detail(client, admin, rid):
    return client.get(f"/api/v1/admin/chat-reports/{rid}", headers=admin["auth"])


def _move(client, admin, rid, to, note=None):
    body = {"to": to} if note is None else {"to": to, "note": note}
    return client.post(f"/api/v1/admin/chat-reports/{rid}/transition", json=body, headers=admin["auth"])


def _audits(**filters):
    db_gen, db = _test_db()
    try:
        q = db.query(VerificationAudit)
        for key, value in filters.items():
            q = q.filter(getattr(VerificationAudit, key) == value)
        return [
            {"action": a.action, "target_id": str(a.target_id) if a.target_id else None, "reason": a.reason, "extra": a.extra, "admin_id": str(a.admin_id)}
            for a in q.order_by(VerificationAudit.created_at).all()
        ]
    finally:
        _close_db(db_gen)


def _report_row(rid):
    db_gen, db = _test_db()
    try:
        r = db.query(ChatReport).filter(ChatReport.id == uuid.UUID(rid)).first()
        return {
            "status": r.status,
            "acknowledged_at": r.acknowledged_at,
            "decided_at": r.decided_at,
            "handled_by": str(r.handled_by) if r.handled_by else None,
            "resolution_note": r.resolution_note,
        }
    finally:
        _close_db(db_gen)


def _all_endpoints(rid="00000000-0000-0000-0000-000000000000", term_id="00000000-0000-0000-0000-000000000000"):
    return [
        ("get", "/api/v1/admin/chat-reports", None),
        ("get", f"/api/v1/admin/chat-reports/{rid}", None),
        ("post", f"/api/v1/admin/chat-reports/{rid}/transition", {"to": "reviewing"}),
        ("get", "/api/v1/admin/chat-filter-terms", None),
        ("post", "/api/v1/admin/chat-filter-terms", {"term": "권한검사"}),
        ("delete", f"/api/v1/admin/chat-filter-terms/{term_id}", None),
    ]


def _call(client, method, url, body, headers):
    if body is None:
        return getattr(client, method)(url, headers=headers) if headers else getattr(client, method)(url)
    return getattr(client, method)(url, json=body, headers=headers) if headers else getattr(client, method)(url, json=body)


# ───────────────────────── 1. 권한 ─────────────────────────


def test_V01_V02_관리자가_아니면_6개_API_모두_403(client):
    host, member, room, rid = _reported(client, "v01")
    org_admin = _register(client, "v01-org@test.com", "counselor")
    _set_role(org_admin["id"], "org_admin")
    before_status = _report_row(rid)["status"]
    for who in (member, host, org_admin):
        for method, url, body in _all_endpoints(rid):
            res = _call(client, method, url, body, who["auth"])
            assert res.status_code == 403, (method, url, res.text)
            assert "플랫폼 관리자만 접근 가능합니다" in res.text
    assert _report_row(rid)["status"] == before_status
    assert _audits() == []


def test_V03_미인증은_401(client):
    for method, url, body in _all_endpoints():
        assert _call(client, method, url, body, None).status_code == 401, (method, url)


def test_V04_없는_ID나_잘못된_ID는_404(client):
    admin = _admin(client)
    for rid in ("00000000-0000-0000-0000-000000000000", "not-a-uuid"):
        assert _detail(client, admin, rid).status_code == 404
        assert _move(client, admin, rid, "reviewing").status_code == 404
        assert client.delete(f"/api/v1/admin/chat-filter-terms/{rid}", headers=admin["auth"]).status_code == 404


# ───────────────────────── 2. 목록·상세·전이·감사 ─────────────────────────


def test_V05_신고는_관리자_목록에_발췌와_이메일_없이_나온다(client):
    host, member, room, rid = _reported(client, "v05")
    admin = _admin(client)
    res = _list(client, admin)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 1 and len(body["items"]) == 1
    item = body["items"][0]
    assert item["id"] == rid and item["status"] == "submitted" and item["reason"] == "abuse"
    assert item["reporter"]["id"] == member["id"] and item["reported_user"]["id"] == host["id"]
    assert item["reporter"]["name"] and item["room_type"] == "direct" and item["has_message"] is True
    assert item["ack_due_at"] and item["decision_due_at"]
    assert item["ack_overdue"] is False and item["decision_overdue"] is False
    assert body["counts"]["submitted"] == 1
    assert body["notice_email_configured"] is True
    assert SECRET_TEXT not in res.text and "message_excerpt" not in res.text
    assert "@test.com" not in res.text and "email" not in item["reporter"]
    audits = _audits(action="chat_report_list")
    assert len(audits) == 1 and audits[0]["admin_id"] == admin["id"]


def test_V06_상세는_발췌를_보여_주고_열람을_감사한다(client):
    host, member, room, rid = _reported(client, "v06")
    # 같은 방의 다른 메시지는 상세에 나오면 안 된다
    client.post(f"/api/v1/chat/rooms/{room}/messages", json={"content": "다른 대화 내용", "type": "text"}, headers=member["auth"])
    admin = _admin(client)
    res = _detail(client, admin, rid)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["message_excerpt"] == SECRET_TEXT
    assert body["reporter"]["email"] == "v06-m@test.com" and body["reported_user"]["email"] == "v06@test.com"
    assert body["room_id"] == room and body["message_id"]
    assert "다른 대화 내용" not in res.text
    audits = _audits(action="chat_report_view")
    assert len(audits) == 1 and audits[0]["target_id"] == rid
    assert all(SECRET_TEXT not in str(a) for a in _audits())


def test_V07_접수에서_검토중으로_옮기면_접수_확인_시각과_처리자가_남는다(client):
    *_, rid = _reported(client, "v07")
    admin = _admin(client)
    res = _move(client, admin, rid, "reviewing")
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "reviewing"
    # 전이 응답에는 발췌·이메일을 싣지 않는다(열람은 상세 조회로만 — 감사 1행)
    assert SECRET_TEXT not in res.text and "@test.com" not in res.text
    assert _audits(action="chat_report_view") == []
    row = _report_row(rid)
    assert row["acknowledged_at"] is not None and row["decided_at"] is None
    assert row["handled_by"] == admin["id"]
    audits = _audits(action="chat_report_transition")
    assert len(audits) == 1 and audits[0]["target_id"] == rid
    assert audits[0]["extra"] == {"from": "submitted", "to": "reviewing"}


def test_V08_판단에는_메모가_필요하다(client):
    *_, rid = _reported(client, "v08")
    admin = _admin(client)
    assert _move(client, admin, rid, "reviewing").status_code == 200
    for note in (None, "   ", "가" * 1001):
        assert _move(client, admin, rid, "actioned", note).status_code == 422, note
    assert _report_row(rid)["status"] == "reviewing"


def test_V09_조치_완료는_판단_시각과_메모를_남긴다(client):
    *_, rid = _reported(client, "v09")
    admin = _admin(client)
    assert _move(client, admin, rid, "reviewing").status_code == 200
    res = _move(client, admin, rid, "actioned", "경고 메일 발송함")
    assert res.status_code == 200, res.text
    row = _report_row(rid)
    assert row["status"] == "actioned" and row["decided_at"] is not None
    assert row["resolution_note"] == "경고 메일 발송함"
    last = _audits(action="chat_report_transition")[-1]
    assert last["reason"] == "경고 메일 발송함" and last["extra"] == {"from": "reviewing", "to": "actioned"}
    history = _detail(client, admin, rid).json()["history"]
    assert [(h["from_status"], h["to_status"]) for h in history] == [("submitted", "reviewing"), ("reviewing", "actioned")]


def test_V10_접수에서_바로_종결할_수_있다(client):
    *_, rid = _reported(client, "v10")
    admin = _admin(client)
    assert _move(client, admin, rid, "dismissed", "위반 아님").status_code == 200
    row = _report_row(rid)
    assert row["acknowledged_at"] is not None and row["acknowledged_at"] == row["decided_at"]


def test_V11_종결된_신고는_다시_옮길_수_없다(client):
    *_, rid = _reported(client, "v11")
    admin = _admin(client)
    assert _move(client, admin, rid, "dismissed", "위반 아님").status_code == 200
    for to, note in (("reviewing", None), ("actioned", "x"), ("dismissed", "y")):
        res = _move(client, admin, rid, to, note)
        assert res.status_code == 409 and res.json()["detail"]["code"] == "REPORT_CLOSED"
    assert _report_row(rid)["status"] == "dismissed"


def test_V12_같은_상태_재요청은_변화도_감사도_없다(client):
    *_, rid = _reported(client, "v12")
    admin = _admin(client)
    assert _move(client, admin, rid, "reviewing").status_code == 200
    first = _report_row(rid)
    assert _move(client, admin, rid, "reviewing").status_code == 200
    assert _report_row(rid) == first
    assert len(_audits(action="chat_report_transition")) == 1


def test_V13_허용되지_않은_목표_상태는_422(client):
    *_, rid = _reported(client, "v13")
    admin = _admin(client)
    for to in ("submitted", "withdrawn", "foo"):
        assert _move(client, admin, rid, to, "메모").status_code == 422
    assert _report_row(rid)["status"] == "submitted"


def test_V14_조치_완료가_자동_삭제_정지_차단을_하지_않는다(client):
    host, member, room, rid = _reported(client, "v14")
    db_gen, db = _test_db()
    try:
        blocks_before = db.query(ChatBlock).count()
        messages_before = db.query(ChatMessage).count()
    finally:
        _close_db(db_gen)
    admin = _admin(client)
    assert _move(client, admin, rid, "actioned", "운영 판단").status_code == 200
    db_gen, db = _test_db()
    try:
        assert db.query(User).filter(User.id == uuid.UUID(host["id"])).first().status == "active"
        assert db.query(ChatBlock).count() == blocks_before
        assert db.query(ChatMessage).count() == messages_before
    finally:
        _close_db(db_gen)


def test_V15_상태_필터_정렬_개수_페이지(client):
    *_, r1 = _reported(client, "v15a")
    *_, r2 = _reported(client, "v15b")
    *_, r3 = _reported(client, "v15c")
    # SQLite now() 는 초 단위라 접수 시각을 명시적으로 벌려 정렬을 고정한다.
    db_gen, db = _test_db()
    try:
        base = datetime(2026, 10, 26, 1, 0, tzinfo=timezone.utc)
        for offset, rid in enumerate((r1, r2, r3)):
            db.query(ChatReport).filter(ChatReport.id == uuid.UUID(rid)).update({"created_at": base + timedelta(minutes=offset)})
        db.commit()
    finally:
        _close_db(db_gen)
    admin = _admin(client)
    assert _move(client, admin, r2, "reviewing").status_code == 200
    body = _list(client, admin).json()
    assert [i["id"] for i in body["items"]] == [r3, r2, r1]  # 최신순
    assert body["counts"] == {"submitted": 2, "reviewing": 1, "actioned": 0, "dismissed": 0, "withdrawn": 0}
    only = _list(client, admin, status="reviewing").json()
    assert [i["id"] for i in only["items"]] == [r2] and only["total"] == 1
    page2 = _list(client, admin, page=2, size=2).json()
    assert [i["id"] for i in page2["items"]] == [r1] and page2["total"] == 3
    assert _list(client, admin, status="nope").status_code == 422


# ───────────────────────── 3. 철회 ─────────────────────────


def _withdraw(client, member, rid):
    return client.post(f"/api/v1/chat/reports/{rid}/withdraw", headers=member["auth"])


def test_V16_V17_철회된_신고는_목록에_남고_옮길_수_없다(client):
    host, member, room, rid = _reported(client, "v16")
    assert _withdraw(client, member, rid).status_code == 200
    admin = _admin(client)
    item = _list(client, admin).json()["items"][0]
    assert item["status"] == "withdrawn"
    assert item["ack_overdue"] is False and item["decision_overdue"] is False
    res = _move(client, admin, rid, "reviewing")
    assert res.status_code == 409 and res.json()["detail"]["code"] == "REPORT_WITHDRAWN"
    assert _report_row(rid)["status"] == "withdrawn"


def test_V18_검토가_시작된_신고는_신고자가_철회할_수_없다(client):
    host, member, room, rid = _reported(client, "v18")
    admin = _admin(client)
    assert _move(client, admin, rid, "reviewing").status_code == 200
    res = _withdraw(client, member, rid)
    assert res.status_code == 409 and res.json()["detail"]["code"] == "REPORT_ALREADY_PROCESSED"
    assert _report_row(rid)["status"] == "reviewing"


# ───────────────────────── 4. 기한 초과 ─────────────────────────


def _freeze(monkeypatch, when):
    from app.services import chat_report_admin_service

    monkeypatch.setattr(chat_report_admin_service, "_now", lambda: when)


def test_V27_V28_기한_초과_판정과_필터(client, monkeypatch):
    *_, rid = _reported(client, "v27")
    *_, other = _reported(client, "v27b")
    admin = _admin(client)
    _freeze(monkeypatch, datetime.now(timezone.utc) + timedelta(days=30))

    items = {i["id"]: i for i in _list(client, admin).json()["items"]}
    assert items[rid]["ack_overdue"] is True and items[rid]["decision_overdue"] is True
    overdue = _list(client, admin, overdue="true").json()
    assert {i["id"] for i in overdue["items"]} == {rid, other}

    assert _move(client, admin, rid, "reviewing").status_code == 200
    item = next(i for i in _list(client, admin).json()["items"] if i["id"] == rid)
    assert item["ack_overdue"] is False and item["decision_overdue"] is True

    assert _move(client, admin, rid, "dismissed", "종결").status_code == 200
    assert _move(client, admin, other, "actioned", "조치").status_code == 200
    assert _list(client, admin, overdue="true").json()["items"] == []


def test_기한_전에는_초과가_아니다(client, monkeypatch):
    *_, rid = _reported(client, "v27c")
    admin = _admin(client)
    _freeze(monkeypatch, datetime.now(timezone.utc) + timedelta(minutes=1))
    assert _list(client, admin, overdue="true").json()["items"] == []


# ───────────────────────── 6. 운영 주소·메일 ─────────────────────────


def _email_rows():
    db_gen, db = _test_db()
    try:
        return [
            {"recipient": o.recipient, "payload": o.payload, "status": o.status}
            for o in db.query(NotificationOutbox).filter(NotificationOutbox.channel == "email").all()
        ]
    finally:
        _close_db(db_gen)


def test_V39_운영_주소가_있으면_관리자_링크와_기한만_담은_outbox_1행(client):
    host, member, room, rid = _reported(client, "v39")
    rows = _email_rows()
    assert len(rows) == 1
    row = rows[0]
    assert row["recipient"] == OPS_EMAIL and row["status"] == "pending"
    body = row["payload"]["body"]
    assert f"/admin/chat-reports?report={rid}" in body
    assert "접수 확인 기한" in body and "1차 판단 기한" in body
    assert "chat_reports 테이블" not in body
    text = str(row["payload"])
    assert SECRET_TEXT not in text and "@test.com" not in text and "테스트" not in text


def test_V40_운영_주소가_없으면_outbox를_만들지_않고_개인_주소로_가지_않는다(client, monkeypatch, caplog):
    monkeypatch.setattr(settings, "moderation_notice_email", "")
    monkeypatch.setattr(settings, "signup_notice_email", "personal@example.invalid")
    with caplog.at_level(logging.WARNING):
        host, member, room, rid = _reported(client, "v40")
    assert _email_rows() == []
    db_gen, db = _test_db()
    try:
        assert db.query(ChatBlock).count() == 1
    finally:
        _close_db(db_gen)
    warnings = [r.getMessage() for r in caplog.records if r.levelno >= logging.WARNING and rid in r.getMessage()]
    assert len(warnings) == 1
    assert SECRET_TEXT not in warnings[0] and "@" not in warnings[0]
    admin = _admin(client)
    assert _list(client, admin).json()["notice_email_configured"] is False


def test_V41_전_과정에서_메일_발송_함수는_호출되지_않는다(client, _no_mail):
    *_, rid = _reported(client, "v41")
    admin = _admin(client)
    _list(client, admin)
    _detail(client, admin, rid)
    _move(client, admin, rid, "reviewing")
    _move(client, admin, rid, "actioned", "조치")
    assert _no_mail == []
