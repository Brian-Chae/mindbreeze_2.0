"""T12 원장→실제 파일·가명·정책 회귀."""
import csv
import hashlib
import io
import json
import subprocess
import sys
import struct
import zipfile
from pathlib import Path
import pyarrow.parquet as pq
import pytest
from app.schemas.biosignal import ExportPolicy, ExportSelection, ManifestRevision
from tests.test_sdd244_manifest import ctx, storage, _upload, _events, _intent, _manifest
from tests.test_sdd027_rollup_raw_report import _db
from tests.test_sdd244_ingest import FIX


def export(ctx, fmt='csv', check=None, **over):
    from app.services import biosignal_export_adapter as adapter
    m = ManifestRevision.model_validate(_manifest(ctx).json()['manifest'])
    p = ExportPolicy(time_policy='relative_only', raw_packets_authorized=False, allowed_artifact_kinds=['raw','feature','indices','gap','normalization','algorithm'], policy_revision='test').model_copy(update=over)
    s = ExportSelection(signals=['eeg','ppg','acc'], time_range={'from_us':'0','to_us':'1000000'}, sample_format=fmt, view_kind='participant_player')
    db = _db()
    def read(key, version):
        signal = next(s for s in ('eeg','ppg','acc') if f'/{s}/' in key)
        return (FIX / f'{signal}-raw-v2.bin').read_bytes()
    try:
        return list(adapter.iter_export_artifacts(m,s,p,db=db,session_id=ctx['sid'],participant_id=ctx['pid'],reader=read,policy_check=check or (lambda *a: True)))
    finally:
        db.close()


def ready(ctx, signal='eeg'):
    from tests.test_sdd244_ingest import _presign, _ack, _ack_items
    data=(FIX/f'{signal}-raw-v2.bin').read_bytes()
    header=json.loads(data[12:12+struct.unpack_from('<I',data,8)[0]])
    metas=[{'chunk_alias':'RAW-EEG','header':header,'checksum':hashlib.sha256(data).hexdigest(),'size_bytes':len(data)}]
    presigned=_presign(ctx,metas).json()['chunks']
    assert _ack(ctx,_ack_items(presigned)).status_code==200
    intent=_intent(metas)
    intent['streams'][0].update(stream_id=header['stream_id'],segment_id=header['segment_id'], signal=signal, received_samples=header['sample_count'])
    assert _events(ctx,[intent]).status_code==200


@pytest.mark.parametrize('fmt',['csv','parquet'])
def test_내부조회로_원본을_해석하고_미수집신호는_생성하지_않음(ctx,fmt):
    ready(ctx)
    artifacts = export(ctx,fmt)
    raw = next(a for a in artifacts if a.metadata.path.endswith('eeg_raw.'+fmt))
    payload = b''.join(raw.iter_bytes())
    assert hashlib.sha256(payload).hexdigest() == raw.metadata.sha256
    rows = list(csv.DictReader(io.StringIO(payload.decode()))) if fmt == 'csv' else pq.read_table(io.BytesIO(payload)).to_pylist()
    assert len(rows)==4 and list(rows[0])==['timestamp','fp1','fp2']
    assert not any('ppg_raw.' in a.metadata.path or 'acc_raw.' in a.metadata.path for a in artifacts)
    meta = next(a for a in artifacts if a.metadata.path.endswith('meta/export.json'))
    assert json.loads(b''.join(meta.iter_bytes()))['signals'][1]['availability']=='not_collected'
    combined = b'\n'.join(b''.join(a.iter_bytes()) for a in artifacts)
    assert ctx['sid'].encode() not in combined and ctx['pid'].encode() not in combined
    assert not any(a.metadata.path.endswith('.bin') for a in artifacts)


def test_현재정책_거절이면_반출_없음(ctx):
    ready(ctx)
    with pytest.raises(PermissionError): export(ctx,check=lambda *a: False)


def test_manifest_bin차단을_요청권한만으로_우회못함(ctx):
    ready(ctx)
    assert not any(a.metadata.path.endswith('.bin') for a in export(ctx,raw_packets_authorized=True))


def test_독립검증_변조거절(ctx,tmp_path):
    ready(ctx)
    artifacts=export(ctx)
    files={a.metadata.path:b''.join(a.iter_bytes()) for a in artifacts}
    expected={'files':{a.metadata.path:{'sha256':a.metadata.sha256,'size_bytes':a.metadata.size_bytes,'row_count':a.metadata.row_count} for a in artifacts}}
    path=tmp_path/'sample.zip'; golden=tmp_path/'golden.json'
    golden.write_text(json.dumps(expected))
    script=Path(__file__).parents[2]/'scripts/verify-sdd244-artifacts.py'
    def run():
        with zipfile.ZipFile(path,'w') as z:
            for name,data in files.items(): z.writestr(name,data)
        return subprocess.run([sys.executable,str(script),'--input',str(path),'--expected',str(golden)],capture_output=True)
    assert run().returncode==0
    name=next(n for n in files if n.endswith('eeg_raw.csv')); files[name]=b'timestamp,fp1\r\n0,1\r\n'
    assert run().returncode!=0

