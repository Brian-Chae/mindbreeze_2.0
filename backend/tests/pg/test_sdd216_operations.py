"""진행자 귀속 정정·만료·미정 경고의 상태 계약."""

from datetime import timedelta
from uuid import uuid4
import pytest
from fastapi import HTTPException
from app.models.class_scheduling import ClassEffect, SessionHostRequest, SessionHostNote
from app.models.record import Report
from app.models.class_program import ClassInstructor
from tests.pg.test_sdd216_review_regressions import setup_class
from tests.pg.test_sdd216_write import NOW, writer

pytestmark = pytest.mark.pg


def test_completed_correction_and_approval_freeze_attribution(pg_session, monkeypatch):
    from app.services import report_service

    a, b, cls, rows = setup_class(pg_session)
    row = rows[0]
    row.status = "completed"
    report = Report(
        session_id=row.id,
        user_id=a.id,
        type="counselor",
        status="pending_review",
        content={},
    )
    pg_session.add(report)
    pg_session.commit()
    assert hasattr(writer(), "correct_host")
    data = {
        "operation_key": str(uuid4()),
        "expected_revision": cls.revision,
        "session_id": str(row.id),
        "expected_state_version": row.state_version,
        "candidate_host_id": str(b.id),
        "mode": "correct",
        "reason": "입력 오류",
    }
    writer().correct_host(pg_session, a.id, cls.id, data, now=NOW)
    assert row.host_id == b.id and report.user_id == b.id
    monkeypatch.setattr(
        report_service, "_enqueue_client_email_on_approval", lambda *args: None
    )
    report_service.approve_report(str(report.id), str(b.id), pg_session)
    assert report.approved_at is not None and report.approved_by_user_id == b.id
    with pytest.raises(HTTPException) as exc:
        writer().correct_host(
            pg_session,
            a.id,
            cls.id,
            {
                **data,
                "operation_key": str(uuid4()),
                "expected_revision": cls.revision,
                "expected_state_version": row.state_version,
                "candidate_host_id": str(a.id),
            },
            now=NOW,
        )
    assert exc.value.status_code == 409
    writer().correct_host(
        pg_session,
        a.id,
        cls.id,
        {
            "operation_key": str(uuid4()),
            "expected_revision": cls.revision,
            "session_id": str(row.id),
            "expected_state_version": row.state_version,
            "mode": "note",
            "displayed_host_name": "표시 정정",
            "reason": "승인 후 표시 메모",
        },
        now=NOW,
    )
    assert row.host_id == b.id and report.user_id == b.id
    assert pg_session.query(SessionHostNote).filter_by(session_id=row.id).count() == 1


def test_expiry_and_reassignment_warning_are_idempotent(pg_session):
    from app.services.class_instructor_service import apply_host_request
    from app.services import class_instructor_service as rules

    a, b, cls, rows = setup_class(pg_session)
    row = rows[0]
    row.scheduled_at = NOW + timedelta(minutes=30)
    request = apply_host_request(
        pg_session,
        cls,
        row,
        {"candidate_host_id": b.id, "expected_state_version": row.state_version},
        a,
        NOW,
    )
    pg_session.commit()
    assert hasattr(rules, "sweep_class_operations")
    rules.sweep_class_operations(pg_session, cls.id, now=NOW + timedelta(minutes=16))
    assert request.status == "expired" and row.host_state == "assigned"
    row.host_state = "needs_reassign"
    row.state_version += 1
    pg_session.commit()
    rules.sweep_class_operations(pg_session, cls.id, now=NOW + timedelta(minutes=17))
    rules.sweep_class_operations(pg_session, cls.id, now=NOW + timedelta(minutes=18))
    warnings = (
        pg_session.query(ClassEffect)
        .filter(
            ClassEffect.session_id == row.id, ClassEffect.kind == "session_host_needed"
        )
        .all()
    )
    assert len(warnings) == 1 and warnings[0].payload["stage"] == "24h"


def test_guest_zero_reports_never_means_approved(pg_session):
    from app.services import class_instructor_service as rules

    a, b, cls, rows = setup_class(pg_session)
    row = rows[0]
    row.status = "completed"
    row.ended_at = NOW
    guest = (
        pg_session.query(ClassInstructor).filter_by(class_id=cls.id, user_id=b.id).one()
    )
    guest.role = "guest"
    guest.scope_session_id = row.id
    pg_session.commit()
    assert hasattr(rules, "sweep_class_operations")
    rules.sweep_class_operations(pg_session, cls.id, now=NOW + timedelta(days=1))
    assert guest.status == "active"
    rules.sweep_class_operations(pg_session, cls.id, now=NOW + timedelta(days=14))
    assert guest.status == "removed"


def test_maintenance_respects_flags_and_completes_due_classes(pg_session, monkeypatch):
    import importlib.util
    from app.config import settings

    a, b, cls, rows = setup_class(pg_session)
    for row in rows:
        row.status = "completed"
    pg_session.commit()
    assert importlib.util.find_spec("app.services.class_operations_service")
    from app.services.class_operations_service import maintain_classes

    monkeypatch.setattr(settings, "class_scheduling_enabled", False)
    maintain_classes(pg_session, now=NOW)
    assert cls.status == "active"
    monkeypatch.setattr(settings, "class_scheduling_enabled", True)
    maintain_classes(pg_session, now=NOW, class_ids=[cls.id])
    assert cls.status == "completed"


def test_host_display_note_cannot_be_rewritten(pg_session):
    a, b, cls, rows = setup_class(pg_session)
    note = SessionHostNote(
        session_id=rows[0].id, actor_id=a.id, displayed_host_name="표시", reason="정정"
    )
    pg_session.add(note)
    pg_session.commit()
    note.reason = "덮어쓰기"
    with pytest.raises(ValueError, match="수정"):
        pg_session.flush()
    pg_session.rollback()
