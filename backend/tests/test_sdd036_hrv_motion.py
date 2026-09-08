"""HRV·움직임 저장 및 리포트 회귀: null, 0, 참가자 격리 검증."""
from uuid import UUID
import pytest
from app.models.eeg_feature import EEGFeatureWindow
from tests.test_sdd027_rollup_raw_report import _register, _create_group_class, _join_guest, _db

FIELDS = ('sdnn', 'rmssd', 'lf_power', 'hf_power', 'lf_hf_ratio', 'heart_rate', 'motion')
MEANS = ('sdnn_mean', 'rmssd_mean', 'lf_hf_ratio_mean', 'heart_rate_mean', 'motion_mean')


def setup_session(client):
    host = _register(client, 'hrv036@test.com')
    session = _create_group_class(client, host['h'])
    pid = _join_guest(client, session['access_code'], 'HRV 참가자')
    return host, session, pid


def upload(client, session, pid, features):
    response = client.post(f"/api/v1/sessions/{session['id']}/features", json={'participant_id': pid, 'features': features})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize('values', [dict(zip(FIELDS, (20, 30, 120, 60, 2, 72, .4))), dict.fromkeys(FIELDS, 0), dict.fromkeys(FIELDS), {}])
def test_ingestion_preserves_values_and_null(client, values):
    _, session, pid = setup_session(client)
    payload = [{'second_offset': 0, **values}]
    assert upload(client, session, pid, payload)['saved'] == 1
    assert upload(client, session, pid, payload)['saved'] == 0
    with _db() as db:
        row = db.query(EEGFeatureWindow).filter_by(session_id=UUID(session['id'])).one()
        for field in FIELDS:
            assert getattr(row, field) == values.get(field)


def test_rollup_global_non_null_mean_and_participant_scope(client):
    host, session, pid = setup_session(client)
    upload(client, session, pid, [
        {'second_offset': 0, **dict.fromkeys(FIELDS, 0)},
        {'second_offset': 1, **dict.fromkeys(FIELDS)},
        {'second_offset': 2, **dict.fromkeys(FIELDS, .3)},
        {'second_offset': 60, **dict.fromkeys(FIELDS, .9)},
    ])
    other = _join_guest(client, session['access_code'], '다른 참가자')
    upload(client, session, other, [{'second_offset': 0, **dict.fromkeys(FIELDS, 1)}])
    response = client.get(f"/api/v1/sessions/{session['id']}/eeg-rollup", params={'participant_id': pid}, headers=host['h'])
    assert response.status_code == 200, response.text
    body = response.json()
    for field in FIELDS:
        assert body['overall']['metrics'][field] == pytest.approx(.4)
        assert body['buckets'][0]['metrics'][field] == pytest.approx(.15)
    for field in MEANS:
        assert body['overall'][field] == pytest.approx(.4)


@pytest.mark.parametrize('values', [dict.fromkeys(FIELDS), dict(zip(FIELDS, (20, 30, 120, 60, 2, 72, 0)))])
def test_report_generation_and_read_preserve_means(client, values):
    host, session, pid = setup_session(client)
    upload(client, session, pid, [{'second_offset': 0, **values}])
    other = _join_guest(client, session['access_code'], '리포트 제외 참가자')
    upload(client, session, other, [{'second_offset': 0, **dict.fromkeys(FIELDS, 1)}])
    response = client.post(f"/api/v1/reports/generate/{session['id']}", json={'type': 'client'}, headers=host['h'])
    assert response.status_code == 200, response.text
    report = response.json()
    for field in MEANS:
        expected = values[field.removesuffix('_mean')]
        assert report[field] == expected
        assert report['content']['eeg'][field] == expected
    response = client.get(f"/api/v1/reports/{report['id']}", headers=host['h'])
    assert response.status_code == 200, response.text
    for field in MEANS:
        assert response.json()[field] == report[field]


def test_no_windows_means_are_null(client):
    host, session, _ = setup_session(client)
    response = client.post(f"/api/v1/reports/generate/{session['id']}", json={'type': 'counselor'}, headers=host['h'])
    assert response.status_code == 200, response.text
    assert response.json()['content']['eeg'] == {'status': 'not_measured'}
    for field in MEANS:
        assert response.json()[field] is None


def test_websocket_feature_storage_and_normalized_payload(client, monkeypatch):
    from app.ws import session_live_namespace

    _, session, pid = setup_session(client)
    monkeypatch.setattr(session_live_namespace, '_open_db', _db)
    values = dict(zip(FIELDS, (20, None, 120, 60, 2, 72, 0)))
    saved, resolved, payload = session_live_namespace._store_feature(
        session['id'], pid, None, {'second_offset': 0, **values},
    )
    assert saved == 1 and resolved == pid
    with _db() as db:
        row = db.query(EEGFeatureWindow).filter_by(session_id=UUID(session['id'])).one()
        for field in FIELDS:
            assert payload[field] == values[field]
            assert getattr(row, field) == values[field]


def test_empty_rollup_preserves_null(client):
    host, session, _ = setup_session(client)
    response = client.get(f"/api/v1/sessions/{session['id']}/eeg-rollup", headers=host['h'])
    assert response.status_code == 200, response.text
    for field in MEANS:
        assert response.json()['overall'][field] is None


@pytest.mark.parametrize('motion', [-.01, 1.01])
def test_motion_rejects_out_of_contract_range(client, motion):
    _, session, pid = setup_session(client)
    response = client.post(f"/api/v1/sessions/{session['id']}/features", json={
        'participant_id': pid, 'features': [{'second_offset': 0, 'motion': motion}],
    })
    assert response.status_code == 422
