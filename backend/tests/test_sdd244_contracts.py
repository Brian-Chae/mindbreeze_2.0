"""G1 순수 계약 검사. --noconftest로 실행하여 DB/설정 파일을 로드하지 않는다."""
import csv
import hashlib
import importlib.util
import json
from pathlib import Path
import struct

import pytest

ROOT = Path(__file__).resolve().parents[2]
CONTRACTS = ROOT / 'specs/sdd-244-biosignal-raw-pipeline/contracts'


def read(name):
    return json.loads((CONTRACTS / name).read_text())


def dto():
    path = ROOT / 'backend/app/schemas/biosignal.py'
    assert path.exists(), 'G1 typed DTO가 아직 없다'
    spec = importlib.util.spec_from_file_location('sdd244_biosignal', path)
    module = importlib.util.module_from_spec(spec)
    import sys
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize('name,model', [('raw-v2','RawHeader'), ('manifest-v1','ManifestRevision'), ('feature-v1','FeatureRecord'), ('indices-v1','DisplaySnapshot')])
def test_frozen_schema_matches_dto_and_golden(name, model):
    module = dto()
    cls = getattr(module, model)
    schema = read(name + '.schema.json')
    assert schema == cls.model_json_schema()
    from jsonschema import Draft202012Validator, FormatChecker
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    for value in read('fixtures/' + name + '.json'):
        validator.validate(value)
        assert cls.model_validate(value).model_dump(mode='json') == value


@pytest.mark.parametrize('signal,stride,fmt', [('eeg',17,'<iiBff'), ('ppg',8,'<II'), ('acc',18,'<hhhfff')])
def test_independent_binary_samples_and_packet_mapping(signal, stride, fmt):
    golden = read('fixtures/raw-golden.json')[signal]
    payload = (CONTRACTS / 'fixtures' / golden['file']).read_bytes()
    assert hashlib.sha256(payload).hexdigest() == golden['sha256']
    assert payload[:8] == b'MBRAW002'
    length = struct.unpack_from('<I', payload, 8)[0]
    header = json.loads(payload[12:12+length])
    dto().RawHeader.model_validate(header)
    body = payload[12+length:]
    sections = {s['name']: s for s in header['sections']}
    samples = sections['samples']
    assert samples['row_stride'] == stride
    actual = list(struct.iter_unpack(fmt, body[samples['offset']:samples['offset']+samples['length']]))
    assert [list(row) for row in actual] == golden['rows']
    packets = sections['packets']
    assert body[packets['offset']:packets['offset']+packets['length']].hex() == golden['packet_hex']
    mapping = sections['packet_map']
    maps = [json.loads(s) for s in body[mapping['offset']:mapping['offset']+mapping['length']].splitlines()]
    assert sum(row['sample_count'] for row in maps) == len(actual)
    assert maps[-1]['malformed_reason'] == 'truncated_packet'
    assert maps[-1]['sample_count'] == 0
    for row in maps:
        dto().PacketMap.model_validate(row)
    with (CONTRACTS / 'fixtures' / (signal + '-expected.csv')).open(newline='') as handle:
        csv_rows = list(csv.DictReader(handle))
    assert len(csv_rows) == len(actual)
    for i, row in enumerate(csv_rows):
        assert float(row['timestamp']) == pytest.approx(i / header['rate']['numerator'], abs=1e-9)


@pytest.mark.parametrize('case', ['unknown_schema','bad_rate','overlap','bad_stride','negative_count','unsafe_time','extra_field','bad_channels'])
def test_raw_invalid(case):
    value = read('fixtures/raw-v2.json')[0]
    if case == 'unknown_schema': value['schema_version'] = 'future'
    elif case == 'bad_rate': value['rate']['numerator'] = 200
    elif case == 'overlap': value['sections'][1]['offset'] = 0
    elif case == 'bad_stride': value['sections'][0]['row_stride'] = 8
    elif case == 'negative_count': value['sample_count'] = -1
    elif case == 'unsafe_time': value['anchor']['utc_us'] = 1780000000000000
    elif case == 'extra_field': value['invented'] = True
    elif case == 'bad_channels': value['channels'] = ['ir','red']
    with pytest.raises(ValueError): dto().RawHeader.model_validate(value)


