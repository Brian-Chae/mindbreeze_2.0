"""SDD-241: 메모리 DB/저장소로 실제 Parquet 계약 검증."""
import hashlib
import io
import json
import uuid
from datetime import timedelta
import pyarrow.parquet as pq
import pytest
from tests.test_sdd209_b13_research_export import db, enabled, staging, _setup, _put_raw, T0
from app.models.record import EEGRawChunk
from app.models.research import ResearchConsent
from app.models.session import SessionParticipant
from app.models.eeg_feature import EEGFeatureWindow
from app.services import research_export_service as svc


def rows(bundle, name):
    return pq.read_table(io.BytesIO(bundle['files'][name + '.parquet'])).to_pylist()


def setup_expanded(db, staging):
    s, p, c = _setup(db)
    _put_raw(staging, s, p)
    c.notice_version = 'r5-2'
    c.consented_at = T0 - timedelta(minutes=1)
    db.commit()
    return s, p, c


def test_확장_시각_진행자_허용목록_해시(db, enabled, staging):
    s, p, c = setup_expanded(db, staging)
    s.started_at = T0.replace(hour=23, microsecond=123456)
    s.ended_at = s.started_at + timedelta(minutes=10)
    base = s.started_at.timestamp() * 1000
    for raw in db.query(EEGRawChunk).all():
        raw.start_ms = base + raw.chunk_index * 4000
        raw.end_ms = base + (raw.chunk_index + 1) * 4000
    db.commit()
    bundle = svc.build_session_bundle(db, s.id)
    session = rows(bundle, 'sessions')[0]
    assert session['started_at_utc'] == '2026-10-17T23:00:00.123456+00:00'
    assert session['started_at_kst'] == '2026-10-18T08:00:00.123456+09:00'
    assert session['ended_at_utc'] == '2026-10-17T23:10:00.123456+00:00'
    subject = rows(bundle, 'subjects')[0]
    assert subject['measurement_started_at_utc'] == '2026-10-17T23:00:00.123456+00:00'
    assert subject['measurement_ended_at_kst'] == '2026-10-18T08:00:08.123456+09:00'
    assert subject['measurement_time_source'] == 'eeg_raw_chunk_endpoints'
    assert subject['birth_year_month'] == '1990-05'
    facilitator = rows(bundle, 'facilitators')[0]
    assert facilitator['user_id'] == str(s.host_id)
    assert facilitator['real_name'] == '호스트이름'
    assert facilitator['account_role'] == 'counselor'
    manifest = json.loads(svc._manifest_bytes(uuid.uuid4(), bundle))
    assert manifest['schema_version'] == '2.0'
    assert 'current' in manifest['facilitator_provenance']
    for entry in manifest['files']:
        assert entry['sha256'] == hashlib.sha256(bundle['files'][entry['name']]).hexdigest()
    assert manifest['field_list_sha256'] == hashlib.sha256(json.dumps({k:list(v) for k,v in sorted(svc.ALLOWED_COLUMNS.items())}, ensure_ascii=False).encode()).hexdigest()


@pytest.mark.parametrize('bad,reason', [(None,'missing_raw_endpoint'), (float('inf'),'non_finite_raw_endpoint'), (1.0,'raw_outside_session'), (T0.timestamp()*1000+9999999,'raw_outside_session')])
def test_개인_시각_근거_불량은_null_사유(db, enabled, staging, bad, reason):
    s, p, c = setup_expanded(db, staging)
    db.query(EEGRawChunk).first().end_ms = bad
    db.commit()
    subject = rows(svc.build_session_bundle(db,s.id), 'subjects')[0]
    assert subject['measurement_started_at_utc'] is None
    assert subject['measurement_ended_at_kst'] is None
    assert subject['measurement_time_reason'] == reason


