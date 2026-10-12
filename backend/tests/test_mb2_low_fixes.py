"""MIND BREEZE 2.0 기능상 오류(하) 9건 회귀 테스트.

- [1] ADMIN-03     플랫폼 관리자 unsuspend — pending(초대 미수락) 강제 활성화 금지
- [2] AUD-03       오디오 stop_recording 멱등성(recording 일 때만 전이)
- [3] LIVE-04      발언권/토큰 — 완료/취소 세션 상태 가드
- [4] LIVE-05      participant_changed 페이로드에 participants 배열 포함
- [5] MB2-ONB-BIRTHDATE-FUTURE  온보딩 step2 미래 생년월일 거부
- [6] MB2-ORG-LASTADMIN-MIRROR  마지막 기관 관리자 가드 membership 기준
- [7] NOTIF-02     전체읽음 응답 키 {count} 계약
- [8] NOTIF-04     session_updated 토글 실효
- [9] PDF-NARR-001 PDF 서사 타임라인 재스케일 경계(==1 제외)
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

VALID_PASSWORD = "Passw0rd!"


def _db():
    from app.core.database import get_db
    from app.main import app

    return next(app.dependency_overrides[get_db]())


def _consents():
    return {"tos": True, "privacy": True, "sensitive": True}


def _register(client, role: str = "counselor", email: str | None = None) -> dict:
    from app.services import email_verify_service
    from tests.conftest import create_test_org, post_register

    email = email or f"{uuid4().hex[:12]}@test.com"
    payload = {
        "org_code": create_test_org(),
        "email": email,
        "password": VALID_PASSWORD,
        "name": "테스트",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": _consents(),
    }
    res = post_register(client, role, payload)
    assert res.status_code == 201, res.text
    body = res.json()
    token = body.get("access_token") or body.get("tokens", {}).get("access_token")
    return {"id": body["user"]["id"], "token": token, "h": {"Authorization": f"Bearer {token}"}}


def _future(minutes: int = 60) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


# ---------------------------------------------------------------------------
# [1] ADMIN-03 — unsuspend 상태 가드
# ---------------------------------------------------------------------------


def test_admin03_unsuspend_pending_stays_pending(client):
    from app.models.user import User
    from app.services import admin_service

    db = _db()
    try:
        padmin = User(
            email="admin03-pa@test.com", password_hash="x", name="관리자",
            role="platform_admin", status="active",
        )
        pending = User(
            email="admin03-pending@test.com", password_hash="x", name="초대대기",
            role="counselor", status="pending",
        )
        db.add_all([padmin, pending])
        db.commit()

        result = admin_service.unsuspend_user(pending.id, padmin.id, db)
        assert result["status"] == "pending"
        db.refresh(pending)
        assert pending.status == "pending"
    finally:
        db.close()


def test_admin03_unsuspend_suspended_reactivates(client):
    from app.models.user import User
    from app.services import admin_service

    db = _db()
    try:
        padmin = User(
            email="admin03-pa2@test.com", password_hash="x", name="관리자",
            role="platform_admin", status="active",
        )
        suspended = User(
            email="admin03-susp@test.com", password_hash="x", name="정지",
            role="counselor", status="suspended",
        )
        db.add_all([padmin, suspended])
        db.commit()

        result = admin_service.unsuspend_user(suspended.id, padmin.id, db)
        assert result["status"] == "active"
    finally:
        db.close()


# ---------------------------------------------------------------------------
# [2] AUD-03 — stop_recording 멱등성
# ---------------------------------------------------------------------------


def _mk_session_with_host(db, email: str, status: str = "in_progress"):
    from app.models.session import Session as SessionModel
    from app.models.user import User

    host = User(
        email=email, password_hash="x", name="호스트", role="counselor", status="active"
    )
    db.add(host)
    db.flush()
    s = SessionModel(host_id=host.id, type="clinical", duration_min=30, status=status)
    db.add(s)
    db.commit()
    return host, s


def test_aud03_stop_without_start_is_noop(client):
    from app.services import audio_service

    db = _db()
    try:
        host, s = _mk_session_with_host(db, "aud03-a@test.com")
        res = audio_service.stop_recording(str(s.id), str(host.id), db)
        assert res["status"] == "idle"  # 미시작 stop 은 processing 으로 전이하지 않는다
    finally:
        db.close()


def test_aud03_double_stop_idempotent(client):
    from app.services import audio_service

    db = _db()
    try:
        host, s = _mk_session_with_host(db, "aud03-b@test.com")
        audio_service.start_recording(str(s.id), str(host.id), True, db)
        first = audio_service.stop_recording(str(s.id), str(host.id), db)
        assert first["status"] == "processing"
        ended_at = first["ended_at"]

        second = audio_service.stop_recording(str(s.id), str(host.id), db)
        assert second["status"] == "processing"
        assert second["ended_at"] == ended_at  # 두 번째 stop 은 상태를 바꾸지 않는다
    finally:
        db.close()


# ---------------------------------------------------------------------------
# [3] LIVE-04 — 완료/취소 세션 발언권·토큰 가드
# ---------------------------------------------------------------------------


def _complete_session(cls: dict) -> None:
    from app.models.session import Session as SessionModel

    db = _db()
    try:
        s = db.get(SessionModel, UUID(cls["id"]))
        s.status = "completed"
        db.commit()
    finally:
        db.close()


def test_live04_raise_hand_completed_400(client):
    from tests.test_member_livekit_token import _set_room_id
    from tests.test_sdd015_class_code import _register as _reg
    from tests.test_sdd094_speaking_rights import _grant_group_guest, _raise_hand

    counselor = _reg(client, "live04-a@test.com")
    cls, joined = _grant_group_guest(client, counselor)
    _set_room_id(cls, uuid4())
    _complete_session(cls)

    res = _raise_hand(client, cls, joined["participant_id"], token=joined["participant_token"])
    assert res.status_code == 400, res.text


def test_live04_set_speaking_completed_400(client):
    from tests.test_sdd015_class_code import _register as _reg
    from tests.test_sdd094_speaking_rights import _grant_group_guest, _set_speaking

    counselor = _reg(client, "live04-b@test.com")
    cls, joined = _grant_group_guest(client, counselor)
    _complete_session(cls)

    res = _set_speaking(client, cls, joined["participant_id"], True, headers=counselor["h"])
    assert res.status_code == 400, res.text


def test_live04_member_token_completed_400(client):
    from tests.test_member_livekit_token import _set_room_id
    from tests.test_sdd015_class_code import _register as _reg
    from tests.test_sdd094_speaking_rights import _grant_group_guest

    counselor = _reg(client, "live04-c@test.com")
    cls, joined = _grant_group_guest(client, counselor)
    _set_room_id(cls, uuid4())
    _complete_session(cls)

    res = client.post(
        f"/api/v1/sessions/by-code/{cls['access_code']}/livekit-token",
        json={
            "participant_id": joined["participant_id"],
            "participant_token": joined["participant_token"],
        },
    )
    assert res.status_code == 400, res.text


# ---------------------------------------------------------------------------
# [4] LIVE-05 — participant_changed 에 participants 배열 포함
# ---------------------------------------------------------------------------


def test_live05_participant_changed_payload_includes_participants(client, monkeypatch):
    import app.ws.session_live_namespace as ns

    captured: dict = {}
    monkeypatch.setattr(
        ns, "notify_participant_changed", lambda sid, payload: captured.update(payload)
    )

    from app.models.session import Session as SessionModel, SessionParticipant
    from app.services import session_service

    db = _db()
    try:
        host, s = _mk_session_with_host(db, "live05@test.com")
        db.add(SessionParticipant(session_id=s.id, user_id=host.id, band_connected=True))
        db.add(SessionParticipant(session_id=s.id, user_id=None, guest_name="게스트A"))
        db.commit()
        db.refresh(s)

        session_service._notify_participant_changed(s, db)
    finally:
        db.close()

    assert "participants" in captured
    assert len(captured["participants"]) == 2
    assert captured["participant_count"] == 2
    names = {p["display_name"] for p in captured["participants"]}
    assert "게스트A" in names
    for row in captured["participants"]:
        assert row["participant_id"]
        assert "user_id" in row and "is_guest" in row and "display_name" in row


# ---------------------------------------------------------------------------
# [5] MB2-ONB-BIRTHDATE-FUTURE — 온보딩 step2 미래 생년월일 거부
# ---------------------------------------------------------------------------


def test_onb_birthdate_future_step2_422(client):
    u = _register(client, role="client", email="onb-birth@test.com")
    res = client.put(
        "/api/v1/onboarding/client/step2",
        json={"gender": None, "birth_date": "2999-01-01", "concerns": [], "interests": []},
        headers=u["h"],
    )
    assert res.status_code == 422, res.text


def test_onb_birthdate_past_step2_ok(client):
    u = _register(client, role="client", email="onb-birth2@test.com")
    res = client.put(
        "/api/v1/onboarding/client/step2",
        json={"gender": None, "birth_date": "1990-05-05", "concerns": [], "interests": []},
        headers=u["h"],
    )
    assert res.status_code == 200, res.text


# ---------------------------------------------------------------------------
# [6] MB2-ORG-LASTADMIN-MIRROR — 마지막 관리자 가드 membership 기준
# ---------------------------------------------------------------------------


def test_org06_last_admin_membership_409(client):
    from app.models.organization import Organization
    from app.models.user import User
    from app.models.user_org_membership import UserOrgMembership
    from app.services import org_management_service

    db = _db()
    try:
        org = Organization(name="기관6A", org_code="O06A")
        db.add(org)
        db.flush()
        actor = User(
            email="o06a-actor@test.com", password_hash="x", name="행위자",
            role="platform_admin", status="active",
        )
        admin = User(
            email="o06a-admin@test.com", password_hash="x", name="관리자",
            role="org_admin", status="active", org_id=org.id,
        )
        db.add_all([actor, admin])
        db.flush()
        db.add(UserOrgMembership(
            user_id=admin.id, org_id=org.id, role="org_admin", status="active", is_primary=True
        ))
        db.commit()

        with pytest.raises(HTTPException) as exc:
            org_management_service.change_counselor(
                org.id, admin.id, actor.id, "강등", db, role="counselor"
            )
        assert exc.value.status_code == 409
    finally:
        db.close()


def test_org06_multi_org_counselor_not_blocked(client):
    """org A 의 org_admin(미러 org_id=A)이 org B 에서는 counselor — B 에서 강등해도 409 아님."""
    from app.models.organization import Organization
    from app.models.user import User
    from app.models.user_org_membership import UserOrgMembership
    from app.services import org_management_service

    db = _db()
    try:
        org_a = Organization(name="기관6B-A", org_code="O06B1")
        org_b = Organization(name="기관6B-B", org_code="O06B2")
        db.add_all([org_a, org_b])
        db.flush()
        actor = User(
            email="o06b-actor@test.com", password_hash="x", name="행위자",
            role="platform_admin", status="active",
        )
        # 주 소속은 A(미러 role=org_admin)이지만 B 에서는 counselor.
        x = User(
            email="o06b-x@test.com", password_hash="x", name="다기관",
            role="org_admin", status="active", org_id=org_a.id,
        )
        db.add_all([actor, x])
        db.flush()
        db.add(UserOrgMembership(
            user_id=x.id, org_id=org_a.id, role="org_admin", status="active", is_primary=True
        ))
        db.add(UserOrgMembership(
            user_id=x.id, org_id=org_b.id, role="counselor", status="active"
        ))
        db.commit()

        # B 에서 강등 — 마지막 관리자 오판으로 409 가 나면 안 된다.
        result = org_management_service.change_counselor(
            org_b.id, x.id, actor.id, "정리", db, role="counselor"
        )
        assert result is not None
    finally:
        db.close()


# ---------------------------------------------------------------------------
# [7] NOTIF-02 — 전체읽음 응답 {count}
# ---------------------------------------------------------------------------


def test_notif02_read_all_returns_count(client):
    u = _register(client, email="notif02@test.com")
    res = client.put("/api/v1/notifications/read-all", headers=u["h"])
    assert res.status_code == 200, res.text
    assert res.json() == {"count": 0}


# ---------------------------------------------------------------------------
# [8] NOTIF-04 — session_updated 토글 실효
# ---------------------------------------------------------------------------


def test_notif04_session_updated_toggle_suppresses(client):
    from app.models.notification import Notification
    from app.models.user import User
    from app.services import notification_service

    db = _db()
    try:
        user = User(
            email="notif04@test.com", password_hash="x", name="수신자",
            role="counselor", status="active",
            notification_preferences={
                "in_app": {"session_updated": False},
                "email": {"session_updated": False},
            },
        )
        db.add(user)
        db.commit()

        notification_service.notify_event(
            "session_updated",
            user.id,
            {
                "title": "일정 변경",
                "body": "세션 일정이 변경되었습니다.",
                "extra": notification_service.build_standard_extra(
                    "session_updated", "session", str(uuid4())
                ),
            },
            db,
        )
        assert db.query(Notification).filter_by(user_id=user.id).count() == 0

        # session_updated 를 켜면 정상 발송된다(치환 제거 확인).
        user.notification_preferences = {"in_app": {"session_updated": True}}
        db.commit()
        notification_service.notify_event(
            "session_updated",
            user.id,
            {
                "title": "일정 변경",
                "body": "세션 일정이 변경되었습니다.",
                "extra": notification_service.build_standard_extra(
                    "session_updated", "session", str(uuid4())
                ),
            },
            db,
        )
        assert db.query(Notification).filter_by(user_id=user.id).count() == 1
    finally:
        db.close()


def test_notif04_pref_event_key_identity():
    from app.services import notification_service

    assert notification_service._get_pref_event_key("session_updated") == "session_updated"
    assert notification_service._get_pref_event_key("session_booked") == "session_booked"


# ---------------------------------------------------------------------------
# [9] PDF-NARR-001 — 재스케일 경계(==1 제외)
# ---------------------------------------------------------------------------


def test_pdf_narr_001_boundary_one_not_rescaled():
    from app.services.report_pdf_narrative import parse_timeline

    points = parse_timeline([
        {"min": 0, "concentration": 1, "relaxation": 0.5, "stress": 100},
    ])
    assert len(points) == 1
    assert points[0]["concentration"] == 1  # 0~100 의 1 은 그대로
    assert points[0]["relaxation"] == 50.0  # 0~1 레거시 0.5 → 50
    assert points[0]["stress"] == 100  # 0~100 의 100 은 그대로
