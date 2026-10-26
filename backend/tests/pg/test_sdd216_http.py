"""합성 인증 + 실제 PostgreSQL + 실제 클래스 라우터 통합."""

from uuid import uuid4
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.session import Session
from tests.pg.sdd216_helpers import world, user
from tests.pg.test_sdd216_write import command

pytestmark = pytest.mark.pg


def test_create_preview_draft_visibility_and_uncertain_host(pg_session, monkeypatch):
    from app.api.v1.classes import router
    from app.config import settings

    org, a, b, parent = world(pg_session)
    outsider = user(pg_session)
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_db] = lambda: pg_session
    actor = {"id": str(a.id), "role": "counselor"}
    app.dependency_overrides[get_current_user] = lambda: actor
    monkeypatch.setattr(settings, "class_scheduling_enabled", True)
    client = TestClient(app)
    data = command(a).model_dump(mode="json")
    preview = client.post("/api/v1/classes/preview-schedule", json=data["schedule"])
    assert preview.status_code == 200, preview.text
    assert len(preview.json()["rows"]) == 8
    data["status"] = "draft"
    created = client.post("/api/v1/classes", json=data)
    assert created.status_code == 201, created.text
    cid = created.json()["class_id"]
    detail = client.get(f"/api/v1/classes/{cid}")
    assert detail.status_code == 200 and detail.json()["draft_schedule"]
    actor["id"] = str(outsider.id)
    assert client.get(f"/api/v1/classes/{cid}").status_code == 404
    actor["id"] = str(a.id)
    published = client.post(
        f"/api/v1/classes/{cid}/publish",
        json={"operation_key": str(uuid4()), "expected_revision": 1},
    )
    assert published.status_code == 200, published.text
    row = (
        pg_session.query(Session)
        .filter(Session.class_id == cid, Session.seq == 1)
        .one()
    )
    row.host_state = "needs_reassign"
    pg_session.commit()
    sessions = client.get(f"/api/v1/classes/{cid}/sessions")
    assert sessions.status_code == 200
    assert sessions.json()["sessions"][0]["host"] is None


def test_draft_edit_preview_instructor_and_email_routes(pg_session, monkeypatch):
    from app.api.v1.classes import router
    from app.config import settings

    org, a, b, _ = world(pg_session)
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_db] = lambda: pg_session
    app.dependency_overrides[get_current_user] = lambda: {
        "id": str(a.id),
        "role": "counselor",
    }
    monkeypatch.setattr(settings, "class_scheduling_enabled", True)
    client = TestClient(app)
    data = command(a, status="draft").model_dump(mode="json")
    created = client.post("/api/v1/classes", json=data).json()
    cid = created["class_id"]
    schedule = data["schedule"]
    schedule["planned_session_count"] = 4
    patched = client.patch(
        f"/api/v1/classes/{cid}",
        json={
            "operation_key": str(uuid4()),
            "expected_revision": 1,
            "schedule": schedule,
        },
    )
    assert patched.status_code == 200, patched.text
    published = client.post(
        f"/api/v1/classes/{cid}/publish",
        json={"operation_key": str(uuid4()), "expected_revision": 2},
    )
    assert published.status_code == 200, published.text
    row = pg_session.query(Session).filter_by(class_id=cid, seq=1).one()
    preview = client.post(
        f"/api/v1/classes/{cid}/schedule/preview",
        json={
            "operation_key": str(uuid4()),
            "expected_revision": 3,
            "action": "shift_week",
            "session_ids": [str(row.id)],
            "expected_state_versions": {str(row.id): row.state_version},
        },
    )
    assert preview.status_code == 200, preview.text
    added = client.post(
        f"/api/v1/classes/{cid}/instructors",
        json={
            "operation_key": str(uuid4()),
            "expected_revision": 3,
            "user_id": str(b.id),
        },
    )
    assert added.status_code == 200, added.text
    changed = client.patch(
        f"/api/v1/classes/{cid}/instructors/{b.id}",
        json={"operation_key": str(uuid4()), "expected_revision": 4, "role": "lead"},
    )
    assert changed.status_code == 200, changed.text
    emails = client.post(
        f"/api/v1/classes/{cid}/email-invites",
        json={
            "operation_key": str(uuid4()),
            "expected_revision": 5,
            "emails": ["synthetic@example.com", "synthetic@example.com"],
        },
    )
    assert emails.status_code == 200, emails.text
    assert len(emails.json()["invitations"]) == 1
    assert emails.json()["invitations"][0]["status"] == "pending"


def test_session_rows_supply_bulk_edit_version_and_settings(pg_session):
    from tests.pg.test_sdd216_review_regressions import setup_class
    from app.services.class_read_service import list_class_sessions

    a, b, cls, rows = setup_class(pg_session)
    items, total = list_class_sessions(str(cls.id), str(a.id), pg_session)
    assert total == 8
    assert items[0]["state_version"] == rows[0].state_version
    assert items[0]["duration_min"] == 60 and items[0]["location_type"] == "online"


def test_hide_endpoint_preserves_unstarted_sessions(pg_session, monkeypatch):
    from app.api.v1.classes import router
    from app.config import settings
    from tests.pg.test_sdd216_review_regressions import setup_class
    from app.models.class_program import Class

    a, b, cls, rows = setup_class(pg_session)
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_db] = lambda: pg_session
    app.dependency_overrides[get_current_user] = lambda: {
        "id": str(a.id),
        "role": "counselor",
    }
    monkeypatch.setattr(settings, "class_scheduling_enabled", True)
    result = TestClient(app).request(
        "DELETE",
        f"/api/v1/classes/{cls.id}",
        json={"operation_key": str(uuid4()), "expected_revision": cls.revision},
    )
    assert result.status_code == 200, result.text
    assert pg_session.query(Class).filter_by(id=cls.id).first() is None
    assert (
        pg_session.query(Session)
        .execution_options(include_hidden=True)
        .filter_by(class_id=cls.id)
        .count()
        == 8
    )
