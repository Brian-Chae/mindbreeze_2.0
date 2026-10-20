"""SDD-220 TS32~TS35 — 채팅 신고·상호 차단 (서버 경계).

REST·WS·그룹 방 수신 필터·초대·미읽음·preview 를 서버에서 막는지, 신고 트랜잭션의 원자성·멱등을 검증한다.
메일은 실제로 보내지 않는다(outbox 행 생성만 확인, 발송 함수는 monkeypatch).
"""

import asyncio

import pytest
from sqlalchemy.exc import IntegrityError

import app.ws.chat_namespace as chat_ws
from app.config import settings
from app.models.chat import ChatBlock, ChatMessage, ChatReport
from app.models.notification_outbox import NotificationOutbox
from tests.test_chat import _close_db, _link, _register, _test_db


def _post(client, room_id, who, text="안녕하세요"):
    return client.post(
        f"/api/v1/chat/rooms/{room_id}/messages",
        json={"content": text, "type": "text"},
        headers=who["auth"],
    )


def _report(client, who, target_id, **kw):
    body = {"target_user_id": target_id, **kw}
    return client.post("/api/v1/chat/reports", json=body, headers=who["auth"])


def _counts():
    db_gen, db = _test_db()
    try:
        return {
            "reports": db.query(ChatReport).count(),
            "blocks": db.query(ChatBlock).count(),
            "emails": db.query(NotificationOutbox).filter(NotificationOutbox.channel == "email").count(),
            "messages": db.query(ChatMessage).count(),
        }
    finally:
        _close_db(db_gen)


def _direct_pair(client, tag):
    """상담사(host) ↔ 내담자 1:1 방. (host, member, room_id)"""
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


def _room_of(client, who, room_id):
    rooms = client.get("/api/v1/chat/rooms", headers=who["auth"]).json()["rooms"]
    return next(r for r in rooms if r["id"] == room_id)


# ───────────────────────── TS32 ─────────────────────────


def test_TS32_메시지_신고는_상호_차단과_운영_알림을_같이_만든다(client):
    host, member, room_id = _direct_pair(client, "ts32a")
    msg = _post(client, room_id, host, "문제 발언").json()

    res = _report(client, member, host["id"], room_id=room_id, message_id=msg["id"], reason="abuse", operation_key="op-1")
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["reported"] is True and body["blocked"] is True and body["report_id"]

    db_gen, db = _test_db()
    try:
        assert db.query(ChatReport).count() == 1
        blocks = db.query(ChatBlock).all()
        assert len(blocks) == 1
        assert str(blocks[0].user_low_id) < str(blocks[0].user_high_id)  # 정규화
        mails = db.query(NotificationOutbox).filter(NotificationOutbox.channel == "email").all()
        assert len(mails) == 1
        assert mails[0].recipient == settings.signup_notice_email
        assert mails[0].status == "pending"
        assert "문제 발언" not in str(mails[0].payload)  # 대화 내용은 메일에 싣지 않는다
    finally:
        _close_db(db_gen)

    # 양방향 is_blocked
    assert _room_of(client, member, room_id)["is_blocked"] is True
    assert _room_of(client, host, room_id)["is_blocked"] is True


def test_TS32_같은_operation_재전송은_중복_신고와_메일을_만들지_않는다(client):
    host, member, room_id = _direct_pair(client, "ts32b")
    first = _report(client, member, host["id"], room_id=room_id, reason="", operation_key="same-op")
    second = _report(client, member, host["id"], room_id=room_id, reason="", operation_key="same-op")
    assert first.status_code == second.status_code == 201
    assert first.json() == second.json()
    c = _counts()
    assert (c["reports"], c["blocks"], c["emails"]) == (1, 1, 1)


def test_TS32_상대_프로필_신고는_메시지_없이도_된다(client):
    host, member, room_id = _direct_pair(client, "ts32c")
    res = _report(client, member, host["id"])
    assert res.status_code == 201, res.text
    assert _counts()["blocks"] == 1


def test_TS32_사유_없이_신고해도_된다(client):
    host, member, room_id = _direct_pair(client, "ts32d")
    assert _report(client, host, member["id"], reason=None).status_code == 201


# ───────────────────────── TS33 ─────────────────────────


