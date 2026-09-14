"""SDD-030 몸 지표의 저장, 전송, 집계 및 리포트 계약 검증."""
from uuid import UUID

import pytest

from app.models.eeg_feature import EEGFeatureWindow
from tests.test_sdd036_hrv_motion import setup_session, upload
from tests.test_sdd027_rollup_raw_report import _db, _join_guest
from tests.test_sdd024_session_live_ws import _wire

BODY = dict(heart_rate=72, respiratory_rate=18, sdnn=20, rmssd=30,
            lf_power=120, hf_power=60, lf_hf_ratio=2)
NEW_SUMMARY = ('respiratory_rate_mean', 'heart_rate_min', 'heart_rate_max',
               'lf_power_mean', 'hf_power_mean')


@pytest.mark.parametrize('values', [{'respiratory_rate': 18.5}, {'respiratory_rate': None}, {}])
def test_rest_respiratory_storage_and_retry(client, values):
    _, session, pid = setup_session(client)
    features = [{'second_offset': 0, **values}]
    assert upload(client, session, pid, features)['saved'] == 1
    assert upload(client, session, pid, features)['saved'] == 0
    with _db() as db:
        row = db.query(EEGFeatureWindow).filter_by(session_id=UUID(session['id'])).one()
        assert row.respiratory_rate == values.get('respiratory_rate')


@pytest.mark.parametrize('values', [BODY, dict.fromkeys(BODY), {}])
def test_ws_body_payload_and_storage(client, monkeypatch, values):
    _, session, pid = setup_session(client)
    fake = _wire(monkeypatch)
    fake.call('connect', 'guest', {}, {})
    fake.call('feature', 'guest', dict(session_id=session['id'], participant_id=pid,
                                     feature={'second_offset': 0, **values}))
    emitted = fake.eeg_emits()
    assert len(emitted) == 1
    assert emitted[0]['room'] == f"session:{session['id']}"
    assert emitted[0]['namespace'] == '/session-live'
    with _db() as db:
        row = db.query(EEGFeatureWindow).filter_by(session_id=UUID(session['id'])).one()
        for key in BODY:
            assert emitted[0]['data']['feature'][key] == values.get(key)
            assert getattr(row, key) == values.get(key)


def test_rollup_and_report_body_statistics(client):
    host, session, pid = setup_session(client)
    upload(client, session, pid, [
        {'second_offset': 0, **BODY, 'heart_rate': 60, 'respiratory_rate': 12},
        {'second_offset': 1, **dict.fromkeys(BODY)},
        {'second_offset': 2, **BODY, 'heart_rate': 90, 'respiratory_rate': 18},
        {'second_offset': 60, **BODY, 'heart_rate': 90, 'respiratory_rate': 30},
    ])
    other = _join_guest(client, session['access_code'], '제외 참가자')
    upload(client, session, other, [{'second_offset': 0, **BODY, 'heart_rate': 200}])
    expected = dict(heart_rate_mean=80, heart_rate_min=60, heart_rate_max=90,
                    respiratory_rate_mean=20, sdnn_mean=20, rmssd_mean=30,
                    lf_power_mean=120, hf_power_mean=60, lf_hf_ratio_mean=2)
    response = client.get(f"/api/v1/sessions/{session['id']}/eeg-rollup",
                          params={'participant_id': pid}, headers=host['h'])
    assert response.status_code == 200, response.text
    rollup = response.json()
    for key, value in expected.items():
        assert rollup['overall'][key] == value
    assert rollup['buckets'][0]['metrics']['respiratory_rate'] == 15
    assert rollup['overall']['metrics']['respiratory_rate'] == 20
    response = client.post(f"/api/v1/reports/generate/{session['id']}",
                           json={'type': 'client'}, headers=host['h'])
    assert response.status_code == 200, response.text
    report = response.json()
    fetched = client.get(f"/api/v1/reports/{report['id']}", headers=host['h']).json()
    for result in (report, fetched):
        for key, value in expected.items():
            assert result[key] == value
            assert result['content']['eeg'][key] == value
        timeline = result['content']['eeg']['timeline']
        assert [point['respiratory_rate'] for point in timeline] == [12, None, 18, 30]
        assert [point['heart_rate'] for point in timeline] == [60, None, 90, 90]


@pytest.mark.parametrize('with_windows', [False, True])
def test_unmeasured_body_summaries_stay_null(client, with_windows):
    host, session, pid = setup_session(client)
    if with_windows:
        upload(client, session, pid, [{'second_offset': 0}])
    response = client.post(f"/api/v1/reports/generate/{session['id']}",
                           json={'type': 'client'}, headers=host['h'])
    assert response.status_code == 200, response.text
    for key in NEW_SUMMARY:
        assert response.json()[key] is None
