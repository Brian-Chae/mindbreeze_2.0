"""SDD-036 집단 정규화 API 및 집계 회귀 검증."""

import json
import uuid
from math import log
from types import SimpleNamespace

import pytest

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User

ROOT = '/api/v1/normalization'
KEYS = ('focusIndex', 'relaxationIndex', 'stressIndex', 'totalNeuralActivity',
        'faa', 'cognitiveLoad', 'emotionalStability', 'autonomicStability',
        'sdnn', 'avgHeartRate', 'breathingStability')


def authenticate(client, role='platform_admin'):
    uid = uuid.uuid4()
    dependency = client.app.dependency_overrides[get_db]()
    db = next(dependency)
    db.add(User(id=uid, email=f'{uid}@example.com', password_hash='unused', name='테스트', role=role))
    db.commit()
    dependency.close()
    client.app.dependency_overrides[get_current_user] = lambda: {'id': str(uid)}
    return str(uid)


def payload(value=1):
    return {'closed': dict.fromkeys(KEYS, value), 'open': dict.fromkeys(KEYS, value),
            'gender': 'female', 'birth_date': '1990-01-01', 'device_id': 'band',
            'pipeline_version': 'v1'}


def test_baseline_model_lifecycle(client):
    uid = authenticate(client)
    assert client.get(f'{ROOT}/models/active').json() == {'active': None}
    assert client.post(f'{ROOT}/models/compute').status_code == 400
    ids = []
    for value in range(1, 6):
        res = client.post(f'{ROOT}/baselines', json=payload(value))
        assert res.status_code == 201, res.text
        assert res.json()['user_id'] == uid
        assert res.json()['closed'] == payload(value)['closed']
        assert res.json()['birth_date'] == '1990-01-01'
        ids.append(res.json()['id'])
    assert len(client.get(f'{ROOT}/baselines').json()['items']) == 5
    first = client.post(f'{ROOT}/models/compute')
    assert first.status_code == 201, first.text
    first = first.json()
    assert first['version'] == 1 and first['n_samples'] == 5
    assert first['is_active'] is False
    assert len(first['params']) == 11
    assert first['params']['faa'] == {'m': 3.0, 's': 1.4826, 'direction': -1}
    second = client.post(f'{ROOT}/models/compute').json()
    assert second['version'] == 2
    for mid in [first['id'], second['id'], second['id']]:
        assert client.post(f'{ROOT}/models/{mid}/activate').json()['active']['id'] == mid
    assert client.post(f'{ROOT}/models/99999/activate').status_code == 404
    assert client.get(f'{ROOT}/models/active').json()['active']['id'] == second['id']
    models = client.get(f'{ROOT}/models').json()['items']
    assert [m['version'] for m in models] == [2, 1]
    assert sum(m['is_active'] for m in models) == 1
    assert client.delete(f'{ROOT}/baselines/{ids[0]}').json() == {'ok': True}
    assert client.delete(f'{ROOT}/baselines/{ids[0]}').status_code == 404
    assert client.post(f'{ROOT}/models/compute').status_code == 400


@pytest.mark.parametrize('role', ['counselor', 'client', 'org_admin'])
def test_all_endpoints_require_platform_admin(client, role):
    authenticate(client, role)
    for method, path in [('get', '/baselines'), ('post', '/baselines'),
                         ('delete', '/baselines/1'), ('get', '/models'),
                         ('post', '/models/compute'), ('get', '/models/active'),
                         ('post', '/models/1/activate'), ('get', '/active'),
                         ('post', '/baselines/1/activate')]:
        kwargs = {'json': payload()} if path == '/baselines' and method == 'post' else {}
        assert getattr(client, method)(ROOT + path, **kwargs).status_code == 403


def test_unauthenticated(client):
    assert client.get(f'{ROOT}/models/active').status_code == 401


@pytest.mark.parametrize('invalid', [float('nan'), float('inf'), -float('inf'), True, '1'])
def test_invalid_metrics_return_serializable_422(client, invalid):
    authenticate(client)
    body = payload()
    body['closed']['sdnn'] = invalid
    response = client.post(f'{ROOT}/baselines', content=json.dumps(body),
                           headers={'Content-Type': 'application/json'})
    assert response.status_code == 422, response.text
    assert response.json()['detail']
    assert client.get(f'{ROOT}/baselines').json() == {'items': []}


def test_null_and_legacy_metrics(client):
    authenticate(client)
    body = payload(None)
    for side in ('closed', 'open'):
        for key in KEYS[7:]:
            del body[side][key]
    response = client.post(f'{ROOT}/baselines', json=body)
    assert response.status_code == 201
    assert response.json()['closed'] == dict.fromkeys(KEYS)


def test_distribution_transforms_and_invalid_samples():
    from app.services.normalization_distribution import compute_distribution
    rows = [SimpleNamespace(closed={key: v for key in KEYS}, open={}) for v in (1, 2, 3)]
    params = compute_distribution(rows)
    assert params['focusIndex']['m'] == pytest.approx(log(2 + 1e-9))
    assert params['focusIndex']['s'] == pytest.approx(1.4826 * log((3 + 1e-9) / (2 + 1e-9)))
    assert params['breathingStability'] == {'m': 2., 's': 1.4826, 'direction': 1}
    assert params['avgHeartRate']['direction'] == -1
    contaminated = rows + [SimpleNamespace(closed={'sdnn': v}, open={}) for v in (0, -1, True, None, float('inf'), float('nan'))]
    assert compute_distribution(contaminated)['sdnn'] == params['sdnn']
    assert compute_distribution([SimpleNamespace(closed={'faa': -1}, open={'faa': -3})])['faa'] == {'m': 2., 's': 1.4826, 'direction': -1}
    assert compute_distribution([SimpleNamespace(closed={'focusIndex': 1}, open={'focusIndex': 1})]) == {}


def test_active_baseline_compatibility(client):
    authenticate(client)
    assert client.get(f'{ROOT}/active').json() == {'active': None}
    first = client.post(f'{ROOT}/baselines', json=payload(1)).json()['id']
    second = client.post(f'{ROOT}/baselines', json=payload(2)).json()['id']
    for bid in (first, second, second):
        response = client.post(f'{ROOT}/baselines/{bid}/activate')
        assert response.status_code == 200, response.text
        assert response.json()['active']['id'] == bid
    assert client.post(f'{ROOT}/baselines/99999/activate').status_code == 404
    assert client.get(f'{ROOT}/active').json()['active']['id'] == second
    assert sum(row['is_active'] for row in client.get(f'{ROOT}/baselines').json()['items']) == 1
    assert client.delete(f'{ROOT}/baselines/{second}').status_code == 200
    assert client.get(f'{ROOT}/active').json() == {'active': None}
