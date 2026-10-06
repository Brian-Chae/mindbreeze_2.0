"""AUTH4/기능상 오류(중) 12건 회귀 검증 — 2026-10 기능오류 4차.

검증 대상:
  [1]  AUTH4-01 상담사 온보딩 role 가드 + verified 직접 상향 분리
  [2]  AUTH4-02 change_counselor 멤버십 role 기준 / 전역 role 오염 제거
  [3]  AUTH4-03 add_counselor_by_code 코드 정규화
  [4]  AUTH4-04 add_counselor_by_code verified_tier·비활성 기관 검증
  [5]  AUTH4-05 admin 기관 구성원/상담사 목록/비번재설정 membership 기준
  [6]  AUTH4-06 delete_user 세션 자식(session_records) cascade
  [7]  AUTHZ-PARTICIPANT-PII 비host 참여자 PII 미노출
  [8]  CHAT-WS-MESSAGE-SPOOF WS message sender_id 서버 강제·페이로드 검증
  [9]  WS-CONTRACT-DEVICE-VERSION device_status_changed version 포함
  [10] WS-SNAPSHOT-METRICS-KEY 호스트 join 스냅샷 participants 키
  [11] WS-JOIN-HOST-EXCEPTION _resolve_join 예외 → join_denied
  [12] RPT-EMAIL-CONTRACT-004 재발송 응답 계약 {success, sent, message}
"""

import asyncio
import uuid
from datetime import date

import pytest

from app.core.database import get_db
from app.core.security import create_access_token, hash_password
from app.main import app
from app.models.chat import ChatRoom  # noqa: F401 — 메타데이터 등록
from app.models.counselor_profile import CounselorProfile
from app.models.organization import Organization
from app.models.record import EEGRecord, Report, SessionRecord
from app.models.session import Session as SessionModel
from app.models.session import SessionParticipant
from app.models.user import User
from app.models.user_org_membership import UserOrgMembership
from app.services import email_verify_service, membership_service
from tests.conftest import create_test_counselor, create_test_org, post_register


VALID_PASSWORD = "Passw0rd!"


