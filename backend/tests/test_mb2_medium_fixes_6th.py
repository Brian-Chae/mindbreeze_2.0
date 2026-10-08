"""MB2 중(中) 기능 오류 16건 회귀 테스트 (6차: 입력검증 9 + ORM 7).

입력 검증
  VB-01  SessionCreate/UpdateRequest.title max_length=200 (DB String(200))
  VB-03  chat list_messages limit ge/le
  VB-04  chat invitable-counselors page/size 검증 + DB LIMIT/OFFSET 페이징
  VB-05  admin counselors 목록 page/size + DB 페이징
  VB-06  admin ClientCreateRequest.email → EmailStr
  VB-07  ClientProfileUpdate name/phone/profile_image 길이 제한
  VB-08  온보딩 step1 name/phone 길이 제한
  VB-09  session/report 목록 limit le 상한
  VB-10  audio/video chunk_index Form ge=0
ORM
  MB2-ORM-N1-01  채팅 메시지 발신자/방 배치 조회 (N+1 제거)
  MB2-ORM-N1-02  _aggregate_window_stats 최신 윈도우 단일 쿼리
  MB2-ORM-N1-03  list_my_rooms 방 직렬화 배치 캐시
  MB2-ORM-IDX-05  notifications.user_id 인덱스
  MB2-ORM-IDX-07  reports.user_id 인덱스
  MB2-ORM-UNQ-11  org_join_requests (user_id, org_id, pending) 부분 유니크
  MB2-ORM-UNQ-12  counselor 리포트 결정적 participant_id (멱등키 통일)
"""

import inspect
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import event
from sqlalchemy.exc import IntegrityError

from app.core.database import get_db
from app.main import app

_BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _db():
    return next(app.dependency_overrides[get_db]())


def _bounds(param) -> tuple[int | None, int | None]:
    """FastAPI Query/Form 파라미터의 ge/le 제약을 metadata 에서 추출한다."""
    ge = le = None
    for meta in getattr(param, "metadata", []):
        if getattr(meta, "ge", None) is not None:
            ge = meta.ge
        if getattr(meta, "le", None) is not None:
            le = meta.le
    return ge, le


def _param(fn, name) -> tuple[int | None, int | None]:
    return _bounds(inspect.signature(fn).parameters[name].default)


