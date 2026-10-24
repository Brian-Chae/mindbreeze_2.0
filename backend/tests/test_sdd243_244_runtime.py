"""SDD-243 ↔ 244 런타임 연결: fake 가 아니라 실제 어댑터가 등록·사용되는지 고정한다."""
import csv
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID

import pytest

from app.schemas import data_center as dc
from app.schemas.biosignal import ManifestRevision
from app.services import data_center_export as dcx
from app.services import data_center_measurement as dm
from app.services import data_center_runtime as rt
from app.services import export_package as pkg
from tests.test_sdd027_rollup_raw_report import _db
from tests.test_sdd244_export_contract import ready
from tests.test_sdd244_ingest import FIX
from tests.test_sdd244_manifest import ctx, storage  # noqa: F401

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def reader(key, version):
    signal = next(s for s in ('eeg', 'ppg', 'acc') if f'/{s}/' in key)
    return (FIX / f'{signal}-raw-v2.bin').read_bytes()


@pytest.fixture
def real_runtime():
    prev = (dm._registered, dcx.RAW_ARTIFACT_SOURCE)
    dm.register_backend(rt.BiosignalMeasurementBackend(session_factory=_db, reader=reader))
    dcx.set_raw_artifact_source(rt.RawExportSource(session_factory=_db, reader=reader))
    yield
    dm.register_backend(prev[0])
    dcx.set_raw_artifact_source(prev[1])


def _fresh(code: str) -> str:
    import os
    env = {**os.environ, 'PYTHONPATH': str(BACKEND_ROOT), 'JWT_SECRET_KEY': 'test-secret-key-for-runtime-check-0123456789'}
    result = subprocess.run([sys.executable, '-c', code], cwd=BACKEND_ROOT, capture_output=True, text=True, env=env)
    assert result.returncode == 0, result.stderr[-2000:]
    return result.stdout.strip().splitlines()[-1]


CHECK = ("from app.services import data_center_export as d, data_center_measurement as m\n"
         "print(type(m.default_backend()).__name__, type(d.RAW_ARTIFACT_SOURCE).__name__)")


def test_앱_시작이_실제_어댑터를_등록한다():
    assert _fresh('import app.main\n' + CHECK) == 'BiosignalMeasurementBackend RawExportSource'


def test_Celery_워커_태스크_모듈이_실제_어댑터를_등록한다():
    assert _fresh('import app.tasks.export_task\n' + CHECK) == 'BiosignalMeasurementBackend RawExportSource'


def test_install은_멱등이고_fake를_실제로_교체한다():
    prev = (dm._registered, dcx.RAW_ARTIFACT_SOURCE)
    try:
        dm.register_backend(None)
        dcx.set_raw_artifact_source(SimpleNamespace(artifacts=lambda *a: []))
        rt.install()
        first = (dm._registered, dcx.RAW_ARTIFACT_SOURCE)
        rt.install()
        assert isinstance(first[0], rt.BiosignalMeasurementBackend) and isinstance(first[1], rt.RawExportSource)
        assert (dm._registered, dcx.RAW_ARTIFACT_SOURCE) == first
    finally:
        dm.register_backend(prev[0])
        dcx.set_raw_artifact_source(prev[1])


def test_실제_backend가_manifest와_골든_파형을_공급한다(ctx, real_runtime):
    ready(ctx)
    sid, pid = UUID(ctx['sid']), UUID(ctx['pid'])
    backend = dm.default_backend()
    assert isinstance(backend, rt.BiosignalMeasurementBackend)
    view = backend.get_manifest(sid, pid, None)
    assert view.close_state == 'complete' and view.signals['eeg'][0] == 'available'
    assert view.signals['ppg'][0] != 'available' and len(view.chunks) == 1
    assert view.chunks[0].stream_id.startswith('Stream') and view.chunks[0].meta.object_key
    out = dm.read_waveform(backend, dc.MeasurementSelection(session_id=sid, participant_id=pid), 'eeg', 2000)
    expected = list(csv.DictReader(open(FIX / 'eeg-expected.csv')))
    assert out.method == 'raw' and out.returned_count == len(expected)
    for ci, name in enumerate(('fp1', 'fp2')):
        assert out.channels[ci].values == pytest.approx([float(r[name]) for r in expected], rel=1e-6, abs=1e-6)
    assert not any(c.chunk_index for c in view.chunks)
    assert backend.get_manifest(sid, UUID(int=1), None) is None  # 수신 자료 없는 참여자


def test_청크_무결성_불일치는_파형을_내지_않는다(ctx):
    ready(ctx)
    sid, pid = UUID(ctx['sid']), UUID(ctx['pid'])
    bad = rt.BiosignalMeasurementBackend(session_factory=_db, reader=lambda *a: b'tampered')
    with pytest.raises(Exception) as exc:
        dm.read_waveform(bad, dc.MeasurementSelection(session_id=sid, participant_id=pid), 'eeg', 2000)
    assert getattr(exc.value, 'status_code', None) == 502
    missing = rt.BiosignalMeasurementBackend(session_factory=_db, reader=lambda *a: None)
    with pytest.raises(Exception) as exc:
        dm.read_waveform(missing, dc.MeasurementSelection(session_id=sid, participant_id=pid), 'eeg', 2000)
    assert getattr(exc.value, 'status_code', None) == 503


