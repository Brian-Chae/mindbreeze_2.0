"""SDD-217 NV-09~12: 실제 PG 종료 원자성·멱등·두 연결 검증."""
from datetime import timedelta
from concurrent.futures import ThreadPoolExecutor
import threading
import pytest
from sqlalchemy import create_engine, event, text, null
from sqlalchemy.orm import Session as DBSession
from app.models.class_program import Class, ClassMember
from app.models.class_membership import ClassAttendanceEvent
from app.models.class_scheduling import ClassEffect
from app.models.session import Session, SessionParticipant
from app.services import session_service as service
from tests.pg.test_sdd217_attendance import scene
from tests.pg.test_sdd217_membership import NOW
pytestmark = pytest.mark.pg

@pytest.fixture(autouse=True)
def external_boundaries(monkeypatch):
    """종료 트랜잭션은 실제 실행하고 외부 미디어·전송 경계만 대체한다."""
    from app.services import audio_service, video_service, research_export_service
    for name in ('_notify_session_state', '_notify_participants_event', '_notify_participant_changed', '_close_out_media_on_cancel'):
        monkeypatch.setattr(service, name, lambda *args, **kwargs: None)
    monkeypatch.setattr(audio_service, 'finalize_on_session_end', lambda *args: None)
    monkeypatch.setattr(video_service, 'finalize_on_session_end', lambda *args: None)
    monkeypatch.setattr(research_export_service, 'on_session_completed', lambda *args: None)
    monkeypatch.setattr(service, '_now', lambda: NOW)

def instant(db):
    host, _, cls, clients, member, row, participant = scene(db, 'in_progress')
    cls.recurrence_rule = null()
    cls.planned_session_count = 1
    cls.revision = 1
    row.started_at = NOW - timedelta(minutes=10)
    db.commit()
    return host, cls, member, row, participant

def snapshot(db, ids):
    db.expire_all()
    cls, member, row, participant = (db.get(model, key) for model, key in zip((Class, ClassMember, Session, SessionParticipant), ids))
    return (cls.status, cls.revision, member.status, member.completed_at, row.status, row.state_version, row.ended_at, row.participation_version, participant.attendance_status,
            db.query(ClassAttendanceEvent).filter_by(session_id=row.id).count(), db.query(ClassEffect).filter_by(class_id=cls.id, kind='class_completed').count())

def test_nv09_instant_end_commits_parent_attendance_member_and_intent(pg_session):
    host, cls, member, row, participant = instant(pg_session)
    assert service.transition_status(str(row.id), str(host.id), 'end', pg_session)['status'] == 'completed'
    assert snapshot(pg_session, (cls.id, member.id, row.id, participant.id)) == ('completed', 2, 'completed', NOW, 'completed', 1, NOW, 1, 'absent', 1, 1)
    from app.services.class_read_service import get_class_detail, list_classes
    for uid in (host.id, member.user_id):
        assert get_class_detail(str(cls.id), str(uid), pg_session)['status'] == 'completed'
        result, _ = list_classes(str(uid), pg_session)
        assert next(item for item in result if item['id'] == str(cls.id))['status'] == 'completed'

def test_nv11_retry_is_read_only_and_preserves_completion_counts(pg_session):
    host, cls, member, row, participant = instant(pg_session)
    ids = cls.id, member.id, row.id, participant.id
    service.transition_status(str(row.id), str(host.id), 'end', pg_session)
    before = snapshot(pg_session, ids)
    assert service.transition_status(str(row.id), str(host.id), 'end', pg_session)['status'] == 'completed'
    assert snapshot(pg_session, ids) == before

def test_nv09_completion_intent_failure_rolls_back_whole_end(pg_session):
    host, cls, member, row, participant = instant(pg_session)
    ids = cls.id, member.id, row.id, participant.id
    before = snapshot(pg_session, ids)
    def fail(*args): raise RuntimeError('합성 수료 의도 저장 실패')
    event.listen(ClassEffect, 'before_insert', fail)
    try:
        with pytest.raises(RuntimeError, match='합성 수료 의도 저장 실패'):
            service.transition_status(str(row.id), str(host.id), 'end', pg_session)
    finally:
        event.remove(ClassEffect, 'before_insert', fail)
    assert snapshot(pg_session, ids) == before

@pytest.mark.parametrize('kind', ['rolling_empty_future', 'cancel', 'makeup', 'all_cancelled'])
def test_nv12_no_false_fixed_completion(pg_session, kind):
    from app.services.class_rolling_service import finish_class_if_due
    host, cls, member, row, participant = instant(pg_session)
    if kind == 'rolling_empty_future': cls.schedule_mode = 'rolling'
    if kind in ('makeup', 'cancel'):
        cls.recurrence_rule = {'start_now': True}
        pg_session.add(Session(type='meditation', class_id=cls.id, host_id=host.id, seq=2, status='completed', session_kind='regular', duration_min=60, host_state='assigned'))
    if kind == 'makeup': row.session_kind = 'makeup'
    if kind == 'all_cancelled':
        row.status = 'cancelled'; pg_session.commit()
        assert not finish_class_if_due(pg_session, cls, NOW)
    else:
        pg_session.commit()
        service.transition_status(str(row.id), str(host.id), 'cancel' if kind == 'cancel' else 'end', pg_session)
    pg_session.expire_all()
    assert cls.status == 'active' and member.status == 'active'
    assert pg_session.query(ClassEffect).filter_by(class_id=cls.id, kind='class_completed').count() == 0

