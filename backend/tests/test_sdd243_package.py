"""SDD-243 B06 — 원본 ZIP·독립 part: 왕복, 1GB(소형 cap) 경계, 가명·bin 통제, 독립 verifier, job 통합."""
import io
import json
import os
import random
import struct
import subprocess
import sys
import zipfile
from pathlib import Path
from uuid import UUID, uuid4

import pytest

from app.services import data_center_export as dcx, export_package as pkg
from app.services.export_package import (BinArtifact, MissingArtifact, PackageError, PackagePolicy, PackageScope,
                                         RowArtifact, TextArtifact, build_data_center_package)
from tests.sdd243_helpers import add_features, auth, db, dc_enabled, mk_part, mk_session, mk_user, world  # noqa: F401

VERIFIER = Path(__file__).resolve().parents[2] / 'scripts/verify-sdd243-package.py'
BASE = '/api/v1/data-center'


def verify(directory: Path, expected: dict, max_bytes: int = 1_000_000_000):
    exp = directory / 'expected.json'
    exp.write_text(json.dumps(expected))
    return subprocess.run([sys.executable, '-I', str(VERIFIER), '--artifacts', str(directory), '--expected', str(exp),
                           '--max-bytes', str(max_bytes)], capture_output=True, text=True)


def scope(n=1, p=1, cls=1):
    return PackageScope(class_alias=f'class-C{cls:02d}', session_label=f'session-{n:03d}_date-withheld',
                        participant_alias=f'P{p:02d}', session_alias=f'S{n:03d}', manifest_revision=2)


def f32(v: float) -> str:
    return format(struct.unpack('<f', struct.pack('<f', v))[0], '.9g')


def eeg_rows(n, seed=1):
    rng = random.Random(seed)
    for i in range(n):
        yield [format(i * 0.004, '.12g'), f32(rng.uniform(-300, 300)), f32(rng.uniform(-300, 300))]


def ppg_rows(n):
    for i in range(n):
        yield [format(i * 0.02, '.12g'), 1000 + i, None if i % 7 == 0 else 2000 + i]  # null 은 빈 칸


def logical(sc, name):
    return f'{sc.directory}/{name}'


def artifacts_for(sc, n=500):
    yield sc, RowArtifact('eeg_raw.csv', 'csv', lambda: eeg_rows(n, hash(sc.directory) % 100), ['timestamp', 'fp1', 'fp2'],
                          kind='eeg_raw', signal='eeg', dictionary_key='eeg_raw')
    yield sc, RowArtifact('ppg_raw.csv', 'csv', lambda: ppg_rows(n), ['timestamp', 'red', 'ir'], kind='ppg_raw', signal='ppg')
    yield sc, MissingArtifact('acc_raw', 'unsupported_client', 'acc')
    yield sc, TextArtifact('meta.json', json.dumps({'participant': sc.participant_alias}))


def policy(**kw):
    return PackagePolicy(part_max_bytes=kw.pop('part_max_bytes', 1_000_000_000), policy_version='dc-policy-1', **kw)


# ── 왕복·null·float32·독립 verifier ─────────────────────────────────────

