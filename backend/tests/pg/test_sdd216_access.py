"""D-28 읽기/쓰기 분리와 부모 소속 기준, D-05 고지 게이트."""

import importlib.util
from datetime import datetime, timezone
import pytest
from fastapi import HTTPException
from app.models.class_program import ClassInstructor
from app.models.record import Report
from app.models.session import Session, SessionParticipant
from tests.pg.sdd216_helpers import world, user

pytestmark = pytest.mark.pg


def test_admin_reads_meditation_but_never_edits(pg_session):
    from app.services.report_service import _can_access_report, require_report_host

    org, a, b, parent = world(pg_session)
    admin = user(pg_session, org, role="org_admin")
    row = Session(
        type="meditation",
        class_id=parent.id,
        host_id=a.id,
        seq=1,
        status="completed",
        host_state="assigned",
        duration_min=60,
        organization_id=org.id,
        organization_attribution_known=True,
    )
    pg_session.add(row)
    pg_session.flush()
    report = Report(
        session_id=row.id,
        user_id=a.id,
        type="counselor",
        status="completed",
        content={},
    )
    pg_session.add(report)
    pg_session.flush()
    assert _can_access_report(str(admin.id), row, pg_session)
    with pytest.raises(HTTPException) as raised:
        require_report_host(str(report.id), str(admin.id), pg_session)
    assert raised.value.status_code == 403


def test_admin_never_reads_counseling_body_even_with_host_same_org(pg_session):
    from app.services.report_service import _can_access_report
    from app.models.counseling import (
        CounselingRelationship,
        CounselingRelationshipCounselor,
    )

    org, a, b, parent = world(pg_session)
    admin = user(pg_session, org, role="org_admin")
    relation = CounselingRelationship(
        is_placeholder=True,
        counselor_id=a.id,
        organization_id=org.id,
        organization_attribution_known=True,
    )
    pg_session.add(relation)
    pg_session.flush()
    pg_session.add(
        CounselingRelationshipCounselor(relationship_id=relation.id, counselor_id=a.id)
    )
    pg_session.flush()
    row = Session(
        type="clinical",
        counseling_relationship_id=relation.id,
        host_state="assigned",
        host_id=a.id,
        seq=1,
        status="completed",
        duration_min=60,
        organization_id=org.id,
        organization_attribution_known=True,
    )
    pg_session.add(row)
    pg_session.flush()
    assert not _can_access_report(str(admin.id), row, pg_session)


def test_team_access_needs_switch_and_every_included_notice(pg_session, monkeypatch):
    assert importlib.util.find_spec(
        "app.services.class_access_service"
    ), "팀 열람 게이트가 필요합니다"
    from app.services.class_access_service import can_read_team_material
    from app.config import settings

    org, a, b, parent = world(pg_session)
    pg_session.add(ClassInstructor(class_id=parent.id, user_id=b.id, role="assistant"))
    row = Session(
        type="meditation",
        class_id=parent.id,
        host_id=a.id,
        seq=1,
        status="completed",
        host_state="assigned",
        duration_min=60,
    )
    pg_session.add(row)
    pg_session.flush()
    participant = SessionParticipant(
        session_id=row.id,
        user_id=user(pg_session, role="client").id,
        report_included=True,
        report_notice_version="r5-1",
        report_notice_ack_at=datetime.now(timezone.utc),
    )
    pg_session.add(participant)
    pg_session.flush()
    monkeypatch.setattr(settings, "class_team_read_enabled", True)
    assert not can_read_team_material(pg_session, b.id, row)
    participant.report_notice_version = "class-team-v1"
    pg_session.flush()
    assert can_read_team_material(pg_session, b.id, row)
    monkeypatch.setattr(settings, "class_team_read_enabled", False)
    assert not can_read_team_material(pg_session, b.id, row)


def test_admin_sees_counseling_metadata_without_body(pg_session):
    from app.models.counseling import (
        CounselingRelationship,
        CounselingRelationshipCounselor,
    )
    from app.services.class_read_service import list_counseling, get_counseling_detail

    org, a, b, _ = world(pg_session)
    admin = user(pg_session, org, role="org_admin")
    rel = CounselingRelationship(
        is_placeholder=True,
        counselor_id=a.id,
        organization_id=org.id,
        organization_attribution_known=True,
    )
    pg_session.add(rel)
    pg_session.flush()
    pg_session.add(
        CounselingRelationshipCounselor(relationship_id=rel.id, counselor_id=a.id)
    )
    pg_session.flush()
    pg_session.add(
        Session(
            type="clinical",
            counseling_relationship_id=rel.id,
            host_id=a.id,
            seq=1,
            host_state="assigned",
            status="scheduled",
            duration_min=60,
            organization_id=org.id,
            organization_attribution_known=True,
            notes="비공개 원문",
        )
    )
    pg_session.flush()
    items, total = list_counseling(str(admin.id), pg_session)
    assert total == 1 and items[0]["id"] == str(rel.id)
    detail = get_counseling_detail(str(rel.id), str(admin.id), pg_session)
    assert "비공개 원문" not in str(detail)
