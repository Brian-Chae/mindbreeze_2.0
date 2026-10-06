"""MIND BREEZE 2.0 기능상 오류(하) 6차 15건 회귀 테스트.

입력 검증
  VB-11  admin 검토 action Literal + batch items 상한
  VB-12  set-password/password-reset 토큰 max_length
  VB-13  org/search q max_length + 결과 상한(limit)
  VB-14  eeg-rollup resolution/start_bucket/end_bucket 범위 검증
ORM
  MB2-ORM-N1-04   mark_read/get_unread_counts 레거시 경로 배치화(N+1 제거)
  MB2-ORM-IDX-08  credentials.user_id 인덱스
  MB2-ORM-IDX-09  chat_message_reads (user_id, message_id) 인덱스
  MB2-ORM-IDX-10  org_join_requests (user_id, org_id, status) + (org_id, created_at) 인덱스
  MB2-ORM-TXN-13  post_message 단일 트랜잭션(부분 상태 메시지 방지)
  MB2-ORM-TXN-14  create_group_room 단일 트랜잭션(고아 빈 방 방지)
  MB2-ORM-MODEL-15 ChatRoomParticipant 패키지 export
  MB2-ORM-MODEL-16 read_by(JSONB) ↔ chat_message_reads 단일 진실원 통일
WS
  WS-07  feature 핸들러 join 세션 컨텍스트 대조
  WS-11  REST 폴백 notify_session_eeg 가 group_average 도 발행
  WS-12  /chat message new_message payload 에 id/created_at 포함
"""

import asyncio
import inspect
import uuid as _uuid
from datetime import datetime
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import event

from app.core.database import get_db
from app.main import app

_BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _db():
    return next(app.dependency_overrides[get_db]())


def _bounds(param) -> tuple[int | None, int | None]:
    ge = le = None
    for meta in getattr(param, "metadata", []):
        if getattr(meta, "ge", None) is not None:
            ge = meta.ge
        if getattr(meta, "le", None) is not None:
            le = meta.le
    return ge, le


def _param(fn, name):
    return _bounds(inspect.signature(fn).parameters[name].default)


def _max_length(fn, name):
    param = inspect.signature(fn).parameters[name].default
    for meta in getattr(param, "metadata", []):
        ml = getattr(meta, "max_length", None)
        if ml is not None:
            return ml
    return getattr(param, "max_length", None)


def _platform_admin_header() -> dict:
    from app.core.security import create_access_token
    from app.models.user import User

    db = _db()
    try:
        admin = User(
            email=f"low6-admin-{uuid4().hex[:8]}@test.com",
            password_hash="x",
            name="플랫폼관리자",
            role="platform_admin",
            status="active",
        )
        db.add(admin)
        db.commit()
        return {"Authorization": f"Bearer {create_access_token(subject=str(admin.id))}"}
    finally:
        db.close()


# ─────────────────────────────────────────────────────────────────────────────
# VB-11 — admin 검토 action Literal + batch items 상한
# ─────────────────────────────────────────────────────────────────────────────


def test_vb11_review_action_literal():
    from app.api.v1 import admin

    with pytest.raises(ValidationError):
        admin.ReviewActionRequest(action="bogus")
    ok = admin.ReviewActionRequest(action="approve")
    assert ok.action == "approve"

    with pytest.raises(ValidationError):
        admin.BatchReviewItem(target_type="credential", target_id=str(uuid4()), action="bogus")


def test_vb11_batch_items_상한():
    from app.api.v1.admin import MAX_BATCH_REVIEW_ITEMS, BatchReviewRequest

    valid = {
        "target_type": "credential",
        "target_id": str(uuid4()),
        "action": "approve",
    }
    with pytest.raises(ValidationError):
        BatchReviewRequest(items=[valid] * (MAX_BATCH_REVIEW_ITEMS + 1))
    assert len(BatchReviewRequest(items=[valid]).items) == 1
    with pytest.raises(ValidationError):
        BatchReviewRequest(items=[])


def test_vb11_batch_endpoint_잘못된_action_422(client):
    res = client.post(
        "/api/v1/admin/reviews/batch",
        json={
            "items": [
                {"target_type": "credential", "target_id": str(uuid4()), "action": "nope"}
            ]
        },
        headers=_platform_admin_header(),
    )
    assert res.status_code == 422, res.text


