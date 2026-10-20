"""심사 시드는 격리 SQLite에서만 검증한다."""
import importlib.util
from pathlib import Path
from unittest.mock import Mock
import pytest
from sqlalchemy import create_engine, select, func
from sqlalchemy.orm import Session


@pytest.fixture(autouse=True)
def forbid_external_calls(monkeypatch):
    import httpx
    from app.tasks import email
    external = Mock(side_effect=AssertionError('외부 API·메일 호출 금지'))
    monkeypatch.setattr(email, '_send_email', external)
    monkeypatch.setattr(httpx.HTTPTransport, 'handle_request', external)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, 'handle_async_request', external)
    yield
    external.assert_not_called()


def seed_module():
    path = Path(__file__).parents[1] / 'scripts/seed_store_review.py'
    assert path.exists(), '심사 시드 구현이 필요하다'
    spec = importlib.util.spec_from_file_location('review_seed', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_dry_run_does_not_connect_or_write():
    module = seed_module()
    factory = Mock(side_effect=AssertionError('접속 금지'))
    assert module.run_seed('sqlite:///:memory:', session_factory=factory)['dry_run']
    factory.assert_not_called()


@pytest.mark.parametrize('url', ['postgresql://u:p@prod/db', 'postgresql://u:p@localhost/dev', 'sqlite:////tmp/production.db'])
def test_reject_non_test_database(url):
    with pytest.raises(ValueError):
        seed_module().run_seed(url, apply=True, password='fixture-secret')


def test_seed_idempotent_and_deleted_account_not_revived():
    module = seed_module()
    import app.models
    from app.core.database import Base
    from app.models.user import User
    from app.models.record import Report
    from app.models.eeg_feature import EEGFeatureWindow
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        module.seed_review(db, 'fixture-secret')
        db.commit()
        assert db.scalar(select(func.count()).select_from(User)) == 2
        assert db.scalar(select(func.count()).select_from(Report)) == 2
        assert db.scalar(select(func.count()).select_from(EEGFeatureWindow)) == 60
        module.seed_review(db, 'fixture-secret')
        db.commit()
        assert db.scalar(select(func.count()).select_from(User)) == 2
        host = db.scalar(select(User).where(User.role == 'counselor'))
        old_hash = host.password_hash
        host.status = 'deleted'
        db.commit()
        module.seed_review(db, 'fixture-secret')
        db.commit()
        db.refresh(host)
        assert host.status == 'deleted' and host.password_hash == old_hash
        assert db.scalar(select(func.count()).select_from(User)) == 3


def test_partial_failure_rolls_back():
    module = seed_module()
    import app.models
    from sqlalchemy import event
    from sqlalchemy.orm import sessionmaker
    from app.core.database import Base
    from app.models.user import User
    from app.models.record import Report
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    def fail_report(*args):
        raise RuntimeError('fixture failure')
    event.listen(Report, 'before_insert', fail_report)
    try:
        with pytest.raises(RuntimeError):
            module.run_seed('sqlite:///:memory:', apply=True, password='fixture-secret',
                            session_factory=sessionmaker(bind=engine))
        with Session(engine) as db:
            assert db.scalar(select(func.count()).select_from(User)) == 0
    finally:
        event.remove(Report, 'before_insert', fail_report)


def test_seed_accounts_can_login_and_read_reports(app_client):
    module = seed_module()
    from app.core.database import SessionLocal
    client, _ = app_client
    with SessionLocal() as db:
        module.seed_review(db, 'fixture-secret')
        db.commit()
    for role in ('counselor', 'client'):
        response = client.post('/api/v1/auth/login', json={
            'email': f'store-review-{role}@example.com', 'password': 'fixture-secret',
        })
        assert response.status_code == 200
        token = response.json()['access_token']
        headers = {'Authorization': f'Bearer {token}'}
        reports = client.get('/api/v1/reports', headers=headers)
        assert reports.status_code == 200
        assert reports.json()['total'] >= 1
        report_id = reports.json()['reports'][0]['id']
        report = client.get(f'/api/v1/reports/{report_id}', headers=headers)
        assert report.status_code == 200
        assert report.json()['content']['source'] == 'synthetic'