def _db():
    provider = app.dependency_overrides[get_db]()
    return next(provider), provider


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register_client(client, email: str) -> dict:
    res = client.post(
        "/api/v1/auth/register/client",
        json={
            "email": email,
            "password": VALID_PASSWORD,
            "name": "내담자",
            "email_verify_token": email_verify_service.generate_email_verify_token(email),
            "consents": {"tos": True, "privacy": True, "sensitive": True},
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()
    return {"id": body["user"]["id"], "token": body["access_token"]}


def _make_counselor_with_code(
    db,
    *,
    email: str,
    code: str,
    verified_tier: str = "email",
    org_id=None,
) -> User:
    user = User(
        email=email, password_hash=hash_password(VALID_PASSWORD), name="상담사",
        role="counselor", status="active", verified_tier=verified_tier, org_id=org_id,
    )
    db.add(user)
    db.flush()
    db.add(CounselorProfile(user_id=user.id, counselor_code=code, specialties=[]))
    if org_id is not None:
        membership_service.add_membership(db, user, org_id, status_="active")
    db.commit()
    db.refresh(user)
    return user


# ---------------------------------------------------------------------------
# [1] AUTH4-01 — 상담사 온보딩 role 가드 + verified 직접 상향 분리
# ---------------------------------------------------------------------------


def test_auth401_client_cannot_run_counselor_onboarding(client):
    """내담자(client)는 상담사 온보딩 단계/완료에 접근할 수 없다(403)."""
    member = _register_client(client, "auth401-client@test.com")
    for path in (
        "/api/v1/onboarding/counselor/step1",
        "/api/v1/onboarding/counselor/step2",
        "/api/v1/onboarding/counselor/step3",
        "/api/v1/onboarding/counselor/step4",
    ):
        res = client.put(path, json={"name": "위조", "affiliation_type": "private"}, headers=_h(member["token"]))
        assert res.status_code == 403, f"{path} -> {res.status_code}"

    done = client.post("/api/v1/onboarding/counselor/complete", headers=_h(member["token"]))
    assert done.status_code == 403


def test_auth401_complete_does_not_self_promote_verified(client):
    """온보딩 완료는 verified_tier 를 'verified' 로 직접 상향하지 않는다."""
    created = create_test_counselor("auth401-co@test.com", org_code=create_test_org())
    h = _h(created["access_token"])
    client.put("/api/v1/onboarding/counselor/step1", json={"name": "상담사", "phone": None}, headers=h)
    client.put(
        "/api/v1/onboarding/counselor/step2",
        json={"gender": None, "birth_date": None, "years_of_experience": None, "specialties": []},
        headers=h,
    )
    client.put("/api/v1/onboarding/counselor/step3", json={"affiliation_type": "private", "credential_files": []}, headers=h)
    client.put("/api/v1/onboarding/counselor/step4", json={"profile_image_url": None, "bio": None}, headers=h)
    res = client.post("/api/v1/onboarding/counselor/complete", headers=h)
    assert res.status_code == 200, res.text
    assert res.json()["verified_tier"] != "verified"


# ---------------------------------------------------------------------------
# [2] AUTH4-02 — change_counselor 멤버십 role 기준 / 전역 role 오염 제거
# ---------------------------------------------------------------------------


def test_auth402_sub_org_role_change_does_not_pollute_global_role(client):
    from app.services import org_management_service

    db, provider = _db()
    try:
        org_a = Organization(name="주소속A", org_code="AUA111", kind="institution")
        org_b = Organization(name="부소속B", org_code="AUB222", kind="institution")
        db.add_all([org_a, org_b])
        db.flush()

        user = User(
            email="auth402@test.com", password_hash=hash_password(VALID_PASSWORD),
            name="다기관", role="counselor", status="active", verified_tier="email",
            org_id=org_a.id,
        )
        db.add(user)
        db.flush()
        membership_service.add_membership(db, user, org_a.id, status_="active")  # primary
        membership_service.add_membership(db, user, org_b.id, status_="active")
        db.commit()

        # 부 소속 B 에서 org_admin 으로 승격 → 전역 role(주 소속 A 미러)은 counselor 유지
        org_management_service.change_counselor(
            org_b.id, user.id, uuid.uuid4(), "부소속 승격", db, role="org_admin"
        )
        db.refresh(user)
        assert user.role == "counselor", "부 소속 역할 변경이 전역 role 을 오염시켰다"
        mem_b = membership_service.get_membership(db, user.id, org_b.id)
        assert mem_b.role == "org_admin"

        # 멤버십 role 기준 멱등 단락 — 같은 role 재요청은 no-op(전역 role 비교 아님)
        before_version = db.query(Organization).filter(Organization.id == org_b.id).first().version
        org_management_service.change_counselor(
            org_b.id, user.id, uuid.uuid4(), "동일 role", db, role="org_admin"
        )
        after_version = db.query(Organization).filter(Organization.id == org_b.id).first().version
        assert before_version == after_version, "동일 멤버십 role 재요청이 실제 변경을 일으켰다"
    finally:
        provider.close()


# ---------------------------------------------------------------------------
# [3]/[4] AUTH4-03/04 — add_counselor_by_code 정규화 + 검증
# ---------------------------------------------------------------------------


def test_auth403_lowercase_code_matches(client):
    member = _register_client(client, "auth403-client@test.com")
    db, provider = _db()
    try:
        _make_counselor_with_code(db, email="auth403-co@test.com", code="ABC123")
    finally:
        provider.close()

    res = client.post(
        "/api/v1/client/counselors", json={"code": "abc123"}, headers=_h(member["token"])
    )
    assert res.status_code == 201, res.text
    assert res.json()["id"]


def test_auth404_unverified_and_inactive_org_blocked(client):
    member = _register_client(client, "auth404-client@test.com")
    db, provider = _db()
    try:
        _make_counselor_with_code(
            db, email="auth404-unverified@test.com", code="UNV111", verified_tier="unverified"
        )
    finally:
        provider.close()
    blocked = client.post("/api/v1/client/counselors", json={"code": "UNV111"}, headers=_h(member["token"]))
    assert blocked.status_code == 403, blocked.text

    # 비활성화 기관 소속 상담사 → 409
    from datetime import datetime, timezone

    db, provider = _db()
    try:
        org = Organization(name="비활성기관", org_code="DEAD01", kind="institution")
        db.add(org)
        db.flush()
        _make_counselor_with_code(db, email="auth404-org@test.com", code="ORG222", org_id=org.id)
        org.deactivated_at = datetime.now(timezone.utc)
        db.commit()
    finally:
        provider.close()
    dead = client.post("/api/v1/client/counselors", json={"code": "ORG222"}, headers=_h(member["token"]))
    assert dead.status_code == 409, dead.text


# ---------------------------------------------------------------------------
# [5] AUTH4-05 — admin 기관 구성원 목록 membership 기준
# ---------------------------------------------------------------------------


def test_auth405_multi_org_counselor_visible_in_admin_org_list(client):
    db, provider = _db()
    try:
        admin = User(email="auth405-admin@test.com", password_hash=hash_password(VALID_PASSWORD),
                     name="플랫폼관리자", role="platform_admin", status="active")
        org_a = Organization(name="A기관", org_code="A5A111", kind="institution")
        org_b = Organization(name="B기관", org_code="A5B222", kind="institution")
        db.add_all([admin, org_a, org_b])
        db.flush()

        user = User(email="auth405-co@test.com", password_hash=hash_password(VALID_PASSWORD),
                    name="다기관상담사", role="counselor", status="active",
                    verified_tier="email", org_id=org_a.id)
        db.add(user)
        db.flush()
        membership_service.add_membership(db, user, org_a.id, status_="active")
        membership_service.add_membership(db, user, org_b.id, status_="active")
        db.commit()
        admin_token = create_access_token(subject=str(admin.id))
        user_id, org_b_id = str(user.id), str(org_b.id)
    finally:
        provider.close()

    res = client.get(f"/api/v1/admin/orgs/{org_b_id}/counselors", headers=_h(admin_token))
    assert res.status_code == 200, res.text
    rows = {r["id"]: r for r in res.json()}
    assert user_id in rows, "부 소속 상담사가 기관 구성원 목록에서 누락됐다"
    assert rows[user_id]["role"] == "counselor"


# ---------------------------------------------------------------------------
# [6] AUTH4-06 — delete_user 세션 자식 cascade
# ---------------------------------------------------------------------------


def test_auth406_delete_user_removes_session_children(client):
    from app.services import admin_service

    db, provider = _db()
    try:
        user = User(email="auth406@test.com", password_hash=hash_password(VALID_PASSWORD),
                    name="삭제대상", role="counselor", status="active")
        db.add(user)
        db.flush()
        session = SessionModel(host_id=user.id, type="meditation", status="completed", duration_min=30)
        db.add(session)
        db.flush()
        db.add(SessionRecord(session_id=session.id, status="completed"))
        db.add(Report(session_id=session.id, type="counselor", status="completed", content={}))
        db.add(EEGRecord(session_id=session.id, user_id=user.id, s3_key="k"))
        db.commit()

        uid, sid = user.id, session.id
        admin_service.delete_user(uid, uuid.uuid4(), db)

        assert db.query(SessionRecord).filter(SessionRecord.session_id == sid).count() == 0
        assert db.query(Report).filter(Report.session_id == sid).count() == 0
        assert db.query(SessionModel).filter(SessionModel.host_id == uid).count() == 0
        assert db.query(User).filter(User.id == uid).first() is None
    finally:
        provider.close()


# ---------------------------------------------------------------------------
# [7] AUTHZ-PARTICIPANT-PII — 비host 참여자 PII 미노출
# ---------------------------------------------------------------------------


def test_participant_pii_hidden_from_non_host(client):
    host = create_test_counselor("pii-host@test.com", org_code=create_test_org())
    member = _register_client(client, "pii-member@test.com")

    db, provider = _db()
    try:
        session = SessionModel(
            host_id=uuid.UUID(host["id"]), type="meditation", status="scheduled",
            duration_min=30, title="PII 검증",
        )
        db.add(session)
        db.flush()
        db.add(SessionParticipant(
            session_id=session.id, user_id=uuid.UUID(member["id"]),
            gender="female", birth_date=date(1990, 1, 1),
        ))
        db.commit()
        sid = str(session.id)
    finally:
        provider.close()

    # 참여자(비host) → PII 미노출
    res = client.get(f"/api/v1/sessions/{sid}", headers=_h(member["token"]))
    assert res.status_code == 200, res.text
    p = res.json()["participants"][0]
    assert p["gender"] is None and p["birth_date"] is None

    # host → PII 노출
    res_host = client.get(f"/api/v1/sessions/{sid}", headers=_h(host["access_token"]))
    assert res_host.status_code == 200, res_host.text
    ph = res_host.json()["participants"][0]
    assert ph["gender"] == "female" and ph["birth_date"] == "1990-01-01"


# ---------------------------------------------------------------------------
# [8] CHAT-WS-MESSAGE-SPOOF — sender_id 서버 강제 + 페이로드 검증
# ---------------------------------------------------------------------------


def test_chat_ws_message_forces_sender_and_validates(monkeypatch):
    from tests.test_ws_chat_multitab import _wire

    import app.ws.chat_namespace as chat

    fake, _seen = _wire(monkeypatch)
    asyncio.run(chat.connect("sid1", {}, {"token": "t"}))

    # 위조 sender_id/created_at 은 무시되고 토큰의 user_id 가 강제된다
    asyncio.run(
        chat.on_message(
            "sid1",
            {"room_id": "room-1", "content": "안녕", "sender_id": "attacker", "created_at": "1970"},
        )
    )
    msgs = [e for e in fake.emits if e["event"] == "new_message"]
    assert msgs and msgs[-1]["data"]["sender_id"] == "user-1"
    # 클라이언트가 보낸 created_at("1970")은 신뢰하지 않는다 — 서버가 새로 찍는다(WS-12).
    assert msgs[-1]["data"]["created_at"] != "1970"
    assert msgs[-1]["data"]["id"]
    assert msgs[-1]["data"]["created_at"]

    # 빈/공백 content 는 브로드캐스트하지 않는다
    before = len(fake.emits)
    asyncio.run(chat.on_message("sid1", {"room_id": "room-1", "content": "   "}))
    asyncio.run(chat.on_message("sid1", {"room_id": "room-1", "content": 123}))
    assert len(fake.emits) == before


# ---------------------------------------------------------------------------
# [9] WS-CONTRACT-DEVICE-VERSION — device_status_changed version 포함
# ---------------------------------------------------------------------------


def test_device_status_payload_includes_version(client, monkeypatch):
    import app.ws.session_live_namespace as ns
    from app.services import session_service

    captured: dict = {}
    monkeypatch.setattr(ns, "notify_device_status_changed", lambda sid, payload: captured.update(payload))

    class _P:
        id = uuid.uuid4()
        band_connected = True
        band_battery = 42

    session_service._notify_device_status(uuid.uuid4(), _P(), version=5)
    assert captured["version"] == 5
    assert captured["participant_id"] == str(_P.id)
    assert captured["band_battery"] == 42


def test_persist_feature_items_passes_session_version(client, monkeypatch):
    from tests.test_sdd026_live_session_p0 import _create_group_class, _feature, _join_guest, _register, _wire
    from app.services import session_service

    counselor = _register(client, "auth409-ver@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "게스트V")
    _wire(monkeypatch)

    captured: list = []
    monkeypatch.setattr(
        session_service, "_notify_device_status",
        lambda sid, participant, **kw: captured.append(kw),
    )
    res = client.post(
        f"/api/v1/sessions/{cls['id']}/features",
        json={"participant_id": pid, "features": [_feature(0, relaxation_index=0.5, band_battery=55)]},
    )
    assert res.status_code == 200, res.text
    assert captured, "배터리 보고 시 device_status 브로드캐스트가 예약되지 않았다"
    assert captured[-1].get("version") is not None


# ---------------------------------------------------------------------------
# [10] WS-SNAPSHOT-METRICS-KEY — 호스트 join 스냅샷 participants 키
# ---------------------------------------------------------------------------


def test_host_join_snapshot_has_participants_key(client, monkeypatch):
    from tests.test_sdd026_live_session_p0 import _create_group_class, _join_guest, _register, _wire

    counselor = _register(client, "auth410-host@test.com")
    cls = _create_group_class(client, counselor["h"])
    _join_guest(client, cls["access_code"], "게스트A")
    fake = _wire(monkeypatch)

    fake.call("connect", "sidH", {}, {"token": counselor["token"]})
    fake.call("join", "sidH", {"session_id": cls["id"]})

    joined = fake.events("joined")
    assert joined and joined[0]["data"]["role"] == "host"
    snap = joined[0]["data"]["snapshot"]
    assert "participants" in snap
    assert len(snap["participants"]) == len(snap["metrics"]) == 1


# ---------------------------------------------------------------------------
# [11] WS-JOIN-HOST-EXCEPTION — _resolve_join 예외 → join_denied
# ---------------------------------------------------------------------------


def test_join_resolve_exception_emits_join_denied(client, monkeypatch):
    from tests.test_sdd026_live_session_p0 import _create_group_class, _register, _wire

    import app.ws.session_live_namespace as ns

    counselor = _register(client, "auth411-host@test.com")
    cls = _create_group_class(client, counselor["h"])
    fake = _wire(monkeypatch)

    def boom(*args, **kwargs):
        raise RuntimeError("db down")

    monkeypatch.setattr(ns, "_resolve_join", boom)
    fake.call("connect", "sidX", {}, {"token": counselor["token"]})
    fake.call("join", "sidX", {"session_id": cls["id"]})

    assert fake.events("join_denied"), "예외 시 join_denied 가 통지되지 않았다"
    assert fake.rooms_of("sidX") == set()


# ---------------------------------------------------------------------------
# [12] RPT-EMAIL-CONTRACT-004 — 재발송 응답 계약 {success, sent, message}
# ---------------------------------------------------------------------------


def _client_report_ctx(client):
    from tests.test_report import _create_session
    from tests.test_report import _register as _reg_report_host

    host = _reg_report_host(client, "auth412-host@example.com")
    session_id = _create_session(client, host)
    db, provider = _db()
    participant = SessionParticipant(session_id=session_id, guest_name="재발송", report_email="old@example.com")
    db.add(participant)
    db.flush()
    report = Report(session_id=session_id, participant_id=participant.id, type="client", status="completed", content={})
    db.add(report)
    db.commit()
    return host, db, provider, report


def test_rpt_email_resend_success_contract(client, monkeypatch):
    from app.services import report_email_service

    host, db, provider, report = _client_report_ctx(client)
    try:
        monkeypatch.setattr(report_email_service, "send_report_email", lambda *a, **k: True)
        res = client.post(
            f"/api/v1/reports/{report.id}/resend-email",
            json={"email": "new@example.com"}, headers=host["auth"],
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert set(body) == {"success", "sent", "message"}
        assert body["success"] is True and body["sent"] is True
        assert body["message"]
    finally:
        provider.close()


def test_rpt_email_resend_failure_is_reported(client, monkeypatch):
    from app.services import report_email_service

    host, db, provider, report = _client_report_ctx(client)
    try:
        monkeypatch.setattr(report_email_service, "send_report_email", lambda *a, **k: False)
        res = client.post(
            f"/api/v1/reports/{report.id}/resend-email",
            json={"email": "new@example.com"}, headers=host["auth"],
        )
        # 실패도 200 이지만 success/sent=false + message 로 프론트가 성공 오표시하지 않게 한다
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["success"] is False and body["sent"] is False
        assert body["message"]
    finally:
        provider.close()
