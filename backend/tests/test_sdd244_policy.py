"""T13/T14 신호 범위·수신 ACK·보관 정책, 실제 객체 저장소는 메모리 더블."""
import hashlib
import uuid
from datetime import timedelta
import pytest
from fastapi import HTTPException
from app.models.record import EEGRawChunk
from app.models.research_export import ResearchExportBatch, ResearchExportItem, ResearchSignalReceipt
from app.services import research_export_service as svc
from tests.test_sdd209_b13_research_export import db, enabled, staging, _setup, _put_raw, _export


def test_legacy_연구_bundle은_v2행을_읽지_않는다(db,enabled,staging):
    s,p,c=_setup(db);_put_raw(staging,s,p)
    db.add(EEGRawChunk(session_id=s.id,participant_id=p.id,stream_id='v2',segment_id='v2',chunk_index=0,
        object_key='must-not-read',signal_type='ppg',schema_version='mb-biosignal-raw-v2',upload_status='uploaded'))
    db.commit()
    assert _export(db,s)['status']=='uploaded'


@pytest.mark.parametrize('signal',['ppg','acc'])
def test_기존동의는_신호범위로_확장하지_않는다(db,signal):
    s,p,c=_setup(db,with_data=False)
    assert svc.signal_consent_status(db,c,signal,'raw')=='unknown'
    assert not svc.signal_research_hold(db,s.id,p.id,signal,'raw','a'*64)


def test_과거_EEG_ACK는_v3_원본의_ACK가_아니다(db):
    s,p,c=_setup(db,state='acked',with_data=False)
    assert svc.signal_research_hold(db,s.id,p.id,'eeg','raw','a'*64)
    assert svc.signal_consent_status(db,c,'eeg','indices')=='unknown'


def signal_batch(db):
    s,p,c=_setup(db,state='exported',with_data=False)
    b=ResearchExportBatch(session_id=s.id,status='uploaded',prefix='synthetic/',manifest_sha256='b'*64)
    db.add(b);db.flush()
    scope={'signal':'eeg','artifact_kind':'raw','manifest_revision':1,'manifest_sha256':'a'*64}
    db.add(ResearchExportItem(batch_id=b.id,consent_id=c.id,research_subject_id=c.research_subject_id,
        revision=1,content_sha256='c'*64,rows={},bundle_schema_version='research-v3',signal_scope=[scope]))
    r=ResearchSignalReceipt(session_id=s.id,participant_id=p.id,consent_id=c.id,signal='eeg',artifact_kind='raw',
        manifest_revision=1,manifest_sha256='a'*64,schema_version='research-v3',batch_id=b.id)
    db.add(r);db.commit()
    return s,p,c,b,r,scope


def test_v3는_명시적_범주_ACK만_수락하고_멱등(db):
    s,p,c,b,r,scope=signal_batch(db)
    with pytest.raises(HTTPException):svc.ack_batch(db,str(b.id),'b'*64)
    bad={**scope,'signal':'ppg'}
    with pytest.raises(HTTPException):svc.ack_signal_batch(db,str(b.id),'b'*64,[bad])
    assert db.get(ResearchSignalReceipt,r.id).acked_at is None
    result=svc.ack_signal_batch(db,str(b.id),'b'*64,[scope])
    assert result['status']=='acked'
    assert db.get(ResearchSignalReceipt,r.id).acked_at is not None
    assert c.export_state=='exported'  # v1 전체 상태를 확대하지 않는다
    assert svc.ack_signal_batch(db,str(b.id),'b'*64,[scope])['already'] is True


def test_철회후_목록과_재ACK_반출차단(db):
    s,p,c,b,r,scope=signal_batch(db)
    svc.ack_signal_batch(db,str(b.id),'b'*64,[scope])
    c.consented=False;db.commit()
    with pytest.raises(HTTPException):svc.ack_signal_batch(db,str(b.id),'b'*64,[scope])
    assert svc.list_uploaded_batches(db)==[]


def test_v3_지원불명_수신자는_pending_유지(db):
    s,p,c=_setup(db,with_data=False)
    result=svc.export_signal_revision(db,s.id,p.id,1,receiver_versions=[])
    assert result=={'status':'pending','reason':'receiver_capability_unknown'}
    assert db.query(ResearchExportBatch).count()==0


