"""기능 오류(하) 16건 회귀 테스트 — 2026-10 기능오류 4차.

검증 대상:
  [1]  AUTH4-07   org_id UUID 파싱 무방비(500) → 400
  [2]  AUTH4-08   비활성(deactivated) 기관 역할 변경/소속 해제 → 409
  [3]  AUTH4-09   ended 링크 재활성화 — ended_at 초기화 + 채팅방 보장
  [4]  AUTH4-10   공개 페이지 소속 상담사 — membership 기준
  [5]  STATE-SWEEP-TOCTOU  스윕 조회~전이 TOCTOU — open 에서만 취소
  [6]  CONTRACT-GUEST-CHAT-ROOM-ID  게스트 join 응답 chat_room_id
  [7]  AUTHZ-WAITLIST-SPEAKING  대기열 발언권·손들기·토큰 제한
  [8]  DASH-WAITLIST-006  대시보드 참여자/게스트 집계 대기자 제외
  [9]  EXPORT-LOCK-007  내보내기 GET 은 lock 없이(읽기 전용)
  [10] EEG-COVERAGE-008  coverage 유효구간 정의 통일(valid 만)
  [11] RPT-NPLUS1-009  client_comments N+1 제거
  [12] ADM-STATE-02  pending 계정 정지 우회 차단
  [13] AUTHZ-05  POST /client/counselors role 제한(client)
  [14] WS-AUTHZ-06  Socket.IO connect 토큰 타입·계정 상태 검증
  [15] NOTIF-CONF-08  알림 설정 event key 화이트리스트
  [16] CONTRACT-09  관리자 기관 등록 응답 계약({org, admin, invite_sent})
"""

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.core.database import get_db
from app.core.security import create_access_token, create_refresh_token, hash_password
from app.main import app
from app.models.chat import ChatRoom, ChatRoomParticipant
from app.models.client_counselor_link import ClientCounselorLink
from app.models.counselor_profile import CounselorProfile
from app.models.data_export import DataExportJob
from app.models.organization import Organization
from app.models.record import Report
from app.models.session import Session as SessionModel
from app.models.session import SessionParticipant
from app.models.user import User
from app.models.user_org_membership import UserOrgMembership
from app.services import admin_service, chat_service, dashboard_service, export_service
from app.services import notification_service, org_management_service, org_service, session_service
from tests.conftest import create_test_counselor, create_test_org, post_register
from tests.test_sdd015_class_code import _create_class, _db, _open_class, _register


# ---------------------------------------------------------------------------
# 공통 헬퍼
# ---------------------------------------------------------------------------


