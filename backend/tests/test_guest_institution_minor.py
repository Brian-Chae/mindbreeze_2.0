"""기관 비회원: 연월 최소 수집과 연구 사본 제외 회귀."""
from datetime import date, datetime
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError

from app.models.session import SessionParticipant
from app.models.research import ResearchConsent
from app.schemas.class_guests import GuestJoin
from app.services import research_export_service as export
from tests.entry_helpers import guest_body
from tests.test_sdd015_class_code import _create_class, _db, _open_class, _register
from tests.test_sdd209_b13_research_export import db, enabled, staging, _setup, _put_raw


def test_minor_enters_with_nickname_and_year_month(client):
    host = _register(client, 'minor-host@example.com')
    session = _create_class(client, host['h'])
    _open_class(client, session, host['h'])
    body = guest_body(session['access_code'], '3반 7번')
    body.pop('birth_date')
    body['birth_year_month'] = '2018-06'
    result = client.post('/api/v1/sessions/enter', json=body)
    assert result.status_code == 200, result.text
    saved_db = _db()
    try:
        p = saved_db.get(SessionParticipant, UUID(result.json()['participant_id']))
        assert p.birth_date == date(2018, 6, 1)
        consent = client.put(f"/api/v1/sessions/{session['id']}/research-consent",
            headers={'X-Entry-Credential': result.json()['entry_credential']},
            json={'consented': True, 'notice_version': 'r5-2'})
        assert consent.status_code == 403
        assert saved_db.query(ResearchConsent).filter_by(participant_id=p.id).count() == 0
    finally:
        saved_db.close()


@pytest.mark.parametrize('value', ['2018-00', '2018-13', '2018-6', '2018-06-01', '9999-01'])
def test_guest_join_invalid_year_month(value):
    with pytest.raises(ValidationError):
        GuestJoin(code='1234', operation_key=uuid4(), guest_name='별명', gender='other',
            birth_year_month=value, report_email='synthetic@example.com')


def test_guest_join_year_month_replaces_day_and_ignores_legacy_research_choice():
    command = GuestJoin(code='1234', operation_key=uuid4(), guest_name='별명', gender='other',
        birth_year_month='2018-06', report_email='synthetic@example.com', research_consented=True,
        research_notice_version='r5-2')
    assert command.birth_date == date(2018, 6, 1)
    assert command.research_consented is False
    assert command.research_notice_version is None


@pytest.mark.parametrize('state', ['not_applicable', 'pending'])
def test_legacy_consented_guest_excluded_from_queue_bundle_and_retry(db, enabled, staging, state):
    session, participant, consent = _setup(db, state=state)
    participant.user_id = None
    db.commit()
    _put_raw(staging, session, participant)
    assert export.queue_session(session.id, db) == 0
    assert export.build_session_bundle(db, session.id) is None
    assert export.export_session(db, session.id)['status'] == 'nothing_to_export'
    assert not staging.store


def test_previously_uploaded_guest_batch_is_not_offered_or_acked(db, enabled, staging):
    """기존 파일은 삭제하지 않으며 이후 목록·ack 전달만 막는다."""
    from fastapi import HTTPException
    from app.models.research_export import ResearchExportBatch
    session, participant, consent = _setup(db)
    _put_raw(staging, session, participant)
    result = export.export_session(db, session.id)
    participant.user_id = None  # 과거 버전이 만든 guest 배치 상황을 재현
    db.commit()
    batch = db.get(ResearchExportBatch, UUID(result['batch_id']))
    existing_objects = dict(staging.store)
    assert export.list_uploaded_batches(db) == []
    with pytest.raises(HTTPException) as error:
        export.ack_batch(db, str(batch.id), batch.manifest_sha256)
    assert error.value.status_code == 409
    assert staging.store == existing_objects


def test_long_guest_join_stores_month_and_prevents_research_update(client, monkeypatch):
    from fastapi import HTTPException
    from app.models.class_program import ClassMember
    from app.services import class_guest_service, class_member_consent_service
    from tests.pg.sdd216_helpers import world
    db = _db()
    try:
        _, _, _, cls = world(db)
        cls.access_code = '1234'
        cls.capacity = 10
        db.commit()
        now = datetime.now()  # SQLite 자격 만료 컬럼의 naive datetime 어댑터
        result = class_guest_service.join_guest(db, cls.id, {
            'code': '1234', 'operation_key': str(uuid4()), 'guest_name': '3반 7번',
            'gender': 'other', 'birth_year_month': '2018-06', 'report_email': 'synthetic@example.com',
            'research_consented': True, 'research_notice_version': 'r5-2'}, now=now)
        member = db.get(ClassMember, UUID(result['member']['id']))
        assert member.birth_date == date(2018, 6, 1)
        assert member.research_consented is False
        token = result['credential_bundle']['activity_credential']
        # SQLite는 자격 만료의 timezone을 버린다. 인증은 기존 PG 계약에서 검증하며 여기서는 저장 가드를 독립 확인한다.
        monkeypatch.setattr(class_member_consent_service, '_command',
            lambda db, class_id, command, user_id, token, apply, **kw: apply(cls, member, command))
        with pytest.raises(HTTPException) as error:
            class_member_consent_service.update_consents(db, cls.id, {
                'operation_key': str(uuid4()), 'expected_revision': cls.revision,
                'research_consented': True, 'research_notice_version': 'r5-2'}, member_credential=token, now=now)
        assert error.value.status_code == 403
    finally:
        db.close()


@pytest.mark.parametrize('value', ['2018-00', '2018-13', '2018-6', '2018-06-01', '9999-01'])
def test_session_entry_rejects_invalid_or_future_year_month(value):
    from app.schemas.session import EnterRequest
    with pytest.raises(ValidationError):
        EnterRequest(code='1234', birth_year_month=value)


def test_legacy_guest_choice_is_not_copied_to_future_session(db, enabled):
    from types import SimpleNamespace
    from app.services import research_consent_service
    session, participant, consent = _setup(db)
    guest = SessionParticipant(session_id=session.id, guest_name='별명')
    db.add(guest)
    db.flush()
    member = SimpleNamespace(user_id=None, research_consented=True)
    research_consent_service.copy_class_choice(db, guest, member)
    assert db.query(ResearchConsent).filter_by(participant_id=guest.id).count() == 0


def test_run_export_does_not_schedule_guest_only_session(db, enabled, staging):
    session, participant, consent = _setup(db)
    participant.user_id = None
    db.commit()
    assert export.run_export(db)['sessions'] == 0
    forced = export.run_export(db, session_ids=[session.id], force=True)
    assert forced['results'] == [{'status': 'nothing_to_export'}]
    assert not staging.store