# ─────────────────────────────────────────────────────────────────────────────
# VB-12 — 토큰 상한
# ─────────────────────────────────────────────────────────────────────────────


def test_vb12_토큰_max_length():
    from app.schemas.auth import PasswordResetRequest, SetPasswordRequest

    for model in (SetPasswordRequest, PasswordResetRequest):
        with pytest.raises(ValidationError):
            model(token="a" * 513, new_password="Passw0rd!")
        # 상한 이내는 통과
        assert model(token="a" * 512, new_password="Passw0rd!").token


def test_vb12_set_password_엔드포인트_초과토큰_422(client):
    res = client.post(
        "/api/v1/auth/set-password",
        json={"token": "a" * 513, "new_password": "Passw0rd!"},
    )
    assert res.status_code == 422, res.text


# ─────────────────────────────────────────────────────────────────────────────
# VB-13 — org/search q 상한 + 결과 상한
# ─────────────────────────────────────────────────────────────────────────────


def test_vb13_search_q_max_length_및_limit_제약():
    from app.api.v1 import org

    assert _max_length(org.search_orgs, "q") == 100
    assert _max_length(org.search_orgs, "region") == 100
    assert _param(org.search_orgs, "limit") == (1, 50)


def test_vb13_search_q_초과_422(client):
    res = client.get("/api/v1/org/search", params={"q": "가" * 101})
    assert res.status_code == 422, res.text
    res2 = client.get("/api/v1/org/search", params={"limit": 51})
    assert res2.status_code == 422, res2.text


def test_vb13_search_결과_상한(client):
    from app.models.organization import Organization

    db = _db()
    try:
        for i in range(3):
            db.add(Organization(name=f"VB13기관{i}", address=f"서울시 VB13-{i}", org_code=f"VB13{i:02d}"))
        db.commit()
    finally:
        db.close()

    res = client.get("/api/v1/org/search", params={"q": "VB13", "limit": 2})
    assert res.status_code == 200, res.text
    assert len(res.json()) <= 2


# ─────────────────────────────────────────────────────────────────────────────
# VB-14 — eeg-rollup 범위 검증
# ─────────────────────────────────────────────────────────────────────────────


def test_vb14_eeg_rollup_범위_제약():
    from app.api.v1 import session as session_api

    assert _param(session_api.get_eeg_rollup, "resolution") == (1, 3600)
    assert _param(session_api.get_eeg_rollup, "start_bucket")[0] == 0
    assert _param(session_api.get_eeg_rollup, "end_bucket")[0] == 0


def test_vb14_eeg_rollup_비정상파라미터_422(client):
    from tests.conftest import create_test_counselor
    from tests.test_sdd026_live_session_p0 import _create_group_class

    host = create_test_counselor("vb14-host@test.com", name="VB14상담")
    auth = {"Authorization": f"Bearer {host['access_token']}"}
    cls = _create_group_class(client, auth, title="VB14")

    assert client.get(
        f"/api/v1/sessions/{cls['id']}/eeg-rollup", params={"resolution": 0}, headers=auth
    ).status_code == 422
    assert client.get(
        f"/api/v1/sessions/{cls['id']}/eeg-rollup", params={"start_bucket": -1}, headers=auth
    ).status_code == 422


# ─────────────────────────────────────────────────────────────────────────────
# MB2-ORM-N1-04 — 레거시 미읽음 배치 계산
# ─────────────────────────────────────────────────────────────────────────────