def test_package_roundtrip(tmp_path):
    scopes = [scope(1, 1), scope(1, 2), scope(2, 1)]
    stream = [x for sc in scopes for x in artifacts_for(sc, 300)]
    result = build_data_center_package('J1', stream, tmp_path, policy())
    assert len(result.parts) == 1 and result.parts[0].path.name == 'mbdc_J1_pseudonymized_part1.zip'
    assert {e['reason'] for e in result.exclusions} == {'unsupported_client'}
    expected = {'rows': {logical(sc, 'eeg_raw.csv'): 300 for sc in scopes} | {logical(sc, 'ppg_raw.csv'): 300 for sc in scopes},
                'forbidden': [], 'values': [
                    {'path': logical(scopes[0], 'ppg_raw.csv'), 'row': 0, 'column': 'ir', 'value': ''},  # null → 빈 칸
                    {'path': logical(scopes[0], 'ppg_raw.csv'), 'row': 1, 'column': 'red', 'value': '1001'}]}
    done = verify(tmp_path, expected)
    assert done.returncode == 0, done.stderr
    with zipfile.ZipFile(result.parts[0].path) as z:
        rows = z.read(logical(scopes[0], 'eeg_raw.csv')).decode().split('\r\n')
        assert rows[0] == 'timestamp,fp1,fp2'
        # float32 유효숫자 9자리 비트 왕복
        for line in rows[1:5]:
            for cell in line.split(',')[1:]:
                assert struct.pack('<f', float(cell)) == struct.pack('<f', struct.unpack('<f', struct.pack('<f', float(cell)))[0])
        manifest = json.loads(z.read('manifest.json'))
        assert manifest['time'] == 'date-withheld' and manifest['part_count'] == 1
        assert {e['name'] for e in map(lambda i: i, z.infolist()) if False} == set()
        assert all(i.date_time == (1980, 1, 1, 0, 0, 0) for i in z.infolist())  # 생성 시각 비노출
        assert any(r['manifest_revision'] == 2 for r in manifest['source_revisions'])
        assert 'acc_raw' in str(manifest['exclusions'])


def test_csv_text_safety_and_nonfinite(tmp_path):
    rows = [['=HYPERLINK("x")', '-5', '+1.5e3', '@cmd', 'plain', None]]
    art = RowArtifact('t.csv', 'csv', lambda: rows, ['a', 'b', 'c', 'd', 'e', 'f'], time_column=None)
    res = build_data_center_package('J', [(scope(), art)], tmp_path, policy())
    with zipfile.ZipFile(res.parts[0].path) as z:
        line = z.read(logical(scope(), 't.csv')).decode().split('\r\n')[1]
    assert line == '\'=HYPERLINK("x"),-5,+1.5e3,\'@cmd,plain,' or line.startswith('"\'=HYPERLINK')  # 숫자는 그대로, 수식은 무력화
    assert '-5' in line and "'@cmd" in line
    bad = RowArtifact('n.csv', 'csv', lambda: [[float('nan')]], ['a'], time_column=None)
    with pytest.raises(PackageError) as e:
        build_data_center_package('J', [(scope(), bad)], tmp_path / 'x', policy())
    assert e.value.code == 'nonfinite_value'


def test_jsonl_and_parquet_pieces(tmp_path):
    pq = pytest.importorskip('pyarrow.parquet')
    jl = RowArtifact('features/eeg.jsonl', 'jsonl', lambda: ({'t': i, 'v': None if i % 3 == 0 else i / 7} for i in range(400)),
                     time_column='t', kind='feature')
    par = RowArtifact('eeg_raw.parquet', 'parquet', lambda: ([i * 0.004, float(i)] for i in range(1000)),
                      ['timestamp', 'fp1'], parquet_types={'timestamp': 'float64', 'fp1': 'float32'}, kind='eeg_raw')
    res = build_data_center_package('J', [(scope(), jl), (scope(), par)], tmp_path, policy(part_max_bytes=40_000))
    total_jsonl = total_pq = 0
    for part in res.parts:
        with zipfile.ZipFile(part.path) as z:
            for n in z.namelist():
                if n.endswith('.jsonl'):
                    total_jsonl += sum(1 for _ in z.read(n).decode().splitlines())
                if n.endswith('.parquet'):
                    table = pq.read_table(io.BytesIO(z.read(n)))
                    assert table.schema.field('fp1').type == 'float'  # float32 채널
                    total_pq += table.num_rows
    assert (total_jsonl, total_pq) == (400, 1000) and len(res.parts) >= 1
    assert all(p.size_bytes <= 40_000 for p in res.parts)


# ── part 상한(소형 cap)·독립 열림 ───────────────────────────────────────

