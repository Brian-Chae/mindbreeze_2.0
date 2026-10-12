"""4차 코드리뷰 기능오류(중) 7건 회귀 테스트.

- CONC-DUP-JOIN-INVITE: 중복 입장·초대 check-then-insert 경합 → IntegrityError(500) 방지
- CONC-CAPACITY-RACE: 정원 검사~삽입 사이 경합 → 세션 행 잠금 + DB 카운트 정원 판정
- CHAT-DIRECT-ROOM-RACE: direct/session 채팅방 멱등 개설(중복 방 방지)
- OUTBOX-DUP-003: 알림 이메일 outbox 직접 큐 적재 제거(이중 소비 방지)
- RPT-REGEN-005: 완료(승인) 리포트 재생성 시 승인 유지
- ADM-STATE-01: 이미 승인/반려된 검토 항목 재검토 차단(409)
- VIDEO-EXPECTED-COUNT-DOS: expected_count 상한(누락 range OOM 방지)
"""

import uuid
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.core.database import get_db
from app.main import app


def _db():
    return next(app.dependency_overrides[get_db]())


# ── CONC-DUP-JOIN-INVITE ─────────────────────────────────────────────


def test_invite_duplicate_returns_409_not_500(client):
    """동일 회원 중복 초대는 500(IntegrityError)이 아니라 409 로 응답한다."""
    from tests.test_sdd015_class_code import _create_class, _register

    counselor = _register(client, "conc-invite@test.com")
    cls = _create_class(client, counselor["h"], max_participants=10)
    member = _register(client, "conc-invite-m@test.com", role="client")
    url = f"/api/v1/sessions/{cls['id']}/invite"

    first = client.post(url, json={"user_id": member["id"]}, headers=counselor["h"])
    assert first.status_code in (200, 201), first.text

    second = client.post(url, json={"user_id": member["id"]}, headers=counselor["h"])
    assert second.status_code == 409, second.text


def test_join_by_code_member_idempotent(client):
    """같은 회원이 코드로 두 번 입장해도 한 행만 유지되고 같은 participant_id 를 돌려준다."""
    from tests.test_sdd015_class_code import _create_class, _open_class, _register

    counselor = _register(client, "conc-join@test.com")
    cls = _create_class(client, counselor["h"], max_participants=10)
    _open_class(client, cls, counselor["h"])
    member = _register(client, "conc-join-m@test.com", role="client")
    url = f"/api/v1/sessions/by-code/{cls['access_code']}/join"

    first = client.post(url, json={}, headers=member["h"])
    second = client.post(url, json={}, headers=member["h"])
    assert first.status_code == 200 and second.status_code == 200, first.text
    assert first.json()["participant_id"] == second.json()["participant_id"]
    assert len(second.json()["session"]["participants"]) == 1


# ── CONC-CAPACITY-RACE ───────────────────────────────────────────────


def test_capacity_full_second_member_waitlisted(client):
    """정원 1인 클래스에 두 명이 입장하면 두 번째는 대기열로 간다(초과 입장 방지)."""
    from tests.test_sdd015_class_code import _create_class, _open_class, _register

    counselor = _register(client, "cap-host@test.com")
    cls = _create_class(client, counselor["h"], max_participants=1)
    _open_class(client, cls, counselor["h"])
    m1 = _register(client, "cap-m1@test.com", role="client")
    m2 = _register(client, "cap-m2@test.com", role="client")
    url = f"/api/v1/sessions/by-code/{cls['access_code']}/join"

    assert client.post(url, json={}, headers=m1["h"]).status_code == 200
    r2 = client.post(url, json={}, headers=m2["h"])
    assert r2.status_code == 200, r2.text

    parts = {p["user_id"]: p for p in r2.json()["session"]["participants"]}
    assert parts[m1["id"]]["is_waitlisted"] is False
    assert parts[m2["id"]]["is_waitlisted"] is True


def test_invite_to_full_session_waitlists(client):
    """정원이 찬 세션에는 초대된 회원이 active 가 아니라 대기열로 등록된다."""
    import uuid as _uuid

    from app.models.session import SessionParticipant
    from tests.test_sdd015_class_code import _create_class, _register

    counselor = _register(client, "cap-inv-host@test.com")
    cls = _create_class(client, counselor["h"], max_participants=1)
    m1 = _register(client, "cap-inv-m1@test.com", role="client")
    m2 = _register(client, "cap-inv-m2@test.com", role="client")
    url = f"/api/v1/sessions/{cls['id']}/invite"

    assert client.post(url, json={"user_id": m1["id"]}, headers=counselor["h"]).status_code in (200, 201)
    assert client.post(url, json={"user_id": m2["id"]}, headers=counselor["h"]).status_code in (200, 201)

    db = _db()
    try:
        rows = {
            str(p.user_id): p
            for p in db.query(SessionParticipant).filter(
                SessionParticipant.session_id == _uuid.UUID(cls["id"])
            ).all()
        }
        assert rows[m1["id"]].is_waitlisted is False
        assert rows[m2["id"]].is_waitlisted is True
    finally:
        db.close()