def test_구동의와_신동의는_가명_namespace_분리(db, enabled, staging):
    s, p, c = setup_expanded(db, staging)
    other = SessionParticipant(session_id=s.id, guest_name='구동의참가자')
    db.add(other)
    db.flush()
    db.add(ResearchConsent(session_id=s.id,participant_id=other.id,consented=True,research_subject_id='b'*64,key_version=1,notice_version='r5-1',export_state='pending'))
    db.add(EEGFeatureWindow(session_id=s.id,participant_id=other.id,window_index=0,quality='valid'))
    db.commit()
    bundle = svc.build_session_bundle(db,s.id)
    sessions = rows(bundle,'sessions')
    subjects = rows(bundle,'subjects')
    assert len(sessions) == 2
    old = next(r for r in subjects if r['research_subject_id']=='b'*64)
    new = next(r for r in subjects if r['research_subject_id']=='a'*64)
    assert old['session_pseudo'] != new['session_pseudo']
    assert old['measurement_time_reason'] == 'legacy_consent_scope'
    legacy_session = next(r for r in sessions if r['session_pseudo']==old['session_pseudo'])
    assert legacy_session['started_at_utc'] is None and legacy_session['session_kind'] is None
    assert all(r['session_pseudo'] != old['session_pseudo'] for r in rows(bundle,'facilitators'))


def test_동의_이전_회차_확장_불가(db, enabled, staging):
    s, p, c = setup_expanded(db, staging)
    c.consented_at = T0 + timedelta(seconds=1)
    db.commit()
    bundle=svc.build_session_bundle(db,s.id)
    assert rows(bundle,'sessions')[0]['started_at_utc'] is None
    assert rows(bundle,'facilitators') == []


def test_참여자와_진행자_동명도_차단(db, enabled, staging):
    s, p, c = setup_expanded(db, staging)
    p.guest_name = '호스트이름'
    db.commit()
    with pytest.raises(svc.ExportValidationError, match='pii_literal'):
        svc.build_session_bundle(db,s.id)


def test_미지_enum은_차단(db, enabled, staging):
    s, p, c = setup_expanded(db, staging)
    s.session_kind = 'unknown'
    db.commit()
    with pytest.raises(svc.ExportValidationError, match='enum_value:session_kind'):
        svc.build_session_bundle(db,s.id)


def test_메타데이터_변경은_content_hash_변경(db, enabled, staging):
    s, p, c = setup_expanded(db, staging)
    first=svc.build_session_bundle(db,s.id)['items'][0]['content_sha256']
    s.ended_at += timedelta(seconds=1)
    db.commit()
    second=svc.build_session_bundle(db,s.id)['items'][0]['content_sha256']
    assert first != second
    raw = db.query(EEGRawChunk).first()
    raw.sample_rate = 500
    db.commit()
    assert second != svc.build_session_bundle(db,s.id)['items'][0]['content_sha256']


def test_클래스_운영정보와_공동진행자_회차범위(db, enabled, staging):
    from app.models.class_program import Class, ClassInstructor
    from app.models.session import Session
    from app.models.user import User

    s, p, c = setup_expanded(db, staging)
    program = Class(created_by=s.host_id, schedule_mode='rolling', planned_session_count=12,
                    default_duration_min=45, title='반출금지프로그램제목')
    db.add(program)
    db.flush()
    s.class_id = program.id
    s.seq = 3
    s.session_kind = 'makeup'
    other_session = Session(host_id=s.host_id, type='meditation', status='completed', duration_min=10)
    db.add(other_session)
    db.flush()
    expected = {str(s.host_id)}
    for i, (scope, status, added_at) in enumerate([
        (None, 'active', T0), (s.id, 'active', T0),
        (other_session.id, 'active', T0), (None, 'removed', T0),
        (None, 'active', T0 + timedelta(days=1)),
    ]):
        user = User(name=f'공동진행{i}', email=f'facilitator{i}@test.com', role='org_admin', password_hash='x')
        db.add(user)
        db.flush()
        db.add(ClassInstructor(class_id=program.id, user_id=user.id, role='assistant', status=status,
                               scope_session_id=scope, added_at=added_at))
        if i < 2:
            expected.add(str(user.id))
    db.commit()
    bundle = svc.build_session_bundle(db, s.id)
    row = rows(bundle, 'sessions')[0]
    assert row['seq'] == 3 and row['session_kind'] == 'makeup'
    assert row['schedule_mode'] == 'rolling' and row['planned_session_count'] == 12
    assert row['default_duration_min'] == 45 and row['class_pseudo'] != str(program.id)
    assert {r['user_id'] for r in rows(bundle, 'facilitators')} == expected
    first_hash = bundle['items'][0]['content_sha256']
    program.default_duration_min = 50
    db.commit()
    assert svc.build_session_bundle(db, s.id)['items'][0]['content_sha256'] != first_hash
    program.planned_session_count = None
    db.commit()
    assert rows(svc.build_session_bundle(db, s.id), 'sessions')[0]['planned_session_count'] is None


