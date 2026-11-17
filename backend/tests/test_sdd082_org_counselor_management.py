"""SDD-082 — 기관 관리자 상담사 관리 QA

verify.md TS1~TS14(BE) 시나리오를 검증한다.
- 기관 관리자용 suspend/unsuspend (사유 필수 + 감사 + 알림 + 로그인 차단)
- 상담사 최근 이력(activity) — 세션/리포트 메타데이터
- 목록 응답의 suspended 우선 표기 + counselor_code/has_personal_office
"""

import asyncio
import uuid

from tests.test_sdd017_counselor_invite import (  # noqa: F401 — 헬퍼 재사용
    NEW_PASSWORD,
    _capture_invites,
    _db,
    _make_org_admin,
)


def _clear_cooldown(redis, org_id: str) -> None:
    """테스트 내 연속 초대를 위해 기관 초대 쿨다운 키를 제거한다 (SDD-079 패턴)."""
    asyncio.run(
        redis.delete(
            f"counselor_invite_send:{org_id}", f"counselor_invite_resend:{org_id}"
        )
    )


def _invite_and_activate(client, monkeypatch, ctx, email: str, redis=None) -> dict:
    """상담사 초대 → set-password 수락(active). {'id', 'h'} 반환."""
    if redis is not None:
        _clear_cooldown(redis, ctx["org_id"])
    cap = _capture_invites(monkeypatch)
    res = client.post(
        f"/api/v1/org/{ctx['org_id']}/counselors/invite",
        json={"name": "김상담", "email": email},
        headers=ctx["h"],
    )
    assert res.status_code == 201, res.text
    user_id = res.json()["counselor"]["id"]
    token = cap["counselor"][0].split("token=", 1)[1]
    activated = client.post(
        "/api/v1/auth/set-password", json={"token": token, "new_password": NEW_PASSWORD}
    )
    assert activated.status_code == 200, activated.text
    return {"id": user_id, "h": {"Authorization": f"Bearer {activated.json()['access_token']}"}}


def _suspend(client, ctx, user_id: str, reason: str | None = "근태 문제"):
    body = {"reason": reason} if reason is not None else {}
    return client.post(
        f"/api/v1/org/{ctx['org_id']}/counselors/{user_id}/suspend",
        json=body,
        headers=ctx["h"],
    )


def _unsuspend(client, ctx, user_id: str, reason: str = "소명 완료"):
    return client.post(
        f"/api/v1/org/{ctx['org_id']}/counselors/{user_id}/unsuspend",
        json={"reason": reason},
        headers=ctx["h"],
    )


def _audits(user_id: str, action: str) -> list:
    from app.models.credential import VerificationAudit

    db = _db()
    try:
        return (
            db.query(VerificationAudit)
            .filter(
                VerificationAudit.target_id == uuid.UUID(user_id),
                VerificationAudit.action == action,
            )
            .all()
        )
    finally:
        db.close()


# ---------------------------------------------------------------------------
# TS1/TS3/TS4/TS13: suspend → 상태·감사·알림·로그인 차단, unsuspend → 복구
# ---------------------------------------------------------------------------


# SDD-323 정책 변경(대표 확정 11/9): 기관 관리자(대표 포함)의 계정 정지·재활성은 제거되었다.
# 아래 시나리오는 라우터가 항상 403 `ORG_STATUS_PLATFORM_ONLY` 로 거절하고 데이터가 변하지 않음을 고정한다.
# 정지 상태 전이 자체(서비스 함수)와 플랫폼 경로(/admin/users/{id}/suspend)는 test_sdd323 및 admin 테스트가 검증한다.
def test_ts1_suspend는_기관관리자에게_403(client, monkeypatch, redis):
    ctx = _make_org_admin(client, monkeypatch, sys_email="s82a@test.com", admin_email="a82a@test.com")
    counselor = _invite_and_activate(client, monkeypatch, ctx, "c82a@test.com")

    res = _suspend(client, ctx, counselor["id"], reason="근태 문제")
    assert res.status_code == 403, res.text
    assert res.json()["code"] == "ORG_STATUS_PLATFORM_ONLY"
    assert _audits(counselor["id"], "org_counselor_suspend") == []
    listing = client.get(f"/api/v1/org/{ctx['org_id']}/counselors", headers=ctx["h"])
    row = next(r for r in listing.json() if r["id"] == counselor["id"])
    assert row["status"] == "active" and "suspend" not in row["allowed_actions"]


