"""SDD-216 가산 스키마와 기존 DB 방어선 검증."""

import pytest
from sqlalchemy import inspect, text

pytestmark = pytest.mark.pg


def test_scheduling_columns_and_legacy_constraints_survive(pg_conn):
    inspector = inspect(pg_conn)
    columns = {c["name"] for c in inspector.get_columns("classes")}
    assert {
        "draft_schedule",
        "ends_on",
        "generation_cursor",
        "revision",
        "archived_from_status",
    } <= columns
    assert "assignment_override" in {
        c["name"] for c in inspector.get_columns("sessions")
    }
    constraints = {
        r[0]
        for r in pg_conn.execute(
            text(
                "SELECT conname FROM pg_constraint WHERE conrelid='sessions'::regclass"
            )
        )
    }
    assert {"fk_sessions_class_host", "ck_sessions_one_parent"} <= constraints
    assert {
        "session_host_requests",
        "class_operations",
        "class_effects",
        "class_email_invites",
        "session_host_notes",
    } <= set(inspector.get_table_names())


def test_pending_request_unique_index_and_operation_key(pg_conn):
    inspector = inspect(pg_conn)
    indexes = {x["name"]: x for x in inspector.get_indexes("session_host_requests")}
    assert indexes["uq_session_host_requests_pending"]["unique"]
    uniques = {
        tuple(x["column_names"])
        for x in inspector.get_unique_constraints("class_operations")
    }
    assert ("actor_id", "operation_key") in uniques