def test_TS33_차단_후_양쪽_전송과_방_재생성_초대가_서버에서_막힌다(client):
    host, member, room_id = _direct_pair(client, "ts33a")
    old = _post(client, room_id, host, "차단 전 메시지").json()
    assert _report(client, member, host["id"], room_id=room_id, operation_key="k").status_code == 201
    before = _counts()["messages"]

    for who in (host, member):
        res = _post(client, room_id, who, "차단 후 전송")
        assert res.status_code == 403
        assert res.json()["detail"]["code"] == "CHAT_BLOCKED"
    assert _counts()["messages"] == before  # 메시지 행 증가 0

    # 방 재생성 우회
    res = client.post("/api/v1/chat/rooms", json={"room_type": "direct", "client_id": member["id"]}, headers=host["auth"])
    assert res.status_code == 403 and res.json()["detail"]["code"] == "CHAT_BLOCKED"
    # 그룹 방 생성 시 차단 상대 포함 불가
    res = client.post(
        "/api/v1/chat/rooms",
        json={"room_type": "group", "participant_ids": [member["id"]], "name": "우회"},
        headers=host["auth"],
    )
    assert res.status_code == 403 and res.json()["detail"]["code"] == "CHAT_BLOCKED"

    # 신고자(member)에게는 상대(host)의 이전 메시지도 보이지 않는다
    msgs = client.get(f"/api/v1/chat/rooms/{room_id}/messages", headers=member["auth"]).json()["messages"]
    assert old["id"] not in [m["id"] for m in msgs]
    # context 직접 접근: 차단 상대 메시지를 앵커로 하면 404
    ctx = client.get(f"/api/v1/chat/rooms/{room_id}/messages/{old['id']}/context", headers=member["auth"])
    assert ctx.status_code == 404
    around = client.get(f"/api/v1/chat/rooms/{room_id}/messages-around?message_id={old['id']}", headers=member["auth"])
    assert around.status_code == 404
    # 미읽음·preview 에서 상대 콘텐츠 0
    room = _room_of(client, member, room_id)
    assert room["unread_count"] == 0
    assert room["last_message"] is None
    unread = client.get(f"/api/v1/chat/rooms/{room_id}/unread-counts", headers=member["auth"]).json()["unread_counts"]
    assert old["id"] not in unread
    # 읽음 처리도 차단 상대 메시지에는 기록하지 않는다
    assert client.put(f"/api/v1/chat/rooms/{room_id}/read", headers=member["auth"]).status_code == 204
    db_gen, db = _test_db()
    try:
        from app.models.chat import ChatMessageRead

        reads = db.query(ChatMessageRead).filter(ChatMessageRead.user_id == member["id"]).count()
        assert reads == 0
    finally:
        _close_db(db_gen)


def test_TS33_차단_상대는_초대_후보_검색에서_제외되고_직접_id_초대도_막힌다(client):
    from tests.conftest import create_test_counselor, create_test_org

    org = create_test_org()
    a = create_test_counselor("inv-a@test.com", name="상담사A", org_code=org)
    b = create_test_counselor("inv-b@test.com", name="상담사B", org_code=org)
    ha = {"id": a["id"], "auth": {"Authorization": f"Bearer {a['access_token']}"}}
    hb = {"id": b["id"], "auth": {"Authorization": f"Bearer {b['access_token']}"}}

    def candidates():
        res = client.get("/api/v1/chat/invitable-counselors", headers=ha["auth"])
        assert res.status_code == 200, res.text
        return [c["user_id"] for c in res.json()["counselors"]]

    assert hb["id"] in candidates()

    # 둘이 공유하는 방이 있어야 신고가 가능하다: A 가 host 인 그룹에 B 초대
    member = _register(client, "inv-member@test.com", role="client")
    _link(ha["id"], member["id"])
    room = client.post(
        "/api/v1/chat/rooms", json={"room_type": "group", "participant_ids": [member["id"]], "name": "g"}, headers=ha["auth"]
    ).json()
    add = client.post(f"/api/v1/chat/rooms/{room['id']}/participants", json={"participant_ids": [hb["id"]]}, headers=ha["auth"])
    assert add.status_code == 200, add.text

    assert _report(client, ha, hb["id"], room_id=room["id"]).status_code == 201
    assert hb["id"] not in candidates()

    # 다른 그룹에 직접 id 로 초대 시도
    other = client.post(
        "/api/v1/chat/rooms", json={"room_type": "group", "participant_ids": [member["id"]], "name": "g2"}, headers=ha["auth"]
    ).json()
    res = client.post(f"/api/v1/chat/rooms/{other['id']}/participants", json={"participant_ids": [hb["id"]]}, headers=ha["auth"])
    assert res.status_code == 403 and res.json()["detail"]["code"] == "CHAT_BLOCKED"


