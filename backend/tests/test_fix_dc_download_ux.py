"""데이터 센터 다운로드 — 입장 동의 판정 통일 · 재인증 스위치(기본 꺼짐)."""
from itertools import count
from uuid import uuid4

import pytest

from app.config import settings
from app.services import data_center_export as dcx, export_reauth
from tests.sdd243_helpers import add_features, auth, db, dc_enabled, mk_part, mk_session, mk_user, world  # noqa: F401
from tests.test_sdd243_jobs import BASE, OkVerifier, body, create, new_preview, preview


@pytest.fixture
def env(client, world, db, dc_enabled, monkeypatch):
    monkeypatch.setattr(export_reauth, '_verifier', OkVerifier())
    monkeypatch.setattr(dcx, 'enqueue_job', lambda job_id: None)
    return world

_SEQ = count(300)


def _one_member_session(db, w, *, consent_eeg, collected, features=2):
    member = mk_user(db, 'client', '동의회원')
    s = mk_session(db, w.counselor, w.cls_a, w.org_a, day=20, seq=next(_SEQ))
    p = mk_part(db, s, member, consent_eeg=consent_eeg)
    p.eeg_collection_consented = collected
    if features:
        add_features(db, s, p, features)
    db.commit()
    return s, p


def test_entry_consent_only_is_included(client, env, db):
    s, _ = _one_member_session(db, env, consent_eeg=False, collected=True)
    r = new_preview(client, env.admin_a, 'session', s.id)
    assert r['eligible'] is True and r['participant_count'] == 1
    assert not r['exclusion_counts'].get('consent_missing')


def test_explicit_refusal_excluded_even_if_legacy_flag(client, env, db):
    s, _ = _one_member_session(db, env, consent_eeg=True, collected=False)
    r = new_preview(client, env.admin_a, 'session', s.id)
    assert r['eligible'] is False and r['exclusion_counts']['consent_missing'] == 1


def test_null_choice_uses_legacy_flag_or_measured_data(client, env, db):
    with_data, _ = _one_member_session(db, env, consent_eeg=False, collected=None, features=2)
    assert new_preview(client, env.admin_a, 'session', with_data.id)['eligible'] is True
    no_data, _ = _one_member_session(db, env, consent_eeg=False, collected=None, features=0)
    r = new_preview(client, env.admin_a, 'session', no_data.id)
    assert r['eligible'] is False and r['exclusion_counts']['consent_missing'] == 1


def test_revalidate_follows_same_rule(client, env, db):
    s, p = _one_member_session(db, env, consent_eeg=False, collected=True)
    token = new_preview(client, env.admin_a, 'session', s.id)['preview_token']
    p.eeg_collection_consented = False
    db.commit()
    r = create(client, env.admin_a, token, proof=None)
    assert r.status_code == 409 and r.json()['detail']['code'] == 'scope_changed'


def test_other_org_still_blocked(client, env, db):
    member = mk_user(db, 'client', '타기관회원')
    s = mk_session(db, env.counselor, env.cls_b, env.org_b, day=21, seq=399)
    p = mk_part(db, s, member, consent_eeg=False)
    p.eeg_collection_consented = True
    add_features(db, s, p, 2)
    db.commit()
    assert preview(client, env.admin_a, body('session', s.id)).status_code == 404


def test_no_reauth_needed_by_default(client, env, db):
    assert settings.data_center_export_reauth_required is False
    s, _ = _one_member_session(db, env, consent_eeg=False, collected=True)
    token = new_preview(client, env.admin_a, 'session', s.id)['preview_token']
    assert create(client, env.admin_a, token, proof=None, reason=' a ').json()['detail']['code'] == 'reason_invalid'
    r = create(client, env.admin_a, token, proof=None)
    assert r.status_code == 202, r.text
    job_id = r.json()['export_id'] if 'export_id' in r.json() else r.json().get('id')
    assert job_id


def test_reauth_enforced_when_switch_on(client, env, db, monkeypatch):
    monkeypatch.setattr(settings, 'data_center_export_reauth_required', True)
    s, _ = _one_member_session(db, env, consent_eeg=False, collected=True)
    token = new_preview(client, env.admin_a, 'session', s.id)['preview_token']
    assert create(client, env.admin_a, token, proof=None).json()['detail']['code'] == 'reauth_required'
    assert create(client, env.admin_a, token, proof='wrong').json()['detail']['code'] == 'reauth_invalid'
    assert create(client, env.admin_a, token).status_code == 202


def test_context_exposes_reauth_flag(client, env, monkeypatch):
    r = client.get(BASE + '/contexts', headers=auth(env.admin_a))
    assert r.status_code == 200 and r.json()['limits']['reauth_required'] is False
    monkeypatch.setattr(settings, 'data_center_export_reauth_required', True)
    assert client.get(BASE + '/contexts', headers=auth(env.admin_a)).json()['limits']['reauth_required'] is True