def seed_v3(db, staging, deadline=None):
    import json,struct
    from pathlib import Path
    from app.models.biosignal import BiosignalManifestRevision
    s,p,c=_setup(db,with_data=False)
    fix=Path(__file__).parents[2]/'specs/sdd-244-biosignal-raw-pipeline/contracts/fixtures'
    data=(fix/'eeg-raw-v2.bin').read_bytes();header=json.loads(data[12:12+struct.unpack_from('<I',data,8)[0]])
    m=json.loads((fix/'manifest-v1.json').read_text())[0]
    m.update(close_state='partial',close_intent=None,artifacts=[m['artifacts'][0]],gaps=[],models=[],algorithms=[])
    m['artifacts'][0]['retention_deadline_us']=deadline
    r=EEGRawChunk(session_id=s.id,participant_id=p.id,stream_id=header['stream_id'],segment_id=header['segment_id'],chunk_index=0,
        object_key='synthetic/eeg',signal_type='eeg',schema_version='mb-biosignal-raw-v2',upload_status='uploaded',
        chunk_alias='Artifact0',checksum=hashlib.sha256(data).hexdigest(),size_bytes=len(data),header=header)
    db.add(r);db.add(BiosignalManifestRevision(session_id=s.id,participant_id=p.id,revision=1,close_state='partial',content=m,content_sha256='d'*64))
    db.commit();staging.raw['synthetic/eeg']=data
    return s,p,c,r


def test_v3_실제_생성부터_수신_ACK까지(db,enabled,staging):
    s,p,c,r=seed_v3(db,staging)
    result=svc.export_signal_revision(db,s.id,p.id,1,receiver_versions=['research-v3'])
    assert result['status']=='uploaded'
    batches=svc.list_signal_batches(db,['research-v3'])
    assert len(batches)==1 and svc.list_signal_batches(db,[])==[]
    b=batches[0]
    assert svc.signal_research_hold(db,s.id,p.id,'eeg','raw',r.checksum)
    svc.ack_signal_batch(db,b['batch_id'],b['manifest_sha256'],b['signal_scope'])
    assert not svc.signal_research_hold(db,s.id,p.id,'eeg','raw',r.checksum)
    assert svc.signal_research_hold(db,s.id,p.id,'eeg','raw','f'*64)
    assert all(scope['signal']=='eeg' for scope in b['signal_scope'])
    item=db.query(ResearchExportItem).one()
    assert item.bundle_schema_version=='research-v3'


def test_동일revision이어도_실제_전송목록에_없는_hash는_보류(db,enabled,staging):
    s,p,c,r=seed_v3(db,staging)
    result=svc.export_signal_revision(db,s.id,p.id,1,receiver_versions=['research-v3'])
    b=svc.list_signal_batches(db,['research-v3'])[0]
    svc.ack_signal_batch(db,b['batch_id'],b['manifest_sha256'],b['signal_scope'])
    item=db.query(ResearchExportItem).one()
    item.rows={**item.rows,'transferred_artifacts':[]};db.commit()
    assert svc.signal_research_hold(db,s.id,p.id,'eeg','raw',r.checksum)

@pytest.mark.parametrize('state',['blocked_key_missing','blocked_identity_missing'])
def test_기존_identity차단을_v3에서_우회하지_않음(db,state):
    s,p,c=_setup(db,state=state,with_data=False)
    assert svc.signal_consent_status(db,c,'eeg','raw')!='consented'


def test_v3_철회는_실제_staging경로를_outbox에_기록(db,enabled,staging):
    from app.models.research_export import ObjectDeletionOutbox
    s,p,c,r=seed_v3(db,staging)
    result=svc.export_signal_revision(db,s.id,p.id,1,receiver_versions=['research-v3'])
    c.consented=False;db.commit()
    svc.cancel_batches_for_withdrawn(db)
    keys={x.object_key for x in db.query(ObjectDeletionOutbox).all()}
    assert set(staging.store)<=keys


def test_90일_신호별_보류와_rawderived_outbox_재시도(db,enabled,staging,monkeypatch):
    from app.models.biosignal import BiosignalArtifact
    from app.models.research_export import ObjectDeletionOutbox
    from app.services import retention_sweep_service as retention
    s,p,c,r=seed_v3(db,staging)
    for signal in ('ppg','acc'):
        db.add(EEGRawChunk(session_id=s.id,participant_id=p.id,stream_id='v2',segment_id='v2',signal_type=signal,
            schema_version='mb-biosignal-raw-v2',chunk_index=0,object_key='synthetic/'+signal,checksum='a'*64,size_bytes=8,upload_status='uploaded'))
    for kind,ret in [('raw_derived','raw_90_days'),('feature','feature_policy')]:
        db.add(BiosignalArtifact(session_id=s.id,participant_id=p.id,artifact_alias='A-'+kind,artifact_kind=kind,
            signal='ppg',sequence=0,row_count=1,schema_version='test',checksum='a'*64,size_bytes=8,
            retention_class=ret,object_key='synthetic/'+kind,upload_status='uploaded'))
    db.commit()
    cutoff=s.ended_at+timedelta(days=91)
    report=retention.sweep_biosignal_originals(db,now=cutoff,apply_from=None,execute=False)
    assert report['candidates']==3 and report['held']==1
    assert db.query(ObjectDeletionOutbox).count()==0
    report=retention.sweep_biosignal_originals(db,now=cutoff,apply_from=None,execute=True)
    assert report['queued']==3 and db.query(ObjectDeletionOutbox).count()==3
    assert db.query(BiosignalArtifact).one().artifact_kind=='feature'
    assert db.query(EEGRawChunk).one().signal_type=='eeg'
    result=retention.retry_object_deletions(db,now=cutoff,delete=lambda key:False)
    assert result['done']==0 and result['retry']==3
    assert all(x.state=='pending' and x.attempts==1 for x in db.query(ObjectDeletionOutbox))
    result=retention.retry_object_deletions(db,now=cutoff+timedelta(hours=1),delete=lambda key:True)
    assert result['done']==3
    assert all(x.state=='done' and x.completed_at for x in db.query(ObjectDeletionOutbox))