class _FakeSio:
    def __init__(self):
        self.emits = []
        self.rooms = {}

    async def emit(self, event, data=None, room=None, to=None, namespace=None):
        self.emits.append({"event": event, "data": data, "room": room, "to": to})

    async def enter_room(self, sid, room, namespace=None):
        self.rooms.setdefault(sid, set()).add(room)

    async def leave_room(self, sid, room, namespace=None):
        pass


def _wire_ws(monkeypatch):
    fake = _FakeSio()
    monkeypatch.setattr(chat_ws, "sio", fake)
    chat_ws._sid_users.clear()
    chat_ws._user_sids.clear()
    return fake


def test_TS33_이미_열린_소켓의_전송도_서버가_CHAT_BLOCKED_로_거부한다(client, monkeypatch):
    fake = _wire_ws(monkeypatch)
    host, member, room_id = _direct_pair(client, "ts33ws")
    chat_ws._sid_users["old-sid"] = host["id"]  # 차단 전에 연결해 둔 소켓
    assert _report(client, member, host["id"], room_id=room_id).status_code == 201

    ack = asyncio.run(chat_ws.on_message("old-sid", {"room_id": room_id, "content": "몰래 보내기"}))
    assert ack == {"ok": False, "error": {"code": "CHAT_BLOCKED"}}
    assert fake.emits == []  # 상대(및 방 전체) emit 0


def test_TS33_차단되지_않은_direct_WS_전송은_정상이다(client, monkeypatch):
    fake = _wire_ws(monkeypatch)
    host, member, room_id = _direct_pair(client, "ts33ok")
    chat_ws._sid_users["sid"] = host["id"]
    ack = asyncio.run(chat_ws.on_message("sid", {"room_id": room_id, "content": "안녕"}))
    assert ack == {"ok": True}
    assert [e["room"] for e in fake.emits] == [room_id]


# ───────────────────────── TS34 ─────────────────────────


def _group_with_three(client, tag):
    """host H, 내담자 A·B·C 가 있는 그룹 방. (H, A, B, C, room_id)"""
    host = _register(client, f"{tag}-h@test.com", role="counselor")
    people = [_register(client, f"{tag}-{n}@test.com", role="client") for n in "abc"]
    for p in people:
        _link(host["id"], p["id"])
    res = client.post(
        "/api/v1/chat/rooms",
        json={"room_type": "group", "participant_ids": [p["id"] for p in people], "name": "그룹"},
        headers=host["auth"],
    )
    assert res.status_code == 201, res.text
    return (host, *people, res.json()["id"])


