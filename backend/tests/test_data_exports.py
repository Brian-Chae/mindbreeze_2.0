"""SDD-071 참가자별 민감 데이터 내보내기 계약."""
import csv
import hashlib
import io
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4
from zipfile import ZipFile

import pytest

from app.api.deps import get_current_user
from app.core.database import get_db
from app.main import app
from app.models.eeg_feature import EEGFeatureWindow
from app.models.record import Report
from app.models.session import Session, SessionParticipant
from app.models.user import User


@pytest.fixture
def export_env(client, monkeypatch):
    provider = app.dependency_overrides[get_db]()
    db = next(provider)
    user = User(email='export@example.com', password_hash='x', name='비공개상담사', role='counselor')
    db.add(user)
    db.flush()
    session = Session(host_id=user.id, type='meditation', status='completed', duration_min=10)
    db.add(session)
    db.flush()
    participant = SessionParticipant(session_id=session.id, guest_name='비공개참가자', report_email='secret@example.com', consent_eeg=True)
    other = SessionParticipant(session_id=session.id, guest_name='타참가자', consent_eeg=True)
    db.add_all([participant, other])
    db.flush()
    for group, value in [('first', None), ('second', 0.12345678901234567)]:
        db.add(EEGFeatureWindow(session_id=session.id, participant_id=participant.id, play_group_id=group,
                               window_index=0, quality='invalid' if value is None else 'degraded', focus_index=value, heart_rate=0))
    db.add(EEGFeatureWindow(session_id=session.id, participant_id=other.id, window_index=999, focus_index=999))
    report = Report(session_id=session.id, participant_id=participant.id, type='client', status='completed',
                    data_credibility=None, content={'secret': '상담원문', 'eeg': {'metrics': {'stress_score': None},
                    'timeline': [{'t': 0, 'stress': None}], 'narrative': {'body': '몸의 흐름'}, 'secret': '비공개'}})
    db.add(report)
    db.commit()
    app.dependency_overrides[get_current_user] = lambda: {'id': str(user.id), 'role': user.role}
    yield client, db, user, session, participant, report
    app.dependency_overrides.pop(get_current_user, None)
    provider.close()


def create_export(env, **payload):
    client, _, _, session, participant, _ = env
    return client.post(f'/api/v1/sessions/{session.id}/participants/{participant.id}/data-exports',
                       json={'purpose': '상담 경과 분석', **payload}, headers={'Idempotency-Key': 'test-key'})


def test_export_requires_authentication(client):
    assert client.post(f'/api/v1/sessions/{uuid4()}/participants/{uuid4()}/data-exports',
                       json={'purpose': '분석'}).status_code == 401


def test_package_roundtrip_is_scoped_and_lossless(export_env, monkeypatch):
    from app.services import export_service, storage_service
    from app.tasks.export_task import generate_data_export
    from app.models.data_export import DataExportAudit, DataExportJob
    monkeypatch.setattr(generate_data_export, 'apply_async', lambda *a, **k: None)
    captured = {}
    monkeypatch.setattr(storage_service, 'upload_export', lambda path, key: captured.update(data=Path(path).read_bytes()))
    response = create_export(export_env)
    assert response.status_code == 202, response.text
    export_id = UUID(response.json()['export_id'])
    db = export_env[1]
    export_service.run_export(export_id, db)
    job = db.get(DataExportJob, export_id)
    assert job.status == 'ready'
    with ZipFile(io.BytesIO(captured['data'])) as archive:
        rows = list(csv.DictReader(io.StringIO(archive.read('participants/p001/feature_timeseries.csv').decode())))
        assert len(rows) == 2
        assert len(rows[0]) == 29
        assert rows[0]['focus_index'] == ''
        assert rows[1]['focus_index'] == repr(0.12345678901234567)
        assert rows[0]['heart_rate'] == '0.0'
        assert [r['quality'] for r in rows] == ['invalid', 'degraded']
        assert [r['window_index'] for r in rows] == ['0', '0']
        report = json.loads(archive.read('participants/p001/report.json'))
        assert set(report) == {'type', 'status', 'data_credibility', 'content'}
        assert set(report['content']['eeg']) == {'metrics', 'timeline', 'narrative'}
        manifest = json.loads(archive.read('manifest.json'))
        for entry in manifest['files']:
            if entry['included']:
                data = archive.read(entry['path'])
                assert entry['size_bytes'] == len(data)
                assert entry['sha256'] == hashlib.sha256(data).hexdigest()
        all_text = '\n'.join(archive.read(name).decode() for name in archive.namelist())
        for secret in ['비공개참가자', 'secret@example.com', '상담원문', str(export_env[4].id)]:
            assert secret not in all_text
    assert job.checksum == hashlib.sha256(captured['data']).hexdigest()
    assert db.query(DataExportAudit).filter_by(export_id=export_id).count() >= 2
    captured.clear()
    export_service.run_export(export_id, db)
    assert captured == {}


