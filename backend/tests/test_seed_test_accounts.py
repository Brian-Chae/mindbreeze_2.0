"""테스트 계정 시드: 실제 DB 대신 격리 SQLite로 검증한다."""
import importlib.util
from pathlib import Path
from unittest.mock import Mock

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.database import Base
from app.core.security import verify_password
from app.models.organization import Organization
from app.models.user import User
from app.models.user_org_membership import UserOrgMembership


@pytest.fixture
def seed():
    spec = importlib.util.spec_from_file_location(
        'test_account_seed', Path(__file__).parents[1] / 'scripts/seed_test_accounts.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def db():
    import app.models  # noqa: F401
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def test_three_accounts_idempotent_and_password_rotation(seed, db):
    assert seed.seed_test_accounts(db, 'fixture-secret') == {'created': 3, 'updated': 0}
    db.commit()
    ids = {u.email: u.id for u in db.query(User)}
    assert seed.seed_test_accounts(db, 'rotated-fixture') == {'created': 0, 'updated': 3}
    db.commit()
    assert {u.email: u.id for u in db.query(User)} == ids
    assert all(verify_password('rotated-fixture', u.password_hash) for u in db.query(User))
    assert db.query(Organization).count() == 1
    assert db.query(UserOrgMembership).count() == 2
    counselor = db.query(User).filter_by(role='counselor').one()
    admin = db.query(User).filter_by(email='orgadmin@test.com').one()
    assert admin.role == 'org_admin' and admin.name == '테스트기관관리자'
    assert admin.org_id == counselor.org_id
    assert db.query(UserOrgMembership).filter_by(user_id=admin.id, org_id=admin.org_id,
                                               role='org_admin', status='active').count() == 1
    assert admin.onboarding_completed
    assert counselor.counselor_profile is not None
    assert len(counselor.client_links) == 1


@pytest.mark.parametrize('general', [False, True])
def test_preserves_personal_office_and_selects_general(seed, db, general):
    counselor = User(email='counselor@test.com', name='기존 상담사', role='counselor',
                     password_hash='unused', status='active')
    db.add(counselor)
    db.flush()
    personal = Organization(name='개인상담소', kind='individual', owner_user_id=counselor.id)
    db.add(personal)
    db.flush()
    counselor.org_id = personal.id
    primary = UserOrgMembership(user_id=counselor.id, org_id=personal.id,
                                role='counselor', status='active', is_primary=True)
    db.add(primary)
    if general:
        org = Organization(name='일반기관', kind='institution')
        db.add(org)
        db.flush()
        db.add(UserOrgMembership(user_id=counselor.id, org_id=org.id,
                                role='counselor', status='active', is_primary=False))
    db.commit()
    seed.seed_test_accounts(db, 'fixture-secret')
    db.commit()
    admin = db.query(User).filter_by(role='org_admin').one()
    selected = db.get(Organization, admin.org_id)
    assert selected.name == ('일반기관' if general else '테스트기관')
    assert counselor.org_id == personal.id and primary.is_primary
    assert primary.status == 'active' and personal.owner_user_id == counselor.id
    before = db.query(UserOrgMembership).count()
    seed.seed_test_accounts(db, 'fixture-secret')
    db.commit()
    assert db.query(UserOrgMembership).count() == before


@pytest.mark.parametrize('environment,url', [
    ('production', 'sqlite:///:memory:'), (' PROD ', 'postgresql://localhost/test'),
    ('dev', 'postgresql://prod/db'),
    ('dev', 'postgresql://mindbreeze-dev.attacker.com/db'),
    ('dev', 'postgresql://mindbreeze-dev.x.rds.amazonaws.com.attacker.com/db'),
    ('dev', 'postgresql://prod/db?host=mindbreeze-dev.x.rds.amazonaws.com'),
    ('dev', 'postgresql://localhost/db?host=prod'),
    ('dev', 'mysql://localhost/test'),
    ('dev', 'postgresql://localhost/db?hostaddr=192.0.2.1'),
    ('dev', 'postgresql://localhost/db?service=prod'),
])
def test_guard_rejects(seed, environment, url):
    with pytest.raises(ValueError):
        seed.require_dev_database(environment, url)


@pytest.mark.parametrize('url', ['sqlite:///:memory:', 'postgresql://localhost/test',
    'postgresql+psycopg://127.0.0.1/test', 'postgresql://[::1]/test',
    'postgresql://mindbreeze-dev.abc.ap-northeast-2.rds.amazonaws.com/db',
    'postgresql://mindbreeze-dev.abc.ap-northeast-2.rds.amazonaws.com/db?sslmode=require'])
def test_guard_accepts_dev_and_local(seed, url):
    seed.require_dev_database('development', url)


def test_main_blocks_before_session(seed, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, 'environment', 'production')
    monkeypatch.setenv('TEST_ACCOUNTS_PASSWORD', 'fixture-secret')
    factory = Mock(side_effect=AssertionError('DB 접속 금지'))
    monkeypatch.setattr('app.core.database.SessionLocal', factory)
    with pytest.raises(SystemExit):
        seed.main([])
    factory.assert_not_called()


def test_org_admin_login(seed, app_client):
    from app.core.database import SessionLocal
    client, _ = app_client
    with SessionLocal() as db:
        seed.seed_test_accounts(db, 'fixture-secret')
        db.commit()
    response = client.post('/api/v1/auth/login', json={
        'email': 'orgadmin@test.com', 'password': 'fixture-secret'})
    assert response.status_code == 200
    assert response.json()['user']['role'] == 'org_admin'
    payload = response.json()
    headers = {'Authorization': f"Bearer {payload['access_token']}"}
    with SessionLocal() as db:
        org_id = db.query(User).filter_by(email='orgadmin@test.com').one().org_id
    result = client.get(f'/api/v1/org/{org_id}/counselors', headers=headers)
    assert result.status_code == 200


def test_chooses_oldest_active_general_and_keeps_other_rows(seed, db):
    from datetime import datetime, timezone
    counselor = User(email='counselor@test.com', name='기존', role='counselor',
                     password_hash='unused', status='active')
    db.add(counselor)
    db.flush()
    expected = None
    memberships = []
    for index, (status, deactivated) in enumerate([
        ('invited', False), ('left', False), ('active', True),
        ('active', False), ('active', False),
    ]):
        org = Organization(name=f'기관{index}', kind='institution',
                           created_at=datetime(2026, 1, index + 1, tzinfo=timezone.utc),
                           deactivated_at=datetime.now(timezone.utc) if deactivated else None,
                           primary_admin_id=counselor.id)
        db.add(org)
        db.flush()
        membership = UserOrgMembership(user_id=counselor.id, org_id=org.id,
                                       role='counselor', status=status, is_primary=False)
        db.add(membership)
        memberships.append(membership)
        if index == 3:
            expected = org.id
    db.commit()
    before = [(m.id, m.status, m.is_primary) for m in memberships]
    seed.seed_test_accounts(db, 'fixture-secret')
    db.commit()
    admin = db.query(User).filter_by(role='org_admin').one()
    assert admin.org_id == expected
    assert [(m.id, m.status, m.is_primary) for m in memberships] == before
    assert all(o.primary_admin_id == counselor.id for o in db.query(Organization))
    assert db.query(Organization).count() == 5


def test_direct_seed_blocks_production_before_writes(seed, db, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, 'environment', 'production')
    with pytest.raises(ValueError):
        seed.seed_test_accounts(db, 'fixture-secret')
    assert db.query(User).count() == 0


def test_password_required(seed, monkeypatch):
    monkeypatch.delenv('TEST_ACCOUNTS_PASSWORD', raising=False)
    with pytest.raises(SystemExit):
        seed.main([])


def test_existing_admin_role_conflict_is_rejected(seed, db):
    db.add(User(email='orgadmin@test.com', name='기존 계정', role='client',
                password_hash='unchanged', status='active'))
    db.commit()
    with pytest.raises(ValueError, match='역할'):
        seed.seed_test_accounts(db, 'fixture-secret')
    db.rollback()
    existing = db.query(User).filter_by(email='orgadmin@test.com').one()
    assert existing.role == 'client' and existing.password_hash == 'unchanged'