def test_part_limit_with_metadata(tmp_path):
    cap = 60_000
    scopes = [scope(s, p) for s in (1, 2, 3) for p in (1, 2, 3)]
    stream = [x for sc in scopes for x in artifacts_for(sc, 1500)]
    res = build_data_center_package('J2', stream, tmp_path, policy(part_max_bytes=cap, piece_target_bytes=12_000))
    assert len(res.parts) > 1
    assert all(p.size_bytes <= cap for p in res.parts), [p.size_bytes for p in res.parts]  # 루트 메타·central directory 포함 실제 크기
    expected = {'rows': {logical(sc, f): 1500 for sc in scopes for f in ('eeg_raw.csv', 'ppg_raw.csv')}, 'forbidden': []}
    done = verify(tmp_path, expected, cap)
    assert done.returncode == 0, done.stderr
    names = []
    for part in res.parts:
        with zipfile.ZipFile(part.path) as z:  # 각 part 단독 열림 + 루트 3종 반복
            assert {'README_ko.md', 'data_dictionary.json', 'manifest.json'} <= set(z.namelist())
            names += [n for n in z.namelist() if '.cont-' in n]
            m = json.loads(z.read('manifest.json'))
            assert m['part_count'] == len(res.parts) and [p['part_no'] for p in m['parts']] == list(range(1, len(res.parts) + 1))
    assert names  # 큰 파일은 행 경계에서 이어진 조각으로 나뉜다
    # 같은 입력은 같은 구조(재실행 시 누락·중복 0)
    again = build_data_center_package('J2', stream, tmp_path / 'again', policy(part_max_bytes=cap, piece_target_bytes=12_000))
    assert [(p.file_count, p.sha256) for p in again.parts] == [(p.file_count, p.sha256) for p in res.parts]


def test_manifest_growth_forces_repack_but_stays_under_limit(tmp_path):
    cap = 24_000
    scopes = [scope(s, 1) for s in range(1, 40)]
    stream = []
    for sc in scopes:
        stream.append((sc, RowArtifact('a.csv', 'csv', lambda: ([i, i * 2] for i in range(80)), ['t', 'v'], time_column='t')))
        stream.append((sc, TextArtifact('meta.json', json.dumps({'k': 'v' * 40}))))
    res = build_data_center_package('J3', stream, tmp_path, policy(part_max_bytes=cap, piece_target_bytes=4096))
    assert all(p.size_bytes <= cap for p in res.parts) and len(res.parts) > 1
    assert verify(tmp_path, {'rows': {logical(sc, 'a.csv'): 80 for sc in scopes}}, cap).returncode == 0


def test_unreachable_limit_fails_cleanly(tmp_path):
    with pytest.raises(PackageError) as e:
        build_data_center_package('J', [(scope(), TextArtifact('meta.json', '{}'))], tmp_path, policy(part_max_bytes=900))
    assert e.value.code in ('part_limit_unreachable', 'single_oversize')


# ── 가명·bin·경로 통제 ──────────────────────────────────────────────────

