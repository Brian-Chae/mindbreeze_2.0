"""즉석 클래스: 회원이 녹음 동의로 입장한 뒤 상담사가 시작하면 회원 LiveKit 토큰이 나가야 한다.

dev(7aab94a2)에서 입장은 200 인데 이후 entry/livekit-token 이 403(RECORDING_CONSENT_REQUIRED)이던 버그의 회귀 테스트.
운영 SessionLocal 과 같은 autoflush=False 세션으로 검증한다(PG 하네스 기본 세션은 autoflush=True 라 재현되지 않는다).
"""
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session as OrmSession

from app.models.session import Session, SessionParticipant
from app.schemas.class_scheduling import CreateClassCommand
from app.services import class_write_service as writes
from app.services import session_service
from app.services.recording_consent_service import is_recorded
from tests.pg.sdd216_helpers import user, world

pytestmark = pytest.mark.pg
NOW = datetime(2026, 11, 2, 15, 3, 27, tzinfo=timezone.utc)


def _instant(db):
    org, host, _, _ = world(db)
    member = user(db, role="client")
    schedule = dict(
        title="즉석 명상", planned_session_count=1,
        recurrence_rule=dict(start_now=True, start_date="2026-01-01", weekdays=[1], time="19:00"),
        assignment_rule=dict(mode="all_one", host_ids=[str(host.id)]),
        member_ids=[member.id],
    )
    res = writes.create_class(db, host.id, CreateClassCommand(operation_key=str(uuid4()), schedule=schedule), now=NOW)
    return host, member, db.query(Session).filter_by(class_id=res["class_id"]).one()


@pytest.fixture
def real_consent_gate(monkeypatch):
    """PG 하네스의 녹음 동의 우회(autouse)를 풀어 실제 게이트로 검증한다."""
    monkeypatch.undo()


def test_입장시_저장한_녹음동의가_autoflush_off에서도_유지되어_토큰이_나간다(pg_conn, real_consent_gate):
    db = OrmSession(bind=pg_conn, join_transaction_mode="create_savepoint", autoflush=False)
    try:
        host, member, s = _instant(db)
        res = session_service.enter_session_as_invited(
            str(s.id), str(member.id), db, recording_consent=True, recording_notice_version="rec-1")
        p = db.query(SessionParticipant).filter_by(session_id=s.id, user_id=member.id).one()
        db.refresh(p)
        assert p.recording_consented is True and is_recorded(p)
        session_service.transition_status(str(s.id), str(host.id), "start", db)
        tok = session_service.participant_livekit_token(
            str(s.id), db, entry_credential=res["entry_credential"], current_user_id=str(member.id))
        assert tok["livekit_token"]
    finally:
        db.close()
