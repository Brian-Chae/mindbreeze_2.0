"""공유 엔진 제어와 팀 열람의 민감 자료 경계를 검증한다."""

import json
from datetime import datetime, timezone
import pytest
from fastapi import HTTPException
from app.models.session import SessionParticipant
from app.models.record import Report, SessionRecord
from tests.pg.sdd216_helpers import user
from tests.pg.test_sdd216_review_regressions import setup_class

pytestmark = pytest.mark.pg


@pytest.mark.parametrize("change", ["needs_reassign", "admin", "removed"])
def test_ineligible_host_cannot_control_or_join(pg_session, change):
    from app.services.session_authz import authorize_session, SessionAction
    from app.models.class_program import ClassInstructor

    a, b, cls, rows = setup_class(pg_session)
    row = rows[0]
    if change == "needs_reassign":
        row.host_state = "needs_reassign"
    elif change == "admin":
        a.role = "org_admin"
    else:
        pg_session.query(ClassInstructor).filter_by(
            class_id=cls.id, user_id=a.id
        ).one().status = "removed"
    pg_session.flush()
    for action in (
        SessionAction.SESSION_TRANSITION,
        SessionAction.SESSION_JOIN,
        SessionAction.AUDIO_RECORD,
    ):
        with pytest.raises(HTTPException) as exc:
            authorize_session(pg_session, a.id, row, action)
        assert exc.value.status_code in (403, 409)


def test_unrecognized_notice_is_rejected_before_report_choice_write(pg_session):
    from app.services.session_service import set_report_choice

    a, b, cls, rows = setup_class(pg_session)
    member = user(pg_session, role="client")
    part = SessionParticipant(
        session_id=rows[0].id, user_id=member.id, report_included=False
    )
    pg_session.add(part)
    pg_session.flush()
    with pytest.raises(HTTPException) as exc:
        set_report_choice(
            str(rows[0].id),
            str(part.id),
            True,
            pg_session,
            notice_acknowledged=True,
            notice_version="invented",
            current_user_id=str(member.id),
        )
    assert exc.value.status_code == 422
    assert part.report_included is False and part.report_notice_ack_at is None


def test_team_report_and_record_omit_raw_material(pg_session, monkeypatch):
    from app.config import settings
    from app.services import report_service, record_service

    a, b, cls, rows = setup_class(pg_session)
    row = rows[0]
    row.status = "completed"
    member = user(pg_session, role="client")
    part = SessionParticipant(
        session_id=row.id,
        user_id=member.id,
        report_included=True,
        report_notice_version="class-team-v1",
        report_notice_ack_at=datetime.now(timezone.utc),
    )
    pg_session.add(part)
    pg_session.flush()
    record = SessionRecord(
        session_id=row.id,
        transcript="RAW_SENTINEL",
        ai_summary={"summary": "공유 요약", "segments": [{"text": "RAW_SENTINEL"}]},
        edit_history=[{"transcript": "RAW_SENTINEL"}],
        markers=[{"note": "RAW_SENTINEL"}],
    )
    report = Report(
        session_id=row.id,
        user_id=a.id,
        type="counselor",
        status="completed",
        content={
            "summary": "공유 요약",
            "transcript_segments": [{"text": "RAW_SENTINEL"}],
            "video": {"url": "RAW_SENTINEL"},
            "error": {"debug": "RAW_SENTINEL"},
            "generation_error": "RAW_SENTINEL",
        },
        pdf_url="RAW_SENTINEL",
    )
    pg_session.add_all([record, report])
    pg_session.flush()
    monkeypatch.setattr(settings, "class_team_read_enabled", True)
    result = report_service.get_report(str(report.id), str(b.id), pg_session)
    assert "RAW_SENTINEL" not in json.dumps(result, default=str)
    result = record_service.get_record(str(row.id), str(b.id), pg_session)
    assert result["ai_summary"]["summary"] == "공유 요약"
    assert "RAW_SENTINEL" not in json.dumps(result, default=str)


