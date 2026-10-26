"""[MB261026][FIX] 채팅 게시 필터(Apple 1.2) — verify V-29~V-37.

운영자가 관리하는 금칙어가 포함된 메시지는 저장·알림 없이 422 로 막는다.
자동 삭제·자동 정지·자동 차단은 하지 않는다.
"""

import logging
import uuid

from app.models.chat import ChatBlock, ChatFilterTerm, ChatMessage, ChatReport
from app.models.credential import VerificationAudit
from app.models.notification import Notification
from app.models.notification_outbox import NotificationOutbox
from app.models.user import User
from tests.test_chat import _close_db, _create_session, _link, _register, _test_db

TERM = "테스트금칙"


def _make_admin(client, email):
    admin = _register(client, email, "counselor")
    db_gen, db = _test_db()
    try:
        user = db.query(User).filter(User.id == uuid.UUID(admin["id"])).first()
        user.role = "platform_admin"
        db.commit()
    finally:
        _close_db(db_gen)
    return admin


def _add_term(client, admin, term):
    return client.post("/api/v1/admin/chat-filter-terms", json={"term": term}, headers=admin["auth"])


def _post(client, room_id, who, text):
    return client.post(
        f"/api/v1/chat/rooms/{room_id}/messages",
        json={"content": text, "type": "text"},
        headers=who["auth"],
    )


def _direct(client, tag):
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