# ── CHAT-DIRECT-ROOM-RACE ────────────────────────────────────────────


def test_get_or_create_direct_room_idempotent(client):
    """같은 (상담사, 내담자) 조합으로 두 번 조회해도 같은 방을 돌려준다."""
    from app.services import chat_service
    from tests.test_sdd015_class_code import _register

    counselor = _register(client, "chatrace-host@test.com")
    member = _register(client, "chatrace-m@test.com", role="client")
    db = _db()
    try:
        r1 = chat_service.get_or_create_direct_room(
            uuid.UUID(counselor["id"]), uuid.UUID(member["id"]), db
        )
        r2 = chat_service.get_or_create_direct_room(
            uuid.UUID(counselor["id"]), uuid.UUID(member["id"]), db
        )
        assert r1.id == r2.id
    finally:
        db.close()


def test_get_or_create_room_by_session_idempotent(client):
    """세션 채팅방은 세션당 하나만 존재한다(멱등)."""
    from app.services import chat_service
    from tests.test_video_record import _create_session, _register

    host = _register(client, "chatroom-host@test.com")
    sid = _create_session(client, host, started=True)
    db = _db()
    try:
        r1 = chat_service.get_or_create_room_by_session(uuid.UUID(sid), db)
        r2 = chat_service.get_or_create_room_by_session(uuid.UUID(sid), db)
        assert r1.id == r2.id
    finally:
        db.close()


def test_get_or_create_room_by_session_recovers_from_unique_conflict(client):
    """존재 검사가 경합으로 빗나가 삽입이 unique(session_id) 위반을 내도 500 대신 기존 방을 반환한다."""
    from app.models.chat import ChatRoom
    from app.models.session import Session as SessionModel
    from app.services import chat_service
    from tests.test_video_record import _create_session, _register

    host = _register(client, "roomrace@test.com")
    sid = _create_session(client, host, started=True)
    db = _db()
    try:
        room = chat_service.get_or_create_room_by_session(uuid.UUID(sid), db)

        class _MissQuery:
            def filter(self, *a, **k):
                return self

            def first(self):
                return None

        class _RaceDB:
            """ChatRoom 존재 검사를 딱 1회 None 으로 만들어 check-then-insert 경합 창을 재현."""

            def __init__(self, real):
                self._real = real
                self._miss = True

            def query(self, *args, **kwargs):
                if self._miss and args and args[0] is ChatRoom:
                    self._miss = False
                    return _MissQuery()
                return self._real.query(*args, **kwargs)

            def __getattr__(self, name):
                return getattr(self._real, name)

        recovered = chat_service.get_or_create_room_by_session(uuid.UUID(sid), _RaceDB(db))
        assert recovered.id == room.id
    finally:
        db.close()


# ── OUTBOX-DUP-003 ───────────────────────────────────────────────────


def test_notify_event_does_not_directly_enqueue_email(client):
    """notify_event 는 이메일 outbox 행만 만들고 직접 큐 적재하지 않는다(이중 소비 방지)."""
    from app.models.notification_outbox import NotificationOutbox
    from app.services import notification_service
    from tests.test_admin import _register

    u = _register(client, "outbox-dup@test.com")
    db = _db()
    try:
        with patch("app.tasks.report_email_task.notification_email_task.apply_async") as apply_async:
            notification_service.notify_event(
                "session_booked", u["id"], {"title": "세션 예약", "body": "예약됨"}, db
            )
        # 직접 enqueue 하지 않는다 → beat/cron 의 단일 소비자만 처리
        apply_async.assert_not_called()

        rows = (
            db.query(NotificationOutbox)
            .filter(
                NotificationOutbox.channel == "email",
                NotificationOutbox.user_id == uuid.UUID(u["id"]),
            )
            .all()
        )
        assert rows, "이메일 outbox 행은 남아 있어야 함"
        assert all(r.status == "pending" for r in rows)
    finally:
        db.close()


# ── RPT-REGEN-005 ────────────────────────────────────────────────────