@pytest.mark.parametrize('case', ['complete_pending','complete_no_intent','unknown_loss','path_traversal','private_id','missing_reason'])
def test_manifest_invalid(case):
    value = read('fixtures/manifest-v1.json')[0]
    if case == 'complete_pending': value['artifacts'][0]['ack_state'] = 'pending'
    elif case == 'complete_no_intent': value['close_intent'] = None
    elif case == 'unknown_loss': value['gaps'][0]['expected_samples'] = 20
    elif case == 'path_traversal': value['artifacts'][0]['path'] = '../secret'
    elif case == 'private_id': value['session_id'] = '00000000-0000-4000-8000-000000000001'
    elif case == 'missing_reason': value['signals'][2]['unavailable_reason'] = None
    with pytest.raises(ValueError): dto().ManifestRevision.model_validate(value)


@pytest.mark.parametrize('case', ['nan','inf','missing_field','raw_waveform'])
def test_feature_invalid(case):
    value = read('fixtures/feature-v1.json')[0]
    if case == 'nan': value['scalars']['focus_index'] = float('nan')
    elif case == 'inf': value['scalars']['focus_index'] = float('inf')
    elif case == 'missing_field': value['scalars'].pop('faa')
    elif case == 'raw_waveform': value['filteredData'] = [0,1]
    with pytest.raises(ValueError): dto().FeatureRecord.model_validate(value)


@pytest.mark.parametrize('case', ['mind_range','hrv_kind','fake_render','reconstructed_match','missing_null_reason'])
def test_indices_invalid(case):
    value = read('fixtures/indices-v1.json')[0]
    if case == 'mind_range': value['focus']['value'] = 101
    elif case == 'hrv_kind': value['hrv_metric'] = 'rmssd'
    elif case == 'fake_render': value['render_status'] = 'not_rendered'
    elif case == 'reconstructed_match': value['source'] = 'reconstructed'
    elif case == 'missing_null_reason': value['respiration']['null_reason'] = None
    with pytest.raises(ValueError): dto().DisplaySnapshot.model_validate(value)


def test_dictionary_has_legacy_27_and_display_six():
    fields = read('field-dictionary-v1.json')['fields']
    legacy = 'focus_index cognitive_load relaxation_index stress_index emotional_stability total_neural_activity faa hemispheric_balance delta_power theta_power alpha_power beta_power gamma_power total_power meditation_level attention_level signal_quality sdnn rmssd lf_power hf_power lf_hf_ratio heart_rate respiratory_rate motion quality device_timestamp_ms'.split()
    assert set(legacy) == set(dto().FeatureScalars.model_fields)
    for name in legacy:
        entry = fields['features.' + name]
        assert {'name','type','unit','nullable','null_reason','source_metric','source_layer','precision','time_basis','schema_version','algorithm_version'} <= entry.keys()
    for name in ('focus','relaxation','emotional','bpm','respiration','hrv'):
        assert 'indices.' + name in fields
    assert fields['indices.hrv']['source_metric'] == 'sdnn'


def test_legacy_scalar_quality_and_fractional_timestamp_are_preserved():
    value = read('fixtures/feature-v1.json')[0]
    value['scalars'].update(quality='valid', device_timestamp_ms=1234.125)
    value['scalar_null_reasons'].pop('quality')
    value['scalar_null_reasons'].pop('device_timestamp_ms')
    parsed = dto().FeatureRecord.model_validate(value)
    assert parsed.scalars.quality == 'valid'
    assert parsed.scalars.device_timestamp_ms == 1234.125


def test_acc_magnitude_is_raw_derived_reference():
    assert read('fixtures/feature-v1.json')[2]['acc']['magnitude']['artifact_id_alias']


@pytest.mark.parametrize('value', ['9223372036854775808', '-9223372036854775809', '-0'])
def test_int64_rejects_out_of_range_and_noncanonical(value):
    item = read('fixtures/raw-v2.json')[0]
    item['anchor']['utc_us'] = value
    with pytest.raises(ValueError): dto().RawHeader.model_validate(item)


