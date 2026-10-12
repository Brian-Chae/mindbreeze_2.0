"""SDD-081 — 상담사 개인 상담소 자동 개설 QA

verify.md TS1~TS10 시나리오를 검증한다.
- 상담사 가입(초대 수락·개인 신청 승인) 시 개인 상담소 자동 개설 + 소속 보장
- 기관 해제 시 개인 상담소 복귀 (무소속 없음) + 안내 알림·메일
- 기관 목록/검색에서 개인 상담소 숨김
"""

import uuid

from tests.test_sdd017_counselor_invite import (  # noqa: F401 — 헬퍼 재사용
    NEW_PASSWORD,
    VALID_PASSWORD,
    _capture_invites,
    _db,
    _make_org_admin,
    _platform_admin,
)
from tests.test_sdd079_multi_org_membership import (  # noqa: F401 — 헬퍼 재사용
    _capture_membership_invites,
    _clear_cooldown,
    _invite,
    _setup_active_counselor,
)


def _offices(user_id: str) -> list:
    """owner 기준 개인 상담소(kind=individual) 목록."""
    from app.models.organization import Organization

    db = _db()
    try:
        return (
            db.query(Organization)
            .filter(
                Organization.owner_user_id == uuid.UUID(user_id),
                Organization.kind == "individual",
            )
            .all()
        )
    finally:
        db.close()


def _memberships(user_id: str) -> list:
    from app.models.user_org_membership import UserOrgMembership

    db = _db()
    try:
        return (
            db.query(UserOrgMembership)
            .filter(UserOrgMembership.user_id == uuid.UUID(user_id))
            .order_by(UserOrgMembership.created_at.asc())
            .all()
        )
    finally:
        db.close()


def _user(user_id: str):
    from app.models.user import User

    db = _db()
    try:
        return db.query(User).filter(User.id == uuid.UUID(user_id)).first()
    finally:
        db.close()


def _notifications(user_id: str, notif_type: str) -> list:
    from app.models.notification import Notification

    db = _db()
    try:
        return (
            db.query(Notification)
            .filter(
                Notification.user_id == uuid.UUID(user_id),
                Notification.type == notif_type,
            )
            .all()
        )
    finally:
        db.close()


def _capture_removed_mail_queue(monkeypatch) -> list:
    """해제 안내 메일 큐 적재(apply_async) 호출을 가로챈다."""
    captured: list = []

    class _FakeTask:
        @staticmethod
        def apply_async(args=None, **kwargs):
            captured.append(args)

    monkeypatch.setattr(
        "app.tasks.report_email_task.org_removed_notice_task", _FakeTask
    )
    return captured


def _login_headers(client, email: str, password: str) -> dict:
    res = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


# ---------------------------------------------------------------------------
# TS1: 기관 초대 수락 시 개인 상담소 자동 개설 (주 소속은 초대 기관 유지)
# ---------------------------------------------------------------------------


def test_ts1_기관초대_수락시_개인상담소_자동개설(client, monkeypatch, redis):
    ctx_a, email, user_id = _setup_active_counselor(client, monkeypatch, redis, "ts81a")

    offices = _offices(user_id)
    assert len(offices) == 1
    office = offices[0]
    assert office.kind == "individual"
    assert office.verified is True
    assert office.org_code is None
    assert "개인 상담소" in office.name

    rows = _memberships(user_id)
    by_org = {str(m.org_id): m for m in rows}
    inst = by_org[ctx_a["org_id"]]
    own = by_org[str(office.id)]
    assert inst.status == "active" and inst.is_primary is True
    assert own.status == "active" and own.is_primary is False
    # 주 소속 미러는 초대 기관 유지
    assert str(_user(user_id).org_id) == ctx_a["org_id"]


# ---------------------------------------------------------------------------
# TS2/TS6: 개인 상담사 신청 승인 경로 — SDD-073 개인 기관 재사용 (중복 생성 금지)
# ---------------------------------------------------------------------------


