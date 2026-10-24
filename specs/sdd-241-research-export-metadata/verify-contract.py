"""SDD-241 독립 계약 검증: 실DB·저장소·환경파일 없이 Parquet/manifest를 재해석한다."""
import hashlib
import io
import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from pydantic_settings.sources import DotEnvSettingsSource
DotEnvSettingsSource.__call__ = lambda self: {}
sys.path.insert(0, str(Path.cwd()))
if sys.argv[1:2] == ["--pytest"]:
    import pytest
    raise SystemExit(pytest.main(sys.argv[2:]))
import pyarrow.parquet as pq
from app.services import research_export_service as svc

start = datetime(2026, 10, 24, 23, 59, 59, 125000, tzinfo=timezone.utc)
end = datetime(2026, 10, 25, 0, 0, 2, 375000, tzinfo=timezone.utc)
session = SimpleNamespace(started_at=start, ended_at=end)
chunks = [SimpleNamespace(stream_id="independent", chunk_index=0, start_ms=1792886399125.0, end_ms=1792886402375.0)]
# 하드코딩 epoch와 달력 기준을 독립적으로 비교한다.
assert datetime.fromtimestamp(chunks[0].start_ms / 1000, timezone.utc) == start
metadata = svc._measurement_metadata(chunks, session, True)
assert metadata['measurement_started_at_utc'] == '2026-10-24T23:59:59.125000+00:00'
assert metadata['measurement_ended_at_kst'] == '2026-10-25T09:00:02.375000+09:00'
for point in ('started', 'ended'):
    utc = datetime.fromisoformat(metadata[f'measurement_{point}_at_utc'])
    kst = datetime.fromisoformat(metadata[f'measurement_{point}_at_kst'])
    assert utc == kst
    assert kst.utcoffset().total_seconds() == 32400
subject = {'research_subject_id': 'a' * 64, 'key_version': 1, 'participant_pseudo': 'b' * 32,
           'session_pseudo': 'c' * 32, 'gender': 'female', 'birth_year_month': '1991-02',
           'revision': 1, **metadata}
files, entries = {}, []
for name in svc.ALLOWED_COLUMNS:
    table = svc._table(name, [subject] if name == 'subjects' else [])
    payload = svc._parquet_bytes(table)
    restored = pq.read_table(io.BytesIO(payload))
    assert tuple(restored.column_names) == svc.ALLOWED_COLUMNS[name]
    if name == 'subjects':
        assert restored.to_pylist()[0] == subject
    filename = f'{name}.parquet'
    files[filename] = payload
    entries.append({'name': filename, 'rows': restored.num_rows, 'bytes': len(payload),
                    'sha256': hashlib.sha256(payload).hexdigest(), 'columns': restored.column_names})
bundle = {'key_version': 1, 'manifest_files': entries, 'items': [
    {'research_subject_id': 'a' * 64, 'revision': 1, 'rows': {'raw': 0, 'features': 0}}]}
manifest = json.loads(svc._manifest_bytes(uuid.UUID(int=1), bundle))
assert manifest['schema_version'] == '2.0'
assert set(files) == {'sessions.parquet', 'subjects.parquet', 'facilitators.parquet', 'features.parquet', 'eeg_raw.parquet'}
for entry in manifest['files']:
    assert entry['sha256'] == hashlib.sha256(files[entry['name']]).hexdigest()
expected_hash = hashlib.sha256(json.dumps({name: list(columns) for name, columns in sorted(svc.ALLOWED_COLUMNS.items())}, ensure_ascii=False).encode()).hexdigest()
assert manifest['field_list_sha256'] == expected_hash
print(json.dumps({'status': 'passed', 'parquet_files': len(files), 'schema_version': manifest['schema_version'], 'time_roundtrip': 'UTC/KST +09:00, date boundary, fractional seconds', 'field_list_sha256': expected_hash}, ensure_ascii=False))
