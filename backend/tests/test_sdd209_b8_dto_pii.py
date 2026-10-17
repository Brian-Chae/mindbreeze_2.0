"""SDD-209 B8 — 참여자 DTO·PII·host_name (BE-8) + 삭제 상태 가드 (BE-13).

verify: BT41~BT43 · BT48 · AZ13 · AZ22 · RV1-4(허용 삭제도 보존 전환) · RV9-8(타인 개인정보 비노출).
"""

import uuid

import pytest
from sqlalchemy import event

from tests.entry_helpers import enter_guest, enter_member
from tests.test_sdd015_class_code import _create_class, _open_class, _register

PII_KEYS = ("gender", "birth_date", "user_email")
NEVER_KEYS = {"report_included", "report_email", "report_notice_ack_at", "report_notice_version", "research_consent"}


def _db():
    from app.core.database import SessionLocal

    return SessionLocal()


def _user(uid):
    from app.models.user import User

    db = _db()
    try:
        u = db.query(User).filter(User.id == uuid.UUID(uid)).first()
        return {"name": u.name, "email": u.email}
    finally:
        db.close()


def _group(client, host, cap=10):
    cls = _create_class(client, host["h"], participant_mode="group", max_participants=cap)
    _open_class(client, cls, host["h"])
    return cls


def _fill_profile(uid):
    from datetime import date

    from app.models.client_profile import ClientProfile

    db = _db()
    try:
        db.add(ClientProfile(user_id=uuid.UUID(uid), gender="male", birth_date=date(1988, 3, 4)))
        db.commit()
    finally:
        db.close()


def _setup(client, tag):
    host = _register(client, f"b8h{tag}@test.com")
    m1 = _register(client, f"b8m{tag}a@test.com", role="client")
    m2 = _register(client, f"b8m{tag}b@test.com", role="client")
    _fill_profile(m1["id"])
    _fill_profile(m2["id"])
    cls = _group(client, host)
    assert enter_member(client, cls["access_code"], m1["h"]).status_code == 200
    assert enter_member(client, cls["access_code"], m2["h"]).status_code == 200
    g = enter_guest(client, cls["access_code"], "손님", email="Guest8@Example.com", birth_date="1991-02-03").json()
    return host, m1, m2, g, cls


def _by_pid(session_json):
    return {p["participant_id"]: p for p in session_json["participants"]}


# ── BT41: 호스트 뷰 ────────────────────────────────────────────────────


def test_BT41_호스트는_user_name_user_email_성별_생년월일_host_name을_받는다(client):
    host, m1, m2, g, cls = _setup(client, "1")
    got = client.get(f"/api/v1/sessions/{cls['id']}", headers=host["h"]).json()
    assert got["host_name"] == _user(host["id"])["name"]
    parts = {p["user_id"] or p["participant_id"]: p for p in got["participants"]}
    m = parts[m1["id"]]
    assert m["user_name"] == _user(m1["id"])["name"] and m["user_email"] == _user(m1["id"])["email"]
    assert m["gender"] == "male" and str(m["birth_date"]) == "1988-03-04"
    guest = parts[g["participant_id"]]
    assert guest["user_name"] == "손님" and guest["guest_name"] == "손님"
    assert guest["user_email"] == "guest8@example.com", "비회원은 입력한 이메일"
    assert guest["gender"] == "female" and str(guest["birth_date"]) == "1991-02-03"


def test_BT41_목록과_생성_응답에도_host_name이_있다(client):
    host = _register(client, "b8h2@test.com")
    cls = _group(client, host)
    assert cls["host_name"] == _user(host["id"])["name"]
    listed = client.get("/api/v1/sessions", headers=host["h"]).json()["sessions"]
    assert listed[0]["host_name"] == _user(host["id"])["name"]


# ── BT42 / AZ13 / AZ22: 비호스트 비노출 ────────────────────────────────


def test_BT42_참여자_조회는_타인_개인정보를_이름만_남기고_가린다(client):
    host, m1, m2, g, cls = _setup(client, "3")
    for viewer in (m1["h"], m2["h"]):
        got = client.get(f"/api/v1/sessions/{cls['id']}", headers=viewer).json()
        assert got["host_name"], "진행자 이름은 공개"
        for p in got["participants"]:
            assert p["user_name"] or p["guest_name"], "이름은 보인다"
            for k in PII_KEYS:
                assert p.get(k) is None, (k, p)
            assert not (set(p) & NEVER_KEYS)
        text = str(got)
        assert "guest8@example.com" not in text.lower()
        assert _user(m1["id"])["email"] not in text and _user(m2["id"])["email"] not in text


