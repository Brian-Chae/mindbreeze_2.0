"""SDD-246 dev 실측 회귀: v2 회차 '시작하기'가 일정 겹침에서 400 으로 막히던 문제.

원인: v2 REST 어댑터가 transition_tx 의 409 schedule_conflict(확인용 지문 포함)를 결정적 거절로 바꾸고,
      map_error 가 모르는 코드라 400 "요청을 처리할 수 없습니다" 로 내려 화면의 '겹침 확인 → force 재요청'이 끊겼다.
기대: 첫 요청은 409 schedule_conflict + conflict_fingerprint, 확인 후 force 재요청은 v2 command 경로로 시작되어
      outbox 에 session.changed(in_progress) 가 남는다(회원 화면이 실시간으로 시작을 받는다).
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest
import sqlalchemy as sa

from app.models.live_state import LiveOutbox
from app.models.session import Session as SessionModel
from app.schemas.class_scheduling import CreateClassCommand
from app.services import class_write_service as writes
from app.services.session_live_legacy import PROTOCOL_V2, pin_session_protocol
from tests.pg.sdd216_helpers import world as class_world
from tests.sdd246.transport.harness import token_for
from tests.sdd246.transport.test_rest_clock_v1_pg import api  # noqa: F401

NOW = datetime.now(timezone.utc)


def _instant(db, host, title, confirm=False):
    schedule = dict(
        title=title, planned_session_count=1,
        recurrence_rule=dict(start_now=True, start_date="2026-01-01", weekdays=[1], time="19:00"),
        assignment_rule=dict(mode="all_one", host_ids=[str(host.id)]),
    )
    extra = {}
    if confirm:
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc:
            writes.create_class(db, host.id, CreateClassCommand(operation_key=str(uuid4()), schedule=schedule), now=NOW)
        extra = dict(force=True, confirmed_conflict_fingerprint=exc.value.detail["conflict_fingerprint"])
    res = writes.create_class(db, host.id, CreateClassCommand(operation_key=str(uuid4()), schedule=schedule, **extra), now=NOW)
    return db.query(SessionModel).filter_by(class_id=res["class_id"]).one()


def _h(uid):
    return {"Authorization": f"Bearer {token_for(uid)}", "X-Live-Protocol": "1,2"}


def test_v2_회차_시작이_일정_겹침이면_409_지문을_주고_확인_후_force로_v2_경로에서_시작된다(api, maker):
    with maker() as db:
        _, host, _, _ = class_world(db)
        _instant(db, host, "첫 클래스")
        second = _instant(db, host, "둘째 클래스", confirm=True)
        db.commit()
        sid, hid = second.id, host.id
        pin_session_protocol(db, sid, protocol=PROTOCOL_V2)
        db.commit()

    r = api.post(f"/api/v1/sessions/{sid}/start", headers=_h(hid))
    assert r.status_code == 409, r.text
    detail = r.json()["detail"]
    assert detail["code"] == "schedule_conflict" and detail["conflict_fingerprint"]

    r = api.post(f"/api/v1/sessions/{sid}/start", headers=_h(hid),
                 json={"force": True, "confirmed_conflict_fingerprint": detail["conflict_fingerprint"]})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "in_progress"
    with maker() as db:
        ev = db.execute(sa.select(LiveOutbox).where(LiveOutbox.session_id == sid, LiveOutbox.domain == "session")
                        .order_by(LiveOutbox.revision.desc())).scalars().first()
    assert ev is not None and ev.payload["status"] == "in_progress"
