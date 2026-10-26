"""SDD-216 클래스 상세의 편성 CTA 권한 계약."""

from app.api.deps import get_current_user
from app.config import settings
from app.core import database
from app.main import app
from app.models.class_program import ClassInstructor, ClassMember
from tests.pg.sdd216_helpers import user, world


def test_클래스_상세_schedule은_편성_스위치와_관리_권한을_함께_반영한다(
    client, monkeypatch
):
    with database.SessionLocal() as db:
        org, lead, assistant, parent = world(db)
        admin = user(db, org, role="org_admin")
        member = user(db, role="client")
        parent.recurrence_rule = {"version": 1}
        db.add(
            ClassInstructor(class_id=parent.id, user_id=assistant.id, role="assistant")
        )
        db.add(
            ClassMember(
                class_id=parent.id,
                user_id=member.id,
                status="active",
                joined_via="code",
            )
        )
        db.commit()
        path = f"/api/v1/classes/{parent.id}"
        viewers = [
            ({"id": str(lead.id), "role": "counselor"}, True, True),
            ({"id": str(admin.id), "role": "org_admin"}, True, True),
            ({"id": str(assistant.id), "role": "counselor"}, False, True),
            ({"id": str(member.id), "role": "client"}, False, False),
        ]

    for enabled in (False, True):
        monkeypatch.setattr(settings, "class_scheduling_enabled", enabled)
        for viewer, manage, invite in viewers:
            monkeypatch.setitem(
                app.dependency_overrides, get_current_user, lambda: viewer
            )
            response = client.get(path)
            assert response.status_code == 200, response.text
            capabilities = response.json()["capabilities"]
            # off에서도 기존 역할 정보·읽기를 유지하고, CTA만 false로 반환한다.
            assert capabilities["manage"] is manage
            assert capabilities["invite"] is invite
            assert capabilities["schedule"] is (enabled and manage)
