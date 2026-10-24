"""합성 G1 자료 재생성. 앱/config/decoder를 import하지 않는다. 실제 장치 증거 아님."""
import csv
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
spec = importlib.util.spec_from_file_location('sdd244_contract', ROOT / 'backend/app/schemas/biosignal.py')
dto = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = dto
spec.loader.exec_module(dto)
FIX = HERE / 'fixtures'
HASH = 'a' * 64
UUID = '00000000-0000-4000-8000-000000000001'


def write(name, value):
    (HERE / name).write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n')


def sha(payload):
    return hashlib.sha256(payload).hexdigest()


profile = dict(firmware='unknown', device_model='LINK-BAND-2.0-synthetic', profile_id='mb-web-clock-v1', version='1', parameters_hash=HASH, platform='synthetic', verification='synthetic_only', packet_endian='mixed', tick_hz=32768, tick_bits=32, header_anchor='last_sample')
algorithm = dict(algorithm_id='mb-synthetic', algorithm_version='fixture-v1', parameters_hash=HASH, parameters={'synthetic': True}, filter_version='fixture-v1', build='sdd244-fixture')
metric_params = dict(m=None, s=None, direction=None, source='b0', b0_version='synthetic-b0-v1', fallback_reason='synthetic_fixture')
model = dict(model_id_alias='Model01', version='synthetic-v1', params_hash=HASH, focus=metric_params, relaxation=metric_params, emotional=metric_params, formula_version='fixture-v1', formula_constants={'center': 50.0, 'range': 50.0}, source='b0', cached=False)
headers, golden = [], {}
# 직접 고정한 경계 ADC와 정확한 float32 값. 생산 decoder/환산 함수와 독립이다.
rows = {
    'eeg': [[-8388608,8388607,0,-336083.375,336083.34375], [0,-1,1,0.0,-0.040064260363578796], [1,0,4,0.040064260363578796,0.0], [0,0,5,0.0,0.0]],
    'ppg': [[0,16777215], [1,255], [12345,67890]],
    'acc': [[-32768,32767,0,-2.0,1.99993896484375,0.0], [16384,-16384,1,1.0,-1.0,0.00006103515625], [0,0,-1,0.0,0.0,-0.00006103515625]],
}
for signal, (fmt, channels, units, rate, scales) in {
    'eeg': ('<iiBff',['fp1','fp2'],['uV','uV'],250,[4.033/12/(2**23-1)*1e6]*2),
    'ppg': ('<II',['red','ir'],['ADC_count','ADC_count'],50,[1.0]*2),
    'acc': ('<hhhfff',['x','y','z'],['g','g','g'],30,[1/16384]*3),
}.items():
    raw = b''.join(struct.pack(fmt, *row) for row in rows[signal])
    # 실제 MB parser framing에 합성 센서값을 넣는다. 실기기 규격 인증 아님.
    wire = (65536).to_bytes(4, 'big' if signal == 'ppg' else 'little')
    for row in rows[signal]:
        if signal == 'eeg':
            wire += bytes([row[2]]) + row[0].to_bytes(3,'big',signed=True) + row[1].to_bytes(3,'big',signed=True)
        elif signal == 'ppg':
            wire += row[0].to_bytes(3,'big') + row[1].to_bytes(3,'big')
        else:
            wire += struct.pack('<hhh',*row[:3])
    packets = wire + b'\xff'
    packet_map = [dict(packet_seq=0, byte_offset=0, byte_length=len(packets)-1, first_sample_index=0, sample_count=len(rows[signal]), tick_raw='65536', tick_unwrapped='65536', received_utc_us='1780000000000000', received_monotonic_us='2000000', header_anchor='last_sample', clock_segment_id=UUID, malformed_reason=None), dict(packet_seq=1, byte_offset=len(packets)-1, byte_length=1, first_sample_index=None, sample_count=0, tick_raw=None, tick_unwrapped=None, received_utc_us='1780000000000001', received_monotonic_us='2000001', header_anchor='unknown', clock_segment_id=UUID, malformed_reason='truncated_packet')]
    maps = b''.join((json.dumps(m, separators=(',', ':'))+'\n').encode() for m in packet_map)
    codec = {'eeg':'eeg-i32-i32-u8-f32-f32-le','ppg':'ppg-u32-u32-le','acc':'acc-i16-i16-i16-f32-f32-f32-le'}[signal]
    header = dict(schema_version='mb-biosignal-raw-v2', signal_type=signal, stream_id=UUID, segment_id=UUID, chunk_index=0, parser_profile=profile, rate={'numerator':rate,'denominator':1}, observed_rate=None, observed_rate_window_us=None, observed_rate_reason='synthetic_not_device_measurement', channels=channels, units=units, scale=scales, sample_count=len(rows[signal]), packet_count=2, first_sample_index=0, end_sample_index_exclusive=len(rows[signal]), time_basis='host_estimated', anchor=dict(sample_index=0, utc_us='1780000000000000', monotonic_us='2000000', relative_us='0', device_tick_raw='65536', device_tick_unwrapped='65536', clock_segment_id=UUID, uncertainty_us=None, rule='anchor_plus_index_delta_over_rate'), sections=[dict(name='samples',offset=0,length=len(raw),row_stride=struct.calcsize(fmt),encoding=codec),dict(name='packets',offset=len(raw),length=len(packets),row_stride=0,encoding='bytes'),dict(name='packet_map',offset=len(raw)+len(packets),length=len(maps),row_stride=0,encoding='utf8-jsonl')])
    dto.RawHeader.model_validate(header)
    encoded = json.dumps(header, separators=(',', ':')).encode()
    payload = b'MBRAW002'+struct.pack('<I',len(encoded))+encoded+raw+packets+maps
    (FIX / (signal+'-raw-v2.bin')).write_bytes(payload)
    headers.append(header)
    golden[signal] = dict(file=signal+'-raw-v2.bin', sha256=sha(payload), rows=rows[signal], packet_hex=packets.hex())
    with (FIX / (signal+'-expected.csv')).open('w', newline='') as handle:
        writer = csv.writer(handle)
        writer.writerow(['timestamp']+channels)
        for i,row in enumerate(rows[signal]):
            values = row[3:] if signal in ('eeg','acc') else row
            writer.writerow([format(i/rate,'.12g')]+[format(v,'.9g') if signal != 'ppg' else str(v) for v in values])