def test_TS34_그룹_방에서_차단된_사람의_메시지는_알림과_emit_없이_나머지에게만_간다(client, monkeypatch):
    fake = _wire_ws(monkeypatch)
    host, a, b, c, room_id = _group_with_three(client, "ts34")
    first = _post(client, room_id, b, "차단 전").json()
    assert _report(client, a, b["id"], room_id=room_id, message_id=first["id"]).status_code == 201

    fake.emits.clear()
    sent = _post(client, room_id, b, "차단 후 그룹 메시지")
    assert sent.status_code == 201, sent.text  # 차단되지 않은 사람 사이의 대화는 방해하지 않는다
    mid = sent.json()["id"]

    # emit: 방 전체 broadcast 없이 허용된 사용자 개인 room 만 (A 제외)
    targets = {e["room"] for e in fake.emits if e["event"] == "new_message"}
    assert room_id not in targets
    assert f"user:{a['id']}" not in targets
    assert {f"user:{host['id']}", f"user:{c['id']}", f"user:{b['id']}"} == targets

    # REST: A 는 B 의 메시지(과거 포함)를 못 보고, B 도 A 쪽은 대칭, C 는 정상 수신
    ids = lambda who: [m["id"] for m in client.get(f"/api/v1/chat/rooms/{room_id}/messages", headers=who["auth"]).json()["messages"]]
    assert mid not in ids(a) and first["id"] not in ids(a)
    assert mid in ids(c) and mid in ids(host)
    assert client.get(f"/api/v1/chat/rooms/{room_id}/messages/{mid}/context", headers=a["auth"]).status_code == 404
    assert client.get(f"/api/v1/chat/rooms/{room_id}/messages/{mid}/context", headers=c["auth"]).status_code == 200
    assert _room_of(client, a, room_id)["unread_count"] == 0
    assert _room_of(client, c, room_id)["unread_count"] >= 2
    assert mid not in client.get(f"/api/v1/chat/rooms/{room_id}/unread-counts", headers=a["auth"]).json()["unread_counts"]

    # 알림·푸시 outbox: A 에게 0, C 에게 있음
    db_gen, db = _test_db()
    try:
        from app.models.notification import Notification

        def pushes(uid):
            return db.query(NotificationOutbox).filter(
                NotificationOutbox.channel == "push", NotificationOutbox.user_id == uid
            ).count()

        # 신고 전 메시지에 대한 푸시는 이미 있을 수 있으므로 차단 후 메시지(mid) 기준으로 센다.
        mid_pushes = db.query(NotificationOutbox).filter(NotificationOutbox.channel == "push").all()
        recipients = {str(r.user_id) for r in mid_pushes if r.payload.get("message_id") == mid}
        assert str(a["id"]) not in recipients
        assert {str(c["id"]), str(host["id"])} <= recipients
        notified = {
            str(n.user_id)
            for n in db.query(Notification).filter(Notification.type == "chat").all()
            if (n.extra or {}).get("params", {}).get("message_id") == mid
        }
        assert str(a["id"]) not in notified and str(c["id"]) in notified
    finally:
        _close_db(db_gen)

    # 반대 방향(A 가 보내면 B 에게 안 간다)
    fake.emits.clear()
    _post(client, room_id, a, "A 의 메시지")
    targets = {e["room"] for e in fake.emits if e["event"] == "new_message"}
    assert f"user:{b['id']}" not in targets and f"user:{c['id']}" in targets


def test_TS34_그룹_WS_전송도_차단_상대_소켓에는_emit_하지_않는다(client, monkeypatch):
    fake = _wire_ws(monkeypatch)
    host, a, b, c, room_id = _group_with_three(client, "ts34ws")
    assert _report(client, a, b["id"], room_id=room_id).status_code == 201
    chat_ws._sid_users["sid-b"] = b["id"]
    ack = asyncio.run(chat_ws.on_message("sid-b", {"room_id": room_id, "content": "WS 그룹"}))
    assert ack == {"ok": True}
    targets = {e["room"] for e in fake.emits}
    assert room_id not in targets and f"user:{a['id']}" not in targets
    assert f"user:{c['id']}" in targets


# ───────────────────────── TS35 ─────────────────────────


def test_TS35_자기_신고는_422_INVALID_REPORT_TARGET(client):
    host, member, room_id = _direct_pair(client, "ts35a")
    res = _report(client, member, member["id"])
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "INVALID_REPORT_TARGET"
    assert _counts()["reports"] == 0


def test_TS35_같은_방이_아닌_대상이나_없는_메시지는_404이고_행이_생기지_않는다(client):
    host, member, room_id = _direct_pair(client, "ts35b")
    stranger = _register(client, "ts35b-x@test.com", role="client")
    assert _report(client, member, stranger["id"]).status_code == 404
    assert _report(client, stranger, host["id"], room_id=room_id).status_code == 404
    msg = _post(client, room_id, host, "x").json()
    # 다른 사람의 메시지를 엉뚱한 사람 id 로 신고
    other = _register(client, "ts35b-y@test.com", role="client")
    assert _report(client, member, other["id"], message_id=msg["id"]).status_code == 404
    assert _report(client, member, host["id"], message_id="00000000-0000-0000-0000-000000000000").status_code == 404
    c = _counts()
    assert (c["reports"], c["blocks"], c["emails"]) == (0, 0, 0)