def test_nv11_two_connections_end_once(scratch_db):
    from tests.pg.conftest import alembic_ok
    url = scratch_db('completion_race'); alembic_ok(url, 'upgrade', 'head')
    engine = create_engine(url); reached = threading.Event()
    try:
        with DBSession(engine) as db:
            host, cls, member, row, participant = instant(db)
            host_id, ids = host.id, (cls.id, member.id, row.id, participant.id)
        with DBSession(engine) as first:
            from app.services.class_write_service import lock_class_session
            from app.services.session_authz import get_session_authorized, SessionAction
            authorized = get_session_authorized(first, str(ids[2]), str(host_id), SessionAction.SESSION_TRANSITION)
            lock_class_session(first, authorized, host_id)
            def observe(conn, cursor, statement, parameters, context, many):
                if 'FOR ' in statement: reached.set()
            event.listen(engine, 'before_cursor_execute', observe)
            def second():
                with DBSession(engine) as db:
                    db.execute(text("SET LOCAL lock_timeout='5s'"))
                    return service.transition_status(str(ids[2]), str(host_id), 'end', db)
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(second)
                assert reached.wait(timeout=3) and not future.done()
                assert service.transition_status(str(ids[2]), str(host_id), 'end', first)['status'] == 'completed'
                assert future.result(timeout=8)['status'] == 'completed'
            event.remove(engine, 'before_cursor_execute', observe)
        with DBSession(engine) as check:
            assert snapshot(check, ids) == ('completed', 2, 'completed', NOW, 'completed', 1, NOW, 1, 'absent', 1, 1)
    finally: engine.dispose()


def test_nv10_real_http_end_then_host_and_member_reads(pg_session):
    """실제 라우터·response_model·PG. 브라우저 시각 증거와 구분한다."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.api.v1 import session as session_api, classes
    from app.api.deps import get_current_user
    from app.core.database import get_db
    host, cls, member, row, participant = instant(pg_session)
    app = FastAPI()
    app.include_router(session_api.router, prefix='/api/v1')
    app.include_router(classes.router, prefix='/api/v1')
    identity = {'id': str(host.id)}
    app.dependency_overrides[get_current_user] = lambda: identity
    app.dependency_overrides[get_db] = lambda: pg_session
    with TestClient(app) as client:
        response = client.post(f'/api/v1/sessions/{row.id}/end')
        assert response.status_code == 200, response.text
        assert response.json()['status'] == 'completed'
        assert client.post(f'/api/v1/sessions/{row.id}/end').status_code == 200
        for uid in (host.id, member.user_id):
            identity['id'] = str(uid)
            response = client.get(f'/api/v1/classes/{cls.id}')
            assert response.status_code == 200, response.text
            assert response.json()['status'] == 'completed'
            response = client.get('/api/v1/classes')
            assert response.status_code == 200, response.text
            assert next(item for item in response.json()['classes'] if item['id'] == str(cls.id))['status'] == 'completed'


# 즉석 클래스 회차 취소 → 부모·멤버가 active 로 남아 회원 '참여 중' 고착(버그 리포트 2026-10-22)
@pytest.mark.parametrize('start', ['open', 'ready'])
def test_instant_only_session_cancel_closes_parent_and_member(pg_session, start):
    host, cls, member, row, participant = instant(pg_session)
    cls.recurrence_rule = {'start_now': True}
    row.status = start; row.started_at = None
    pg_session.commit()
    assert service.transition_status(str(row.id), str(host.id), 'cancel', pg_session)['status'] == 'cancelled'
    pg_session.expire_all()
    assert (cls.status, cls.revision, member.status, member.completed_at) == ('cancelled', 2, 'completed', NOW)
    assert pg_session.query(ClassEffect).filter_by(class_id=cls.id, kind='class_cancelled').count() == 1
    assert pg_session.query(ClassEffect).filter_by(class_id=cls.id, kind='class_completed').count() == 0
    from app.services.class_read_service import list_classes
    result, _ = list_classes(str(member.user_id), pg_session)
    item = next(i for i in result if i['id'] == str(cls.id))
    assert item['status'] == 'cancelled' and item['membership']['status'] == 'completed'


def test_non_instant_fixed_cancel_keeps_parent_active(pg_session):
    """일반 고정형 클래스는 회차를 모두 취소해도 자동으로 닫지 않는다(기존 동작 유지)."""
    host, cls, member, row, participant = instant(pg_session)
    cls.recurrence_rule = {'start_now': False}
    row.status = 'open'; row.started_at = None
    pg_session.commit()
    service.transition_status(str(row.id), str(host.id), 'cancel', pg_session)
    pg_session.expire_all()
    assert cls.status == 'active' and member.status == 'active'


def test_maintenance_closes_already_stuck_instant_class(pg_session, monkeypatch):
    """배포 전에 이미 회차만 취소된 즉석 클래스는 유지 작업(cron)이 정리한다."""
    from app.config import settings
    from app.services import class_operations_service as ops
    monkeypatch.setattr(settings, 'class_scheduling_enabled', True)
    monkeypatch.setattr(ops, 'sweep_class_operations', lambda *a: None)
    host, cls, member, row, participant = instant(pg_session)
    cls.recurrence_rule = {'start_now': True}
    row.status = 'cancelled'; row.started_at = None
    pg_session.commit()
    ops.maintain_classes(pg_session, now=NOW, class_ids=[cls.id])
    pg_session.expire_all()
    assert cls.status == 'cancelled' and member.status == 'completed'