def _make_platform_admin(db, email: str) -> User:
    user = User(
        email=email, password_hash=hash_password("Passw0rd!"), name="플랫폼관리자",
        role="platform_admin", status="active",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _make_counselor_with_code(db, email: str, code: str, *, org_id=None) -> User:
    user = User(
        email=email, password_hash=hash_password("Passw0rd!"), name="상담사",
        role="counselor", status="active", verified_tier="email", org_id=org_id,
    )
    db.add(user)
    db.flush()
    db.add(CounselorProfile(user_id=user.id, counselor_code=code, specialties=[]))
    db.commit()
    db.refresh(user)
    return user


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# [1] AUTH4-07 — UUID 파싱 무방비
# ---------------------------------------------------------------------------


def test_auth407_invalid_org_id_is_400_not_500(client):
    res = client.get("/api/v1/org/not-a-uuid")
    assert res.status_code == 400, res.text


def test_auth407_lock_organization_invalid_uuid_400(client):
    db = _db()
    try:
        with pytest.raises(HTTPException) as exc:
            org_management_service.lock_organization("not-a-uuid", db)
        assert exc.value.status_code == 400
    finally:
        db.close()


def test_auth407_request_join_invalid_org_id_400(client):
    member = _register(client, "auth407-join@test.com", role="client")
    res = client.post("/api/v1/org/not-a-uuid/join", headers=member["h"])
    assert res.status_code == 400, res.text


# ---------------------------------------------------------------------------
# [2] AUTH4-08 — 비활성 기관 역할 변경 차단
# ---------------------------------------------------------------------------


def test_auth408_deactivated_org_blocks_role_change(client):
    db = _db()
    try:
        org = Organization(name="비활성기관", org_code="DED408", kind="institution")
        db.add(org)
        db.flush()
        actor = _make_platform_admin(db, "auth408-actor@test.com")
        target = User(
            email="auth408-target@test.com", password_hash="x", name="상담사",
            role="counselor", status="active", org_id=org.id,
        )
        db.add(target)
        db.flush()
        db.add(UserOrgMembership(
            user_id=target.id, org_id=org.id, role="counselor", status="active", is_primary=True
        ))
        org.deactivated_at = datetime.now(timezone.utc)
        db.commit()

        with pytest.raises(HTTPException) as exc:
            org_management_service.change_counselor(
                org.id, target.id, actor.id, "역할 조정", db, role="org_admin"
            )
        assert exc.value.status_code == 409
    finally:
        db.close()


# ---------------------------------------------------------------------------
# [3] AUTH4-09 — ended 링크 재활성화
# ---------------------------------------------------------------------------


def test_auth409_reactivate_ended_link_resets_ended_at_and_creates_room(client):
    member = _register(client, "auth409-client@test.com", role="client")
    db = _db()
    try:
        counselor = _make_counselor_with_code(db, "auth409-co@test.com", "RACT01")
        counselor_id = counselor.id
        db.add(ClientCounselorLink(
            client_id=uuid.UUID(member["id"]),
            counselor_id=counselor_id,
            status="ended",
            ended_at=datetime.now(timezone.utc),
        ))
        db.commit()
    finally:
        db.close()

    res = client.post(
        "/api/v1/client/counselors", json={"code": "RACT01"}, headers=member["h"]
    )
    assert res.status_code == 201, res.text

    db = _db()
    try:
        link = (
            db.query(ClientCounselorLink)
            .filter(
                ClientCounselorLink.client_id == uuid.UUID(member["id"]),
                ClientCounselorLink.counselor_id == counselor_id,
            )
            .one()
        )
        assert link.status == "active"
        assert link.ended_at is None
        # 재활성화 시 다이렉트 채팅방이 보장되어야 한다(양측이 같은 방에 존재).
        client_rooms = set(chat_service.get_user_chat_room_ids(member["id"], db))
        counselor_rooms = set(chat_service.get_user_chat_room_ids(str(counselor_id), db))
        assert client_rooms & counselor_rooms
    finally:
        db.close()


# ---------------------------------------------------------------------------
# [4] AUTH4-10 — 공개 페이지 membership 기준
# ---------------------------------------------------------------------------


def test_auth410_public_page_uses_membership(client):
    code = create_test_org("공개멤버십센터")
    db = _db()
    try:
        org = db.query(Organization).filter(Organization.org_code == code).one()
        org_id = org.id
        # membership 은 있으나 미러(User.org_id)가 다른 기관을 가리키는 상담사.
        member_counselor = User(
            email="auth410-member@test.com", password_hash="x", name="멤버상담사",
            role="counselor", status="active",
        )
        # 미러만 있고 membership 이 없는 사용자(공개 노출 대상 아님).
        mirror_only = User(
            email="auth410-mirror@test.com", password_hash="x", name="미러상담사",
            role="counselor", status="active", org_id=org_id,
        )
        db.add_all([member_counselor, mirror_only])
        db.flush()
        db.add(UserOrgMembership(
            user_id=member_counselor.id, org_id=org_id, role="counselor", status="active"
        ))
        db.commit()
        member_id, mirror_id = str(member_counselor.id), str(mirror_only.id)
    finally:
        db.close()

    res = client.get(f"/api/v1/o/{code}")
    assert res.status_code == 200, res.text
    ids = {c["id"] for c in res.json()["counselors"]}
    assert member_id in ids
    assert mirror_id not in ids


# ---------------------------------------------------------------------------
# [5] STATE-SWEEP-TOCTOU — open 에서만 취소
# ---------------------------------------------------------------------------


def test_state_sweep_toctou_in_progress_not_cancelled(client):
    from tests.test_stale_open_session import (
        _create_open_session,
        _register as _register_stale,
        _set_opened_at,
        _sweep,
    )

    host = _register_stale(client, "toctou@test.com")
    sid = _create_open_session(client, host)
    _set_opened_at(sid, datetime.now(timezone.utc) - timedelta(hours=25))

    # 조회(open)~전이 사이 다른 요청이 in_progress 로 올린 상황을 재현한다.
    db = _db()
    try:
        s = db.query(SessionModel).filter(SessionModel.id == uuid.UUID(sid)).one()
        s.status = "in_progress"
        db.commit()
    finally:
        db.close()

    cancelled = _sweep()
    assert sid not in cancelled
    db = _db()
    try:
        s = db.query(SessionModel).filter(SessionModel.id == uuid.UUID(sid)).one()
        assert s.status == "in_progress"
    finally:
        db.close()


# ---------------------------------------------------------------------------
# [6] CONTRACT-GUEST-CHAT-ROOM-ID
# ---------------------------------------------------------------------------


def test_guest_join_response_has_chat_room_id(client):
    counselor = _register(client, "guestcr@test.com")
    cls = _create_class(
        client, counselor["h"], location_type="online", participant_mode="group",
        max_participants=10,
    )
    _open_class(client, cls, counselor["h"])

    res = client.post(
        f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={"name": "게스트"}
    )
    assert res.status_code == 200, res.text
    assert "chat_room_id" in res.json()["session"]
    assert res.json()["session"]["chat_room_id"]


# ---------------------------------------------------------------------------
# [7] AUTHZ-WAITLIST-SPEAKING
# ---------------------------------------------------------------------------


def test_waitlisted_participant_cannot_speak_or_get_token(client):
    from tests.test_member_livekit_token import _set_room_id, _token_url
    from tests.test_sdd094_speaking_rights import _raise_hand, _set_speaking

    counselor = _register(client, "waitlist-speak@test.com")
    cls = _create_class(
        client, counselor["h"], location_type="online", participant_mode="group",
        max_participants=1,
    )
    _open_class(client, cls, counselor["h"])
    url = f"/api/v1/sessions/by-code/{cls['access_code']}/join"

    g1 = client.post(url, json={"name": "g1"}).json()
    g2 = client.post(url, json={"name": "g2"}).json()
    parts = {p["participant_id"]: p for p in g2["session"]["participants"]}
    assert parts[g1["participant_id"]]["is_waitlisted"] is False
    assert parts[g2["participant_id"]]["is_waitlisted"] is True

    # 대기열 참여자 손들기 → 403
    res = _raise_hand(client, cls, g2["participant_id"], token=g2["participant_token"])
    assert res.status_code == 403, res.text

    # 상담사가 대기열 참여자에게 발언권 부여 → 409
    res = _set_speaking(client, cls, g2["participant_id"], True, headers=counselor["h"])
    assert res.status_code == 409, res.text

    # 대기열 참여자 LiveKit 토큰 발급 → 403
    _set_room_id(cls, uuid.uuid4())
    res = client.post(
        _token_url(cls),
        json={"participant_id": g2["participant_id"], "participant_token": g2["participant_token"]},
    )
    assert res.status_code == 403, res.text


# ---------------------------------------------------------------------------
# [8] DASH-WAITLIST-006 — 대시보드 대기자 제외
# ---------------------------------------------------------------------------


def test_dashboard_excludes_waitlisted_participants(client):
    counselor = _register(client, "dash-wl@test.com")
    cls = _create_class(
        client, counselor["h"], location_type="online", participant_mode="group",
        max_participants=1,
    )
    _open_class(client, cls, counselor["h"])
    url = f"/api/v1/sessions/by-code/{cls['access_code']}/join"
    client.post(url, json={"name": "d1"})
    client.post(url, json={"name": "d2"})

    db = _db()
    try:
        body = dashboard_service.counselor_dashboard(counselor["id"], db)
    finally:
        db.close()

    summary = next(c for c in body["classes"] if c["id"] == cls["id"])
    assert summary["participant_count"] == 1
    assert summary["guest_count"] == 1


# ---------------------------------------------------------------------------
# [9] EXPORT-LOCK-007 — GET 은 lock 없이
# ---------------------------------------------------------------------------


def test_export_get_job_uses_no_lock(client, monkeypatch):
    db = _db()
    try:
        owner = User(
            email="export-lock@test.com", password_hash="x", name="소유자",
            role="counselor", status="active",
        )
        db.add(owner)
        db.flush()
        job = DataExportJob(
            user_id=owner.id, requester_role="counselor",
            session_id=uuid.uuid4(), participant_id=uuid.uuid4(),
            include=[], purpose="test", request_hash="h",
            idempotency_key="k", status="ready", consent_eeg=False,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            updated_at=datetime.now(timezone.utc),
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        job_id, owner_id = job.id, owner.id
    finally:
        db.close()

    seen: dict = {}
    from types import SimpleNamespace

    def spy(_db, user_id, session_id, participant_id, *, lock=False):
        seen["lock"] = lock
        return None, None, SimpleNamespace(consent_eeg=True)

    monkeypatch.setattr(export_service, "authorize", spy)

    db = _db()
    try:
        result = export_service.get_job(db, job_id, owner_id)
        assert result.id == job_id
    finally:
        db.close()
    assert seen["lock"] is False


# ---------------------------------------------------------------------------
# [10] EEG-COVERAGE-008 — valid 만 유효 구간
# ---------------------------------------------------------------------------


class _W:
    def __init__(self, quality: str):
        self.quality = quality
        from app.services.eeg_rollup_service import ROLLUP_METRIC_KEYS

        for key in ROLLUP_METRIC_KEYS:
            setattr(self, key, None)


def test_coverage_definition_unified_valid_only():
    from app.services.eeg_rollup_service import _bucket_payload
    from app.tasks.report_task import _coverage_ratio

    t0 = datetime(2026, 10, 4, 10, 0, 0, tzinfo=timezone.utc)
    span = (t0, t0 + timedelta(seconds=3))
    # valid(1) + degraded(1) + invalid(1) / 3초 → valid 만 세면 1/3
    wins = [_W("valid"), _W("degraded"), _W("invalid")]
    assert _coverage_ratio(wins, *span) == round(1 / 3, 4)  # type: ignore[arg-type]

    # 롤업도 동일하게 valid 만 coverage 에 반영한다.
    bucket = _bucket_payload(0, [_W("valid"), _W("degraded")], 2)
    assert bucket["valid_count"] == 1
    assert bucket["coverage"] == round(1 / 2, 4)


# ---------------------------------------------------------------------------
# [11] RPT-NPLUS1-009 — N+1 제거
# ---------------------------------------------------------------------------


def test_collect_client_comments_batches_queries(client):
    from sqlalchemy import event

    from app.services.report_service import _collect_client_comments

    db = _db()
    try:
        host = User(email="nplus1-host@test.com", password_hash="x", name="상담사",
                    role="counselor", status="active")
        member = User(email="nplus1-member@test.com", password_hash="x", name="회원",
                      role="client", status="active")
        db.add_all([host, member])
        db.flush()
        s = SessionModel(host_id=host.id, type="clinical", duration_min=30,
                         status="completed")
        db.add(s)
        db.flush()
        p_member = SessionParticipant(session_id=s.id, user_id=member.id)
        p_guest = SessionParticipant(session_id=s.id, user_id=None, guest_name="게스트")
        db.add_all([p_member, p_guest])
        db.flush()
        db.add(Report(
            session_id=s.id, user_id=member.id, participant_id=p_member.id,
            type="client", content={"counselor_comment": "회원 코멘트"},
        ))
        db.add(Report(
            session_id=s.id, user_id=None, participant_id=p_guest.id,
            type="client", content={"counselor_comment": "게스트 코멘트"},
        ))
        db.commit()
        session_id = s.id

        # SELECT 문 개수 계측 — 배치 조회면 reports/participants/users 3회면 충분.
        count = {"n": 0}

        def _on_execute(conn, cursor, statement, params, ctx, executemany):
            if statement.lstrip().upper().startswith("SELECT"):
                count["n"] += 1

        engine = db.get_bind()
        event.listen(engine, "before_cursor_execute", _on_execute)
        try:
            comments = _collect_client_comments(session_id, db)
        finally:
            event.remove(engine, "before_cursor_execute", _on_execute)

        names = {c["participant_name"] for c in comments}
        assert names == {"회원", "게스트"}
        assert all(c["comment"].endswith("코멘트") for c in comments)
        assert count["n"] <= 3
    finally:
        db.close()


# ---------------------------------------------------------------------------
# [12] ADM-STATE-02 — pending 정지 우회 차단
# ---------------------------------------------------------------------------


def test_adm_state02_suspend_pending_blocked(client):
    db = _db()
    try:
        admin = _make_platform_admin(db, "admstate02-admin@test.com")
        pending = User(
            email="admstate02-pending@test.com", password_hash="x", name="초대대기",
            role="counselor", status="pending",
        )
        db.add(pending)
        db.commit()
        pending_id, admin_id = pending.id, admin.id
    finally:
        db.close()

    db = _db()
    try:
        with pytest.raises(HTTPException) as exc:
            admin_service.suspend_user(pending_id, "사유", admin_id, db)
        assert exc.value.status_code == 409
    finally:
        db.close()

    # API 경로도 409.
    admin_token = create_access_token(subject=str(admin_id))
    res = client.post(
        f"/api/v1/admin/users/{pending_id}/suspend",
        json={"reason": "사유"},
        headers=_h(admin_token),
    )
    assert res.status_code == 409, res.text


# ---------------------------------------------------------------------------
# [13] AUTHZ-05 — POST /client/counselors 는 client 전용
# ---------------------------------------------------------------------------


def test_authz05_non_client_cannot_add_counselor(client):
    counselor = _register(client, "authz05-co@test.com")
    res = client.post(
        "/api/v1/client/counselors", json={"code": "ABC123"}, headers=counselor["h"]
    )
    assert res.status_code == 403, res.text


# ---------------------------------------------------------------------------
# [14] WS-AUTHZ-06 — Socket.IO connect 검증
# ---------------------------------------------------------------------------


class _FakeSio:
    def __init__(self):
        self.rooms: dict = {}

    async def enter_room(self, sid, room, namespace=None):
        self.rooms.setdefault(sid, set()).add(room)

    async def leave_room(self, sid, room, namespace=None):
        self.rooms.get(sid, set()).discard(room)

    async def emit(self, *args, **kwargs):
        pass


def _wire_ws(monkeypatch):
    import app.ws.chat_namespace as chat

    fake = _FakeSio()
    monkeypatch.setattr(chat, "sio", fake)
    chat._sid_users.clear()
    chat._user_sids.clear()
    return chat


def test_ws_authz06_refresh_token_not_registered(client, monkeypatch):
    chat = _wire_ws(monkeypatch)
    token = create_refresh_token(subject=str(uuid.uuid4()))
    asyncio.run(chat.connect("sid-r", {}, {"token": token}))
    assert "sid-r" not in chat._sid_users
    assert not chat._user_sids


def test_ws_authz06_suspended_account_not_registered(client, monkeypatch):
    chat = _wire_ws(monkeypatch)
    db = _db()
    try:
        user = User(email="ws-susp@test.com", password_hash="x", name="정지",
                    role="counselor", status="suspended")
        db.add(user)
        db.commit()
        uid = user.id
    finally:
        db.close()
    token = create_access_token(subject=str(uid))
    asyncio.run(chat.connect("sid-s", {}, {"token": token}))
    assert "sid-s" not in chat._sid_users
    assert not chat._user_sids


def test_ws_authz06_active_account_registered(client, monkeypatch):
    chat = _wire_ws(monkeypatch)
    db = _db()
    try:
        user = User(email="ws-active@test.com", password_hash="x", name="활성",
                    role="counselor", status="active")
        db.add(user)
        db.commit()
        uid = user.id
    finally:
        db.close()
    token = create_access_token(subject=str(uid))
    asyncio.run(chat.connect("sid-a", {}, {"token": token}))
    assert chat._sid_users.get("sid-a") == str(uid)


# ---------------------------------------------------------------------------
# [15] NOTIF-CONF-08 — event key 화이트리스트
# ---------------------------------------------------------------------------


def test_notif_conf08_unknown_event_key_rejected(client):
    member = _register(client, "notifwh@test.com", role="client")
    bad = client.put(
        "/api/v1/notifications/preferences",
        headers=member["h"],
        json={"email": {"not_a_real_event": True}},
    )
    assert bad.status_code == 422, bad.text

    ok = client.put(
        "/api/v1/notifications/preferences",
        headers=member["h"],
        json={"email": {"chat_message": True}},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["email"]["chat_message"] is True


# ---------------------------------------------------------------------------
# [16] CONTRACT-09 — 관리자 기관 등록 응답 계약
# ---------------------------------------------------------------------------


def test_contract09_admin_register_org_response_shape(client):
    db = _db()
    try:
        admin = _make_platform_admin(db, "contract09-admin@test.com")
        admin_id = admin.id
    finally:
        db.close()
    token = create_access_token(subject=str(admin_id))

    res = client.post("/api/v1/admin/orgs", json={"name": "계약센터"}, headers=_h(token))
    assert res.status_code == 201, res.text
    body = res.json()
    # 백엔드 OrganizationWithAdminResponse 계약 — 평면 AdminOrganizationDto 가 아니다.
    assert set(body.keys()) == {"org", "admin", "invite_sent"}
    assert body["admin"] is None
    assert body["invite_sent"] is False
    org = body["org"]
    for field in ("id", "name", "org_code", "phone", "verified", "kind",
                  "has_primary_admin", "version", "deactivated_at", "created_at"):
        assert field in org
    assert len(org["org_code"]) == 6