def _package(ctx, consent: bool, include=frozenset({'eeg_raw', 'ppg_raw'})):
    from app.models.session import SessionParticipant
    db = _db()
    part = db.get(SessionParticipant, UUID(ctx['pid']))
    part.consent_eeg = consent
    db.commit()
    scope = pkg.PackageScope('class-C01', 'session-001_date-withheld', 'P01', 'S001', 1)
    target = SimpleNamespace(job_id=None, session_id=UUID(ctx['sid']), participant_id=UUID(ctx['pid']), manifest_revision=1)
    policy = pkg.PackagePolicy(policy_version='t', eeg_format='csv')
    return list(dcx.participant_artifacts(db, {}, target, scope, policy, set(include)))


def test_실제_반출_어댑터가_raw_파일을_만든다(ctx, real_runtime):
    ready(ctx)
    arts = _package(ctx, True)
    raw = next(a for a in arts if getattr(a, 'name', '').endswith('eeg_raw.csv'))
    rows = list(raw.rows())
    assert len(rows) == 4 and raw.signal == 'eeg'
    assert any(isinstance(a, pkg.MissingArtifact) and a.signal == 'ppg' for a in arts)  # 미수집은 파일 없이 사유만
    assert not any(isinstance(a, pkg.MissingArtifact) and getattr(a, 'reason', '') == 'manifest_not_connected' for a in arts)


def test_파일마다_동의를_다시_확인한다(ctx, real_runtime):
    ready(ctx)
    with pytest.raises(PermissionError):
        _package(ctx, False)


def test_indices_only_반출도_증빙_sidecar를_포함한다(ctx, real_runtime):
    from tests.test_sdd244_export_contract import ManifestRevision as MR  # noqa: F401
    from tests.test_sdd244_artifacts import _art, _jsonl
    from app.models.biosignal import BiosignalArtifact, BiosignalManifestRevision
    ready(ctx)
    data = json.loads((FIX / 'indices-v1.json').read_text())
    data = data if isinstance(data, list) else [data]
    payload = _jsonl(data)
    db = _db()
    rev = db.query(BiosignalManifestRevision).one()
    manifest = ManifestRevision.model_validate(rev.content)
    sha = hashlib.sha256(payload).hexdigest()
    ref = manifest.artifacts[0].model_copy(update={
        'artifact_id_alias': 'IDX-X', 'artifact_kind': 'indices', 'path': 'indices/IDX-X.bin', 'sha256': sha,
        'size_bytes': len(payload), 'row_count': len(data), 'time_range': None, 'retention': 'feature_policy'})
    body = manifest.model_dump(mode='json')
    body.update(close_state='partial', close_intent=None, artifacts=[ref.model_dump(mode='json')])
    rev.content = body
    db.add(BiosignalArtifact(
        session_id=UUID(ctx['sid']), participant_id=UUID(ctx['pid']), artifact_alias='IDX-X', artifact_kind='indices',
        signal=None, sequence=0, row_count=len(data), schema_version='indices-v1', checksum=sha, size_bytes=len(payload),
        retention_class='feature_policy', object_key='synthetic/indices', upload_status='uploaded'))
    db.commit()
    source = rt.RawExportSource(session_factory=_db, reader=lambda *a: payload)
    dcx.set_raw_artifact_source(source)
    arts = _package(ctx, True, include={'indices'})  # raw 신호 선택 없음(indices-only)
    names = [getattr(a, 'name', '') for a in arts]
    assert 'indices.csv' in names
    assert any(n.endswith('display-status.jsonl') for n in names)
    assert any(n.endswith('/indices.jsonl') for n in names)
    assert len(names) == len(set(names))


# ── dev 활성화 · 운영 설정 ──────────────────────────────────────────────

ROOT = BACKEND_ROOT.parent


def test_데이터센터는_dev_환경에서만_기본_활성():
    from app.config import Settings
    assert Settings(_env_file=None, environment='development').data_center_enabled is True
    assert Settings(_env_file=None, environment='production').data_center_enabled is False
    assert Settings(_env_file=None).data_center_enabled is False  # 기본 환경은 production(fail-safe)


def test_명시값은_환경과_무관하게_이긴다():
    from app.config import Settings
    assert Settings(_env_file=None, environment='development', data_center_enabled=False).data_center_enabled is False
    assert Settings(_env_file=None, environment='production', data_center_enabled=True).data_center_enabled is True


def test_dev_cron과_번들에_outbox_재전달이_등록된다():
    cron = (ROOT / 'deploy/dev/register-crons.sh').read_text()
    line = next(x for x in cron.splitlines() if x.startswith('(crontab') and 'process_data_export_outbox_cron' in x)
    assert line.count("grep -v 'process_data_export_outbox_cron'") == 1  # 멱등 갱신
    assert "'* * * * * cd /home/ubuntu/mindbreeze/backend" in line and 'DATABASE_URL' in line and 'REDIS_URL' in line
    assert 'venv/bin/python process_data_export_outbox_cron.py >>' in line
    assert (BACKEND_ROOT / 'process_data_export_outbox_cron.py').is_file()
    assert 'backend/process_data_export_outbox_cron.py' in (ROOT / '.github/workflows/deploy-dev.yml').read_text()


def test_데이터센터_메뉴가_플랫폼과_기관_관리자_내비에_있다():
    nav = (ROOT / 'frontend/src/components/layout/SidebarNav.tsx').read_text()
    assert '"/org/data-center"' in nav and '"/admin/data-center"' in nav
    app = (ROOT / 'frontend/src/App.tsx').read_text()
    assert 'path="/org/data-center"' in app and 'role="org_admin"' in app
    assert 'path="/admin/data-center"' in app and 'PlatformAdminRoute' in app