@pytest.mark.parametrize('value', ['2.5', True])
def test_finite_numbers_reject_type_coercion(value):
    item = read('fixtures/feature-v1.json')[0]
    item['scalars']['focus_index'] = value
    with pytest.raises(ValueError): dto().FeatureRecord.model_validate(item)


def test_profile_and_export_policy_metadata_is_explicit():
    module=dto()
    assert {'firmware','device_model'} <= module.ParserProfile.model_fields.keys()
    assert {'retention_deadline_us','consent_scope','consent_version'} <= module.ArtifactReference.model_fields.keys()
    assert {'discovered_at_us'} <= module.GapEvent.model_fields.keys()
    assert {'input_source','event_age_ms'} <= module.DisplayMetric.model_fields.keys()


@pytest.mark.parametrize('signal', ['eeg', 'ppg', 'acc'])
def test_csv_preserves_adc_or_float32_round_trip(signal):
    golden = read('fixtures/raw-golden.json')[signal]['rows']
    with (CONTRACTS / 'fixtures' / (signal+'-expected.csv')).open(newline='') as handle:
        rows = list(csv.reader(handle))[1:]
    for actual, expected in zip(rows,golden,strict=True):
        if signal=='ppg':
            assert list(map(int,actual[1:])) == expected
        else:
            for text,value in zip(actual[1:],expected[3:],strict=True):
                assert struct.pack('<f',float(text)) == struct.pack('<f',value)


def test_fractional_30hz_does_not_accumulate_rounding_drift():
    from fractions import Fraction
    for case in read('fixtures/time-golden.json')['cases']:
        time = Fraction(case['index']*1_000_000,case['rate'])
        assert time == Fraction(case['expected_numerator'],case['expected_denominator'])
    profiles = read('fixtures/raw-v2.json')
    assert profiles[2]['rate']['numerator'] == 30
    assert profiles[3]['rate']['numerator'] == 25
    assert profiles[3]['time_basis'] == 'device_relative'
    assert profiles[3]['anchor']['utc_us'] is None
    assert profiles[3]['observed_rate'] is None


def test_processor_inventory_is_pinned_and_all_fields_have_destination():
    import re
    module = dto()
    for signal, item in read('fixtures/processor-inventory.json').items():
        source = (ROOT / item['source']).read_text()
        signature = source.split('Promise<{',1)[1].split('}> {',1)[0]
        assert hashlib.sha256(signature.encode()).hexdigest() == item['signature_sha256'], '처리기 emit 계약 변경: inventory/DTO 검토 필요'
        names = set(re.findall(r'^\s+(\w+)\??:', signature, re.M))
        schema = getattr(module, signal.upper()+'Output').model_json_schema()
        supported = set(schema['properties'])
        for definition in schema.get('$defs',{}).values():
            supported.update(definition.get('properties',{}))
        assert names <= supported
        assert set(item['fields']) == names


@pytest.mark.parametrize('case', ['missing_hash','missing_gap','duplicate_id','bad_expected_hash'])
def test_manifest_complete_checks_whole_expected_set(case):
    item=read('fixtures/manifest-v1.json')[0]
    if case=='missing_hash': item['close_intent']['expected_artifacts'].pop('Artifact2')
    elif case=='missing_gap': item['gaps']=[]
    elif case=='duplicate_id': item['artifacts'][1]['artifact_id_alias']='Artifact0'
    else: item['close_intent']['expected_artifacts']['Artifact2']='b'*64
    with pytest.raises(ValueError): dto().ManifestRevision.model_validate(item)


def test_ack_requires_item_identity_hash_size_and_verified_time():
    from pydantic import ValidationError
    valid=dict(chunk_id='00000000-0000-4000-8000-000000000001',checksum='a'*64,size_bytes=100,status='uploaded',verified_at_us='1000000',failure_reason=None)
    assert dto().AckReceipt.model_validate(valid).status=='uploaded'
    for key in ['chunk_id','checksum','size_bytes','verified_at_us']:
        missing={k:v for k,v in valid.items() if k!=key}
        with pytest.raises(ValidationError):dto().AckReceipt.model_validate(missing)
    with pytest.raises(ValidationError):dto().AckReceipt.model_validate({**valid,'verified_at_us':None})