def _group(client, host, member):
    res = client.post(
        "/api/v1/chat/rooms",
        json={"room_type": "group", "participant_ids": [member["id"]], "name": "그룹"},
        headers=host["auth"],
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _counts():
    db_gen, db = _test_db()
    try:
        return {
            "messages": db.query(ChatMessage).count(),
            "notifications": db.query(Notification).count(),
            "outbox": db.query(NotificationOutbox).count(),
            "blocks": db.query(ChatBlock).count(),
            "reports": db.query(ChatReport).count(),
        }
    finally:
        _close_db(db_gen)


def _assert_blocked(res):
    assert res.status_code == 422, res.text
    detail = res.json()["detail"]
    assert detail["code"] == "CHAT_CONTENT_BLOCKED"
    assert TERM not in res.text  # 어떤 단어에 걸렸는지 알려 주지 않는다


def test_V29_금칙어가_없으면_모두_통과한다(client):
    host, member, room = _direct(client, "f29")
    assert _post(client, room, member, "안녕하세요").status_code == 201
    assert _post(client, room, member, "이건 정말 별로네요").status_code == 201


def test_V30_금칙어_메시지는_저장_알림_없이_422(client):
    admin = _make_admin(client, "f30-admin@test.com")
    host, member, room = _direct(client, "f30")
    assert _add_term(client, admin, TERM).status_code == 201
    before = _counts()
    _assert_blocked(_post(client, room, member, f"이건 {TERM} 이에요"))
    assert _counts() == before


def test_V31_띄어쓰기_기호_대소문자_전각_변형도_막는다(client):
    admin = _make_admin(client, "f31-admin@test.com")
    host, member, room = _direct(client, "f31")
    assert _add_term(client, admin, TERM).status_code == 201
    assert _add_term(client, admin, "badword").status_code == 201
    for text in ("테스트 금칙", "테.스.트-금칙", "앞 테*스*트_금칙 뒤", "this is BadWord", "ｂａｄ ｗｏｒｄ!"):
        res = _post(client, room, member, text)
        assert res.status_code == 422, text
        assert res.json()["detail"]["code"] == "CHAT_CONTENT_BLOCKED"


def test_V32_금칙어_없는_문장은_보낸다(client):
    admin = _make_admin(client, "f32-admin@test.com")
    host, member, room = _direct(client, "f32")
    assert _add_term(client, admin, TERM).status_code == 201
    assert _post(client, room, member, "테스트 잘 끝났어요").status_code == 201


def test_V33_모든_방_유형과_역할에_적용된다(client):
    admin = _make_admin(client, "f33-admin@test.com")
    host, member, direct_room = _direct(client, "f33")
    group_room = _group(client, host, member)
    session = _create_session(client, host["auth"], participant_ids=[member["id"]])
    assert _add_term(client, admin, TERM).status_code == 201

    _assert_blocked(_post(client, direct_room, host, TERM))  # 상담사
    _assert_blocked(_post(client, group_room, member, TERM))  # 회원, 그룹
    _assert_blocked(_post(client, session["chat_room_id"], host, TERM))  # 클래스(세션) 방
    admin_room = client.post(
        "/api/v1/chat/rooms",
        json={"room_type": "group", "participant_ids": [host["id"]], "name": "운영"},
        headers=admin["auth"],
    )
    if admin_room.status_code == 201:  # 관리자가 방을 만들 수 있는 경우 관리자 발신도 확인
        _assert_blocked(_post(client, admin_room.json()["id"], admin, TERM))


def test_V34_시스템_메시지는_필터_대상이_아니다(client):
    from app.services.system_message_service import send_system_message

    admin = _make_admin(client, "f34-admin@test.com")
    host = _register(client, "f34@test.com")
    session = _create_session(client, host["auth"])
    assert _add_term(client, admin, TERM).status_code == 201
    db_gen, db = _test_db()
    try:
        msg = send_system_message(uuid.UUID(session["id"]), f"안내 {TERM}", "test", db)
        assert msg.id is not None
    finally:
        _close_db(db_gen)


def test_V35_오탐은_관리자가_지우면_바로_보낼_수_있다(client):
    admin = _make_admin(client, "f35-admin@test.com")
    host, member, room = _direct(client, "f35")
    added = _add_term(client, admin, "시발")
    assert added.status_code == 201, added.text
    text = "시발점에서 출발해요"
    assert _post(client, room, member, text).status_code == 422

    res = client.delete(f"/api/v1/admin/chat-filter-terms/{added.json()['id']}", headers=admin["auth"])
    assert res.status_code == 204
    assert _post(client, room, member, text).status_code == 201

    db_gen, db = _test_db()
    try:
        actions = [a.action for a in db.query(VerificationAudit).filter(VerificationAudit.target_type == "chat_filter_term")]
        assert sorted(actions) == ["chat_filter_term_add", "chat_filter_term_remove"]
    finally:
        _close_db(db_gen)


def test_V36_금칙어_길이_중복_개수_제한(client, monkeypatch):
    from app.services import chat_content_filter

    admin = _make_admin(client, "f36-admin@test.com")
    assert _add_term(client, admin, "가").status_code == 422
    assert _add_term(client, admin, " - 가 . ").status_code == 422  # 정규화 후 1자
    assert _add_term(client, admin, "가" * 51).status_code == 422
    assert _add_term(client, admin, "BadWord").status_code == 201
    dup = _add_term(client, admin, " bad word ")
    assert dup.status_code == 409 and dup.json()["detail"]["code"] == "CHAT_FILTER_TERM_EXISTS"

    monkeypatch.setattr(chat_content_filter, "MAX_TERMS", 2)
    assert _add_term(client, admin, "둘째단어").status_code == 201
    over = _add_term(client, admin, "셋째단어")
    assert over.status_code == 409 and over.json()["detail"]["code"] == "CHAT_FILTER_TERM_LIMIT"

    listed = client.get("/api/v1/admin/chat-filter-terms", headers=admin["auth"]).json()["items"]
    assert sorted(i["term"] for i in listed) == ["BadWord", "둘째단어"]

    db_gen, db = _test_db()
    try:
        assert db.query(ChatFilterTerm).count() == 2
        assert db.query(VerificationAudit).filter(VerificationAudit.action == "chat_filter_term_add").count() == 2
    finally:
        _close_db(db_gen)


def test_V37_반복_차단에도_자동_제재가_없고_로그에_내용이_없다(client, caplog):
    admin = _make_admin(client, "f37-admin@test.com")
    host, member, room = _direct(client, "f37")
    assert _add_term(client, admin, TERM).status_code == 201
    before = _counts()
    with caplog.at_level(logging.INFO):
        for i in range(10):
            assert _post(client, room, member, f"{i} {TERM} 비밀내용").status_code == 422
    assert _counts() == before
    db_gen, db = _test_db()
    try:
        assert db.query(User).filter(User.id == uuid.UUID(member["id"])).first().status == "active"
    finally:
        _close_db(db_gen)
    assert all("비밀내용" not in r.getMessage() and TERM not in r.getMessage() for r in caplog.records)
    # 차단된 뒤에도 정상 메시지는 보낼 수 있다
    assert _post(client, room, member, "정상 메시지").status_code == 201
