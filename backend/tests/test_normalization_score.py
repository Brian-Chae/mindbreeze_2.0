"""SDD-041 프론트 수식 및 리포트 표준 모델 회귀 검증."""
import math

import pytest

from app.services.normalization_score import sigmoid_score, transform_raw
from app.services import eeg_metrics as em
from tests.test_eeg_metrics import _valid_series


@pytest.mark.parametrize('key,raw,expected', [
    ('faa', -2, 2), ('breathingStability', 70, 70),
    ('focusIndex', 0, math.log(1e-9)), ('focusIndex', -1, None),
    ('sdnn', 0, None), ('avgHeartRate', 0, None),
    ('autonomicStability', 0, None), ('stressIndex', float('nan'), None),
])
def test_transform(key, raw, expected):
    assert transform_raw(key, raw) == expected


@pytest.mark.parametrize('key,raw,params,expected', [
    ('focusIndex', 1, {'m': math.log(1+1e-9), 's': 1, 'direction': 1}, 50),
    ('breathingStability', 1.2815515655446004, {'m': 0, 's': 1, 'direction': 1}, 90),
    ('breathingStability', 1.2815515655446004, {'m': 0, 's': 1, 'direction': -1}, 10),
    ('faa', 0, {'m': 12, 's': 1, 'direction': -1}, 100),
    ('faa', -1, {'m': 12, 's': 1, 'direction': -1}, 50),
    ('faa', 1e200, {'m': 0, 's': 1, 'direction': -1}, 1),
    ('focusIndex', 1e-100, {'m': 100, 's': 1, 'direction': 1}, 1),
    ('focusIndex', None, {'m': 0, 's': 1, 'direction': 1}, None),
    ('focusIndex', 1, {'m': 0, 's': 0, 'direction': 1}, None),
    ('focusIndex', 1, {'m': 0, 's': 1, 'direction': 'bad'}, None),
])
def test_frontend_scores(key, raw, params, expected):
    assert sigmoid_score(key, raw, params) == expected


def test_partial_model_and_metadata():
    series = _valid_series()
    cohort = em.compute_session_metrics(**series)
    model = em.compute_session_metrics(**series, normalization_params={
        'stressIndex': {'m': math.log(2+1e-9), 's': 1, 'direction': -1},
    }, normalization_version=17)
    assert model.stress_score == 50
    assert model.relaxation_score == cohort.relaxation_score
    assert model.normalization_source == 'standard_model'
    assert model.normalization_version == '17'
    assert cohort.normalization_source == 'cohort'
    assert cohort.normalization_version == str(cohort.constants_version)
    assert model.meditation_total_score == round(em.weighted_total(model.as_dict()), 1)


def test_model_preserves_quality_and_missing_raw():
    params = {'totalNeuralActivity': {'m': 0, 's': 1, 'direction': 1}}
    series = _valid_series()
    series['total_neural_activity'] = [None]*50
    result = em.compute_session_metrics(**series, normalization_params=params)
    assert result.total_neural_activity_score is None
    result = em.compute_session_metrics(**_valid_series(10), normalization_params=params)
    assert result.meditation_total_score is None
    assert result.total_neural_activity_score is None