def test_90일_정확한_경계와_ACK일로_연장안함(db,staging):
    from app.services import retention_sweep_service as retention
    s,p,c,r=seed_v3(db,staging);c.consented=False;db.commit()
    boundary=s.ended_at+timedelta(days=90)
    assert retention.sweep_biosignal_originals(db,now=boundary-timedelta(microseconds=1),apply_from=None,execute=False)['candidates']==0
    assert retention.sweep_biosignal_originals(db,now=boundary,apply_from=None,execute=False)['candidates']==1


def test_legacy_정리와_수동삭제는_v2를_건드리지_않음(db,staging,monkeypatch):
    from app.services import media_cleanup_service,original_deletion_service
    from app.tasks import eeg_raw_task
    from app.config import settings
    s,p,c,r=seed_v3(db,staging)
    assert r.object_key not in media_cleanup_service._collect_session_media_refs([s.id],db)
    monkeypatch.setattr(media_cleanup_service,'_delete_media_ref',lambda key:None)
    original_deletion_service.delete_session_originals(s.id,s.host_id,'test',['eeg_raw'],db)
    assert db.get(EEGRawChunk,r.id) is not None
    r.upload_status='pending';r.created_at=s.ended_at-timedelta(days=100);db.commit()
    monkeypatch.setattr(settings,'retention_sweep_enabled',False)
    eeg_raw_task.run_sweep_eeg_raw(db)
    assert db.get(EEGRawChunk,r.id) is not None


def test_v2_EEG_삭제시_file_count도_실제_남은_EEG로_갱신(db,staging):
    from app.models.record import EEGRecord
    from app.services import retention_sweep_service as retention
    s,p,c,r=seed_v3(db,staging);c.consented=False
    rec=EEGRecord(session_id=s.id,participant_id=p.id,s3_key='synthetic',file_count=1)
    db.add(rec);db.commit()
    retention.sweep_biosignal_originals(db,now=s.ended_at+timedelta(days=91),apply_from=None,execute=True)
    assert db.get(EEGRecord,rec.id).file_count==0


def test_재시작후_in_progress_lease_만료시_삭제재시도(db):
    from app.models.research_export import ObjectDeletionOutbox
    from app.services import retention_sweep_service as retention
    from datetime import datetime,timezone
    now=datetime.now(timezone.utc)
    r=ObjectDeletionOutbox(object_key='synthetic/restart',source_table='biosignal_artifacts',reason='raw_retention_90_days',state='in_progress',attempts=1,next_attempt_at=now-timedelta(seconds=1))
    db.add(r);db.commit()
    result=retention.retry_object_deletions(db,now=now,delete=lambda key:True)
    assert result['done']==1 and r.attempts==2


def test_90일후_연구보류_원본은_이관_ACK를_받을수_있음(db,enabled,staging):
    s,p,c,r=seed_v3(db,staging,deadline='1')
    result=svc.export_signal_revision(db,s.id,p.id,1,receiver_versions=['research-v3'])
    assert result['status']=='uploaded'


def test_legacy_cron은_v2를_보존하고_EEG파일수에_포함(db,staging):
    from app.tasks.eeg_raw_task import run_legacy_sweep
    from app.models.record import EEGRecord
    s,p,c,r=seed_v3(db,staging)
    rec=EEGRecord(session_id=s.id,participant_id=p.id,s3_key='synthetic',file_count=2)
    db.add(rec)
    db.add(EEGRawChunk(session_id=s.id,participant_id=p.id,stream_id='legacy',chunk_index=0,object_key='synthetic/old',
        schema_version='1.0',upload_status='uploaded',created_at=s.ended_at-timedelta(days=100)))
    db.commit()
    run_legacy_sweep(db,now=s.ended_at+timedelta(days=1),retention_days=90)
    assert db.get(EEGRawChunk,r.id) is not None
    assert db.get(EEGRecord,rec.id).file_count==1


def test_삭제완료_키가_다시_등록되면_outbox를_재활성화(db,staging):
    from app.services import retention_sweep_service as retention
    from app.models.research_export import ObjectDeletionOutbox
    s,p,c,r=seed_v3(db,staging);c.consented=False
    db.add(ObjectDeletionOutbox(object_key=r.object_key,source_table='eeg_raw_chunks',reason='raw_retention_90_days',state='done'))
    db.commit()
    retention.sweep_biosignal_originals(db,now=s.ended_at+timedelta(days=91),apply_from=None,execute=True)
    assert db.query(ObjectDeletionOutbox).one().state=='pending'