@pytest.mark.parametrize('role', ['org_admin', 'client'])
def test_disallowed_roles(export_env, role):
    export_env[2].role = role
    export_env[1].commit()
    response = create_export(export_env)
    assert response.status_code == 403
    if role == 'org_admin':
        assert '기관' in response.json()['detail']
    from app.models.data_export import DataExportAudit
    event = export_env[1].query(DataExportAudit).filter_by(event='request_denied').one()
    assert event.role == role
    assert event.result == 'http_403'


def test_idempotency_and_scope(export_env, monkeypatch):
    from app.tasks.export_task import generate_data_export
    monkeypatch.setattr(generate_data_export, 'apply_async', lambda *a, **k: None)
    first = create_export(export_env)
    assert first.status_code == 202
    assert create_export(export_env).json()['export_id'] == first.json()['export_id']
    assert create_export(export_env, purpose='다른 목적').status_code == 409
    client, db, user, session, participant, _ = export_env
    app.dependency_overrides[get_current_user] = lambda: {'id': str(uuid4()), 'role': 'platform_admin'}
    assert client.get('/api/v1/data-exports/' + first.json()['export_id']).status_code in (403, 404)
    app.dependency_overrides[get_current_user] = lambda: {'id': str(user.id), 'role': user.role}
    session.host_id = uuid4()
    db.commit()
    assert create_export(export_env).status_code == 404


def test_consent_and_session_gate(export_env):
    _, db, _, session, participant, _ = export_env
    session.status = 'in_progress'
    db.commit()
    assert create_export(export_env).status_code == 409
    session.status = 'completed'
    participant.consent_eeg = False
    db.commit()
    assert create_export(export_env).status_code == 403


def test_presign_and_expiration(export_env, monkeypatch):
    from app.models.data_export import DataExportJob
    from app.services import export_service, storage_service
    from app.tasks.export_task import generate_data_export
    monkeypatch.setattr(generate_data_export, 'apply_async', lambda *a, **k: None)
    monkeypatch.setattr(storage_service, 'upload_export', lambda *a: None)
    deleted = []
    monkeypatch.setattr(storage_service, 'delete_export', lambda key: deleted.append(key))
    export_id = UUID(create_export(export_env).json()['export_id'])
    client, db, _, _, participant, _ = export_env
    export_service.run_export(export_id, db)
    job = db.get(DataExportJob, export_id)
    seen = []
    monkeypatch.setattr(storage_service, 'generate_presigned_get', lambda key, **kw: seen.append(kw['expires_in']) or 'https://s3.example/signed')
    job.expires_at = datetime.now(timezone.utc) + timedelta(seconds=60)
    db.commit()
    path = f'/api/v1/data-exports/{export_id}/download-url'
    assert client.post(path).status_code == 200
    assert 1 <= seen[0] <= 60
    participant.consent_eeg = False
    db.commit()
    assert client.post(path).status_code == 403
    participant.consent_eeg = True
    job.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()
    assert client.post(path).status_code == 410
    export_service.cleanup_expired(db)
    assert deleted
    db.refresh(job)
    assert job.status == 'expired'