def test_n1_04_get_unread_counts_레거시_배치(client):
    from app.models.chat import ChatMessage, ChatMessageRead, ChatRoom
    from app.models.user import User
    from app.services import chat_service

    db = _db()
    try:
        host = User(email="n104-host@test.com", password_hash="x", name="상담사", role="counselor", status="active")
        member = User(email="n104-c@test.com", password_hash="x", name="내담자", role="client", status="active")
        db.add_all([host, member])
        db.flush()
        room = ChatRoom(room_type="direct", host_id=host.id, name=str(member.id))
        db.add(room)
        db.flush()
        msgs = [
            ChatMessage(
                room_id=room.id, sender_id=host.id, type="text", content=f"m{i}",
                recipient_count=0, read_by=None,
            )
            for i in range(10)
        ]
        db.add_all(msgs)
        db.flush()
        # 첫 메시지는 상담사가 읽음 → 미읽음 1
        db.add(ChatMessageRead(message_id=msgs[0].id, user_id=host.id))
        db.commit()
        rid = str(room.id)
        first_id = str(msgs[0].id)

        engine = db.get_bind()
        selects: list[int] = []

        def _before(conn, cursor, statement, parameters, context, executemany):
            if statement.lstrip().upper().startswith("SELECT"):
                selects.append(1)

        event.listen(engine, "before_cursor_execute", _before)
        try:
            counts = chat_service.get_unread_counts(rid, str(host.id), db)
        finally:
            event.remove(engine, "before_cursor_execute", _before)

        assert len(counts) == 10
        assert counts[first_id] == 1
        assert all(counts[str(m.id)] == 2 for m in msgs[1:])
        # 메시지 10건이어도 읽음 집계는 IN GROUP BY 1회 — 개별 count N+1 이면 10+.
        assert len(selects) <= 6, f"SELECT {len(selects)}회 (N+1 의심)"
    finally:
        db.close()


# ─────────────────────────────────────────────────────────────────────────────
# MB2-ORM-IDX-08/09/10 — 인덱스
# ─────────────────────────────────────────────────────────────────────────────


def test_idx08_credentials_user_id_인덱스():
    from app.models.credential import Credential

    idx = next((i for i in Credential.__table__.indexes if i.name == "ix_credentials_user_id"), None)
    assert idx is not None
    assert [c.name for c in idx.columns] == ["user_id"]


def test_idx09_chat_message_reads_user_id_인덱스():
    from app.models.chat import ChatMessageRead

    idx = next(
        (i for i in ChatMessageRead.__table__.indexes if i.name == "ix_chat_message_reads_user_id"),
        None,
    )
    assert idx is not None
    assert [c.name for c in idx.columns] == ["user_id", "message_id"]


def test_idx10_org_join_requests_인덱스():
    from app.models.org_join_request import OrganizationJoinRequest

    names = {i.name for i in OrganizationJoinRequest.__table__.indexes}
    assert "ix_org_join_requests_user_org_status" in names
    assert "ix_org_join_requests_org_created" in names
    by_status = next(i for i in OrganizationJoinRequest.__table__.indexes if i.name == "ix_org_join_requests_user_org_status")
    assert [c.name for c in by_status.columns] == ["user_id", "org_id", "status"]