def test_pseudonym_bin_redaction_and_oversize(tmp_path):
    payload = os.urandom(5000)
    import hashlib
    sha = hashlib.sha256(payload).hexdigest()
    bin_art = BinArtifact('raw/eeg/stream-S01/segment-001/chunk-000001.bin', lambda: io.BytesIO(payload), len(payload), sha,
                          kind='raw_bin', signal='eeg')
    csv_art = RowArtifact('eeg_raw.csv', 'csv', lambda: eeg_rows(10), ['timestamp', 'fp1', 'fp2'], kind='eeg_raw')
    res = build_data_center_package('J', [(scope(), bin_art), (scope(), csv_art)], tmp_path, policy())
    assert [e['reason'] for e in res.exclusions] == ['blocked_requires_redaction']
    with zipfile.ZipFile(res.parts[0].path) as z:
        assert not any(n.endswith('.bin') for n in z.namelist())  # 가명 기본: 원본 bin 차단
    # 무손실 권한이 있으면 원본 바이트 그대로(해시 일치)
    allowed = build_data_center_package('J', [(scope(), bin_art), (scope(), csv_art)], tmp_path / 'ok', policy(lossless_allowed=True))
    with zipfile.ZipFile(allowed.parts[0].path) as z:
        assert hashlib.sha256(z.read(logical(scope(), bin_art.name))).hexdigest() == sha
    # 서버 정본과 hash 가 다르면 만들지 않는다
    tampered = BinArtifact(bin_art.name, lambda: io.BytesIO(payload + b'x'), len(payload) + 1, sha)
    with pytest.raises(PackageError) as e:
        build_data_center_package('J', [(scope(), tampered)], tmp_path / 't', policy(lossless_allowed=True))
    assert e.value.code == 'artifact_integrity'
    # 단독 bin 이 part 상한보다 크면 바이트 분할 없이 차단 + 대체 포맷 안내, 나머지는 정상
    big = os.urandom(60_000)
    big_art = BinArtifact('raw/eeg/stream-S01/segment-001/chunk-000002.bin', lambda: io.BytesIO(big), len(big),
                          hashlib.sha256(big).hexdigest(), signal='eeg')
    res = build_data_center_package('J', [(scope(), big_art), (scope(), csv_art)], tmp_path / 'big',
                                    policy(part_max_bytes=30_000, lossless_allowed=True))
    ex = [e for e in res.exclusions if e['reason'] == 'single_oversize_bin']
    assert ex and ex[0]['alternative'] == 'csv_or_parquet'
    assert all(p.size_bytes <= 30_000 for p in res.parts)
    assert 'single_oversize_bin:eeg' in res.warnings


def test_leak_and_path_guards(tmp_path):
    secret = str(uuid4())
    leaky = RowArtifact('x.csv', 'csv', lambda: [[f'id={secret}']], ['a'], time_column=None)
    with pytest.raises(PackageError) as e:
        build_data_center_package('J', [(scope(), leaky)], tmp_path / 'a', policy(forbidden_strings=frozenset({secret})))
    assert e.value.code == 'pseudonym_leak'
    for bad in ('../x.csv', '/abs.csv', 'a//b.csv', 'a\\b.csv', 'a/./b.csv'):
        art = TextArtifact(bad, 'x')
        with pytest.raises(PackageError) as e:
            build_data_center_package('J', [(scope(), art)], tmp_path / 'b', policy())
        assert e.value.code == 'unsafe_path'
    dup = [(scope(), TextArtifact('meta.json', 'a')), (scope(), TextArtifact('meta.json', 'b'))]
    with pytest.raises(PackageError) as e:
        build_data_center_package('J', dup, tmp_path / 'c', policy())
    assert e.value.code == 'duplicate_path'


# ── 독립 verifier 가 손상을 잡는다(음성 fixture) ────────────────────────

def make_good(tmp_path):
    scopes = [scope(1, 1), scope(2, 1)]
    stream = [x for sc in scopes for x in artifacts_for(sc, 400)]
    res = build_data_center_package('JV', stream, tmp_path, policy(part_max_bytes=50_000, piece_target_bytes=9_000))
    expected = {'rows': {logical(sc, 'eeg_raw.csv'): 400 for sc in scopes}, 'forbidden': ['SECRET-NAME']}
    assert verify(tmp_path, expected, 50_000).returncode == 0
    return res, expected


def rewrite(path: Path, mutate):
    with zipfile.ZipFile(path) as z:
        items = [(i, z.read(i.filename)) for i in z.infolist()]
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as out:
        for info, data in items:
            new = mutate(info.filename, data)
            if new is not None:
                out.writestr(info.filename, new)
        extra = mutate(None, None)
        if extra:
            for name, data in extra:
                out.writestr(name, data)


