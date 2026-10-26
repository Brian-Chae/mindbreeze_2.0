"""SDD-241 — 명시적 확장 고지 재선택과 구버전 범위 보존."""
from tests.test_sdd209_b11_research_consent import (
    _register, _group, _guest, _put, _cred, _consent_row, _events, research_key,
)


def test_explicit_new_notice_renews_existing_consent(client, monkeypatch):
    from datetime import datetime, timezone
    from app.services import research_consent_service as service
    before_time = datetime(2026, 10, 24, 1, 0, tzinfo=timezone.utc)
    renewed_time = datetime(2026, 10, 24, 2, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(service, "_now", lambda: before_time)
    host = _register(client, 'sdd241-notice@test.com')
    session = _group(client, host)
    guest = _guest(client, session)
    assert _put(client, session, _cred(guest), notice_version='r5-1').status_code == 200
    before = _consent_row(guest['participant_id'])
    monkeypatch.setattr(service, '_now', lambda: renewed_time)
    result = _put(client, session, _cred(guest), notice_version='r5-2')
    assert result.status_code == 200
    assert result.json()['changed'] is True
    after = _consent_row(guest['participant_id'])
    assert after['notice_version'] == 'r5-2'
    assert after['consented_at'].replace(tzinfo=timezone.utc) == renewed_time
    assert after['consented_at'] > before['consented_at']
    assert len(_events(guest['participant_id'])) == 2
    assert _put(client, session, _cred(guest), notice_version='r5-2').json()['changed'] is False
    assert _put(client, session, _cred(guest)).json()['notice_version'] == 'r5-2'
    assert _put(client, session, _cred(guest), notice_version='r5-1').json()['notice_version'] == 'r5-2'


def test_missing_notice_remains_legacy(client):
    host = _register(client, 'sdd241-legacy@test.com')
    session = _group(client, host)
    guest = _guest(client, session)
    result = _put(client, session, _cred(guest))
    assert result.status_code == 200
    assert result.json()['notice_version'] == 'r5-1'
