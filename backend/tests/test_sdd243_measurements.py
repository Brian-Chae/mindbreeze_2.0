"""SDD-243 B04 — 파형·feature·표시값·PSD: 예산, gap 비연결, legacy 시간 불명, 재구성 금지, Welch 정확도.

244 T06(manifest)/T12 가 연결되기 전이므로 계약 기반 fake backend 를 주입한다(실제 연결 인수는 T06 이후).
"""
import math
from fractions import Fraction
from uuid import uuid4

import pytest

from app.api.v1 import data_center as api
from app.main import app
from app.schemas import data_center as dc
from app.services import data_center_measurement as dm
from tests.sdd243_helpers import auth, db, dc_enabled, mk_part, add_features, world  # noqa: F401

BASE = '/api/v1/data-center'
RATE = 250


class Sample:
    def __init__(self, idx, rel_us, values, basis='session_relative', channels=('fp1', 'fp2')):
        self.sample_index, self.relative_us, self.values = idx, rel_us, values
        self.time_basis, self.channels, self.null_reasons = basis, channels, {}


def sine(freq, amp, idx):
    return amp * math.sin(2 * math.pi * freq * idx / RATE)


class FakeBackend:
    """chunk 하나 = 1초(250샘플). 읽은 chunk 수를 센다."""

    def __init__(self, manifest, make_samples):
        self.manifest, self._make = manifest, make_samples
        self.reads: list[int] = []

    def get_manifest(self, session_id, participant_id, revision=None):
        return self.manifest

    def fetch(self, chunk):
        self.reads.append(chunk.chunk_index)
        return b''

    def decode(self, payload, chunk):
        return self._make(chunk)


def stream(signal='eeg', rate=RATE, unit='uV', channels=('fp1', 'fp2')):
    return dm.StreamInfo(stream_id='S01', segment_id='G01', signal=signal, rate_hz=float(rate), observed_rate_hz=None,
                         channels=channels, units=tuple(unit for _ in channels), time_basis='session_relative')


def chunk_ref(i, seg='G01', offset_s=0, signal='eeg', known=True):
    first = i * RATE
    start = int((offset_s + i) * 1_000_000)
    return dm.ChunkRef(signal=signal, stream_id='S01', segment_id=seg, chunk_index=i, first_sample_index=first,
                       end_sample_index_exclusive=first + RATE, start_us=start if known else None,
                       end_us=start + 1_000_000 if known else None, meta={'seg': seg, 'offset_s': offset_s})


def build_manifest(chunks, *, close_state='complete', signals=None, gaps=(), streams=None):
    sig = {'eeg': ('available', None), 'ppg': ('unsupported_client', 'old_app'), 'acc': ('not_collected', 'band_not_used')}
    sig.update(signals or {})
    return dm.ManifestView(revision=2, close_state=close_state, default_view='participant_player', signals=sig,
                           streams=tuple(streams or [stream()]), chunks=tuple(chunks), gaps=tuple(gaps))


def eeg_maker(freq=10.0, amp=5.0, known_time=True):
    def make(chunk):
        out = []
        base_s = chunk.meta['offset_s']
        for k in range(RATE):
            idx = chunk.first_sample_index + k
            rel = Fraction(int(base_s * 1_000_000)) + Fraction(idx * 1_000_000, RATE) if known_time else None
            out.append(Sample(idx, rel, (sine(freq, amp, idx), sine(freq, amp / 2, idx)),
                              'session_relative' if known_time else 'unknown'))
        return out
    return make


@pytest.fixture
def backend_env(client, world, dc_enabled):
    holder = {}

    def install(backend):
        holder['b'] = backend
        app.dependency_overrides[api.backend_dep] = lambda: backend
        return backend

    yield install
    app.dependency_overrides.pop(api.backend_dep, None)


def wf(client, w, signal='eeg', part=None, sess=None, user=None, **params):
    part = part or w.p_a1_c
    sess = sess or w.s_a1
    q = {'signal_type': signal, **{k: str(v) for k, v in params.items()}}
    return client.get(f'{BASE}/measurements/{sess.id}/{part.id}/waveform', params=q, headers=auth(user or w.admin_a))


