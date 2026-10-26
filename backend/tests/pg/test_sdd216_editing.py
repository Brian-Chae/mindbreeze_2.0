"""초안 재개와 일괄 변경 미리 보기는 쓰기 의미가 다르다."""

from uuid import uuid4
import pytest
from app.models.class_program import Class
from app.models.session import Session
from tests.pg.sdd216_helpers import world
from tests.pg.test_sdd216_write import writer, command, NOW, counts

pytestmark = pytest.mark.pg


def test_patch_draft_then_publish_uses_saved_settings(pg_session):
    service = writer()
    org, a, b, _ = world(pg_session)
    result = service.create_class(pg_session, a.id, command(a, status="draft"), now=NOW)
    assert hasattr(service, "update_class")
    schedule = command(a).schedule.model_dump(mode="json")
    schedule["title"] = "수정된 제목"
    schedule["planned_session_count"] = 4
    changed = service.update_class(
        pg_session,
        a.id,
        result["class_id"],
        {"operation_key": str(uuid4()), "expected_revision": 1, "schedule": schedule},
        now=NOW,
    )
    from app.schemas.class_scheduling import WriteCommand

    published = service.publish_class(
        pg_session,
        a.id,
        result["class_id"],
        WriteCommand(operation_key=str(uuid4()), expected_revision=changed["revision"]),
        now=NOW,
    )
    assert len(published["session_ids"]) == 4
    assert pg_session.get(Class, result["class_id"]).title == "수정된 제목"


def test_bulk_preview_leaves_every_domain_row_unchanged(pg_session):
    service = writer()
    org, a, b, _ = world(pg_session)
    result = service.create_class(pg_session, a.id, command(a), now=NOW)
    row = pg_session.query(Session).filter_by(class_id=result["class_id"], seq=1).one()
    before = counts(pg_session)
    stamp = row.scheduled_at
    assert hasattr(service, "preview_bulk")
    preview = service.preview_bulk(
        pg_session,
        a.id,
        result["class_id"],
        {
            "operation_key": str(uuid4()),
            "expected_revision": 1,
            "action": "shift_week",
            "session_ids": [str(row.id)],
            "expected_state_versions": {str(row.id): row.state_version},
        },
        now=NOW,
    )
    assert preview["rows"][0]["scheduled_at"].startswith("2026-11-09T10:00:00")
    assert "conflict_fingerprint" in preview
    assert counts(pg_session) == before and row.scheduled_at == stamp