# 네이티브는 검증 전 후보일 뿐: rate 25를 별도 기록하며 웹값 재라벨 금지.
acc25 = json.loads(json.dumps(headers[-1]))
acc25['rate']['numerator'] = 25
acc25['parser_profile'].update(profile_id='native-candidate-v1', platform='native-candidate', verification='unverified', header_anchor='first_sample', packet_endian='unknown')
acc25['time_basis'] = 'device_relative'
acc25['anchor']['utc_us'] = None
acc25['observed_rate_reason'] = 'native_device_not_verified'
headers.append(acc25)
write('fixtures/raw-v2.json', headers)
write('fixtures/raw-golden.json', golden)
write('fixtures/time-golden.json', dict(rule='anchor+(sample_index-anchor.sample_index)*1000000*denominator/numerator; round only final output', cases=[dict(rate=250,index=1,expected_numerator=4000,expected_denominator=1),dict(rate=50,index=1,expected_numerator=20000,expected_denominator=1),dict(rate=30,index=1,expected_numerator=100000,expected_denominator=3),dict(rate=30,index=108000,expected_numerator=3600000000,expected_denominator=1),dict(rate=25,index=1,expected_numerator=40000,expected_denominator=1)]))
ref = dict(artifact_id_alias='Derived01', sha256=HASH, field_path='filteredData', first_sample_index=0, sample_count=3, availability='available', unavailable_reason=None)
quality_refs = {key:{**ref,'field_path':key} for key in ['sqi','redSQI','irSQI','overallSQI','ch1SQI','ch2SQI']}
eeg = dict(filteredData=ref, signalQuality=dict(overall=95.0,fp1=94.0,fp2=96.0,sqi=quality_refs['sqi']), bandPowers={key:1.0 for key in ['delta','theta','alpha','beta','gamma']}, brainState=dict(currentState='neutral',confidence=0.5,stateHistory=['neutral'],recommendations=None,metrics=None), frequencySpectrum=dict(frequencies=[1.0,2.0],ch1Power=[0.5,0.25],ch2Power=[0.25,0.5],timestamp=0.0), indices={key:0.5 for key in dto.EEGIndices.model_fields}, rawAnalysis={key:quality_refs[key] for key in ['ch1SQI','ch2SQI','overallSQI']}, channelBandPowers=None,channelBandPowers_reason='not_emitted_by_current_processor')
ppg = dict(filteredData=ref,signalQuality=dict(overall=90.0,red=89.0,ir=91.0,**{key:quality_refs[key] for key in ['sqi','redSQI','irSQI','overallSQI']}),vitals=dict(heartRate=60.0,hrv=12.0,spo2=None),peakInfo=dict(peakCount=3,avgPeakInterval=1000.0,peakQuality=0.9),advancedHRV={key:1.0 for key in dto.AdvancedHRV.model_fields},rrIntervals=[980.0,1000.0,1020.0],beats=None,beats_reason='not_emitted_by_current_processor')
acc = dict(filteredData=ref,magnitude={**ref,'field_path':'magnitude'},activity=dict(type='stationary',confidence=1.0,intensity=0.0),movement=dict(avgMovement=0.0,stdMovement=0.0,maxMovement=0.0,totalMovement=0.0),posture=dict(tiltAngle=0.0,stability=1.0,balance=1.0),signalQuality=dict(overall=1.0,reliability=1.0,consistency=1.0))
features=[]
for signal,output in [('eeg',eeg),('ppg',ppg),('acc',acc)]:
    scalars = {key:None for key in dto.FeatureScalars.model_fields}
    scalars.update(focus_index=0.5,sdnn=20.0,rmssd=30.0)
    value = dict(schema_version='feature-v1',feature_id_alias='Feature'+signal,sequence=0,signal=signal,play_group_id=None,window_index=0,t_rel_ms=0.0,computed_at_us='1000000',measured_at_us='0',algorithm=algorithm,source_windows=[dict(signal=signal,stream_alias='Stream01',segment_alias='Segment01',raw_artifact_id_alias='Raw01',raw_sha256=golden[signal]['sha256'],first_sample_index=0,end_sample_index_exclusive=3,time_range=dict(from_us='0',to_us='100000'),valid_sample_count=3)],scalars=scalars,scalar_null_reasons={key:'not_collected' for key,v in scalars.items() if v is None},eeg=None,ppg=None,acc=None,quality='synthetic',detail_null_reasons={'ppg.vitals.spo2':'not_emitted_by_current_processor'} if signal=='ppg' else {})
    value[signal]=output
    features.append(dto.FeatureRecord.model_validate(value).model_dump(mode='json'))