def test_ts2_개인신청_승인수락시_기존_개인기관_재사용(client, monkeypatch):
    from app.services import email_verify_service

    cap = _capture_invites(monkeypatch)
    email = "own81@test.com"
    res = client.post(
        "/api/v1/signup-applications/individual-counselor",
        json={
            "name": "김개인",
            "email": email,
            "email_verify_token": email_verify_service.generate_email_verify_token(email),
            "consents": {"tos": True, "privacy": True, "sensitive": True},
        },
    )
    assert res.status_code == 201, res.text
    app_id = res.json()["application_id"]

    admin = _platform_admin(client, "padm81@test.com")
    res = client.post(
        f"/api/v1/admin/signup-applications/{app_id}/approve", headers=admin["h"]
    )
    assert res.status_code == 200, res.text

    token = cap["counselor"][0].split("token=", 1)[1]
    activated = client.post(
        "/api/v1/auth/set-password", json={"token": token, "new_password": NEW_PASSWORD}
    )
    assert activated.status_code == 200, activated.text
    user_id = activated.json()["user"]["id"]

    # SDD-073 이 만든 개인 기관 1개만 존재 — 중복 생성 금지
    offices = _offices(user_id)
    assert len(offices) == 1

    rows = _memberships(user_id)
    assert len(rows) == 1
    assert rows[0].status == "active" and rows[0].is_primary is True
    assert str(_user(user_id).org_id) == str(offices[0].id)


# ---------------------------------------------------------------------------
# TS3: 기관 해제(org_admin) → 개인 상담소 복귀 + 알림 + 안내 메일 큐
# ---------------------------------------------------------------------------


def test_ts3_기관해제시_개인상담소_복귀_알림_메일(client, monkeypatch, redis):
    ctx_a, email, user_id = _setup_active_counselor(client, monkeypatch, redis, "ts81c")
    mail_queue = _capture_removed_mail_queue(monkeypatch)

    res = client.delete(
        f"/api/v1/org/{ctx_a['org_id']}/counselors/{user_id}", headers=ctx_a["h"]
    )
    assert res.status_code == 204, res.text

    # 개인 상담소 중복 생성 없이 복귀 — active + 주 소속
    offices = _offices(user_id)
    assert len(offices) == 1
    office = offices[0]
    rows = _memberships(user_id)
    by_org = {str(m.org_id): m for m in rows}
    assert by_org[ctx_a["org_id"]].status == "left"
    own = by_org[str(office.id)]
    assert own.status == "active" and own.is_primary is True
    assert str(_user(user_id).org_id) == str(office.id)  # 무소속 없음

    # 로그인 팝업용 인앱 알림 + 안내 메일 큐 적재
    notifs = _notifications(user_id, "org_removed")
    assert len(notifs) == 1
    assert notifs[0].is_read is False
    assert notifs[0].extra["office_name"] == office.name
    assert len(mail_queue) == 1
    assert mail_queue[0][0] == user_id and mail_queue[0][2] == office.name


# ---------------------------------------------------------------------------
# TS4: 다중 소속 상담사 — 한 기관 해제 시 남은 기관 승격, 복귀·알림 없음
# ---------------------------------------------------------------------------


def test_ts4_다중소속_한기관해제는_남은기관_승격_알림없음(client, monkeypatch, redis):
    ctx_a, email, user_id = _setup_active_counselor(client, monkeypatch, redis, "ts81d")
    ctx_b = _make_org_admin(
        client, monkeypatch, sys_email="s81d@test.com", admin_email="a81d@test.com"
    )
    mem_cap = _capture_membership_invites(monkeypatch)
    res = _invite(client, ctx_b, email)
    assert res.status_code == 201, res.text
    token = mem_cap[0].split("token=", 1)[1]
    res = client.post("/api/v1/org/membership-invites/accept", json={"token": token})
    assert res.status_code == 200, res.text

    mail_queue = _capture_removed_mail_queue(monkeypatch)
    res = client.delete(
        f"/api/v1/org/{ctx_a['org_id']}/counselors/{user_id}", headers=ctx_a["h"]
    )
    assert res.status_code == 204, res.text

    # 남은 기관(B)이 주 소속 — 개인 상담소(fallback)가 아니라 기관이 우선
    assert str(_user(user_id).org_id) == ctx_b["org_id"]
    rows = _memberships(user_id)
    by_org = {str(m.org_id): m for m in rows}
    assert by_org[ctx_b["org_id"]].is_primary is True
    # 복귀가 아니므로 알림·메일 없음
    assert _notifications(user_id, "org_removed") == []
    assert mail_queue == []


# ---------------------------------------------------------------------------
# TS5: 플랫폼 관리자 해제(change_counselor) → 동일 복귀 동작
# ---------------------------------------------------------------------------


