"""SDD-214 P1·P2 — 세션 생성 경로를 실제 PG 제약 위에서 검증한다 (verify CP-6, CN 연계).

SQLite 는 CHECK·복합 FK 를 ORM 메타데이터로 만들지 않으므로(TD8) 부모 없는 세션이 통과한다.
여기서는 마이그레이션 head 의 제약(ck_sessions_one_parent, 복합 FK, UNIQUE(.., seq))이 켜진 DB 에서
생성 경로의 모든 Session 생성 지점이 제약을 만족하는지 확인한다. 임시 DB 는 끝에 지운다.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from collections.abc import Iterator

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as OrmSession

from tests.pg.conftest import alembic_ok

pytestmark = pytest.mark.pg


@pytest.fixture(scope="module")
def head_engine(scratch_db) -> Iterator[sa.Engine]:
    url = scratch_db("create_path")
    alembic_ok(url, "upgrade", "head")
    engine = sa.create_engine(url)
    yield engine
    engine.dispose()


@pytest.fixture
def db(head_engine) -> Iterator[OrmSession]:
    with head_engine.connect() as conn:
        outer = conn.begin()
        session = OrmSession(bind=conn, join_transaction_mode="create_savepoint")
        try:
            yield session
        finally:
            session.close()
            if outer.is_active:
                outer.rollback()


def _mk_user(db: OrmSession) -> uuid.UUID:
    uid = uuid.uuid4()
    db.execute(
        sa.text(
            "INSERT INTO users (id, email, password_hash, name, role, verified_tier) "
            "VALUES (:id, :email, 'x', '테스트', 'counselor', 'email')"
        ),
        {"id": str(uid), "email": f"cp-{uid.hex[:8]}@example.com"},
    )
    return uid


def _new_session(host_id: uuid.UUID, **over):
    from app.models.session import Session

    fields = dict(
        type="meditation", status="ready", host_id=host_id, duration_min=50, title="제목", notes="안내",
        max_participants=10, location_type="offline", participant_mode="group", linkband_mode="none",
        sfu_enabled=False, record_audio=True, record_video=True, reminder_offsets=[],
        webrtc_room_id=uuid.uuid4(), organization_attribution_known=True,
    )
    fields.update(over)
    return Session(**fields)


def _create(db: OrmSession, host_id: uuid.UUID, **over):
    from app.services import session_service as svc

    s = _new_session(host_id, access_code=svc.generate_access_code(db), **over)
    svc._attach_parent(s, db)
    svc._add_session_with_code_retry(s, db)
    s.run_id = s.id
    db.flush()
    return s


def test_부모_없는_비템플릿_세션은_PG_CHECK_로_거부된다(db):
    host = _mk_user(db)
    s = _new_session(host)
    db.add(s)
    with pytest.raises(IntegrityError, match="ck_sessions_one_parent"):
        db.flush()


def test_명상_생성은_CHECK와_복합_FK를_통과한다(db):
    host = _mk_user(db)
    s = _create(db, host, type="meditation")
    row = db.execute(
        sa.text("select class_id, counseling_relationship_id, seq, host_state from sessions where id = :i"),
        {"i": str(s.id)},
    ).one()
    assert row.class_id is not None and row.counseling_relationship_id is None
    assert (row.seq, row.host_state) == (1, "assigned")


def test_상담_생성은_보관용_관계를_재사용하고_seq가_이어진다(db):
    host = _mk_user(db)
    a = _create(db, host, type="clinical", participant_mode="one_on_one")
    b = _create(db, host, type="hypnosis", participant_mode="one_on_one")
    assert a.counseling_relationship_id == b.counseling_relationship_id
    assert (a.seq, b.seq) == (1, 2)
    n = db.execute(
        sa.text("select count(*) from counseling_relationships where counselor_id = :h and is_placeholder"),
        {"h": str(host)},
    ).scalar_one()
    assert n == 1


def test_숨긴_세션의_seq는_재사용하지_않는다(db):
    host = _mk_user(db)
    a = _create(db, host, type="clinical", participant_mode="one_on_one")
    a.hidden_at = datetime.now(timezone.utc)
    db.flush()
    b = _create(db, host, type="clinical", participant_mode="one_on_one")
    assert (a.seq, b.seq) == (1, 2)


def test_복제_경로와_템플릿_경로도_제약을_만족한다(db):
    from app.services import session_service as svc

    host = _mk_user(db)
    src = _create(db, host, type="meditation")
    clone = svc._clone_session_config(
        src, host_uuid=host, organization_id=None, is_template=False, title="복제", scheduled_at=None, db=db
    )
    db.flush()
    assert clone.class_id is not None and clone.class_id != src.class_id and clone.seq == 1
    tpl = svc._clone_session_config(
        src, host_uuid=host, organization_id=None, is_template=True, title="템플릿", scheduled_at=None, db=db
    )
    db.flush()
    assert tpl.class_id is None and tpl.counseling_relationship_id is None and tpl.seq is None


def test_마지막_가시_세션을_숨기면_클래스가_숨겨지고_PG에서도_일관된다(db):
    from app.models.class_program import Class
    from app.services import session_service as svc

    host = _mk_user(db)
    s = _create(db, host, type="meditation")
    s.title = "수정"
    svc._sync_parent_class(s, db)
    assert db.get(Class, s.class_id).title == "수정"
    s.hidden_at = datetime.now(timezone.utc)
    svc._hide_class_if_no_visible_sessions(s, db)
    db.flush()
    hidden = db.execute(sa.text("select hidden_at from classes where id = :i"), {"i": str(s.class_id)}).scalar_one()
    assert hidden is not None