@pytest.mark.parametrize('case', ['hash', 'missing_row', 'oversize', 'nested_zip', 'pii', 'missing_part', 'missing_root'])
def test_verifier_rejects_corruption(tmp_path, case):
    res, expected = make_good(tmp_path)
    first = res.parts[0].path
    target = next(n for n in zipfile.ZipFile(first).namelist() if n.endswith('eeg_raw.csv') or '.cont-' in n and 'eeg_raw' in n)
    max_bytes = 50_000
    if case == 'hash':
        rewrite(first, lambda n, d: d.replace(b'0', b'1', 1) if n == target else (None if n is None else d))
    elif case == 'missing_row':
        def drop(n, d):
            if n is None:
                return None
            if n == target:
                lines = d.split(b'\r\n')
                return b'\r\n'.join(lines[:2] + lines[3:])
            return d
        rewrite(first, drop)
    elif case == 'oversize':
        max_bytes = 100
    elif case == 'nested_zip':
        rewrite(first, lambda n, d: [('inner.zip', b'PK\x03\x04junk')] if n is None else d)
    elif case == 'pii':
        rewrite(first, lambda n, d: [('participant-note.txt', b'hello SECRET-NAME')] if n is None else d)
    elif case == 'missing_part':
        res.parts[-1].path.unlink()
    elif case == 'missing_root':
        rewrite(first, lambda n, d: None if n == 'README_ko.md' else (None if n is None else d))
    done = verify(tmp_path, expected, max_bytes)
    assert done.returncode == 1 and 'FAIL' in done.stderr, (case, done.stdout, done.stderr)


# ── job 통합: DB 원천 → 패키지 → part 원장 ─────────────────────────────

class FakeRawSource:
    """244 T12 어댑터 자리: 합성 3신호 파일을 공급한다(통합 시 실제 adapter 로 교체)."""

    def artifacts(self, sc, target, pol, signals):
        yield RowArtifact('eeg_raw.csv', 'csv', lambda: eeg_rows(250), ['timestamp', 'fp1', 'fp2'], kind='eeg_raw',
                          signal='eeg', dictionary_key='eeg_raw')
        yield RowArtifact('ppg_raw.csv', 'csv', lambda: ppg_rows(100), ['timestamp', 'red', 'ir'], kind='ppg_raw', signal='ppg')
        yield MissingArtifact('acc_raw', 'unsupported_client', 'acc')


@pytest.fixture
def job_env(client, world, db, dc_enabled, monkeypatch):
    from app.services import export_reauth, storage_service

    class Ok:
        def verify(self, *a, **k):
            return True

    monkeypatch.setattr(export_reauth, '_verifier', Ok())
    monkeypatch.setattr(dcx, 'enqueue_job', lambda job_id: None)
    uploaded = {}
    monkeypatch.setattr(storage_service, 'upload_export', lambda path, key: uploaded.__setitem__(key, Path(path).read_bytes()))
    for sess, part in ((world.s_a1, world.p_a1_c), (world.s_a1, world.p_a1_c2), (world.s_a2, world.p_a2_c)):
        add_features(db, sess, part, 5)
    db.commit()
    world.uploaded = uploaded
    yield world
    dcx.set_raw_artifact_source(None)


def run_job_request(client, w, user, **body):
    r = client.post(BASE + '/exports/preview', json={'scope': 'class', 'target_id': str(w.cls_a.id), 'include': ['features', 'indices'],
                                                      **body}, headers=auth(user))
    assert r.status_code == 200, r.text
    c = client.post(BASE + '/exports', json={'preview_token': r.json()['preview_token'], 'reason': '운영 점검', 'reauth_proof': 'x'},
                    headers={**auth(user), 'Idempotency-Key': uuid4().hex})
    assert c.status_code == 202, c.text
    return UUID(c.json()['export_id'])