def _platform_admin_header() -> dict:
    from app.core.security import create_access_token
    from app.models.user import User

    db = _db()
    try:
        admin = User(
            email=f"6th-admin-{uuid4().hex[:8]}@test.com",
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
# VB-01 — 세션 title max_length
# ─────────────────────────────────────────────────────────────────────────────


def test_vb01_session_create_title_초과_스키마거부():
    from app.schemas.session import SessionCreateRequest

    with pytest.raises(ValidationError):
        SessionCreateRequest(type="clinical", duration_min=50, title="가" * 201)
    ok = SessionCreateRequest(type="clinical", duration_min=50, title="가" * 200)
    assert len(ok.title) == 200


def test_vb01_session_update_title_초과_스키마거부():
    from app.schemas.session import SessionUpdateRequest

    with pytest.raises(ValidationError):
        SessionUpdateRequest(title="가" * 201)
    assert SessionUpdateRequest(title="가" * 200).title is not None


def test_vb01_session_create_title_초과_엔드포인트422(client):
    from tests.conftest import create_test_counselor

    host = create_test_counselor("vb01-host@test.com", name="VB01상담")
    auth = {"Authorization": f"Bearer {host['access_token']}"}
    res = client.post(
        "/api/v1/sessions",
        json={"type": "clinical", "duration_min": 50, "title": "가" * 201},
        headers=auth,
    )
    assert res.status_code == 422, res.text


# ─────────────────────────────────────────────────────────────────────────────
# VB-03/04/05/09/10 — 쿼리 파라미터·Form 제약
# ─────────────────────────────────────────────────────────────────────────────


def test_vb03_list_messages_limit_ge_le():
    from app.api.v1 import chat

    assert _param(chat.list_messages, "limit") == (1, 100)


def test_vb04_invitable_counselors_page_size_제약():
    from app.api.v1 import chat

    assert _param(chat.list_invitable_counselors, "page")[0] == 1
    assert _param(chat.list_invitable_counselors, "size") == (1, 100)


def test_vb05_admin_counselors_page_size_제약():
    from app.api.v1 import admin

    assert _param(admin.admin_list_counselors, "page")[0] == 1
    assert _param(admin.admin_list_counselors, "size") == (1, 100)


def test_vb05_admin_counselors_DB페이징(client):
    from app.models.user import User

    header = _platform_admin_header()
    db = _db()
    try:
        for i in range(3):
            db.add(
                User(
                    email=f"vb05-c{i}@test.com",
                    password_hash="x",
                    name=f"VB05상담{i}",
                    role="counselor",
                    status="active",
                )
            )
        db.commit()
    finally:
        db.close()

    body = client.get("/api/v1/admin/counselors?page=1&size=2", headers=header).json()
    assert body["total"] == 3
    assert len(body["items"]) == 2

    page2 = client.get("/api/v1/admin/counselors?page=2&size=2", headers=header).json()
    assert len(page2["items"]) == 1
    # 잘못된 size 는 422
    assert client.get("/api/v1/admin/counselors?size=101", headers=header).status_code == 422


def test_vb09_limit_le_상한_적용():
    from app.api.v1 import reports, session as session_api

    assert _param(session_api.list_sessions, "limit") == (1, 100)
    assert _param(session_api.list_session_templates, "limit") == (1, 100)
    assert _param(reports.list_all, "limit") == (1, 100)


def test_vb10_chunk_index_ge0():
    from app.api.v1 import audio, video

    assert _param(audio.upload_chunk, "chunk_index")[0] == 0
    assert _param(video.upload_video_chunk, "chunk_index")[0] == 0


# ─────────────────────────────────────────────────────────────────────────────
# VB-04 — 서비스 DB 레벨 페이징 동작
# ─────────────────────────────────────────────────────────────────────────────


def test_vb04_invitable_counselors_DB페이징(client):
    from app.core.database import get_db as _get_db  # noqa: F401
    from app.models.organization import Organization
    from app.models.user import User
    from app.models.user_org_membership import UserOrgMembership
    from app.services import chat_service

    db = _db()
    try:
        org = Organization(name="VB04기관", org_code="VB4001")
        db.add(org)
        db.flush()
        me = User(email="vb04-me@test.com", password_hash="x", name="나", role="counselor", status="active")
        db.add(me)
        db.flush()
        members = []
        for i in range(5):
            u = User(
                email=f"vb04-p{i}@test.com", password_hash="x",
                name=f"상담사{i}", role="counselor", status="active",
            )
            db.add(u)
            members.append(u)
        db.flush()
        for u in [me, *members]:
            db.add(
                UserOrgMembership(user_id=u.id, org_id=org.id, role="counselor", status="active")
            )
        db.commit()

        page1 = chat_service.list_invitable_counselors(str(me.id), None, db, page=1, size=2)
        assert page1["total"] == 5
        assert len(page1["counselors"]) == 2

        page3 = chat_service.list_invitable_counselors(str(me.id), None, db, page=3, size=2)
        assert len(page3["counselors"]) == 1
        # 페이지 간 중복 없음
        ids1 = {c["user_id"] for c in page1["counselors"]}
        assert not (ids1 & {c["user_id"] for c in page3["counselors"]})
    finally:
        db.close()


# ─────────────────────────────────────────────────────────────────────────────
# VB-06/07/08 — 이메일·이름·전화 길이
# ─────────────────────────────────────────────────────────────────────────────


def test_vb06_client_create_email_EmailStr():
    from app.api.v1.admin import ClientCreateRequest

    with pytest.raises(ValidationError):
        ClientCreateRequest(name="내담자", email="not-an-email", counselor_id=str(uuid4()))
    ok = ClientCreateRequest(name="내담자", email="ok@test.com", counselor_id=str(uuid4()))
    assert ok.email == "ok@test.com"


def test_vb06_admin_clients_잘못된이메일_422(client):
    res = client.post(
        "/api/v1/admin/clients",
        json={"name": "내담자", "email": "bad-email", "counselor_id": str(uuid4())},
        headers=_platform_admin_header(),
    )
    assert res.status_code == 422, res.text


def test_vb07_client_profile_update_길이제한():
    from app.schemas.auth import ClientProfileUpdate

    for field, limit in (("name", 100), ("phone", 20), ("profile_image", 500)):
        meta = ClientProfileUpdate.model_fields[field].metadata
        assert any(getattr(m, "max_length", None) == limit for m in meta), field
    with pytest.raises(ValidationError):
        ClientProfileUpdate(name="가" * 101)
    with pytest.raises(ValidationError):
        ClientProfileUpdate(phone="0" * 21)
    with pytest.raises(ValidationError):
        ClientProfileUpdate(profile_image="u" * 501)


def test_vb08_onboarding_step1_길이제한():
    from app.schemas.onboarding import ClientStep1Request, CounselorStep1Request

    for model in (CounselorStep1Request, ClientStep1Request):
        assert any(getattr(m, "max_length", None) == 100 for m in model.model_fields["name"].metadata)
        assert any(getattr(m, "max_length", None) == 20 for m in model.model_fields["phone"].metadata)
        with pytest.raises(ValidationError):
            model(name="가" * 101)
        with pytest.raises(ValidationError):
            model(phone="0" * 21)


# ─────────────────────────────────────────────────────────────────────────────
# MB2-ORM-N1-01 — 채팅 메시지 배치 직렬화
# ─────────────────────────────────────────────────────────────────────────────


def test_n1_01_list_messages_발신자_배치조회(client):
    from app.models.chat import ChatMessage, ChatRoom
    from app.models.user import User
    from app.services import chat_service

    db = _db()
    try:
        host = User(email="n101-host@test.com", password_hash="x", name="상담사", role="counselor", status="active")
        sender = User(email="n101-s@test.com", password_hash="x", name="발신자", role="client", status="active")
        db.add_all([host, sender])
        db.flush()
        room = ChatRoom(room_type="direct", host_id=host.id, name=str(sender.id))
        db.add(room)
        db.flush()
        for i in range(8):
            db.add(
                ChatMessage(
                    room_id=room.id, sender_id=sender.id, type="text",
                    content=f"m{i}", recipient_count=2, read_by=[],
                )
            )
        db.commit()
        room_id, host_id = str(room.id), str(host.id)

        engine = db.get_bind()
        selects: list[str] = []

        def _before(conn, cursor, statement, parameters, context, executemany):
            if statement.lstrip().upper().startswith("SELECT"):
                selects.append(statement)

        event.listen(engine, "before_cursor_execute", _before)
        try:
            msgs = chat_service.list_messages(room_id, host_id, db, limit=50)
        finally:
            event.remove(engine, "before_cursor_execute", _before)

        assert len(msgs) == 8
        assert all(m["sender_name"] == "발신자" for m in msgs)
        # N+1 제거 — 메시지 8건이어도 발신자 조회는 IN 1회. SELECT 총합을 작게 유지한다.
        assert len(selects) <= 5, f"SELECT {len(selects)}회 (N+1 의심)"
    finally:
        db.close()


def test_n1_01_get_message_context_배치(client):
    from app.models.chat import ChatMessage, ChatRoom
    from app.models.user import User
    from app.services import chat_service

    db = _db()
    try:
        host = User(email="n101b-host@test.com", password_hash="x", name="상담사", role="counselor", status="active")
        s1 = User(email="n101b-s1@test.com", password_hash="x", name="하나", role="client", status="active")
        s2 = User(email="n101b-s2@test.com", password_hash="x", name="둘", role="client", status="active")
        db.add_all([host, s1, s2])
        db.flush()
        room = ChatRoom(room_type="direct", host_id=host.id, name=str(s1.id))
        db.add(room)
        db.flush()
        base = datetime(2026, 1, 1, tzinfo=timezone.utc)
        msgs = [
            ChatMessage(
                room_id=room.id, sender_id=(s1.id if i % 2 == 0 else s2.id), type="text",
                content=f"c{i}", recipient_count=2, read_by=[], created_at=base + timedelta(seconds=i),
            )
            for i in range(5)
        ]
        db.add_all(msgs)
        db.commit()
        anchor = str(msgs[2].id)

        ctx = chat_service.get_message_context(str(room.id), anchor, str(host.id), db, before=2, after=2)
        names = {ctx["message"]["sender_name"], *[m["sender_name"] for m in ctx["before"] + ctx["after"]]}
        assert names <= {"하나", "둘"}
        assert ctx["message"]["sender_name"] == "하나"  # index2 → s1
    finally:
        db.close()


# ─────────────────────────────────────────────────────────────────────────────
# MB2-ORM-N1-02 — 최신 윈도우 단일 쿼리
# ─────────────────────────────────────────────────────────────────────────────


def test_n1_02_aggregate_window_stats_단일쿼리_최신선택(client, monkeypatch):
    from app.models.eeg_feature import EEGFeatureWindow
    from app.services import session_service

    db = _db()
    try:
        sid = uuid4()
        p1, p2 = uuid4(), uuid4()
        base = datetime(2026, 1, 1, tzinfo=timezone.utc)
        db.add_all(
            [
                EEGFeatureWindow(session_id=sid, participant_id=p1, play_group_id="g", window_index=0, relaxation_index=0.2, created_at=base),
                EEGFeatureWindow(session_id=sid, participant_id=p1, play_group_id="g", window_index=1, relaxation_index=0.6, created_at=base + timedelta(seconds=10)),
                EEGFeatureWindow(session_id=sid, participant_id=p2, play_group_id="g", window_index=0, relaxation_index=0.4, created_at=base),
            ]
        )
        db.commit()

        called = {"n": 0}

        def _boom(*args, **kwargs):
            called["n"] += 1
            raise AssertionError("latest_feature_window 개별 호출 발생 (N+1)")

        monkeypatch.setattr("app.services.eeg_query.latest_feature_window", _boom)

        result = session_service._aggregate_window_stats(sid, [p1, p2], db)
        assert called["n"] == 0
        assert result[p1]["current_relaxation"] == 0.6
        assert result[p2]["current_relaxation"] == 0.4
        assert result[p1]["avg_relaxation"] == pytest.approx(0.4, abs=1e-4)
    finally:
        db.close()


# ─────────────────────────────────────────────────────────────────────────────
# MB2-ORM-N1-03 — list_my_rooms 배치 직렬화
# ─────────────────────────────────────────────────────────────────────────────


def test_n1_03_list_my_rooms_배치직렬화(client, monkeypatch):
    from app.models.chat import ChatMessage, ChatRoom, ChatRoomParticipant
    from app.models.user import User
    from app.services import chat_service

    db = _db()
    try:
        host = User(email="n103-host@test.com", password_hash="x", name="방장", role="counselor", status="active")
        c1 = User(email="n103-c1@test.com", password_hash="x", name="참가1", role="client", status="active")
        c2 = User(email="n103-c2@test.com", password_hash="x", name="참가2", role="client", status="active")
        db.add_all([host, c1, c2])
        db.flush()
        room = ChatRoom(room_type="group", host_id=host.id, name="그룹방")
        db.add(room)
        db.flush()
        db.add_all(
            [
                ChatRoomParticipant(room_id=room.id, user_id=c1.id),
                ChatRoomParticipant(room_id=room.id, user_id=c2.id),
                ChatMessage(room_id=room.id, sender_id=c1.id, type="text", content="안녕", recipient_count=3, read_by=[str(c1.id)]),
            ]
        )
        db.commit()
        rid = str(room.id)

        def _boom(*args, **kwargs):
            raise AssertionError("방 단위 개별 조회 호출 (N+1)")

        monkeypatch.setattr(chat_service, "_peer_name_for_direct", _boom)
        monkeypatch.setattr(chat_service, "_unread_count", _boom)
        monkeypatch.setattr(chat_service, "_participant_count", _boom)

        rooms = chat_service.list_my_rooms(str(host.id), db)
        target = next(r for r in rooms if r["id"] == rid)
        assert target["participant_count"] == 3  # host + 참가자 2
        assert target["unread_count"] == 1  # host 미읽음 1건
    finally:
        db.close()


# ─────────────────────────────────────────────────────────────────────────────
# MB2-ORM-IDX-05/07 + UNQ-11 — 모델 인덱스·제약
# ─────────────────────────────────────────────────────────────────────────────


def test_idx05_notifications_user_id_인덱스():
    from app.models.notification import Notification

    idx = next((i for i in Notification.__table__.indexes if i.name == "ix_notifications_user_id"), None)
    assert idx is not None
    assert [c.name for c in idx.columns] == ["user_id"]


def test_idx07_reports_user_id_인덱스():
    from app.models.record import Report

    idx = next((i for i in Report.__table__.indexes if i.name == "ix_reports_user_id"), None)
    assert idx is not None
    assert [c.name for c in idx.columns] == ["user_id"]


def test_unq11_org_join_request_pending_부분유니크():
    from app.models.org_join_request import OrganizationJoinRequest

    idx = next(
        (i for i in OrganizationJoinRequest.__table__.indexes if i.name == "uq_org_join_request_pending"),
        None,
    )
    assert idx is not None and idx.unique is True
    assert [c.name for c in idx.columns] == ["user_id", "org_id"]


def test_unq11_pending_중복삽입_DB차단(client):
    from app.models.organization import Organization
    from app.models.org_join_request import OrganizationJoinRequest
    from app.models.user import User

    db = _db()
    try:
        org = Organization(name="UNQ11기관", org_code="UNQ110")
        user = User(email="unq11@test.com", password_hash="x", name="신청자", role="counselor", status="active")
        db.add_all([org, user])
        db.flush()
        db.add(OrganizationJoinRequest(user_id=user.id, org_id=org.id, status="pending"))
        db.commit()

        db.add(OrganizationJoinRequest(user_id=user.id, org_id=org.id, status="pending"))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()

        # approved 는 별개 상태 — 부분 유니크라 중복 허용
        db.add_all(
            [
                OrganizationJoinRequest(user_id=user.id, org_id=org.id, status="approved"),
                OrganizationJoinRequest(user_id=user.id, org_id=org.id, status="approved"),
            ]
        )
        db.commit()
    finally:
        db.close()


def test_orm_인덱스_마이그레이션_헤드연결():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    cfg = Config(str(_BACKEND_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(_BACKEND_ROOT / "alembic"))
    script = ScriptDirectory.from_config(cfg)
    # 6차 하(下) 인덱스 마이그레이션이 새 헤드로 연결된다.
    # SDD-188: 후속 리비전이 head 가 될 수 있으므로 단일 head + 체인 포함으로 검증한다.
    assert len(script.get_heads()) == 1
    assert "e036a0000035" in {r.revision for r in script.walk_revisions()}
    rev = script.get_revision("e036a0000035")
    assert rev.down_revision == "e036a0000034"


# ─────────────────────────────────────────────────────────────────────────────
# MB2-ORM-UNQ-12 — counselor 리포트 결정적 participant_id (멱등키 통일)
# ─────────────────────────────────────────────────────────────────────────────


def test_unq12_counselor_리포트_결정적참여자_멱등(client):
    from app.models.record import Report
    from app.models.session import SessionParticipant
    from tests.conftest import create_test_counselor

    host = create_test_counselor("unq12-host@test.com", name="결정상담")
    auth = {"Authorization": f"Bearer {host['access_token']}"}
    created = client.post(
        "/api/v1/sessions",
        json={
            "type": "clinical",
            "scheduled_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
            "duration_min": 50,
            "title": "UNQ12",
        },
        headers=auth,
    )
    assert created.status_code == 201, created.text
    sid = created.json()["id"]

    db = _db()
    try:
        early = SessionParticipant(
            session_id=UUID(sid), guest_name="먼저",
            joined_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        )
        late = SessionParticipant(
            session_id=UUID(sid), guest_name="나중",
            joined_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
        )
        db.add_all([early, late])
        db.commit()
        early_id = str(early.id)

        first = client.post(
            f"/api/v1/reports/generate/{sid}", json={"type": "counselor"}, headers=auth
        )
        second = client.post(
            f"/api/v1/reports/generate/{sid}", json={"type": "counselor"}, headers=auth
        )
        assert first.status_code == 200 and second.status_code == 200
        # 멱등 — 같은 리포트 재사용
        assert first.json()["id"] == second.json()["id"]
        # 결정적 선택 — 먼저 참여한 참가자로 고정 (ORDER BY 없는 .first() 였다면 비결정적)
        assert first.json()["participant_id"] == early_id

        rows = (
            db.query(Report)
            .filter(Report.session_id == UUID(sid), Report.type == "counselor")
            .all()
        )
        assert len(rows) == 1
    finally:
        db.close()