def test_ts5_플랫폼관리자_해제도_개인상담소_복귀(client, monkeypatch, redis):
    ctx_a, email, user_id = _setup_active_counselor(client, monkeypatch, redis, "ts81e")
    mail_queue = _capture_removed_mail_queue(monkeypatch)
    padmin = _platform_admin(client, "padm81e@test.com")

    res = client.request(
        "DELETE",
        f"/api/v1/admin/orgs/{ctx_a['org_id']}/counselors/{user_id}",
        headers=padmin["h"],
        json={"reason": "운영 조정"},
    )
    assert res.status_code == 204, res.text

    offices = _offices(user_id)
    assert len(offices) == 1
    assert str(_user(user_id).org_id) == str(offices[0].id)
    assert len(_notifications(user_id, "org_removed")) == 1
    assert len(mail_queue) == 1


# ---------------------------------------------------------------------------
# TS7: 기관 검색·플랫폼 관리자 목록에서 개인 상담소 숨김
# ---------------------------------------------------------------------------


def test_ts7_기관검색_관리자목록에서_개인상담소_숨김(client, monkeypatch, redis):
    ctx_a, email, user_id = _setup_active_counselor(client, monkeypatch, redis, "ts81f")
    office = _offices(user_id)[0]

    res = client.get("/api/v1/org/search")
    assert res.status_code == 200
    ids = [o["id"] for o in res.json()]
    assert str(office.id) not in ids
    assert ctx_a["org_id"] in ids

    padmin = _platform_admin(client, "padm81f@test.com")
    res = client.get("/api/v1/admin/orgs", headers=padmin["h"])
    assert res.status_code == 200
    ids = [o["id"] for o in res.json()]
    assert str(office.id) not in ids
    assert ctx_a["org_id"] in ids


# ---------------------------------------------------------------------------
# TS8: 본인 대시보드 — 개인 상담소 주 소속이면 org_kind=individual 노출
# ---------------------------------------------------------------------------


def test_ts8_대시보드_org_kind_노출(client, monkeypatch, redis):
    ctx_a, email, user_id = _setup_active_counselor(client, monkeypatch, redis, "ts81g")
    h = _login_headers(client, email, NEW_PASSWORD)

    res = client.get("/api/v1/dashboard/counselor", headers=h)
    assert res.status_code == 200, res.text
    assert res.json()["org_kind"] == "institution"

    _capture_removed_mail_queue(monkeypatch)
    res = client.delete(
        f"/api/v1/org/{ctx_a['org_id']}/counselors/{user_id}", headers=ctx_a["h"]
    )
    assert res.status_code == 204

    res = client.get("/api/v1/dashboard/counselor", headers=h)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["org_kind"] == "individual"
    assert "개인 상담소" in body["org_name"]


# ---------------------------------------------------------------------------
# TS9: org_admin 초대 수락은 개인 상담소를 만들지 않는다
# ---------------------------------------------------------------------------


def test_ts9_org_admin은_개인상담소_미생성(client, monkeypatch):
    from app.models.user import User

    _make_org_admin(client, monkeypatch, sys_email="s81h@test.com", admin_email="a81h@test.com")
    db = _db()
    try:
        admin_user = db.query(User).filter(User.email == "a81h@test.com").first()
        admin_id = str(admin_user.id)
    finally:
        db.close()
    assert _offices(admin_id) == []


# ---------------------------------------------------------------------------
# TS10: 로그인 팝업 알림 — 미읽음 1회 → 확인(mark read) 후 재노출 없음
# ---------------------------------------------------------------------------


def test_ts10_해제알림_1회노출_확인후_재노출없음(client, monkeypatch, redis):
    ctx_a, email, user_id = _setup_active_counselor(client, monkeypatch, redis, "ts81i")
    _capture_removed_mail_queue(monkeypatch)
    res = client.delete(
        f"/api/v1/org/{ctx_a['org_id']}/counselors/{user_id}", headers=ctx_a["h"]
    )
    assert res.status_code == 204

    h = _login_headers(client, email, NEW_PASSWORD)
    res = client.get("/api/v1/notifications?only_unread=true", headers=h)
    assert res.status_code == 200
    unread = [n for n in res.json()["notifications"] if n["type"] == "org_removed"]
    assert len(unread) == 1

    res = client.put(f"/api/v1/notifications/{unread[0]['id']}/read", headers=h)
    assert res.status_code == 200

    res = client.get("/api/v1/notifications?only_unread=true", headers=h)
    assert [n for n in res.json()["notifications"] if n["type"] == "org_removed"] == []