@pytest.mark.parametrize('signal',['ppg','acc'])
def test_다른_신호도_샘플행으로_복원(ctx,signal):
    ready(ctx,signal)
    a=next(a for a in export(ctx) if a.metadata.path.endswith(signal+'_raw.csv'))
    rows=list(csv.DictReader(io.StringIO(a.payload.decode())))
    with (FIX/f'{signal}-expected.csv').open() as f: expected=list(csv.DictReader(f))
    assert rows==expected


def test_가명변환은_절대시각과_uuid를_제거():
    from app.services.biosignal_export_adapter import _redact
    data={'computed_at_us':'99999','discovered_at_us':'8888','device_timestamp_ms':999,
          'reference':'11111111-1111-4111-8111-111111111111'}
    value=_redact(data)
    assert value['computed_at_us'] is None and value['discovered_at_us'] is None
    assert '11111111-' not in value['reference']

@pytest.mark.parametrize('kind,filename',[('feature','feature-v1.json'),('indices','indices-v1.json'),('raw_derived',None)])
def test_상세산출물과_flat파일_및_파형_정책(ctx,kind,filename):
    from tests.test_sdd244_artifacts import _art, _post, _jsonl
    from tests.test_sdd244_ingest import STREAM, SEG
    from app.models.biosignal import BiosignalManifestRevision
    from app.services import biosignal_export_adapter as adapter
    data=json.loads((FIX/filename).read_text()) if filename else [{'feature_id_alias':'FEAT-X','first_sample_index':0,'fields':{'filteredData':[0.1,0.2]}}]
    if not isinstance(data,list): data=[data]
    if kind=='feature': data=[data[0]]
    payload=_jsonl(data)
    meta=_art(kind,'ART-X',payload,row_count=len(data), signal='eeg' if kind!='indices' else None,
        segment_id=SEG if kind!='indices' else None,view_instance_id='44444444-4444-4444-8444-444444444444' if kind=='indices' else None)
    # G1 원장과 동일한 synthetic 행: 외부 저장소/회원 정보 사용 없음.
    from app.models.biosignal import BiosignalArtifact
    from app.schemas.biosignal import ArtifactReference
    from uuid import UUID
    ready(ctx)
    db=_db()
    try:
        rev=db.query(BiosignalManifestRevision).one()
        m=ManifestRevision.model_validate(rev.content)
        ref=m.artifacts[0].model_copy(update={'artifact_id_alias':'ART-X','artifact_kind':kind,'path':'artifact/ART-X.bin',
            'sha256':hashlib.sha256(payload).hexdigest(),'size_bytes':len(payload),'row_count':len(data),'time_range':None,
            'retention':'raw_90_days' if kind=='raw_derived' else 'feature_policy'})
        body=m.model_dump(mode='json');body.update(close_state='partial',close_intent=None,artifacts=[ref.model_dump(mode='json')])
        rev.content=body
        db.add(BiosignalArtifact(session_id=UUID(ctx['sid']),participant_id=UUID(ctx['pid']),artifact_alias='ART-X',artifact_kind=kind,
            signal='eeg' if kind!='indices' else None,sequence=0,row_count=len(data),schema_version=kind+'-v1',checksum=ref.sha256,
            size_bytes=len(payload),retention_class=ref.retention,object_key='synthetic/artifact',upload_status='uploaded'))
        db.commit()
        m=ManifestRevision.model_validate(body)
        sel=ExportSelection(signals=['eeg'],time_range={'from_us':'0','to_us':'99999999999'},sample_format='csv',view_kind='participant_player')
        policy=ExportPolicy(time_policy='relative_only',raw_packets_authorized=False,allowed_artifact_kinds=[kind],policy_revision='test')
        out=list(adapter.iter_export_artifacts(m,sel,policy,db=db,session_id=ctx['sid'],participant_id=ctx['pid'],reader=lambda *a:payload,policy_check=lambda *a:True))
        assert any(a.metadata.artifact_kind==kind for a in out)
        if kind=='feature': assert any(a.metadata.path.endswith('features.csv') for a in out)
        if kind=='indices': assert any(a.metadata.path.endswith('display-status.jsonl') for a in out)
    finally: db.close()