def test_idx_마이그레이션_헤드연결():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    cfg = Config(str(_BACKEND_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(_BACKEND_ROOT / "alembic"))
    script = ScriptDirectory.from_config(cfg)
    assert "e036a0000035" in script.get_heads()
    rev = script.get_revision("e036a0000035")
    assert rev.down_revision == "e036a0000034"
    # 세 인덱스가 마이그레이션에 존재
    src = (_BACKEND_ROOT / "alembic" / "versions" / "e036a0000035_orm_indexes_6th.py").read_text(encoding="utf-8")
    for name in (
        "ix_credentials_user_id",
        "ix_chat_message_reads_user_id",
        "ix_org_join_requests_user_org_status",
        "ix_org_join_requests_org_created",
    ):
        assert name in src


# ─────────────────────────────────────────────────────────────────────────────
# MB2-ORM-TXN-13/14 — 단일 트랜잭션
# ─────────────────────────────────────────────────────────────────────────────


def _make_group_room_with_link(db):
    """host 상담사 + 내담자 + 연결 + 그룹방을 만들어 (host, member, room_id) 반환."""
    from app.models.chat import ChatRoom
    from app.models.client_counselor_link import ClientCounselorLink
    from app.models.user import User

    host = User(email=f"txn-host-{uuid4().hex[:6]}@t.com", password_hash="x", name="상담사", role="counselor", status="active")
    member = User(email=f"txn-c-{uuid4().hex[:6]}@t.com", password_hash="x", name="내담자", role="client", status="active")
    db.add_all([host, member])
    db.flush()
    db.add(ClientCounselorLink(counselor_id=host.id, client_id=member.id))
    room = ChatRoom(room_type="group", host_id=host.id, name="그룹")
    db.add(room)
    db.commit()
    return host, member, room


def test_txn13_post_message_실패시_메시지_미영속(client, monkeypatch):
    from app.models.chat import ChatMessage
    from app.services import chat_service

    db = _db()
    try:
        host, member, room = _make_group_room_with_link(db)
        rid = str(room.id)
        host_id = str(host.id)

        def _boom(*args, **kwargs):
            raise RuntimeError("resolve 실패")

        monkeypatch.setattr(chat_service, "_resolve_recipients", _boom)
        with pytest.raises(RuntimeError):
            asyncio.run(
                chat_service.post_message(rid, host_id, "안녕", "text", None, db)
            )
        # 실패 지점이 INSERT(+읽음 메타) 커밋 전이어야 부분 상태 메시지가 남지 않는다.
        db.rollback()
        count = db.query(ChatMessage).filter(ChatMessage.room_id == UUID(rid)).count()
        assert count == 0, "부분 상태(recipient_count 미설정) 메시지가 영속됨"
    finally:
        db.close()


def test_txn14_create_group_room_단일커밋(client):
    from app.models.chat import ChatRoomParticipant
    from app.services import chat_service

    from app.models.client_counselor_link import ClientCounselorLink
    from app.models.user import User

    db = _db()
    try:
        host = User(email="txn14-host@t.com", password_hash="x", name="상담사", role="counselor", status="active")
        member = User(email="txn14-c@t.com", password_hash="x", name="내담자", role="client", status="active")
        db.add_all([host, member])
        db.flush()
        db.add(ClientCounselorLink(counselor_id=host.id, client_id=member.id))
        db.commit()
        host_id, member_id = str(host.id), str(member.id)

        commits: list[int] = []

        def _on_commit(session):
            commits.append(1)

        event.listen(db, "after_commit", _on_commit)
        try:
            result = chat_service.create_group_room(host_id, [member_id], "TXN14", db)
        finally:
            event.remove(db, "after_commit", _on_commit)
        # 방 생성 + 참여자 등록이 한 트랜잭션 → 커밋 1회.
        assert len(commits) == 1, f"commit {len(commits)}회 (분리 커밋 의심)"
        parts = (
            db.query(ChatRoomParticipant)
            .filter(ChatRoomParticipant.room_id == UUID(result["id"]))
            .all()
        )
        assert [str(p.user_id) for p in parts] == [member_id]
    finally:
        db.close()


# ─────────────────────────────────────────────────────────────────────────────
# MB2-ORM-MODEL-15/16
# ─────────────────────────────────────────────────────────────────────────────


def test_model15_chat_room_participant_패키지_export():
    import app.models as models
    from app.models import ChatRoomParticipant  # noqa: F401

    assert "ChatRoomParticipant" in models.__all__


def test_model16_read_by_단일진실원_파생(client):
    from app.models.chat import ChatMessage, ChatMessageRead, ChatRoom
    from app.models.user import User
    from app.services import chat_service

    db = _db()
    try:
        u1 = User(email="m16-u1@t.com", password_hash="x", name="하나", role="counselor", status="active")
        u2 = User(email="m16-u2@t.com", password_hash="x", name="둘", role="client", status="active")
        db.add_all([u1, u2])
        db.flush()
        room = ChatRoom(room_type="direct", host_id=u1.id, name=str(u2.id))
        db.add(room)
        db.flush()
        msg = ChatMessage(room_id=room.id, sender_id=u1.id, type="text", content="x", recipient_count=2)
        db.add(msg)
        db.flush()
        db.add_all([
            ChatMessageRead(message_id=msg.id, user_id=u1.id),
            ChatMessageRead(message_id=msg.id, user_id=u2.id),
        ])
        db.flush()
        # 캐시를 오염시켜도 단일 진실원(테이블)에서 재구성된다.
        msg.read_by = ["bogus"]
        chat_service._refresh_read_cache([msg], db)
        assert set(msg.read_by) == {str(u1.id), str(u2.id)}
    finally:
        db.close()


def test_model16_mark_read_후_캐시_일치(client):
    from app.models.chat import ChatMessage, ChatMessageRead, ChatRoom, ChatRoomParticipant
    from app.models.user import User
    from app.services import chat_service

    db = _db()
    try:
        host = User(email="m16b-host@t.com", password_hash="x", name="상담사", role="counselor", status="active")
        member = User(email="m16b-c@t.com", password_hash="x", name="회원", role="client", status="active")
        db.add_all([host, member])
        db.flush()
        room = ChatRoom(room_type="group", host_id=host.id, name="단일진실원")
        db.add(room)
        db.flush()
        db.add(ChatRoomParticipant(room_id=room.id, user_id=member.id))
        msgs = [
            ChatMessage(room_id=room.id, sender_id=host.id, type="text", content=f"m{i}", recipient_count=2, read_by=[str(host.id)])
            for i in range(3)
        ]
        db.add_all(msgs)
        db.commit()
        rid, member_id = str(room.id), str(member.id)

        asyncio.run(chat_service.mark_read(rid, member_id, db))

        for m in msgs:
            table_users = {
                str(r[0])
                for r in db.query(ChatMessageRead.user_id)
                .filter(ChatMessageRead.message_id == m.id)
                .all()
            }
            assert set(m.read_by or []) == table_users
            assert member_id in table_users
    finally:
        db.close()


# ─────────────────────────────────────────────────────────────────────────────
# WS-07/11/12
# ─────────────────────────────────────────────────────────────────────────────


def test_ws07_feature_join_불일치_무시(client, monkeypatch):
    from tests.test_sdd026_live_session_p0 import _create_group_class, _register, _wire
    from app.ws import session_live_namespace as ns

    counselor = _register(client, "ws07-feat@test.com")
    cls_a = _create_group_class(client, counselor["h"], title="WS07-A")
    cls_b = _create_group_class(client, counselor["h"], title="WS07-B")
    fake = _wire(monkeypatch)

    calls: list = []

    def _fake_store(*args, **kwargs):
        calls.append(args)
        return 1, "pid", {}, True

    monkeypatch.setattr(ns, "_store_feature", _fake_store)

    fake.call("connect", "sidF", {}, {"token": counselor["token"]})
    fake.call("join", "sidF", {"session_id": cls_a["id"]})

    # join 하지 않은 타 세션 id → 저장/브로드캐스트 없음
    fake.call("feature", "sidF", {"session_id": cls_b["id"], "feature": {"second_offset": 1}})
    assert calls == [], "join 컨텍스트와 다른 session_id 의 feature 가 저장됨"
    assert not fake.events("eeg_feature")

    # join 한 세션 id → 정상 처리
    fake.call("feature", "sidF", {"session_id": cls_a["id"], "feature": {"second_offset": 2}})
    assert len(calls) == 1
    assert fake.events("eeg_feature")


def test_ws11_notify_session_eeg_group_average_발행(monkeypatch):
    from app.ws import session_live_namespace as ns

    seen: list[str] = []

    async def _eeg(sid, payload):
        seen.append("eeg")

    async def _agg(sid):
        seen.append("aggregate")

    async def _avg(sid):
        seen.append("average")

    monkeypatch.setattr(ns, "broadcast_session_eeg", _eeg)
    monkeypatch.setattr(ns, "publish_group_aggregate", _agg)
    monkeypatch.setattr(ns, "publish_group_average", _avg)

    coros: list = []
    monkeypatch.setattr(ns, "_schedule", lambda c: coros.append(c))

    ns.notify_session_eeg("sess-1", {"participant_id": "p1"})
    assert len(coros) == 3, "REST 폴백이 group_average 를 발행하지 않음"
    for c in coros:
        asyncio.run(c)
    assert sorted(seen) == ["aggregate", "average", "eeg"]


def test_ws12_chat_message_payload_id_created_at(monkeypatch):
    import app.ws.chat_namespace as chat

    captured: dict = {}

    async def _member(sid, room_id):
        return True

    async def _emit(event, data=None, room=None, to=None, namespace=None):
        captured[event] = data

    monkeypatch.setattr(chat, "_is_room_member", _member)
    monkeypatch.setattr(chat.sio, "emit", _emit)
    monkeypatch.setitem(chat._sid_users, "sid-m", "user-1")
    try:
        asyncio.run(chat.on_message("sid-m", {"room_id": "room-1", "content": "안녕하세요"}))
    finally:
        chat._sid_users.pop("sid-m", None)

    payload = captured["new_message"]
    assert payload["id"], "new_message payload 에 id 없음"
    _uuid.UUID(payload["id"])  # 파싱 가능해야 한다
    assert payload["created_at"], "new_message payload 에 created_at 없음"
    datetime.fromisoformat(payload["created_at"])
    assert payload["sender_id"] == "user-1"
