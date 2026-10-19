"""커밋 뒤 전달 의도 소비와 실패 재처리."""

from datetime import datetime, timedelta, timezone
import importlib.util
import pytest
from app.models.class_scheduling import ClassEffect, ClassEmailInvite
from app.models.notification import Notification
from tests.pg.sdd216_helpers import world, user

pytestmark = pytest.mark.pg


@pytest.fixture(autouse=True)
def isolate_external_delivery(monkeypatch):
    from app.tasks.reminder_task import send_session_reminder_task

    monkeypatch.setattr(
        send_session_reminder_task, "apply_async", lambda *args, **kwargs: None
    )
    monkeypatch.setattr("app.tasks.email._send_email", lambda *args, **kwargs: False)


def test_notification_intent_processed_once(pg_session):
    assert importlib.util.find_spec(
        "app.services.class_effect_service"
    ), "전달 의도 소비자가 필요합니다"
    from app.services.class_effect_service import process_effects

    org, a, b, parent = world(pg_session)
    member = user(pg_session, role="client")
    intent = ClassEffect(
        class_id=parent.id,
        effect_key="test:" + str(parent.id),
        kind="class_invited",
        payload={"recipient_id": str(member.id)},
    )
    pg_session.add(intent)
    pg_session.commit()
    now = datetime.now(timezone.utc) + timedelta(seconds=1)
    assert process_effects(pg_session, now=now)["done"] >= 1
    pg_session.refresh(intent)
    assert intent.status == "done"
    assert process_effects(pg_session, now=now)["done"] == 0
    notifications = (
        pg_session.query(Notification).filter(Notification.user_id == member.id).all()
    )
    assert len(notifications) == 1 and notifications[0].extra["target_type"] == "class"


def test_email_failure_can_retry_without_fake_member(pg_session, monkeypatch):
    from app.services import class_membership_service as members

    assert hasattr(members, "invite_emails"), "클래스 이메일 초대가 필요합니다"
    from app.services.class_effect_service import process_effects

    org, a, b, parent = world(pg_session)
    parent.access_code = "0042"
    invites = members.invite_emails(
        pg_session, parent, [" TEST@EXAMPLE.COM ", "test@example.com"], a.id
    )
    assert len(invites) == 1
    pg_session.commit()
    monkeypatch.setattr("app.tasks.email._send_email", lambda *args, **kwargs: False)
    now = datetime.now(timezone.utc) + timedelta(seconds=1)
    result = process_effects(pg_session, now=now)
    assert result["failed"] == 1
    pg_session.refresh(invites[0])
    assert invites[0].status == "failed"
    monkeypatch.setattr("app.tasks.email._send_email", lambda *args, **kwargs: True)
    members.retry_email(pg_session, parent, invites[0].id)
    pg_session.commit()
    result = process_effects(pg_session, now=now + timedelta(minutes=2))
    pg_session.refresh(invites[0])
    assert invites[0].status == "sent"
    assert (
        pg_session.query(ClassEmailInvite)
        .filter(ClassEmailInvite.class_id == parent.id)
        .count()
        == 1
    )


def test_bulk_change_and_initial_assignment_are_grouped(pg_session):
    from tests.pg.test_sdd216_review_regressions import setup_class
    from tests.pg.test_sdd216_write import writer, NOW
    from uuid import uuid4
    from app.models.class_scheduling import ClassEffect

    a, b, cls, rows = setup_class(pg_session)
    assigned = (
        pg_session.query(ClassEffect)
        .filter_by(class_id=cls.id, kind="session_host_assigned")
        .all()
    )
    assert len(assigned) == 1 and len(assigned[0].payload["session_ids"]) == 8
    writer().bulk_update(
        pg_session,
        a.id,
        cls.id,
        {
            "operation_key": str(uuid4()),
            "expected_revision": cls.revision,
            "action": "shift_week",
            "session_ids": [str(r.id) for r in rows],
            "expected_state_versions": {str(r.id): r.state_version for r in rows},
        },
        now=NOW,
    )
    changed = (
        pg_session.query(ClassEffect)
        .filter_by(class_id=cls.id, kind="session_updated")
        .all()
    )
    assert len(changed) == 1 and len(changed[0].payload["session_ids"]) == 8
