"""SDD-231 — 예약 클래스 열리기 전 대기실 입장 허용 구간 / 미디어·출석 보류."""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.models.session import SessionParticipant
from app.services import class_code_service as codes
from app.services import session_service
from app.services.class_membership_service import invite_members
from tests.pg.sdd216_helpers import user
from tests.pg.test_sdd216_review_regressions import setup_class
from tests.pg.test_sdd216_write import NOW

pytestmark = pytest.mark.pg


def _prepare(db, minutes_before=30):
    """첫 회차를 시작 minutes_before 분 전 시점(=now)으로 맞추고 회원 1명을 초대한다."""
    a, b, cls, rows = setup_class(db)
    row = rows[0]
    member = user(db, role="client")
    invite_members(db, cls, [member.id], a.id, NOW)
    row.scheduled_at = datetime.now(timezone.utc) + timedelta(minutes=minutes_before)
    for other in rows[1:]:
        other.scheduled_at = row.scheduled_at + timedelta(days=7 * other.seq)
    db.commit()
    return a, cls, row, member


def _consent(db, row, member):
    p = db.query(SessionParticipant).filter_by(session_id=row.id, user_id=member.id).one()
    p.recording_consented = True
    p.recording_notice_version = "v1"
    db.commit()
    return p


def test_허용_구간_초대_입장은_대기실_입장만_하고_출석은_남기지_않는다(pg_session):
    a, cls, row, member = _prepare(pg_session, 30)
    assert row.status in ("ready", "scheduled")
    result = session_service._enter_resolved(
        row, pg_session, user_id=str(member.id), require_invite=True,
        recording_consent=True, recording_notice_version="v1",
    )
    assert result["entry_credential"]
    p = pg_session.query(SessionParticipant).filter_by(session_id=row.id, user_id=member.id).one()
    assert p.entered_at is None and p.attendance_status == "expected"


def test_허용_구간_코드_입장_조회는_예정_회차_1개를_돌려준다(pg_session):
    a, cls, row, member = _prepare(pg_session, 30)
    assert codes.find_enterable_session(pg_session, cls.access_code).id == row.id
    result = session_service._enter_resolved(
        row, pg_session, user_id=str(member.id),
        recording_consent=True, recording_notice_version="v1",
    )
    assert result["entry_credential"]


@pytest.mark.parametrize("minutes", [300, -300])
def test_허용_구간_밖은_409_session_not_open_이고_예정_시각을_싣는다(pg_session, minutes):
    a, cls, row, member = _prepare(pg_session, minutes)
    assert codes.find_enterable_session(pg_session, cls.access_code) is None
    with pytest.raises(HTTPException) as exc:
        session_service._enter_resolved(row, pg_session, user_id=str(member.id), require_invite=True)
    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "session_not_open"
    assert exc.value.detail["scheduled_at"]


def test_예정_회차가_허용_구간에_둘이면_코드_입장은_404_유지(pg_session):
    a, cls, row, member = _prepare(pg_session, 30)
    rows = pg_session.query(type(row)).filter_by(class_id=cls.id).order_by(type(row).seq).all()
    rows[1].scheduled_at = row.scheduled_at + timedelta(minutes=20)
    pg_session.commit()
    assert codes.find_enterable_session(pg_session, cls.access_code) is None


def test_열리기_전에는_라이브킷_토큰이_나가지_않는다(pg_session):
    a, cls, row, member = _prepare(pg_session, 30)
    session_service._enter_resolved(
        row, pg_session, user_id=str(member.id), require_invite=True,
        recording_consent=True, recording_notice_version="v1",
    )
    with pytest.raises(HTTPException) as exc:
        session_service.participant_livekit_token(str(row.id), pg_session, current_user_id=str(member.id))
    assert exc.value.status_code == 409 and exc.value.detail["code"] == "session_not_open"


def test_열고_시작한_뒤_토큰_발급_때_입장_시각과_출석이_기록된다(pg_session, monkeypatch):
    import uuid
    a, cls, row, member = _prepare(pg_session, 30)
    session_service._enter_resolved(
        row, pg_session, user_id=str(member.id), require_invite=True,
        recording_consent=True, recording_notice_version="v1",
    )
    monkeypatch.setattr(session_service, "_notify_participant_changed", lambda *a, **k: None)
    row.status = "in_progress"
    row.started_at = datetime.now(timezone.utc)
    row.webrtc_room_id = uuid.uuid4()
    pg_session.commit()
    out = session_service.participant_livekit_token(str(row.id), pg_session, current_user_id=str(member.id))
    assert out["livekit_token"]
    p = pg_session.query(SessionParticipant).filter_by(session_id=row.id, user_id=member.id).one()
    assert p.entered_at is not None and p.attendance_status == "attended"


def test_join_session_은_열리기_전_409_와_예정_시각(pg_session):
    a, cls, row, member = _prepare(pg_session, 30)
    with pytest.raises(HTTPException) as exc:
        session_service.join_session(str(row.id), str(member.id), "회원", pg_session)
    assert exc.value.status_code == 409 and exc.value.detail["code"] == "session_not_open"