@pytest.mark.parametrize('signal',['eeg','ppg','acc'])
def test_wire_bytes_and_physical_scaling_match_mb_profile(signal):
    golden=read('fixtures/raw-golden.json')[signal]
    packet=bytes.fromhex(golden['packet_hex'])[:-1]
    assert int.from_bytes(packet[:4],'big' if signal=='ppg' else 'little')==65536
    rows=golden['rows']
    if signal=='eeg':
        assert {row[2] for row in rows} == {0,1,4,5}
        for i,row in enumerate(rows):
            sample=packet[4+i*7:4+(i+1)*7]
            assert sample[0]==row[2]
            for ch in range(2):
                adc=int.from_bytes(sample[1+ch*3:4+ch*3],'big',signed=True)
                assert adc==row[ch]
                expected=struct.unpack('<f',struct.pack('<f',adc*4.033/12/(2**23-1)*1e6))[0]
                assert row[3+ch]==expected
    elif signal=='ppg':
        for i,row in enumerate(rows):
            assert all(0<=v<=16777215 for v in row)
            assert [int.from_bytes(packet[4+i*6+j*3:7+i*6+j*3],'big') for j in range(2)]==row
    else:
        for i,row in enumerate(rows):
            assert list(struct.unpack_from('<hhh',packet,4+i*6))==row[:3]
            assert [v/16384 for v in row[:3]]==row[3:]


def test_cohort_params_allow_absent_sigmoid_but_require_b0_provenance():
    value=dict(m=None,s=None,direction=None,source='b0',b0_version='b0-v1',fallback_reason='model_unavailable')
    assert dto().NormalizationMetric.model_validate(value).m is None
    with pytest.raises(ValueError):dto().NormalizationMetric.model_validate({**value,'b0_version':None})
    with pytest.raises(ValueError):dto().NormalizationMetric.model_validate({**value,'source':'standard_model'})


def test_manifest_raw_artifact_matches_delivered_binary():
    artifact=read('fixtures/manifest-v1.json')[0]['artifacts'][0]
    payload=(CONTRACTS/'fixtures/eeg-raw-v2.bin').read_bytes()
    assert artifact['sha256']==hashlib.sha256(payload).hexdigest()
    assert artifact['size_bytes']==len(payload)
    assert artifact['schema_version']=='mb-biosignal-raw-v2'


def test_close_intent_preserves_multiple_segments_and_views():
    value=read('fixtures/manifest-v1.json')[0]['close_intent']
    assert len(value['streams']) == 2
    assert value['streams'][0]['last_chunk_sequence'] == value['streams'][1]['last_chunk_sequence'] == 0
    assert value['streams'][0]['segment_alias'] != value['streams'][1]['segment_alias']
    assert value['snapshots'][0]['view_instance_alias']
    dto().CloseIntent.model_validate(value)


def test_nonfinite_detail_can_be_preserved_as_null_with_reason():
    value=read('fixtures/feature-v1.json')[0]
    value['eeg']['bandPowers']['alpha']=None
    value['eeg']['frequencySpectrum']['ch1Power'][0]=None
    value['detail_null_reasons']={'eeg.bandPowers.alpha':'nonfinite_result','eeg.frequencySpectrum.ch1Power.0':'nonfinite_result'}
    dto().FeatureRecord.model_validate(value)
    value['detail_null_reasons'].pop('eeg.bandPowers.alpha')
    with pytest.raises(ValueError):dto().FeatureRecord.model_validate(value)


def test_dictionary_display_source_metrics():
    fields=read('field-dictionary-v1.json')['fields']
    for key,source in dict(focus='focus_index',relaxation='relaxation_index',emotional='emotional_stability',bpm='heart_rate',respiration='respiratory_rate',hrv='sdnn').items():
        assert fields['indices.'+key]['source_metric']==source


def test_complete_fixture_coverage_matches_received_raw_rows():
    manifest = read('fixtures/manifest-v1.json')[0]
    eeg = next(signal for signal in manifest['signals'] if signal['signal'] == 'eeg')
    raw = manifest['artifacts'][0]
    received = sum(stream['received_samples'] for stream in manifest['close_intent']['streams'] if stream['signal'] == 'eeg')
    assert eeg['acked_samples'] == raw['row_count'] == received