def two_segment_backend():
    # 구간1: 0~20초(chunk 0..19), 구간2: 30~40초(offset 30초) — 20~30초는 끊김
    chunks = [chunk_ref(i) for i in range(20)] + [chunk_ref(i, seg='G02', offset_s=30) for i in range(10)]
    gaps = [dm.GapRange(start_us='20000000', end_us='30000000', reason='ble_disconnect', observed_or_estimated='observed')]
    return FakeBackend(build_manifest(chunks, gaps=gaps), eeg_maker())


# ── 파형 ────────────────────────────────────────────────────────────────

def test_waveform_budget_and_gap(client, world, backend_env):
    backend = backend_env(two_segment_backend())
    r = wf(client, world)  # 기본 max_points=2000 → 40초 구간은 envelope
    assert r.status_code == 200, r.text
    body = r.json()
    assert body['method'] == 'minmax_envelope' and body['max_points'] == 2000
    ch = body['channels'][0]
    assert len(ch['min']) + len(ch['max']) <= 2000 and len(ch['min']) == len(body['t_us']) == body['returned_count']
    assert body['source_sample_count'] == 30 * RATE  # 읽은 원천 샘플 수(구간 안 전체)
    assert body['availability'] == 'available' and body['manifest_revision'] == 2
    assert body['nominal_rate_hz'] == 250.0 and body['time_basis'] == 'session_relative'
    # gap 은 연결·보간하지 않는다: 20~30초 버킷은 null, segment 는 둘로 나뉜다
    t = [int(x) for x in body['t_us']]
    inside_gap = [i for i, x in enumerate(t) if 20_000_000 <= x < 30_000_000 - 40_000]
    assert inside_gap and all(ch['min'][i] is None and ch['max'][i] is None for i in inside_gap)
    assert len(body['segments']) == 2 and body['segments'][0]['segment_id'] == 'G01'
    assert body['segments'][0]['point_end'] <= body['segments'][1]['point_start']
    assert any(g['reason'] == 'ble_disconnect' for g in body['gaps'])
    # envelope 극값은 원시 극값을 보존한다
    assert max(v for v in ch['max'] if v is not None) == pytest.approx(5.0, abs=0.05)

    # 좁은 구간은 원본 샘플, 해당 구간 chunk 만 읽는다
    backend.reads.clear()
    narrow = wf(client, world, from_us=0, to_us=2_000_000).json()
    assert narrow['method'] == 'raw' and narrow['returned_count'] == 2 * RATE == len(narrow['channels'][0]['values'])
    assert narrow['t_us'][0] == '0' and narrow['t_us'][1] == '4000'  # 250Hz = 4000us (누적 반올림 없음)
    assert sorted(backend.reads) == [0, 1]
    assert narrow['channels'][0]['values'][1] == pytest.approx(sine(10, 5, 1))
    # [from,to) 반개구간: to 시각 샘플은 제외
    edge = wf(client, world, from_us=0, to_us=4000).json()
    assert edge['returned_count'] == 1
    assert wf(client, world, max_points=4001).status_code == 422
    assert wf(client, world, max_points=4000, from_us=0, to_us=40_000_000).json()['channels'][0]['min'].__len__() <= 2000
    assert wf(client, world, from_us=5, to_us=5).status_code == 422
    assert wf(client, world, signal='bogus').status_code == 422


def test_waveform_scope_is_enforced(client, world, backend_env):
    backend_env(two_segment_backend())
    for sess, part in ((world.s_b1, world.p_b1_c), (world.s_solo, world.p_solo), (world.s_a1, world.p_b1_c),
                       (world.s_clinical, world.p_clin)):
        assert wf(client, world, sess=sess, part=part).status_code == 404
    assert client.get(f'{BASE}/measurements/{uuid4()}/{uuid4()}/waveform?signal_type=eeg',
                      headers=auth(world.admin_a)).status_code == 404
    assert wf(client, world, sess=world.s_b1, part=world.p_b1_c, user=world.platform).status_code == 200
    assert wf(client, world, user=world.counselor).status_code == 403