@pytest.mark.parametrize('scenario,reason', [
    ('feature_only', 'no_raw_chunks'), ('session_end_missing', 'invalid_session_interval'),
    ('session_reversed', 'invalid_session_interval'), ('raw_reversed', 'reversed_raw_endpoints'),
    ('clock_reset', 'raw_clock_reset'),
])
def test_시각_근거별_null_사유(db, enabled, staging, scenario, reason):
    s, p, c = setup_expanded(db, staging)
    chunks = db.query(EEGRawChunk).order_by(EEGRawChunk.chunk_index).all()
    if scenario == 'feature_only':
        for chunk in chunks:
            chunk.upload_status = 'pending'
    elif scenario == 'session_end_missing':
        s.ended_at = None
    elif scenario == 'session_reversed':
        s.ended_at = T0 - timedelta(seconds=1)
    elif scenario == 'raw_reversed':
        chunks[0].start_ms += 1
        chunks[0].end_ms = chunks[0].start_ms - 1
    else:
        chunks[0].start_ms += 100
        chunks[1].start_ms = T0.timestamp() * 1000
    db.commit()
    bundle = svc.build_session_bundle(db, s.id)
    row = rows(bundle, 'subjects')[0]
    assert row['measurement_started_at_utc'] is None
    assert row['measurement_time_reason'] == reason
    if scenario == 'session_reversed':
        assert rows(bundle, 'sessions')[0]['session_time_reason'] == 'reversed_session_endpoints'


@pytest.mark.parametrize('target', ['gender', 'account_role', 'schedule_mode'])
def test_미지_인구학_진행자_운영_enum_차단(db, enabled, staging, target):
    from app.models.user import User
    from app.models.class_program import Class

    s, p, c = setup_expanded(db, staging)
    if target == 'gender':
        c.gender = 'unknown'
    elif target == 'account_role':
        db.query(User).filter(User.id == s.host_id).one().role = 'unknown'
    else:
        program = Class(created_by=s.host_id, schedule_mode='unknown', default_duration_min=45)
        db.add(program)
        db.flush()
        s.class_id = program.id
    db.commit()
    with pytest.raises(svc.ExportValidationError, match=f'enum_value:{target}'):
        svc.build_session_bundle(db, s.id)


def test_진행자_실명은_다른셀_반출불가(db, enabled, staging):
    s, p, c = setup_expanded(db, staging)
    db.query(EEGRawChunk).first().unit = '호스트이름'
    db.commit()
    with pytest.raises(svc.ExportValidationError, match='pii_literal:unit'):
        svc.build_session_bundle(db, s.id)


def test_확장_사본도_참여자_PII_미포함(db, enabled, staging):
    from tests.test_sdd209_b13_research_export import GUEST_NAME, GUEST_EMAIL, SESSION_TITLE

    s, p, c = setup_expanded(db, staging)
    bundle = svc.build_session_bundle(db, s.id)
    decoded = json.dumps({name: rows(bundle, name) for name in svc.ALLOWED_COLUMNS}, default=str, ensure_ascii=False)
    for forbidden in (str(p.id), str(s.id), str(c.id), GUEST_NAME, GUEST_EMAIL, SESSION_TITLE, '1990-05-17'):
        assert forbidden not in decoded
    subject = rows(bundle, 'subjects')[0]
    assert subject['birth_year_month'] == '1990-05'


def test_진행자_개인시각_변경도_hash_갱신(db, enabled, staging):
    from app.models.user import User

    s, p, c = setup_expanded(db, staging)
    first = svc.build_session_bundle(db, s.id)['items'][0]['content_sha256']
    host = db.query(User).filter(User.id == s.host_id).one()
    host.name = '수정진행자'
    db.commit()
    second = svc.build_session_bundle(db, s.id)['items'][0]['content_sha256']
    assert first != second
    db.query(EEGRawChunk).first().start_ms += 1
    db.commit()
    assert second != svc.build_session_bundle(db, s.id)['items'][0]['content_sha256']