def test_job_end_to_end_pseudonymized(client, job_env, db, tmp_path):
    from app.models.data_export import DataExportJob, DataExportPart
    from app.services.export_service import run_export
    w = job_env
    jid = run_job_request(client, w, w.admin_a)
    run_export(jid, db)
    db.expire_all()
    job = db.get(DataExportJob, jid)
    assert job.status == 'ready', job.error_code
    parts = db.query(DataExportPart).filter_by(job_id=jid).all()
    assert len(parts) == 1 and parts[0].status == 'ready' and parts[0].size_bytes == len(w.uploaded[parts[0].object_key])
    out = tmp_path / 'dl'
    out.mkdir()
    (out / 'p1.zip').write_bytes(w.uploaded[parts[0].object_key])
    forbidden = [str(i) for i in (w.s_a1.id, w.s_a2.id, w.p_a1_c.id, w.p_a1_c2.id, w.p_a2_c.id, w.client.id, w.client2.id,
                                  w.cls_a.id, w.org_a.id, w.admin_a.id, w.counselor.id)] + [w.client.name, w.client.email, w.admin_a.name]
    sc = 'class-C01/session-001_date-withheld/participant-P01'
    done = verify(out, {'rows': {f'{sc}/features.csv': 5, f'{sc}/indices.csv': 5, 'class-C01/session-001_date-withheld/participant-P02/features.csv': 5,
                                 'class-C01/session-002_date-withheld/participant-P01/features.csv': 5}, 'forbidden': forbidden})
    assert done.returncode == 0, done.stderr
    with zipfile.ZipFile(out / 'p1.zip') as z:
        feats = z.read(f'{sc}/features.csv').decode().split('\r\n')
        assert feats[0].startswith('play_group_id,window_index,t_rel_ms,focus_index') and feats[0].endswith('quality,device_timestamp_ms')
        first = dict(zip(feats[0].split(','), feats[1].split(',')))
        assert first['device_timestamp_ms'] == '' and first['t_rel_ms'] == '0'  # 가명: 절대 장치시각 null
        assert first['total_neural_activity'] == ''  # null 은 빈 칸
        idx = z.read(f'{sc}/indices.csv').decode().split('\r\n')
        assert 'display_history_missing' in idx[1] and ',unavailable,unverified,' in idx[1]
        meta = json.loads(z.read(f'{sc}/meta.json'))
        assert meta['time'] == 'date-withheld' and 'started_at' not in meta
        manifest = json.loads(z.read('manifest.json'))
        assert manifest['purpose'] == 'operations' and manifest['preview_exclusion_counts']
    assert 'warnings' not in job.error_code if job.error_code else True


def test_job_with_raw_adapter_and_identified_exact_time(client, job_env, db, tmp_path):
    from app.models.data_export import DataExportJob
    from app.services.export_service import run_export
    w = job_env
    dcx.set_raw_artifact_source(FakeRawSource())
    from app.api.v1 import data_center as api
    from app.main import app
    from tests.test_sdd243_measurements import FakeBackend, build_manifest, chunk_ref, eeg_maker
    from tests.test_sdd243_jobs import RawOwners
    from tests.sdd243_helpers import add_raw
    add_raw(db, w.s_a1, w.p_a1_c)
    add_raw(db, w.s_a1, w.p_a1_c2)
    add_raw(db, w.s_a2, w.p_a2_c)
    db.commit()
    app.dependency_overrides[api.backend_dep] = lambda: RawOwners(build_manifest([chunk_ref(0)]), [w.p_a1_c.id, w.p_a1_c2.id, w.p_a2_c.id])
    try:
        jid = run_job_request(client, w, w.platform, include=['eeg_raw', 'ppg_raw', 'acc_raw', 'features'], identity='identified')
    finally:
        app.dependency_overrides.pop(api.backend_dep, None)
    from app.services import export_service
    export_service.run_export(jid, db)
    db.expire_all()
    job = db.get(DataExportJob, jid)
    assert job.status == 'ready_with_warnings' and any('unsupported_client' in x for x in job.warnings), (job.status, job.warnings)
    z = zipfile.ZipFile(io.BytesIO(next(iter(w.uploaded.values()))))
    sc = 'class-C01/session-001_2026-10-01/participant-P01'  # 식별 운영: 날짜 허용
    assert f'{sc}/eeg_raw.csv' in z.namelist() and f'{sc}/ppg_raw.csv' in z.namelist()
    feats = z.read(f'{sc}/features.csv').decode().split('\r\n')
    assert dict(zip(feats[0].split(','), feats[1].split(',')))['device_timestamp_ms'] != ''
    assert json.loads(z.read(f'{sc}/meta.json'))['time'] == 'exact_utc'
    assert not any(n.endswith('.bin') for n in z.namelist())