def test_storage_does_not_return_stub(monkeypatch):
    from app.services import storage_service
    monkeypatch.setattr(storage_service.settings, 'aws_access_key_id', '')
    monkeypatch.setattr(storage_service.settings, 'aws_secret_access_key', '')
    with pytest.raises(storage_service.ExportStorageError):
        storage_service.generate_presigned_get('data-exports/a.zip')


def test_upload_failure_is_explicit(export_env, monkeypatch):
    from app.services import export_service, storage_service
    from app.models.data_export import DataExportJob
    from app.tasks.export_task import generate_data_export
    monkeypatch.setattr(generate_data_export, 'apply_async', lambda *a, **k: None)
    def fail(*args):
        raise storage_service.ExportStorageError('upload_failed')
    monkeypatch.setattr(storage_service, 'upload_export', fail)
    export_id = UUID(create_export(export_env).json()['export_id'])
    export_service.run_export(export_id, export_env[1])
    job = export_env[1].get(DataExportJob, export_id)
    assert job.status == 'failed'
    assert job.error_code == 'storage_unavailable'


def test_migration_can_render_offline():
    import subprocess
    import sys
    # Alembic env.py의 fileConfig가 현재 pytest 로거를 변경하지 않도록 별도 프로세스 사용.
    result = subprocess.run([sys.executable, '-m', 'alembic', 'upgrade',
                             'e036a0000006:e036a0000007', '--sql'],
                            cwd=Path(__file__).parents[1], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert 'CREATE TABLE data_export_jobs' in result.stdout


def test_source_deletion_keeps_cleanup_ledger():
    from app.models.data_export import DataExportJob
    for field in ('session_id', 'participant_id'):
        assert not DataExportJob.__table__.c[field].foreign_keys


def test_platform_admin_and_inactive_user(export_env, monkeypatch):
    from app.tasks.export_task import generate_data_export
    monkeypatch.setattr(generate_data_export, 'apply_async', lambda *a, **k: None)
    _, db, user, session, _, _ = export_env
    user.role = 'platform_admin'
    session.host_id = uuid4()
    db.commit()
    assert create_export(export_env).status_code == 202
    user.status = 'inactive'
    db.commit()
    assert create_export(export_env).status_code == 403


def test_empty_features_and_pending_report_warn(export_env, monkeypatch):
    from app.services import export_service, storage_service
    from app.models.data_export import DataExportJob
    from app.tasks.export_task import generate_data_export
    monkeypatch.setattr(generate_data_export, 'apply_async', lambda *a, **k: None)
    captured = {}
    monkeypatch.setattr(storage_service, 'upload_export', lambda path, key: captured.update(data=Path(path).read_bytes()))
    _, db, _, _, participant, report = export_env
    db.query(EEGFeatureWindow).filter_by(participant_id=participant.id).delete()
    participant.consent_eeg = False
    participant.band_connected = False
    report.content = {'eeg': {'status': 'not_measured'}}
    report.status = 'pending_review'
    db.commit()
    response = create_export(export_env)
    assert response.status_code == 202, response.text
    export_id = UUID(response.json()['export_id'])
    export_service.run_export(export_id, db)
    job = db.get(DataExportJob, export_id)
    assert job.status == 'ready_with_warnings'
    assert job.warnings == ['not_measured', 'report_pending']
    with ZipFile(io.BytesIO(captured['data'])) as archive:
        assert len(archive.read('participants/p001/feature_timeseries.csv').splitlines()) == 1
        assert 'participants/p001/report.json' not in archive.namelist()
        assert json.loads(archive.read('session_metadata.json'))['measurement_status'] == 'not_measured'


def test_queue_failure_and_unsupported_options(export_env, monkeypatch):
    from app.tasks.export_task import generate_data_export
    def fail(*a, **k):
        raise ConnectionError('broker unavailable')
    monkeypatch.setattr(generate_data_export, 'apply_async', fail)
    assert create_export(export_env, include=['raw']).status_code == 422
    assert create_export(export_env, purpose='  ').status_code == 422
    response = create_export(export_env)
    assert response.status_code == 202
    assert response.json()['status'] == 'failed'
    assert response.json()['error_code'] == 'queue_unavailable'


def test_revocation_during_upload_prevents_publication(export_env, monkeypatch):
    from app.services import export_service, storage_service
    from app.models.data_export import DataExportJob
    from app.tasks.export_task import generate_data_export
    monkeypatch.setattr(generate_data_export, 'apply_async', lambda *a, **k: None)
    _, db, _, _, participant, _ = export_env
    deleted = []
    def upload(*args):
        participant.consent_eeg = False
        db.commit()
    monkeypatch.setattr(storage_service, 'upload_export', upload)
    monkeypatch.setattr(storage_service, 'delete_export', lambda key: deleted.append(key))
    export_id = UUID(create_export(export_env).json()['export_id'])
    export_service.run_export(export_id, db)
    job = db.get(DataExportJob, export_id)
    assert job.status == 'failed'
    assert job.error_code == 'access_revoked'
    assert deleted
    assert job.object_key is None


def test_delete_failure_is_retried(export_env, monkeypatch):
    from app.services import export_service, storage_service
    from app.models.data_export import DataExportJob
    from app.tasks.export_task import generate_data_export
    monkeypatch.setattr(generate_data_export, 'apply_async', lambda *a, **k: None)
    export_id = UUID(create_export(export_env).json()['export_id'])
    db = export_env[1]
    job = db.get(DataExportJob, export_id)
    job.status = 'ready'
    job.object_key = 'data-exports/test/data.zip'
    job.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()
    def fail(key):
        raise storage_service.ExportStorageError('delete_failed')
    monkeypatch.setattr(storage_service, 'delete_export', fail)
    export_service.cleanup_expired(db)
    assert job.object_key is not None
    assert job.status == 'expired'
    monkeypatch.setattr(storage_service, 'delete_export', lambda key: None)
    export_service.cleanup_expired(db)
    assert job.object_key is None


def test_s3_signature_is_real_and_clamped(monkeypatch):
    from app.services import storage_service
    class S3:
        def head_object(self, **kw):
            pass
        def generate_presigned_url(self, operation, **kw):
            assert operation == 'get_object'
            assert 1 <= kw['ExpiresIn'] <= 30
            assert kw['Params']['ResponseContentDisposition'].startswith('attachment')
            return 'https://s3.example/real-signature'
    monkeypatch.setattr(storage_service, '_export_client', lambda: S3())
    assert storage_service.generate_presigned_get('data-exports/test/data.zip', expires_in=300,
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=30)).endswith('real-signature')


def test_disconnected_is_not_evidence_of_never_measured(export_env, monkeypatch):
    from app.services import export_service, storage_service
    from app.models.data_export import DataExportJob
    from app.tasks.export_task import generate_data_export
    monkeypatch.setattr(generate_data_export, 'apply_async', lambda *a, **k: None)
    monkeypatch.setattr(storage_service, 'upload_export', lambda *a: None)
    _, db, _, _, participant, report = export_env
    db.query(EEGFeatureWindow).filter_by(participant_id=participant.id).delete()
    participant.band_connected = False
    db.delete(report)
    db.commit()
    export_id = UUID(create_export(export_env).json()['export_id'])
    export_service.run_export(export_id, db)
    job = db.get(DataExportJob, export_id)
    assert 'unknown' in job.warnings
    assert 'not_measured' not in job.warnings


def test_celery_worker_loads_exports_in_fresh_process():
    import subprocess
    import sys
    result = subprocess.run([sys.executable, '-c', "from app.core.celery_app import celery_app; celery_app.loader.import_default_modules(); assert 'tasks.generate_data_export' in celery_app.tasks; assert 'tasks.cleanup_data_exports' in celery_app.tasks"],
                            cwd=Path(__file__).parents[1], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