write('fixtures/feature-v1.json',features)


def metric(value, physical=False):
    return dict(input_source='local_ble',event_age_ms=0.0,value=value,display_input=float(value) if value is not None else None,normalized_output=None if physical or value is None else float(value),measured_at_us='0',source_feature_id='Feature01',provenance_reason=None,held=False,stale=False,lead_off=False,quality='synthetic',null_reason='insufficient_window' if value is None else None,normalization_source='physical' if physical else 'b0')


snapshot=dict(schema_version='indices-v1',stream_alias='Stream01',view_instance_alias='View01',view_kind='participant_player',second_index=0,t_rel_ms=0.0,play_group_id=None,window_index=0,displayed_at_us='1000000',render_status='rendered',focus=metric(50),relaxation=metric(60),emotional=metric(70),bpm=metric(60,True),respiration=metric(None,True),hrv=metric(20,True),hrv_metric='sdnn',normalization=model,algorithm=algorithm,display_pipeline_version='synthetic-v1',source='displayed',display_match=True,unavailable_reason=None)
snapshots=[snapshot]
for kind in ['not_rendered','unavailable']:
    value=json.loads(json.dumps(snapshot))
    value.update(render_status=kind,displayed_at_us=None,source='unavailable',display_match='unverified',unavailable_reason='display_history_missing' if kind=='unavailable' else 'not_rendered',normalization=None,algorithm=None,display_pipeline_version=None)
    for name in ['focus','relaxation','emotional','bpm','respiration','hrv']:
        value[name]=dict(input_source='unavailable',event_age_ms=None,value=None,display_input=None,normalized_output=None,measured_at_us=None,source_feature_id=None,provenance_reason=value['unavailable_reason'],held=False,stale=False,lead_off=False,quality='unknown',null_reason=value['unavailable_reason'],normalization_source='unavailable')
    snapshots.append(value)