def test_report_regeneration_preserves_approved(client):
    """완료(승인) 리포트를 재생성해도 status=completed 가 유지된다."""
    from app.models.record import Report
    from app.tasks.report_task import generate_report_inline
    from tests.test_video_record import _create_session, _register

    host = _register(client, "regen@test.com")
    sid = _create_session(client, host, started=True)
    db = _db()
    try:
        report = Report(
            session_id=uuid.UUID(sid),
            user_id=uuid.UUID(host["id"]),
            participant_id=None,
            type="counselor",
            status="completed",
            content={"headline": "승인된 리포트", "counselor_comment": "좋은 세션이었습니다"},
            data_credibility="high",
            generation_status="ready",
        )
        db.add(report)
        db.commit()
        db.refresh(report)
        rid = report.id

        generate_report_inline(str(rid), db)
        db.refresh(report)
        assert report.status == "completed", "재생성 후에도 승인(completed)이 유지돼야 함"
    finally:
        db.close()


# ── ADM-STATE-01 ─────────────────────────────────────────────────────


def test_admin_review_terminal_state_guard(client):
    """이미 승인된 검토 항목은 반려/보완요청 등 재검토 액션을 409 로 거부한다."""
    from tests.test_admin import _make_admin, _register, _seed_credential

    admin = _make_admin(client)
    submitter = _register(client, "adm-guard@test.com")
    cid = _seed_credential(client, submitter["id"], status="pending")
    url = f"/api/v1/admin/reviews/credential/{cid}/action"

    approve = client.post(url, json={"action": "approve", "reason": "ok"}, headers=admin["h"])
    assert approve.status_code == 200, approve.text
    assert approve.json()["status"] == "approved"

    reject = client.post(url, json={"action": "reject", "reason": "번복"}, headers=admin["h"])
    assert reject.status_code == 409, reject.text

    request_more = client.post(url, json={"action": "request_more", "reason": "재검토"}, headers=admin["h"])
    assert request_more.status_code == 409, request_more.text


def test_admin_review_org_document_terminal_state_guard(client):
    from tests.test_admin import _make_admin, _seed_org_document

    admin = _make_admin(client)
    did = _seed_org_document(client)
    url = f"/api/v1/admin/reviews/org_document/{did}/action"

    first = client.post(url, json={"action": "approve", "reason": "ok"}, headers=admin["h"])
    assert first.status_code == 200, first.text

    second = client.post(url, json={"action": "reject", "reason": "번복"}, headers=admin["h"])
    assert second.status_code == 409, second.text


# ── VIDEO-EXPECTED-COUNT-DOS ─────────────────────────────────────────


def test_video_stop_rejects_oversized_expected_count(client):
    """API 는 비현실적으로 큰 expected_count 를 422 로 거부한다(스키마 상한)."""
    from tests.test_video_record import _create_session, _register

    host = _register(client, "vid-dos@test.com")
    sid = _create_session(client, host)
    client.post(
        f"/api/v1/sessions/{sid}/video/start", json={"consent_video": True}, headers=host["auth"]
    )
    res = client.post(
        f"/api/v1/sessions/{sid}/video/stop",
        json={"expected_count": 1_000_000_000},
        headers=host["auth"],
    )
    assert res.status_code == 422, res.text


def test_video_stop_service_rejects_oversized_expected_count(client):
    """서비스 계층도 상한을 초과한 expected_count 를 422 로 거부한다(직접 호출 방어)."""
    from app.services import video_service
    from tests.test_video_record import _create_session, _register

    host = _register(client, "vid-dos2@test.com")
    sid = _create_session(client, host)
    db = _db()
    try:
        with pytest.raises(HTTPException) as exc:
            video_service.stop_recording(sid, host["id"], 1_000_000_000, db)
        assert exc.value.status_code == 422
    finally:
        db.close()


def test_video_stop_ignores_polluted_expected_count_without_oom(client):
    """과거에 오염된 큰 expected_count 가 남아 있어도 range() 폭발 없이 안전하게 응답한다."""
    from app.models.record import SessionRecord
    from app.services import video_service
    from tests.test_video_record import _create_session, _register

    host = _register(client, "vid-dos3@test.com")
    sid = _create_session(client, host)
    db = _db()
    try:
        record = SessionRecord(
            session_id=uuid.UUID(sid), video_status="completed", video_expected_chunks=1_000_000_000
        )
        db.add(record)
        db.commit()

        result = video_service.stop_recording(sid, host["id"], None, db)
        assert result["expected_chunks"] is None
        assert result["missing_chunks"] == []
    finally:
        db.close()