def test_ts3_ts4_unsuspend도_기관관리자에게_403(client, monkeypatch, redis):
    ctx = _make_org_admin(client, monkeypatch, sys_email="s82b@test.com", admin_email="a82b@test.com")
    counselor = _invite_and_activate(client, monkeypatch, ctx, "c82b@test.com")

    assert _suspend(client, ctx, counselor["id"]).status_code == 403
    login = client.post("/api/v1/auth/login", json={"email": "c82b@test.com", "password": NEW_PASSWORD})
    assert login.status_code == 200, login.text  # 정지되지 않았으므로 로그인 정상
    res = _unsuspend(client, ctx, counselor["id"])
    assert res.status_code == 403 and res.json()["code"] == "ORG_STATUS_PLATFORM_ONLY"
    assert _audits(counselor["id"], "org_counselor_unsuspend") == []


# ---------------------------------------------------------------------------
# TS2/TS5~TS9: 사유 필수, 권한·대상 제한, 상태 전이 제한
# ---------------------------------------------------------------------------


def test_ts2_사유없거나_공백이면_422(client, monkeypatch, redis):
    ctx = _make_org_admin(client, monkeypatch, sys_email="s82c@test.com", admin_email="a82c@test.com")
    counselor = _invite_and_activate(client, monkeypatch, ctx, "c82c@test.com")

    assert _suspend(client, ctx, counselor["id"], reason=None).status_code == 422
    assert _suspend(client, ctx, counselor["id"], reason="   ").status_code == 422


def test_ts5_자기자신과_org_admin은_정지불가(client, monkeypatch, redis):
    ctx = _make_org_admin(client, monkeypatch, sys_email="s82d@test.com", admin_email="a82d@test.com")

    # org_admin(자기 자신) 정지 시도 → 403
    from app.models.user import User

    db = _db()
    try:
        admin = db.query(User).filter(User.email == "a82d@test.com").first()
        admin_id = str(admin.id)
    finally:
        db.close()
    assert _suspend(client, ctx, admin_id).status_code == 403


def test_ts6_타기관_상담사_정지는_403_정보비노출(client, monkeypatch, redis):
    ctx_a = _make_org_admin(client, monkeypatch, sys_email="s82e@test.com", admin_email="a82e@test.com")
    ctx_b = _make_org_admin(client, monkeypatch, sys_email="s82f@test.com", admin_email="a82f@test.com")
    counselor_b = _invite_and_activate(client, monkeypatch, ctx_b, "c82f@test.com")

    # SDD-323: 정지는 대상 존재 여부와 무관하게 먼저 403 (존재 비노출)
    assert _suspend(client, ctx_a, counselor_b["id"]).status_code == 403
    assert _suspend(client, ctx_a, str(uuid.uuid4())).status_code == 403
    assert _suspend(client, ctx_a, "not-a-uuid").status_code == 403


def test_ts7_counselor_토큰은_403(client, monkeypatch, redis):
    ctx = _make_org_admin(client, monkeypatch, sys_email="s82g@test.com", admin_email="a82g@test.com")
    counselor = _invite_and_activate(client, monkeypatch, ctx, "c82g@test.com")
    other = _invite_and_activate(client, monkeypatch, ctx, "c82g2@test.com", redis=redis)

    res = client.post(
        f"/api/v1/org/{ctx['org_id']}/counselors/{other['id']}/suspend",
        json={"reason": "시도"},
        headers=counselor["h"],
    )
    assert res.status_code == 403
    res = client.get(
        f"/api/v1/org/{ctx['org_id']}/counselors/{other['id']}/activity",
        headers=counselor["h"],
    )
    assert res.status_code == 403