write('fixtures/indices-v1.json',[dto.DisplaySnapshot.model_validate(v).model_dump(mode='json') for v in snapshots])
artifacts=[]
for i,kind in enumerate(['raw','feature','raw_derived','indices','normalization','algorithm','gap']):
    artifacts.append(dict(artifact_id_alias='Artifact'+str(i),artifact_kind=kind,path='class-C01/session-001_date-withheld/participant-P01/'+kind+'/fixture.json',schema_version=kind+'-v1',dictionary_key=kind,row_count=1,size_bytes=1,sha256=HASH,uncompressed_sha256=None,time_range=dict(from_us='0',to_us='1000000'),selection=dict(from_us='0',to_us='1000000'),extra_range=[],retention_deadline_us=None,consent_scope=['synthetic-only'],consent_version='synthetic-v1',retention='raw_90_days' if kind in ('raw','raw_derived') else 'feature_policy',availability='available',unavailable_reason=None,ack_state='verified'))
artifacts[0].update(path='class-C01/session-001_date-withheld/participant-P01/raw/eeg/stream-S01/segment-001/chunk-000000.bin',schema_version='mb-biosignal-raw-v2',sha256=golden['eeg']['sha256'],size_bytes=(FIX/'eeg-raw-v2.bin').stat().st_size,row_count=4)
gap=dict(discovered_at_us='1000000',event_id_alias='Gap01',signal='eeg',stream_alias='Stream01',segment_alias='Segment01',start_us='1000000',end_us=None,reason='process_terminated',observed_or_estimated='unknown',expected_samples=None,received_samples=None,reconnect_count=0,sequence=0)
manifest=dict(schema_version='manifest-v1',revision=1,session_alias='Session01',participant_alias='Participant01',close_state='complete',close_intent=dict(intent_id_alias='Intent01',expected_artifacts={a['artifact_id_alias']:a['sha256'] for a in artifacts},streams=[dict(stream_alias='Stream01',segment_alias='Segment01',signal='eeg',last_chunk_sequence=0,last_feature_sequence=0,received_samples=4),dict(stream_alias='Stream01',segment_alias='Segment02',signal='eeg',last_chunk_sequence=0,last_feature_sequence=0,received_samples=0)],snapshots=[dict(stream_alias='Stream01',view_instance_alias='View01',last_snapshot_sequence=0)],last_gap_sequence=0,end_reason='synthetic_close_after_unknown_tail'),time_basis='session_relative',default_view='participant_player',streams=[dict(stream_alias='Stream01',segment_alias='Segment01',signal='eeg',profile=profile,rate={'numerator':250,'denominator':1},observed_rate=None,observed_rate_window_us=None,observed_rate_reason='synthetic_only',channels=['fp1','fp2'],units=['uV','uV'],time_basis='session_relative')],signals=[dict(signal=s,availability='available' if s=='eeg' else 'not_collected',unavailable_reason=None if s=='eeg' else 'band_signal_not_collected',expected_samples=None,acked_samples=4 if s=='eeg' else 0,lost_samples=None,unknown_samples=s=='eeg') for s in ['eeg','ppg','acc']],artifacts=artifacts,gaps=[gap],models=[model],algorithms=[algorithm],policy_recheck_required=True,raw_packet_policy='blocked_requires_redaction')
manifests=[manifest]
pending=json.loads(json.dumps(manifest)); pending.update(revision=2,close_state='pending_upload'); pending['artifacts'][2]['ack_state']='pending'; manifests.append(pending)
write('fixtures/manifest-v1.json',[dto.ManifestRevision.model_validate(v).model_dump(mode='json') for v in manifests])
for name,cls in [('raw-v2',dto.RawHeader),('manifest-v1',dto.ManifestRevision),('feature-v1',dto.FeatureRecord),('indices-v1',dto.DisplaySnapshot)]:
    write(name+'.schema.json',cls.model_json_schema())