def test_BT42_클래스_목록도_참여자_뷰에서는_PII가_없다(client):
    host, m1, m2, g, cls = _setup(client, "4")
    mine = client.get("/api/v1/sessions", headers=m1["h"]).json()["sessions"]
    target = next(s for s in mine if s["id"] == cls["id"])
    for p in target["participants"]:
        for k in PII_KEYS:
            assert p.get(k) is None, (k, p)
    # 호스트 목록에서는 보인다
    host_view = next(s for s in client.get("/api/v1/sessions", headers=host["h"]).json()["sessions"] if s["id"] == cls["id"])
    assert any(p["user_email"] for p in host_view["participants"])


def test_BT42_입장_응답과_게스트_조회에도_타인_PII_없음(client):
    host = _register(client, "b8h5@test.com")
    cls = _group(client, host)
    enter_guest(client, cls["access_code"], "먼저", email="first@example.com")
    second = enter_guest(client, cls["access_code"], "나중", email="second@example.com").json()
    for p in second["session"]["participants"]:
        for k in PII_KEYS:
            assert p.get(k) is None
    assert "first@example.com" not in str(second).lower()


def test_ParticipantInfo는_리포트_선택_연구_동의_증빙_필드를_갖지_않는다():
    from app.schemas.session import ParticipantInfo

    assert not (set(ParticipantInfo.model_fields) & NEVER_KEYS)


# ── BT43: N+1 방지 ─────────────────────────────────────────────────────


def _count_queries(fn):
    from app.core.database import engine

    n = []

    def before(conn, cursor, statement, *a):
        n.append(statement)

    event.listen(engine, "before_cursor_execute", before)
    try:
        fn()
    finally:
        event.remove(engine, "before_cursor_execute", before)
    return len(n)


def test_BT43_목록_쿼리_수는_클래스_수에_비례하지_않는다(client):
    host = _register(client, "b8h6@test.com")
    members = [_register(client, f"b8m6{i}@test.com", role="client") for i in range(3)]

    def make(k):
        for _ in range(k):
            cls = _group(client, host)
            for m in members:
                enter_member(client, cls["access_code"], m["h"])

    make(1)
    one = _count_queries(lambda: client.get("/api/v1/sessions", headers=host["h"]))
    make(4)
    many = _count_queries(lambda: client.get("/api/v1/sessions", headers=host["h"]))
    assert many <= one + 2, (one, many)


# ── BT48 / BE-13: 삭제 상태 가드 ───────────────────────────────────────


def _delete(client, host, cls):
    return client.delete(f"/api/v1/sessions/{cls['id']}", headers=host["h"])


def _hidden(cls):
    from app.models.session import Session

    db = _db()
    try:
        s = db.query(Session).filter(Session.id == uuid.UUID(cls["id"])).execution_options(include_hidden=True).first()
        return s is not None, s.hidden_at is not None
    finally:
        db.close()


def test_BT48_ready_scheduled_cancelled만_삭제되고_보존_전환(client):
    host = _register(client, "b8h7@test.com")
    ready = _create_class(client, host["h"])
    assert _delete(client, host, ready).status_code == 204
    assert _hidden(ready) == (True, True), "행은 남고 숨김"

    cancelled = _create_class(client, host["h"])
    client.post(f"/api/v1/sessions/{cancelled['id']}/cancel", headers=host["h"])
    assert _delete(client, host, cancelled).status_code == 204
    assert _hidden(cancelled) == (True, True)


def test_BT48_진행중_완료_열림_상태는_삭제_거부_409(client):
    host = _register(client, "b8h8@test.com")
    for action, tag in (("open", "open"), ("start", "start"), ("end", "end")):
        cls = _create_class(client, host["h"])
        for step in {"open": ["open"], "start": ["open", "start"], "end": ["open", "start", "end"]}[action]:
            r = client.post(f"/api/v1/sessions/{cls['id']}/{step}", headers=host["h"])
            assert r.status_code == 200, (step, r.text)
        r = _delete(client, host, cls)
        assert r.status_code == 409, (tag, r.status_code, r.text)
        assert _hidden(cls) == (True, False), "거부된 삭제는 숨김도 만들지 않는다"


def test_BT48_거부된_삭제는_알림도_보내지_않는다(client):
    from app.models.notification import Notification

    host = _register(client, "b8h9@test.com")
    m = _register(client, "b8m9@test.com", role="client")
    cls = _group(client, host)
    enter_member(client, cls["access_code"], m["h"])
    assert _delete(client, host, cls).status_code == 409  # open
    db = _db()
    try:
        assert db.query(Notification).filter(Notification.user_id == uuid.UUID(m["id"]), Notification.type == "session").filter(
            Notification.title.like("%취소%")
        ).count() == 0
    finally:
        db.close()
