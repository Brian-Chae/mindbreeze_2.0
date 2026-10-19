"""부모 코드 해석·최소 가입·기존 입장 엔진 연결."""

from uuid import uuid4
import pytest
from fastapi import HTTPException
from app.models.class_program import ClassMember
from app.models.session import SessionParticipant
from tests.pg.sdd216_helpers import user
from tests.pg.test_sdd216_review_regressions import setup_class
from tests.pg.test_sdd216_write import NOW

pytestmark = pytest.mark.pg


def test_parent_code_selects_only_open_sessions_and_join_is_idempotent(pg_session):
    from app.services import class_code_service as codes

    a, b, cls, rows = setup_class(pg_session)
    member = user(pg_session, role="client")
    pg_session.commit()
    assert hasattr(codes, "resolve_class_code")
    result = codes.resolve_class_code(pg_session, cls.access_code)
    assert result["class_id"] == str(cls.id) and result["sessions"] == []
    assert codes.find_enterable_session(pg_session, cls.access_code) is None
    assert hasattr(codes, "join_class_code")
    first = codes.join_class_code(
        pg_session, cls.id, member.id, cls.access_code, now=NOW
    )
    assert (
        codes.join_class_code(pg_session, cls.id, member.id, cls.access_code, now=NOW)
        == first
    )
    assert (
        pg_session.query(ClassMember)
        .filter_by(class_id=cls.id, user_id=member.id)
        .count()
        == 1
    )
    assert (
        pg_session.query(SessionParticipant).filter_by(user_id=member.id).count() == 8
    )
    rows[0].status = "open"
    pg_session.flush()
    assert codes.find_enterable_session(pg_session, cls.access_code).id == rows[0].id
    rows[1].status = "open"
    pg_session.flush()
    assert len(codes.resolve_class_code(pg_session, cls.access_code)["sessions"]) == 2
    assert codes.find_enterable_session(pg_session, cls.access_code) is None
    cls.status = "completed"
    pg_session.flush()
    with pytest.raises(HTTPException) as exc:
        codes.resolve_class_code(pg_session, cls.access_code)
    assert exc.value.status_code == 404


def test_parent_display_code_and_join_mismatch_never_grants_membership(pg_session):
    from app.services import class_code_service as codes, session_service

    a, b, cls, rows = setup_class(pg_session)
    member = user(pg_session, role="client")
    pg_session.commit()
    assert session_service._serialize(rows[0])["access_code"] == cls.access_code
    with pytest.raises(HTTPException) as exc:
        codes.join_class_code(pg_session, uuid4(), member.id, cls.access_code, now=NOW)
    assert exc.value.status_code == 404
    assert pg_session.query(ClassMember).filter_by(user_id=member.id).count() == 0


def test_legacy_enter_respects_removed_membership_and_counselor_scope(pg_session):
    from app.services.session_service import _enter_resolved
    from app.services.class_membership_service import invite_members

    a, b, cls, rows = setup_class(pg_session)
    row = rows[0]
    row.status = "open"
    member = user(pg_session, role="client")
    membership = invite_members(pg_session, cls, [member.id], a.id, NOW)[0]
    membership.status = "removed"
    pg_session.commit()
    for uid in (member.id, b.id):
        with pytest.raises(HTTPException) as exc:
            _enter_resolved(row, pg_session, user_id=str(uid))
        assert exc.value.status_code in (403, 409)
    assert (
        pg_session.query(SessionParticipant).filter_by(session_id=row.id).count() == 0
    )