def test_운영_naive_시각은_UTC_추정하지_않음():
    assert svc._utc(T0.replace(tzinfo=None)) is None


@pytest.mark.parametrize('name', ['facilitator@example.com', '010-1234-5678'])
def test_진행자_실명셀도_이메일_전화_패턴_금지(db, enabled, staging, name):
    from app.models.user import User

    s, p, c = setup_expanded(db, staging)
    db.query(User).filter(User.id == s.host_id).one().name = name
    db.commit()
    result = svc.export_session(db, s.id)
    assert result['status'] == 'failed'
    assert 'pii_pattern:real_name' in result['error']
    assert staging.calls['upload'] == []


def test_회차_종료_결측은_시작만_보존(db, enabled, staging):
    s, p, c = setup_expanded(db, staging)
    s.ended_at = None
    db.commit()
    row = rows(svc.build_session_bundle(db, s.id), 'sessions')[0]
    assert row['started_at_utc'] == T0.isoformat()
    assert row['ended_at_utc'] is None
    assert row['session_time_reason'] == 'missing_session_endpoint'


def test_시작시각_결측은_동의시점_검증불가로_확장금지(db, enabled, staging):
    s, p, c = setup_expanded(db, staging)
    s.started_at = None
    db.commit()
    bundle = svc.build_session_bundle(db, s.id)
    assert rows(bundle, 'sessions')[0]['session_time_reason'] == 'legacy_consent_scope'
    assert rows(bundle, 'facilitators') == []


def test_진행자_실명과_회차제목_동일은_실명셀에서만_허용(db, enabled, staging):
    s, p, c = setup_expanded(db, staging)
    s.title = '호스트이름'
    db.commit()
    bundle = svc.build_session_bundle(db, s.id)
    assert rows(bundle, 'facilitators')[0]['real_name'] == '호스트이름'
    assert 'title' not in rows(bundle, 'sessions')[0]


def test_다중스트림_이름순과_시각순_불일치는_리셋아님(db, enabled, staging):
    s, p, c = setup_expanded(db, staging)
    chunks = db.query(EEGRawChunk).order_by(EEGRawChunk.chunk_index).all()
    base = T0.timestamp() * 1000
    chunks[0].stream_id = 'a-stream'
    chunks[0].chunk_index = 0
    chunks[0].start_ms = base + 2000
    chunks[0].end_ms = base + 3000
    chunks[1].stream_id = 'z-stream'
    chunks[1].chunk_index = 0
    chunks[1].start_ms = base
    chunks[1].end_ms = base + 1000
    db.commit()
    row = rows(svc.build_session_bundle(db, s.id), 'subjects')[0]
    assert row['measurement_time_reason'] is None
    assert row['measurement_started_at_utc'] == T0.isoformat()
    assert row['measurement_ended_at_utc'] == (T0 + timedelta(seconds=3)).isoformat()


def test_제거된_강사도_회차당시_관계구간_포함(db, enabled, staging):
    from app.models.class_program import Class, ClassInstructor
    from app.models.user import User

    s, p, c = setup_expanded(db, staging)
    program = Class(created_by=s.host_id, default_duration_min=30)
    db.add(program)
    db.flush()
    s.class_id = program.id
    expected = {str(s.host_id)}
    for i, removed_at in enumerate([
        T0 - timedelta(seconds=1), T0 + timedelta(minutes=3),
        T0 + timedelta(days=1), None,
    ]):
        user = User(name=f'과거진행{i}', email=f'past-facilitator{i}@test.com',
                    role='counselor', password_hash='x')
        db.add(user)
        db.flush()
        db.add(ClassInstructor(class_id=program.id, user_id=user.id, role='assistant',
                               status='removed', added_at=T0 - timedelta(days=1), removed_at=removed_at))
        if i in (1, 2):
            expected.add(str(user.id))
    db.commit()
    bundle = svc.build_session_bundle(db, s.id)
    assert {r['user_id'] for r in rows(bundle, 'facilitators')} == expected