fields={}
for key in dto.FeatureScalars.model_fields:
    unit = 'ms' if key in ('sdnn','rmssd') else 'bpm' if key=='heart_rate' else 'breaths/min' if key=='respiratory_rate' else 'uV^2' if key.endswith('_power') and key not in ('lf_power','hf_power') else 'unknown'
    fields['features.'+key]=dict(name=key,type='string' if key=='quality' else 'number',unit=unit,nullable=True,null_reason='scalar_null_reasons.'+key,source_metric=key,source_layer='feature',precision='float64; NaN/Inf forbidden',time_basis='session_relative; device_timestamp_ms redacted to null',schema_version='feature-v1',algorithm_version='record.algorithm.algorithm_version')
for key in ['focus','relaxation','emotional','bpm','respiration','hrv']:
    fields['indices.'+key]=dict(name=key,type='integer',unit='0-100' if key in ('focus','relaxation','emotional') else {'bpm':'bpm','respiration':'breaths/min','hrv':'ms'}[key],nullable=True,null_reason=key+'.null_reason',source_metric={'focus':'focus_index','relaxation':'relaxation_index','emotional':'emotional_stability','bpm':'heart_rate','respiration':'respiratory_rate','hrv':'sdnn'}[key],source_layer='display',precision='display integer; input float64',time_basis='session_relative',schema_version='indices-v1',algorithm_version='record.algorithm.algorithm_version')
# 구조 필드까지 자동 열거하여 사전 누락을 막되 의미/단위는 아래 명시 규칙을 우선한다.
for name,cls in [('raw',dto.RawHeader),('manifest',dto.ManifestRevision),('feature',dto.FeatureRecord),('indices',dto.DisplaySnapshot)]:
    schema=cls.model_json_schema()
    def walk(node, prefix, ancestors=()):
        if '$ref' in node:
            refname=node['$ref'].split('/')[-1]
            if refname in ancestors:return
            return walk(schema['$defs'][refname],prefix,ancestors+(refname,))
        if 'properties' in node:
            for key,item in node['properties'].items():walk(item,prefix+'.'+key,ancestors)
        elif node.get('type')=='array':walk(node['items'],prefix+'[]',ancestors)
        else:
            fields.setdefault(prefix,dict(name=prefix,type=node.get('type','union'),unit='us' if prefix.endswith('_us') else 'Hz rational' if '.rate.' in prefix else 'not_applicable',nullable=any(v.get('type')=='null' for v in node.get('anyOf',[])),null_reason='context-specific reason field; see DTO/README',source_metric=prefix,source_layer=name,precision='JSON numbers finite; int64 decimal strings; raw float32 CSV 9 significant digits',time_basis='record time_basis or session_relative',schema_version=next(iter(schema['properties']['schema_version'].get('enum',[])),schema['properties']['schema_version'].get('const')),algorithm_version='record algorithm/profile version'))
            for option in node.get('anyOf',[]):
                if '$ref' in option:walk(option,prefix,ancestors)
    walk(schema,name)
write('field-dictionary-v1.json',dict(schema_version='field-dictionary-v1',csv=dict(encoding='UTF-8',format='RFC4180',null='',decimal_separator='.',float32_significant_digits=9,time_selection='[from,to)'),fields=fields))
write('fixtures/error-cases.json',[
    dict(id='unsupported_schema',stage='T03 decoder',mutation='magic MBRAW999',expected='unsupported_schema'),
    dict(id='truncated_header',stage='T03 decoder',mutation='header_len exceeds payload',expected='truncated_header'),
    dict(id='checksum_mismatch',stage='T03 decoder',mutation='flip final byte',expected='checksum_mismatch'),
    dict(id='section_overlap',stage='G1 DTO + T03 decoder',mutation='packets.offset=0',expected='invalid_sections'),
    dict(id='nonfinite_sample',stage='T03 decoder',mutation='EEG float32 NaN',expected='nonfinite_sample'),
    dict(id='unknown_loss',stage='G1 DTO',mutation='unknown gap expected_samples=20',expected='unknown_count_must_be_null'),
])