def test_ts8_pending_상담사_정지도_403(client, monkeypatch, redis):
    ctx = _make_org_admin(client, monkeypatch, sys_email="s82h@test.com", admin_email="a82h@test.com")
    res = client.post(
        f"/api/v1/org/{ctx['org_id']}/counselors/invite",
        json={"name": "대기상담", "email": "c82h@test.com"},
        headers=ctx["h"],
    )
    assert res.status_code == 201, res.text
    assert _suspend(client, ctx, res.json()["counselor"]["id"]).status_code == 403


def test_ts9_중복_전이_요청도_403(client, monkeypatch, redis):
    ctx = _make_org_admin(client, monkeypatch, sys_email="s82i@test.com", admin_email="a82i@test.com")
    counselor = _invite_and_activate(client, monkeypatch, ctx, "c82i@test.com")
    assert _unsuspend(client, ctx, counselor["id"]).status_code == 403
    assert _suspend(client, ctx, counselor["id"]).status_code == 403
    assert _suspend(client, ctx, counselor["id"]).status_code == 403


# ---------------------------------------------------------------------------
# TS10~TS12: 최근 이력
# ---------------------------------------------------------------------------


def test_ts10_activity_세션과_리포트_메타데이터(client, monkeypatch, redis):
    ctx = _make_org_admin(client, monkeypatch, sys_email="s82j@test.com", admin_email="a82j@test.com")
    counselor = _invite_and_activate(client, monkeypatch, ctx, "c82j@test.com")

    # 세션 + 참여자 + 리포트를 직접 생성 (메타데이터 조회 검증 목적)
    from app.models.record import Report
    from app.models.session import Session as SessionModel
    from app.models.session import SessionParticipant

    db = _db()
    try:
        session = SessionModel(
            type="meditation",
            status="completed",
            host_id=uuid.UUID(counselor["id"]),
            duration_min=60,
            title="저녁 명상 클래스",
            organization_id=uuid.UUID(ctx["org_id"]),
            organization_attribution_known=True,
        )
        db.add(session)
        db.flush()
        db.add(SessionParticipant(session_id=session.id, guest_name="게스트1"))
        db.add(SessionParticipant(session_id=session.id, guest_name="게스트2"))
        db.add(
            Report(
                session_id=session.id,
                type="counselor",
                content={"summary": "요약"},
                status="completed",
            )
        )
        db.commit()
        session_id = str(session.id)
    finally:
        db.close()

    res = client.get(
        f"/api/v1/org/{ctx['org_id']}/counselors/{counselor['id']}/activity",
        headers=ctx["h"],
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body["sessions"]) == 1
    sess = body["sessions"][0]
    assert sess["id"] == session_id
    assert sess["title"] == "저녁 명상 클래스"
    assert sess["status"] == "completed"
    assert sess["participant_count"] == 2
    assert len(body["reports"]) == 1
    report = body["reports"][0]
    assert report["session_id"] == session_id
    assert report["title"] == "저녁 명상 클래스"
    assert report["status"] == "completed"
    # 리포트 본문(content)은 노출하지 않는다
    assert "content" not in report


def test_ts12_미소속_상담사_activity_404(client, monkeypatch, redis):
    ctx = _make_org_admin(client, monkeypatch, sys_email="s82k@test.com", admin_email="a82k@test.com")
    res = client.get(
        f"/api/v1/org/{ctx['org_id']}/counselors/{uuid.uuid4()}/activity",
        headers=ctx["h"],
    )
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# TS14: 목록 응답 확장 — counselor_code / has_personal_office
# ---------------------------------------------------------------------------