def test_signal_availability_and_manifest_states(client, world, backend_env):
    backend_env(two_segment_backend())
    ppg = wf(client, world, signal='ppg').json()
    assert ppg['availability'] == 'unsupported_client' and ppg['method'] == 'none' and ppg['channels'] == []
    assert ppg['unavailable_reason'] == 'old_app'
    acc = wf(client, world, signal='acc').json()
    assert acc['availability'] == 'not_collected' and acc['t_us'] == []  # 0 값 파형을 만들지 않는다
    backend_env(FakeBackend(None, eeg_maker()))
    none = wf(client, world).json()
    assert none['availability'] == 'unknown' and none['unavailable_reason'] == 'manifest_not_connected'
    backend_env(FakeBackend(build_manifest([chunk_ref(0)], close_state='pending_upload'), eeg_maker()))
    pending = wf(client, world)
    assert pending.status_code == 409 and pending.json()['detail']['code'] == 'manifest_pending'
    backend_env(FakeBackend(build_manifest([chunk_ref(0)], close_state='partial'), eeg_maker()))
    assert wf(client, world, from_us=0, to_us=1_000_000).json()['availability'] == 'available'  # 명시적 partial 은 열람 허용


def test_legacy_time_unknown(client, world, backend_env):
    backend_env(FakeBackend(build_manifest([chunk_ref(0, known=False)]), eeg_maker(known_time=False)))
    body = wf(client, world, from_us=0, to_us=1_000_000).json()
    assert body['availability'] == 'unknown' and body['unavailable_reason'] == 'legacy_time_origin_unknown'
    assert body['method'] == 'none' and body['t_us'] == [] and body['channels'] == []
    assert body['time_basis'] == 'unknown'


def test_waveform_unknown_decoder_blocks_not_zero_fill(client, world, backend_env):
    backend_env(FakeBackend(build_manifest([chunk_ref(0)]), eeg_maker()))
    app.dependency_overrides[api.backend_dep] = lambda: dm.NullBackend()
    body = wf(client, world).json()
    assert body['availability'] == 'unknown' and body['unavailable_reason'] == 'manifest_not_connected'


def test_overlap_and_index_gap_not_connected(client, world, backend_env):
    # chunk 0 다음 chunk 2(1 건너뜀) → 샘플 인덱스 불연속은 끊김으로 표시, 보간 없음
    chunks = [chunk_ref(0), chunk_ref(2)]
    backend_env(FakeBackend(build_manifest(chunks), eeg_maker()))
    body = wf(client, world, from_us=0, to_us=3_000_000).json()
    assert body['method'] == 'raw' and len(body['segments']) == 2 and body['returned_count'] == 2 * RATE
    assert any(g['reason'] == 'sample_index_gap' for g in body['gaps'])


# ── feature ─────────────────────────────────────────────────────────────

def test_features_preserve_nulls_and_values(client, world, db, backend_env):
    from app.models.eeg_feature import EEGFeatureWindow
    for i in range(5):
        db.add(EEGFeatureWindow(session_id=world.s_a1.id, participant_id=world.p_a1_c.id, window_index=i,
                                quality='valid' if i else 'invalid', focus_index=0.123456789012345 + i,
                                total_neural_activity=None, faa=-0.5 if i == 2 else None, sdnn=41.0,
                                device_timestamp_ms=1_000_000.0 + i * 1000))
    db.commit()
    url = f'{BASE}/measurements/{world.s_a1.id}/{world.p_a1_c.id}/features'
    r = client.get(url, params={'limit': 2}, headers=auth(world.admin_a)).json()
    assert r['detail_emit'] == 'not_connected' and r['total'] == 5 and r['time_origin'] == 'first_feature_window'
    first = r['items'][0]
    assert first['source'] == 'scalar_1hz' and first['quality'] == 'invalid' and first['t_rel_ms'] == 0
    assert first['values']['focus_index'] == 0.123456789012345  # 원 float 보존
    assert first['values']['total_neural_activity'] is None  # null 을 0 으로 채우지 않는다
    assert 'rmssd' in first['values'] and first['values']['rmssd'] is None
    assert len(first['values']) >= 25
    seen = [i['window_index'] for i in r['items']]
    cursor = r['next_cursor']
    while cursor:
        page = client.get(url, params={'limit': 2, 'cursor': cursor}, headers=auth(world.admin_a)).json()
        seen += [i['window_index'] for i in page['items']]
        cursor = page['next_cursor']
    assert seen == [0, 1, 2, 3, 4]
    ranged = client.get(url, params={'from_us': 2_000_000, 'to_us': 4_000_000}, headers=auth(world.admin_a)).json()
    assert [i['window_index'] for i in ranged['items']] == [2, 3]
    assert client.get(f'{BASE}/measurements/{world.s_b1.id}/{world.p_b1_c.id}/features',
                      headers=auth(world.admin_a)).status_code == 404