def test_open_expires_pending_host_request_and_preserves_current_host(
    pg_session, monkeypatch
):
    from datetime import timedelta
    from app.services import session_service
    from app.services.class_instructor_service import apply_host_request
    from tests.pg.test_sdd216_write import NOW

    a, b, cls, rows = setup_class(pg_session)
    row = rows[0]
    row.scheduled_at = NOW + timedelta(minutes=30)
    req = apply_host_request(
        pg_session,
        cls,
        row,
        {"candidate_host_id": b.id, "expected_state_version": row.state_version},
        a,
        NOW,
    )
    pg_session.commit()
    monkeypatch.setattr(session_service, "_now", lambda: NOW)
    session_service.transition_status(str(row.id), str(a.id), "open", pg_session)
    assert row.status == "open" and row.host_id == a.id
    assert req.status == "expired" and row.host_state == "assigned"


def test_new_class_cannot_use_legacy_join_autostart(pg_session):
    from app.services.session_service import join_session

    a, b, cls, rows = setup_class(pg_session)
    with pytest.raises(HTTPException) as exc:
        join_session(str(rows[0].id), str(a.id), a.name, pg_session)
    assert exc.value.status_code == 409
    assert rows[0].status == "scheduled"


def test_legacy_update_cannot_bypass_bulk_revision(pg_session):
    from app.services.session_service import update_session
    from app.schemas.session import SessionUpdateRequest

    a, b, cls, rows = setup_class(pg_session)
    with pytest.raises(HTTPException) as exc:
        update_session(
            str(rows[0].id),
            str(a.id),
            SessionUpdateRequest(title="우회 변경"),
            pg_session,
        )
    assert exc.value.status_code == 409
    assert rows[0].title == cls.title


def test_admin_former_host_cannot_read_raw_video_or_control_audio(pg_session):
    from app.api.v1.video import get_video_url
    from app.services.session_service import resolve_audio_sync_host

    a, b, cls, rows = setup_class(pg_session)
    a.role = "org_admin"
    pg_session.flush()
    for call in (
        lambda: get_video_url(
            str(rows[0].id), {"id": str(a.id), "role": "org_admin"}, pg_session
        ),
        lambda: resolve_audio_sync_host(str(rows[0].id), str(a.id), pg_session),
    ):
        with pytest.raises(HTTPException) as exc:
            call()
        assert exc.value.status_code == 403


def test_admin_legacy_list_has_no_session_body(pg_session):
    from app.services.session_service import list_sessions

    a, b, cls, rows = setup_class(pg_session)
    rows[0].notes = "PRIVATE_SENTINEL"
    a.role = "org_admin"
    pg_session.flush()
    items, total = list_sessions(str(a.id), pg_session)
    assert "PRIVATE_SENTINEL" not in str(items)


def test_legacy_creation_and_duplicate_cannot_bypass_new_scheduling(
    pg_session, monkeypatch
):
    from app.config import settings
    from app.services.session_service import create_session, duplicate_session
    from app.schemas.session import SessionCreateRequest

    a, b, cls, rows = setup_class(pg_session)
    monkeypatch.setattr(settings, "class_scheduling_enabled", True)
    for call in (
        lambda: create_session(
            str(a.id),
            SessionCreateRequest(
                type="meditation", duration_min=50, max_participants=10
            ),
            pg_session,
        ),
        lambda: duplicate_session(str(rows[0].id), str(a.id), pg_session),
    ):
        with pytest.raises(HTTPException) as exc:
            call()
        assert exc.value.status_code == 409


def test_member_session_response_masks_uncertain_host(pg_session):
    from app.services.session_service import _serialize
    from app.schemas.session import SessionResponse

    a, b, cls, rows = setup_class(pg_session)
    for state in ("pending_ack", "needs_reassign"):
        rows[0].host_state = state
        public = _serialize(rows[0])
        assert public["host_id"] is None and public["host_name"] is None
        assert public["host_state"] == state
        SessionResponse.model_validate(public)
        assert _serialize(rows[0], include_participant_pii=True)["host_id"] == str(a.id)