def test_ts14_목록에_코드와_개인상담소_여부_포함(client, monkeypatch, redis):
    ctx = _make_org_admin(client, monkeypatch, sys_email="s82l@test.com", admin_email="a82l@test.com")
    counselor = _invite_and_activate(client, monkeypatch, ctx, "c82l@test.com")

    listing = client.get(f"/api/v1/org/{ctx['org_id']}/counselors", headers=ctx["h"])
    assert listing.status_code == 200
    row = next(r for r in listing.json() if r["id"] == counselor["id"])
    assert "counselor_code" in row
    assert "has_personal_office" in row
    # SDD-081: 초대 수락 시 개인 상담소가 자동 개설되면 True
    from app.models.organization import Organization
    from app.models.user_org_membership import UserOrgMembership

    db = _db()
    try:
        has_office = (
            db.query(UserOrgMembership)
            .join(Organization, Organization.id == UserOrgMembership.org_id)
            .filter(
                UserOrgMembership.user_id == uuid.UUID(counselor["id"]),
                UserOrgMembership.status == "active",
                Organization.kind == "individual",
            )
            .count()
            > 0
        )
    finally:
        db.close()
    assert row["has_personal_office"] is has_office


# ---------------------------------------------------------------------------
# MB2-ORG-01: 소속 해제 보호 가드 (자기 자신·주 담당자·마지막 기관 관리자)
# ---------------------------------------------------------------------------


def test_mb2_org01_주담당자_자기소속해제_409(client, monkeypatch, redis):
    """기관 관리자가 자기 자신(주 담당자)을 소속 해제하려 하면 409 — change_counselor 가드 공유."""
    ctx = _make_org_admin(
        client, monkeypatch, sys_email="s82m@test.com", admin_email="a82m@test.com"
    )
    from app.models.user import User

    db = _db()
    try:
        admin = db.query(User).filter(User.email == "a82m@test.com").first()
        assert admin is not None
        admin_id = str(admin.id)
        org_id = str(admin.org_id)
    finally:
        db.close()

    res = client.request(
        "DELETE", f"/api/v1/org/{org_id}/counselors/{admin_id}", json={"reason": "시도"}, headers=ctx["h"]
    )
    assert res.status_code == 409, res.text

    # 소속이 그대로 유지된다
    db = _db()
    try:
        admin = db.query(User).filter(User.id == uuid.UUID(admin_id)).first()
        assert admin.org_id is not None
    finally:
        db.close()


def test_mb2_org01_주담당자를_다른관리자가_해제_409(client, monkeypatch, redis):
    """비(非)주담당 org_admin 이 주 담당자를 해제하려 하면 409."""
    ctx = _make_org_admin(
        client, monkeypatch, sys_email="s82n@test.com", admin_email="a82n@test.com"
    )
    counselor = _invite_and_activate(client, monkeypatch, ctx, "c82n@test.com")

    from app.models.user import User
    from app.models.user_org_membership import UserOrgMembership

    db = _db()
    try:
        cu = db.query(User).filter(User.id == uuid.UUID(counselor["id"])).first()
        assert cu is not None
        cu.role = "org_admin"  # 두 번째 기관 관리자로 승격
        mem = (
            db.query(UserOrgMembership)
            .filter(
                UserOrgMembership.user_id == cu.id,
                UserOrgMembership.org_id == uuid.UUID(ctx["org_id"]),
            )
            .first()
        )
        if mem is not None:
            mem.role = "org_admin"
        primary = db.query(User).filter(User.email == "a82n@test.com").first()
        assert primary is not None
        primary_id = str(primary.id)
        db.commit()
    finally:
        db.close()

    res = client.request(
        "DELETE", f"/api/v1/org/{ctx['org_id']}/counselors/{primary_id}",
        json={"reason": "시도"}, headers=counselor["h"],
    )
    assert res.status_code == 409, res.text
