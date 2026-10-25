"""클래스 시작하기 409: 같은 상담사의 즉석 클래스 2개가 겹칠 때 start 가 막히던 문제 회귀 테스트."""
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.models.session import Session
from app.schemas.class_scheduling import CreateClassCommand
from app.services import class_write_service as writes
from app.services import session_service
from tests.pg.sdd216_helpers import world

pytestmark = pytest.mark.pg
NOW = datetime(2026, 11, 2, 15, 3, 27, tzinfo=timezone.utc)


def _instant(db, host, title, confirm=False):
    schedule = dict(
        title=title, planned_session_count=1,
        recurrence_rule=dict(start_now=True, start_date="2026-01-01", weekdays=[1], time="19:00"),
        assignment_rule=dict(mode="all_one", host_ids=[str(host.id)]),
    )
    extra = {}
    if confirm:  # 생성 화면의 '겹침 확인 후 만들기'(force) 경로 — dev 에서 두 번째 POST /classes 201
        with pytest.raises(HTTPException) as exc:
            writes.create_class(db, host.id, CreateClassCommand(operation_key=str(uuid4()), schedule=schedule), now=NOW)
        extra = dict(force=True, confirmed_conflict_fingerprint=exc.value.detail["conflict_fingerprint"])
    res = writes.create_class(db, host.id, CreateClassCommand(operation_key=str(uuid4()), schedule=schedule, **extra), now=NOW)
    return db.query(Session).filter_by(class_id=res["class_id"]).one()


def test_겹치는_즉석클래스가_있어도_확인_후_force로_시작된다(pg_session):
    _, host, _, _ = world(pg_session)
    first = _instant(pg_session, host, "첫 클래스")
    second = _instant(pg_session, host, "둘째 클래스", confirm=True)
    assert first.status == "open"  # 즉석 클래스는 생성 즉시 대기실(open)
    # 첫 클래스가 열려 있는 동안 둘째 시작 → 확인이 필요한 구조화 409
    with pytest.raises(HTTPException) as exc:
        session_service.transition_status(str(second.id), str(host.id), "start", pg_session)
    assert exc.value.status_code == 409
    detail = exc.value.detail
    assert detail["code"] == "schedule_conflict" and detail["conflict_fingerprint"]
    # 확인 후 재요청(force)하면 시작된다
    out = session_service.transition_status(
        str(second.id), str(host.id), "start", pg_session,
        force=True, confirmed_conflict_fingerprint=detail["conflict_fingerprint"])
    assert out["status"] == "in_progress"