def test_report_active_model_and_serialization():
    from uuid import uuid4
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from app.models.normalization_model import NormalizationModel
    from app.models.eeg_feature import EEGFeatureWindow
    from app.services.report_service import normalize_report_content
    from app.tasks.report_task import _build_eeg_content

    engine = create_engine('sqlite://')
    NormalizationModel.__table__.create(engine)
    EEGFeatureWindow.__table__.create(engine)
    sid = uuid4()
    with Session(engine) as db:
        db.add_all([EEGFeatureWindow(
            session_id=sid, window_index=i, quality='valid', stress_index=2,
            focus_index=1, cognitive_load=2, relaxation_index=0.3,
            emotional_stability=3, total_neural_activity=400, faa=0.1,
        ) for i in range(50)])
        inactive = NormalizationModel(version=99, n_samples=5, is_active=False,
                                      params={'stressIndex': {'m': -20, 's': 1, 'direction': -1}})
        db.add(inactive)
        db.flush()
        cohort = _build_eeg_content(sid, db)
        # SDD-069: is_active가 없으면 가장 최근 모델(version desc)을 기본 적용
        assert cohort['normalization_source'] == 'standard_model'
        model = NormalizationModel(version=17, n_samples=5, is_active=True,
                                   params={'stressIndex': {'m': math.log(2+1e-9), 's': 1, 'direction': -1}})
        db.add(model)
        db.flush()
        result = _build_eeg_content(sid, db)
        assert result['metrics']['stress_score'] == 50
        assert result['normalization_source'] == 'standard_model'
        assert result['normalization_version'] == '17'
        assert result['metrics']['relaxation_score'] == cohort['metrics']['relaxation_score']
        normalized = normalize_report_content({'eeg': result})['eeg']
        assert normalized['normalization_source'] == 'standard_model'
        assert normalized['normalization_version'] == '17'
        assert db.query(EEGFeatureWindow).first().stress_index == 2
        model.is_active = False
        db.flush()
        assert _build_eeg_content(sid, db) == cohort
    engine.dispose()


@pytest.mark.parametrize('key', [
    'focusIndex', 'relaxationIndex', 'stressIndex', 'totalNeuralActivity',
    'cognitiveLoad', 'emotionalStability', 'autonomicStability', 'sdnn', 'avgHeartRate',
])
def test_all_log_metrics_center(key):
    assert sigmoid_score(key, 3, {'m': math.log(3+1e-9), 's': 0.7, 'direction': '1'}) == 50


def test_all_seven_model_scores_and_stability_gate():
    series = _valid_series()
    params = {key: {'m': 0, 's': 0.8, 'direction': -1 if key in ('stressIndex', 'cognitiveLoad', 'faa') else 1}
              for key in ('focusIndex', 'relaxationIndex', 'stressIndex', 'totalNeuralActivity',
                          'cognitiveLoad', 'emotionalStability', 'faa')}
    result = em.compute_session_metrics(**series, normalization_params=params, normalization_version=5)
    for key, raw, target in [
        ('focusIndex', 1.1, 'focus_index_stability_score'),
        ('cognitiveLoad', 2.1, 'cognitive_load_stability_score'),
        ('relaxationIndex', 0.3, 'relaxation_score'),
        ('stressIndex', 2, 'stress_score'),
        ('totalNeuralActivity', 400, 'total_neural_activity_score'),
        ('emotionalStability', 3, 'emotional_stability_score'),
        ('faa', 0.1, 'hemispheric_balance_score'),
    ]:
        assert getattr(result, target) == sigmoid_score(key, raw, params[key])
    gated = em.compute_session_metrics(**series, normalization_params=params, longest_usable_run=10)
    assert gated.focus_index_stability_score is None
    assert gated.cognitive_load_stability_score is None
    assert gated.stress_score == result.stress_score


@pytest.mark.parametrize('params', [None, {}, {'stressIndex': {}},
                                   {'stressIndex': {'m': 0, 's': -1, 'direction': -1}}])
def test_missing_or_invalid_model_preserves_cohort(params):
    assert em.compute_session_metrics(**_valid_series(), normalization_params=params).as_dict() == em.compute_session_metrics(**_valid_series()).as_dict()


def test_raw_is_not_rounded_before_model_score():
    series = _valid_series()
    series['relaxation_index'] = [0.300049]*50
    params = {'m': math.log(0.300049+1e-9), 's': 0.00001, 'direction': 1}
    result = em.compute_session_metrics(**series, normalization_params={'relaxationIndex': params})
    assert result.relaxation_score == 50
    assert result.relaxation_index_mean == 0.3