def test_TS35_서로_신고해도_pair_행은_하나다(client):
    host, member, room_id = _direct_pair(client, "ts35c")
    assert _report(client, member, host["id"], operation_key="m1").status_code == 201
    assert _report(client, host, member["id"], operation_key="h1").status_code == 201
    c = _counts()
    assert c["blocks"] == 1 and c["reports"] == 2


def test_TS35_chat_blocks_는_pair_unique_와_정규화_제약을_가진다(client):
    host, member, room_id = _direct_pair(client, "ts35d")
    low, high = sorted([host["id"], member["id"]])
    db_gen, db = _test_db()
    try:
        db.add(ChatBlock(user_low_id=low, user_high_id=high, blocker_id=host["id"]))
        db.commit()
        db.add(ChatBlock(user_low_id=low, user_high_id=high, blocker_id=member["id"]))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
        db.add(ChatBlock(user_low_id=high, user_high_id=low, blocker_id=member["id"]))  # 비정규화 순서
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
    finally:
        _close_db(db_gen)


def test_TS35_신고_저장_중_실패하면_신고와_차단이_모두_롤백된다(client, monkeypatch):
    from app.services import chat_moderation_service as moderation

    host, member, room_id = _direct_pair(client, "ts35e")

    class _Boom:
        def __init__(self, *a, **k):
            raise RuntimeError("outbox 장애")

    monkeypatch.setattr(moderation, "NotificationOutbox", _Boom)
    db_gen, db = _test_db()
    try:
        with pytest.raises(RuntimeError):
            moderation.report_user(
                member["id"], host["id"], room_id=room_id, message_id=None,
                reason=None, operation_key="boom", db=db,
            )
    finally:
        _close_db(db_gen)
    c = _counts()
    assert (c["reports"], c["blocks"], c["emails"]) == (0, 0, 0)


def test_TS35_메일_발송_장애여도_신고와_차단은_유지되고_outbox_는_재시도_대기다(client, monkeypatch):
    from app.tasks import outbox

    host, member, room_id = _direct_pair(client, "ts35f")
    assert _report(client, member, host["id"], room_id=room_id, operation_key="mail").status_code == 201

    sent = []
    monkeypatch.setattr(outbox, "send_email_notification", lambda *a, **k: sent.append(a) or False)
    outbox.process_email_outbox()

    db_gen, db = _test_db()
    try:
        assert db.query(ChatReport).count() == 1 and db.query(ChatBlock).count() == 1
        mail = db.query(NotificationOutbox).filter(NotificationOutbox.channel == "email").one()
        assert mail.status == "pending" and mail.attempts == 1  # 재시도 대기
    finally:
        _close_db(db_gen)
    assert len(sent) == 1


# ───────────────────────── 탈퇴 사용자 표시 ─────────────────────────


def test_탈퇴한_사용자는_이름_대신_탈퇴한_사용자로_표시되고_열린_소켓_전송은_거부된다(client, monkeypatch):
    fake = _wire_ws(monkeypatch)
    host, member, room_id = _direct_pair(client, "del")
    _post(client, room_id, host, "탈퇴 전 메시지")
    chat_ws._sid_users["sid-host"] = host["id"]

    db_gen, db = _test_db()
    try:
        from app.models.user import User

        db.query(User).filter(User.id == host["id"]).update({"status": "deleted"})
        db.commit()
    finally:
        _close_db(db_gen)

    msgs = client.get(f"/api/v1/chat/rooms/{room_id}/messages", headers=member["auth"]).json()["messages"]
    assert [m["sender_name"] for m in msgs] == ["탈퇴한 사용자"]
    room = _room_of(client, member, room_id)
    assert room["peer_name"] == "탈퇴한 사용자" and room["peer_deleted"] is True

    fake.emits.clear()  # 탈퇴 전 REST 전송이 남긴 emit 제외
    ack = asyncio.run(chat_ws.on_message("sid-host", {"room_id": room_id, "content": "유령"}))
    assert ack == {"ok": False, "error": {"code": "ACCOUNT_INACTIVE"}}
    assert fake.emits == []