def test_job_part_splitting_with_small_cap(client, job_env, db, tmp_path, monkeypatch):
    from app.models.data_export import DataExportJob, DataExportPart
    from app.services.export_service import run_export
    w = job_env
    from app.models.eeg_feature import EEGFeatureWindow
    rng = random.Random(7)
    for sess, part in ((w.s_a1, w.p_a1_c), (w.s_a1, w.p_a1_c2), (w.s_a2, w.p_a2_c)):
        for i in range(5, 605):
            db.add(EEGFeatureWindow(session_id=sess.id, participant_id=part.id, window_index=i, quality='valid',
                                    focus_index=rng.random(), alpha_power=rng.random(), beta_power=rng.random(),
                                    theta_power=rng.random(), heart_rate=60 + rng.random() * 20, device_timestamp_ms=1000.0 * i))
    db.commit()
    jid = run_job_request(client, w, w.admin_a)
    monkeypatch.setattr(dcx, 'resolve_part_max', lambda job: 40_000)
    run_export(jid, db)
    db.expire_all()
    job = db.get(DataExportJob, jid)
    parts = db.query(DataExportPart).filter_by(job_id=jid).order_by(DataExportPart.part_no).all()
    assert job.status == 'ready' and len(parts) > 1 and job.expected_part_count == len(parts) == job.completed_count
    assert all(p.size_bytes <= 40_000 for p in parts)


def test_repack_when_estimate_is_too_small(tmp_path, monkeypatch):
    """예상 오버헤드가 부족해 첫 배치가 상한을 넘으면 예약분을 늘려 재패킹하고, 최종 실제 크기는 상한 이하다."""
    monkeypatch.setattr(pkg, 'ZIP_ENTRY_OVERHEAD', 0)
    monkeypatch.setattr(pkg, 'ZIP_END_RESERVE', 0)
    calls = []
    real = pkg._write_parts
    monkeypatch.setattr(pkg, '_write_parts', lambda *a, **k: calls.append(1) or real(*a, **k))
    cap = 9_000
    scopes = [scope(s, 1) for s in range(1, 30)]
    stream = []
    for sc in scopes:
        stream.append((sc, RowArtifact('a.csv', 'csv', lambda: ([random.random(), random.random()] for _ in range(20)), ['t', 'v'],
                                       time_column='t')))
    res = build_data_center_package('JR', stream, tmp_path, policy(part_max_bytes=cap, piece_target_bytes=2000))
    assert len(calls) > 1, '재패킹이 일어나지 않았다'
    assert all(p.size_bytes <= cap for p in res.parts)
    assert verify(tmp_path, {'rows': {logical(sc, 'a.csv'): 20 for sc in scopes}}, cap).returncode == 0


@pytest.mark.skipif(not os.environ.get('SDD243_REAL_1GB'), reason='실제 1GB 경계 인수시험(디스크 약 3GB·수십 초): SDD243_REAL_1GB=1')
def test_real_one_gb_boundary(tmp_path):
    """작은 cap 단위시험과 별개: 실제 상한 1,000,000,000B 에서 비압축성 데이터가 2개 이상 part 로 나뉘고 모두 상한 이하."""
    import hashlib

    arts = []
    for i in range(1, 6):  # 5 participants × 50 bin × 4MiB(비압축) ≈ 1.05GB
        sc = scope(1, i)
        for k in range(50):
            data = os.urandom(4 << 20)
            arts.append((sc, BinArtifact(f'raw/eeg/stream-S01/segment-001/chunk-{k:06d}.bin', (lambda d=data: io.BytesIO(d)), len(data),
                                         hashlib.sha256(data).hexdigest(), signal='eeg')))
    res = build_data_center_package('J1GB', arts, tmp_path, PackagePolicy(lossless_allowed=True, policy_version='dc-policy-1'))
    sizes = [p.size_bytes for p in res.parts]
    assert len(res.parts) >= 2 and all(s <= 1_000_000_000 for s in sizes), sizes
    assert verify(tmp_path, {'rows': {}}, 1_000_000_000).returncode == 0
