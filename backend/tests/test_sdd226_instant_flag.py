"""SDD-226 V01 — 클래스 목록 응답의 즉석(is_instant) 플래그."""
from __future__ import annotations

from datetime import datetime, timezone

from app.models.class_program import Class
from app.services.class_read_service import _class_summary
from tests.test_sdd214_read_api import world  # noqa: F401 — 픽스처 재사용

NOW = datetime.now(timezone.utc)


def _summary(rule):
    cls = Class(title="t", status="active", schedule_mode="fixed", planned_session_count=1, recurrence_rule=rule)
    return _class_summary(cls, [], {}, NOW)


def test_V01_start_now_클래스만_is_instant():
    assert _summary({"version": 1, "start_now": True})["is_instant"] is True
    assert _summary({"version": 1, "start_now": False})["is_instant"] is False
    assert _summary({"version": 1})["is_instant"] is False
    assert _summary(None)["is_instant"] is False
    assert _summary({"start_now": "true"})["is_instant"] is False  # 불리언만 인정


def test_V01_API_응답에도_is_instant가_포함된다(client, world):  # noqa: F811
    from tests.test_sdd214_read_api import _h

    res = client.get("/api/v1/classes", headers=_h(world, "host_a"))
    assert res.status_code == 200, res.text
    classes = res.json()["classes"]
    assert classes and all(item["is_instant"] is False for item in classes)
