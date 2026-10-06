"""3차 기능오류(중) 수정 검증 — 관리자 제출자 / 자격등급 강등 / 역할변경 사유 /
이메일 아웃박스 등록·발송 실패 마킹 / 리포트 진행 사유 파생.

대상: ADMIN-01, MB2-CRED-TIER-DOWNGRADE, MB2-ORG-ROLE-REASON,
      NOTIF-03/OUTBOX-001, OUTBOX-002, PROGRESS-001
"""

import uuid


# ── ADMIN-01: 기관 서류 상세에 제출자 정보 포함 ────────────────────────────
def test_admin_org_document_detail_includes_submitter(client):
    from app.core.database import get_db
    from app.core.security import create_access_token
    from app.main import app
    from app.models.org_document import OrgDocument
    from app.models.organization import Organization
    from app.models.user import User

    db = next(app.dependency_overrides[get_db]())
    admin = User(
        email="padmin-admin01@test.com", password_hash="x", name="플랫폼관리자",
        role="platform_admin", status="active", verified_tier="fully_verified",
    )
    submitter = User(
        email="submitter-admin01@test.com", password_hash="x", name="제출자",
        role="counselor", status="active", verified_tier="email",
    )
    db.add_all([admin, submitter])
    db.commit()
    admin_id = admin.id
    submitter_id = submitter.id
    org = Organization(name="제출기관", primary_admin_id=submitter_id)
    db.add(org)
    db.commit()
    doc = OrgDocument(
        org_id=org.id, type="biz_registration", s3_key="/tmp/biz.pdf",
        file_name="biz.pdf", status="needs_review", ai_verdict={"risk_score": 0.1},
    )
    db.add(doc)
    db.commit()
    did = str(doc.id)
    db.close()

    token = create_access_token(subject=str(admin_id))
    res = client.get(
        f"/api/v1/admin/reviews/org-documents/{did}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["submitter_name"] == "제출자"
    assert body["submitter_email"] == "submitter-admin01@test.com"
    assert body["org"]["name"] == "제출기관"


# ── MB2-CRED-TIER-DOWNGRADE: 반려 시 등급 강등 ─────────────────────────────
def test_recalculate_tier_downgrades_when_credential_rejected(client):
    from app.core.database import get_db
    from app.main import app
    from app.models.credential import Credential
    from app.models.user import User
    from app.services import credential_service

    db = next(app.dependency_overrides[get_db]())
    user = User(
        email="tier-down@test.com", password_hash="x", name="등급테스트",
        role="counselor", status="active", verified_tier="email",
    )
    db.add(user)
    db.commit()
    idc = Credential(user_id=user.id, type="id_card", s3_key="k1", status="approved")
    lic = Credential(user_id=user.id, type="license", s3_key="k2", status="approved")
    db.add_all([idc, lic])
    db.commit()

    assert credential_service.recalculate_tier(user.id, db) == "verified"
    # 자격증 반려 → 잔여 approved(신분증만) 기준 강등
    lic.status = "rejected"
    db.commit()
    assert credential_service.recalculate_tier(user.id, db) == "unverified"
    db.refresh(user)
    assert user.verified_tier == "unverified"
    db.close()


def test_admin_verify_reject_recalculates_tier(client, monkeypatch):
    """레거시 자격 API 반려 경로도 등급을 강등한다."""
    from app.core.database import get_db
    from app.main import app
    from app.models.credential import Credential
    from app.models.user import User
    from app.services import credential_service

    monkeypatch.setattr("app.services.notification_service.send_email_notification", lambda *a, **k: True)

    db = next(app.dependency_overrides[get_db]())
    user = User(
        email="tier-down-admin@test.com", password_hash="x", name="등급관리",
        role="counselor", status="active", verified_tier="verified",
    )
    db.add(user)
    db.commit()
    idc = Credential(user_id=user.id, type="id_card", s3_key="k1", status="approved")
    lic = Credential(user_id=user.id, type="license", s3_key="k2", status="approved")
    db.add_all([idc, lic])
    db.commit()

    credential_service.admin_verify(lic.id, "rejected", "위변조", db)
    db.refresh(user)
    assert user.verified_tier == "unverified"
    db.close()


# ── MB2-ORG-ROLE-REASON: 역할 변경 사유 선택 ───────────────────────────────
def test_org_role_change_without_reason_succeeds(client, monkeypatch, redis):
    from tests.test_sdd082_org_counselor_management import _invite_and_activate
    from tests.test_sdd017_counselor_invite import _make_org_admin

    ctx = _make_org_admin(
        client, monkeypatch, sys_email="role-nr-sys@test.com", admin_email="role-nr-admin@test.com"
    )
    counselor = _invite_and_activate(client, monkeypatch, ctx, "role-nr-c@test.com", redis=redis)

    # 프론트(updateCounselor)는 reason 없이 role 만 전송한다.
    res = client.put(
        f"/api/v1/org/{ctx['org_id']}/counselors/{counselor['id']}",
        json={"role": "org_admin"},
        headers=ctx["h"],
    )
    assert res.status_code == 200, res.text
    assert res.json()["role"] == "org_admin"


def test_org_role_change_blank_reason_still_422():
    import pytest
    from pydantic import ValidationError

    from app.schemas.org import OrganizationCounselorPatch

    assert OrganizationCounselorPatch(role="counselor").reason is None
    with pytest.raises(ValidationError):
        OrganizationCounselorPatch(role="counselor", reason="   ")


# ── NOTIF-03/OUTBOX-001: beat 등록 + cron 대체 스크립트 ────────────────────
def test_process_email_outbox_registered_in_beat_schedule():
    from app.core.celery_app import celery_app

    tasks = {v["task"] for v in celery_app.conf.beat_schedule.values()}
    assert "tasks.process_email_outbox" in tasks


def test_process_email_outbox_cron_script_importable():
    import importlib

    mod = importlib.import_module("process_email_outbox_cron")
    assert callable(mod.main)


# ── OUTBOX-002: 실패를 성공으로 마킹하지 않고 HTML 전달 ────────────────────
def _seed_email_outbox(payload: dict, recipient: str) -> str:
    from app.core.database import get_db
    from app.main import app
    from app.models.notification_outbox import NotificationOutbox
    from app.models.user import User

    db = next(app.dependency_overrides[get_db]())
    user = User(
        email=recipient, password_hash="x", name="아웃박스수신",
        role="counselor", status="active", verified_tier="email",
    )
    db.add(user)
    db.commit()
    item = NotificationOutbox(
        user_id=user.id, channel="email", recipient=recipient, payload=payload, status="pending",
    )
    db.add(item)
    db.commit()
    oid = str(item.id)
    db.close()
    return oid


def _load_outbox(oid: str):
    from app.core.database import get_db
    from app.main import app
    from app.models.notification_outbox import NotificationOutbox

    db = next(app.dependency_overrides[get_db]())
    item = db.query(NotificationOutbox).filter(NotificationOutbox.id == uuid.UUID(oid)).first()
    db.refresh(item)
    db.close()
    return item


def test_process_email_outbox_failure_is_not_marked_sent(client, monkeypatch):
    from app.tasks import outbox as outbox_task

    oid = _seed_email_outbox(
        {"subject": "s", "body": "b", "html": "<p>h</p>"}, "outbox-fail@test.com"
    )

    captured = {}

    def _fake(to_email, subject, body, body_html=None):
        captured.update(to=to_email, subject=subject, body=body, html=body_html)
        return False

    monkeypatch.setattr(outbox_task, "send_email_notification", _fake)
    result = outbox_task.process_email_outbox()

    # HTML 본문이 전달된다
    assert captured["html"] == "<p>h</p>"
    # 실패는 sent 로 마킹되지 않는다
    assert result["sent"] == 0
    assert result["failed"] >= 1
    item = _load_outbox(oid)
    assert item.status == "pending"  # MAX_ATTEMPTS 미만 → 재시도 대기
    assert item.attempts == 1
    assert item.last_error


def test_process_email_outbox_success_marks_sent(client, monkeypatch):
    from app.tasks import outbox as outbox_task

    oid = _seed_email_outbox(
        {"subject": "s", "body": "b", "html": "<p>ok</p>"}, "outbox-ok@test.com"
    )
    monkeypatch.setattr(outbox_task, "send_email_notification", lambda *a, **k: True)

    result = outbox_task.process_email_outbox()
    assert result["sent"] >= 1
    item = _load_outbox(oid)
    assert item.status == "sent"
    assert item.sent_at is not None


# ── PROGRESS-001: 생성 예외를 timeout 으로 오표기하지 않음 ─────────────────
def _derive_reason_for_generation_error(client, error_value: str):
    from tests.test_sdd095_report_progress import _create_session, _db, _mk_report, _register

    host = _register(client, f"prog-{error_value[:4]}@test.com")
    sid = _create_session(client, host)
    db = _db()
    try:
        rep = _mk_report(db, sid, generation_status="partial")
        rep.generation_error = error_value
        db.commit()
        return rps_compute(sid, db)
    finally:
        db.close()


def rps_compute(sid, db):
    from app.services import report_progress_service as rps

    return rps.compute_report_progress(sid, db)


def test_derive_reason_generation_exception_is_report_failed(client):
    from app.services import report_progress_service as rps

    result = _derive_reason_for_generation_error(client, "ValueError: boom")
    assert result["generation_status"] == "partial"
    assert result["reason"] == rps.REASON_REPORT_FAILED


def test_derive_reason_timeout_still_reported_as_timeout(client):
    from app.services import report_progress_service as rps

    result = _derive_reason_for_generation_error(client, rps.REASON_TIMEOUT)
    assert result["reason"] == rps.REASON_TIMEOUT