# ── 표시 지표 ───────────────────────────────────────────────────────────

def test_indices_not_reconstructed(client, world, db, backend_env):
    add_features(db, world.s_a1, world.p_a1_c, 3)  # focus_index=1.5 가 있어도 표시값으로 재구성하지 않는다
    db.commit()
    url = f'{BASE}/measurements/{world.s_a1.id}/{world.p_a1_c.id}/indices'
    backend_env(FakeBackend(None, eeg_maker()))
    body = client.get(url, headers=auth(world.admin_a)).json()
    assert body['view'] == 'unavailable' and len(body['items']) == 3
    row = body['items'][0]
    for key in ('focus', 'relaxation', 'emotional_balance', 'bpm', 'respiration', 'hrv_sdnn_ms'):
        assert row[key]['value'] is None and row[key]['status'] == 'display_history_missing'
        assert row[key]['source'] == 'none'
    assert 'rmssd' not in str(body) and 'overall' not in str(body) and 'score' not in str(body)

    # 244 snapshot 이 있으면 표시 정수·출처·provenance 를 그대로 통과시킨다(재계산·반올림 없음)
    class Snap:
        def indices(self, session_id, participant_id, revision, cursor, limit):
            m = lambda v, st='snapshot', src='participant_player', reason=None: dc.IndexMetric(value=v, status=st, source=src, reason=reason)
            rows = [dc.IndexRow(t_rel_ms=0, focus=m(62), relaxation=m(48), emotional_balance=m(None, 'null', 'participant_player', 'gate'),
                                bpm=m(71), respiration=m(None, 'insufficient_window', 'none', '첫 60초'),
                                hrv_sdnn_ms=m(44), model_version='disp-1')]
            return 'participant_player', rows, None
    backend = FakeBackend(build_manifest([chunk_ref(0)]), eeg_maker())
    backend.indices = Snap().indices
    backend_env(backend)
    snap = client.get(url, headers=auth(world.admin_a)).json()
    assert snap['view'] == 'participant_player'
    item = snap['items'][0]
    assert item['focus']['value'] == 62 and item['hrv_sdnn_ms']['value'] == 44
    assert item['emotional_balance']['status'] == 'null' and item['respiration']['status'] == 'insufficient_window'
    assert client.get(f'{BASE}/measurements/{world.s_b1.id}/{world.p_b1_c.id}/indices',
                      headers=auth(world.admin_a)).status_code == 404


# ── PSD ─────────────────────────────────────────────────────────────────

def test_welch_sine_density():
    fs, amp, freq = 250.0, 5.0, 10.0
    x = [sine(freq, amp, i) for i in range(int(10 * fs))]
    freqs, psd = dm.welch_psd(x, fs)
    df = freqs[1] - freqs[0]
    assert df == pytest.approx(0.5)  # 2초 창
    peak = max(range(len(psd)), key=lambda i: psd[i])
    assert abs(freqs[peak] - freq) <= df
    power = sum(psd) * df
    assert power == pytest.approx(amp ** 2 / 2, rel=0.05)  # A^2/2 = 12.5 uV^2
    # 평균 제거: DC 오프셋은 파워에 영향을 주지 않는다
    freqs2, psd2 = dm.welch_psd([v + 100.0 for v in x], fs)
    assert sum(psd2) * df == pytest.approx(power, rel=0.01)


def test_spectrum_endpoint_rules(client, world, backend_env):
    backend_env(two_segment_backend())
    url = f'{BASE}/measurements/{world.s_a1.id}/{world.p_a1_c.id}/spectrum'

    def spec(**params):
        return client.get(url, params={k: str(v) for k, v in params.items()}, headers=auth(world.admin_a))

    ok = spec(from_us=0, to_us=10_000_000).json()
    assert ok['computable'] is True and ok['method'] == 'dc-welch-v1' and ok['unit'] == 'uV2/Hz'
    assert [c['name'] for c in ok['channels']] == ['fp1', 'fp2']
    fp1 = ok['channels'][0]['psd']
    peak = max(range(len(fp1)), key=lambda i: fp1[i])
    assert abs(ok['freq_hz'][peak] - 10.0) <= 0.5
    short = spec(from_us=0, to_us=1_000_000).json()
    assert short['computable'] is False and short['reason'] == 'range_too_short' and short['channels'] == []
    assert spec(from_us=0, to_us=31_000_000).json()['reason'] == 'range_too_long'
    assert spec(from_us=15_000_000, to_us=25_000_000).json()['reason'] == 'gap_in_range'  # 20~30초 끊김
    assert spec(from_us=0).status_code == 422 and spec().status_code == 422
    backend_env(FakeBackend(build_manifest([chunk_ref(0, known=False)]), eeg_maker(known_time=False)))
    assert spec(from_us=0, to_us=5_000_000).json()['reason'] == 'time_axis_unknown'
    backend_env(FakeBackend(None, eeg_maker()))
    assert spec(from_us=0, to_us=5_000_000).json()['reason'] == 'manifest_not_connected'
    assert client.get(f'{BASE}/measurements/{world.s_b1.id}/{world.p_b1_c.id}/spectrum',
                      params={'from_us': 0, 'to_us': 5_000_000}, headers=auth(world.admin_a)).status_code == 404


# ── 244 통합 후에만 실행되는 실제 디코더 결합 검증(T03 소비) ────────────────

def test_real_decoder_binding_with_golden_fixture():
    """244 의 biosignal_decoder 와 G1 golden 이 트리에 들어온 뒤(통합) 실제 디코더로 파형 경로를 검증한다."""
    import csv
    import hashlib
    import json
    import struct
    from pathlib import Path

    decoder = pytest.importorskip('app.services.biosignal_decoder')
    schema = pytest.importorskip('app.schemas.biosignal')
    fixtures = Path(__file__).resolve().parents[2] / 'specs/sdd-244-biosignal-raw-pipeline/contracts/fixtures'
    if not (fixtures / 'eeg-raw-v2.bin').exists():
        pytest.skip('244 golden fixture 미통합')
    payload = (fixtures / 'eeg-raw-v2.bin').read_bytes()
    length = struct.unpack_from('<I', payload, 8)[0]
    header = json.loads(payload[12:12 + length])
    meta = schema.RawChunkMeta(session_id=uuid4(), participant_id=uuid4(), play_group_id=None, chunk_id=uuid4(), header=header,
                               checksum=hashlib.sha256(payload).hexdigest(), size_bytes=len(payload),
                               object_key='synthetic.bin', object_version_id=None)
    ref = dm.ChunkRef(signal='eeg', stream_id='S01', segment_id='G01', chunk_index=0, first_sample_index=0,
                      end_sample_index_exclusive=header['sample_count'], start_us=0,
                      end_us=int(header['sample_count'] * 1_000_000 / 250), meta=meta)

    class Real:
        def get_manifest(self, *_):
            return build_manifest([ref], streams=[stream()])

        def fetch(self, chunk):
            return payload

        def decode(self, data, chunk):
            return decoder.decode_raw_chunk(data, chunk.meta)

    sel = dc.MeasurementSelection(session_id=uuid4(), participant_id=uuid4())
    out = dm.read_waveform(Real(), sel, 'eeg', 2000)
    expected = list(csv.DictReader(open(fixtures / 'eeg-expected.csv')))
    assert out.method == 'raw' and out.returned_count == len(expected)
    assert out.t_us == [str(round(float(r['timestamp']) * 1_000_000)) for r in expected]
    for ci, name in enumerate(('fp1', 'fp2')):
        assert out.channels[ci].values == pytest.approx([float(r[name]) for r in expected], rel=1e-6, abs=1e-6)
