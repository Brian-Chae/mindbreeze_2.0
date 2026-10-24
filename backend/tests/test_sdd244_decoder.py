"""T03 순수 바이너리 검사: --noconftest, DB/환경 설정을 로드하지 않는다."""
import csv
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import struct
import sys
from fractions import Fraction
from uuid import UUID

import pytest

ROOT = Path(__file__).resolve().parents[2]
FIX = ROOT / 'specs/sdd-244-biosignal-raw-pipeline/contracts/fixtures'


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


# 통합 pytest에서 이미 로드된 DTO를 바꾸면 클래스 동등성 검사가 깨진다.
schema = sys.modules.get('app.schemas.biosignal') or load('app.schemas.biosignal', ROOT / 'backend/app/schemas/biosignal.py')


@pytest.fixture
def decoder():
    path = ROOT / 'backend/app/services/biosignal_decoder.py'
    assert path.exists(), 'T03 디코더 미구현'
    return load('sdd244_decoder_test', path)


def parts(signal):
    data = (FIX / f'{signal}-raw-v2.bin').read_bytes()
    length = struct.unpack_from('<I', data, 8)[0]
    return json.loads(data[12:12+length]), bytearray(data[12+length:])


def pack(header, body):
    encoded = json.dumps(header, separators=(',', ':')).encode()
    return b'MBRAW002' + struct.pack('<I', len(encoded)) + encoded + body


def meta(payload, header=None):
    if header is None:
        length = struct.unpack_from('<I', payload, 8)[0]
        header = json.loads(payload[12:12+length])
    return schema.RawChunkMeta(session_id=UUID(int=1), participant_id=UUID(int=2),
        play_group_id=None, chunk_id=UUID(int=3), header=header,
        checksum=hashlib.sha256(payload).hexdigest(), size_bytes=len(payload),
        object_key='synthetic.bin', object_version_id=None)


@pytest.mark.parametrize('signal', ['eeg', 'ppg', 'acc'])
def test_golden_bits_csv_parquet_and_packet_provenance(decoder, signal):
    payload = (FIX / f'{signal}-raw-v2.bin').read_bytes()
    samples = list(decoder.decode_raw_chunk(payload, meta(payload)))
    expected = json.loads((FIX / 'raw-golden.json').read_text())[signal]['rows']
    assert [list(s.raw_values) for s in samples] == expected
    rows = list(decoder.iter_csv_rows(samples))
    with (FIX / f'{signal}-expected.csv').open(newline='') as f:
        assert rows == list(csv.DictReader(f))
    typed = list(decoder.iter_parquet_rows(samples))
    for sample, csv_row, typed_row in zip(samples, rows, typed):
        assert sample.packet.tick_raw == '65536'
        assert sample.packet.received_monotonic_us is not None
        assert sample.relative_us == Fraction(sample.sample_index * 1_000_000, meta(payload).header.rate.numerator)
        for channel, value in zip(sample.channels, sample.values):
            assert typed_row[channel] == value
            if signal != 'ppg':
                assert struct.pack('<f', float(csv_row[channel])) == struct.pack('<f', value)
    if signal == 'eeg':
        assert [s.lead_off for s in samples] == [0, 1, 4, 5]
        assert [(s.fp1_lead_off, s.fp2_lead_off) for s in samples] == [(False,False),(True,False),(False,True),(True,True)]


@pytest.mark.parametrize('case', ['hash', 'truncated', 'magic', 'header_length', 'trailing', 'nan', 'adc', 'packet_overlap', 'sample_overlap', 'clock', 'packet_count', 'version'])
def test_rejects_before_first_row(decoder, case):
    header, body = parts('eeg')
    original = pack(header, body)
    metadata = meta(original)
    if case == 'hash':
        payload = original[:-1] + b'!'
    elif case == 'truncated':
        payload = original[:-1]
        metadata = metadata.model_copy(update={'checksum': hashlib.sha256(payload).hexdigest(), 'size_bytes': len(payload)})
    elif case == 'magic':
        payload = b'MBRAW099' + original[8:]
    elif case == 'header_length':
        payload = original[:8] + struct.pack('<I', 65537) + original[12:]
    else:
        if case == 'trailing': body += b'!'
        if case == 'nan': struct.pack_into('<f', body, 9, float('nan'))
        if case == 'adc': struct.pack_into('<i', body, 0, -8388609)
        if case in ('packet_overlap', 'sample_overlap', 'clock'):
            section = header['sections'][2]
            maps = [json.loads(line) for line in body[section['offset']:].splitlines()]
            if case == 'packet_overlap': maps[1]['byte_offset'] = 0
            if case == 'sample_overlap': maps[0]['first_sample_index'] = 1
            if case == 'clock': maps[0]['clock_segment_id'] = str(UUID(int=99))
            new = b''.join(json.dumps(m).encode() + b'\n' for m in maps)
            body[section['offset']:] = new
            section['length'] = len(new)
        if case == 'packet_count': header['packet_count'] += 1
        if case == 'version': header['schema_version'] = 'future'
        payload = pack(header, body)
    if case != 'hash':
        metadata = metadata.model_copy(update={'checksum': hashlib.sha256(payload).hexdigest(), 'size_bytes': len(payload)})
        if case not in ('version', 'magic', 'header_length', 'truncated'):
            metadata = metadata.model_copy(update={'header': schema.RawHeader.model_validate(header)})
    with pytest.raises(decoder.DecodeError):
        next(decoder.decode_raw_chunk(payload, metadata))


@pytest.mark.parametrize('case', json.loads((FIX / 'time-golden.json').read_text())['cases'])
def test_rational_time_no_drift(decoder, case):
    header = schema.RawHeader.model_validate(json.loads((FIX / 'raw-v2.json').read_text())[2])
    rate = schema.Rate(numerator=case['rate'], denominator=1)
    assert decoder.sample_relative_us(header.anchor, rate, case['index']) == Fraction(case['expected_numerator'], case['expected_denominator'])


def test_legacy_values_null_and_unknown_time(decoder):
    payload = struct.pack('<ffff', -0.0, 1.25, -2.5, 0.0)
    metadata = decoder.LegacyRawChunkMeta(checksum=hashlib.sha256(payload).hexdigest(), size_bytes=len(payload), sample_count=2)
    samples = list(decoder.decode_raw_chunk(payload, metadata))
    assert [s.values for s in samples] == [(-0.0,1.25),(-2.5,0.0)]
    assert all(s.adc is None and s.packet is None and s.relative_us is None for s in samples)
    assert samples[0].null_reasons['adc'] == 'not_recorded_in_legacy'
    assert list(decoder.iter_csv_rows(samples))[0] == {'timestamp':'','fp1':'-0','fp2':'1.25'}
    assert struct.pack('<f', samples[0].values[0]) == b'\x00\x00\x00\x80'


@pytest.mark.parametrize('version', ['1.0', 'future', 'mb-biosignal-raw-v2'])
def test_unknown_legacy_version_unsupported(decoder, version):
    payload = b'\x00' * 8
    metadata = decoder.LegacyRawChunkMeta(checksum=hashlib.sha256(payload).hexdigest(), size_bytes=8, sample_count=1, schema_version=version)
    with pytest.raises(decoder.UnsupportedRawVersion):
        list(decoder.decode_raw_chunk(payload, metadata))


def test_gap_metadata_preserved_without_inventing_samples(decoder):
    payload = (FIX / 'acc-raw-v2.bin').read_bytes()
    gap = schema.GapEvent.model_validate(json.loads((FIX / 'manifest-v1.json').read_text())[0]['gaps'][0])
    result = decoder.decode_raw_chunk_with_gaps(payload, meta(payload), gaps=[gap])
    assert result.gaps == (gap,)
    assert len(result.samples) == 3
    assert result.packets[-1].malformed_reason == 'truncated_packet'
    assert result.packet_bytes.endswith(b'\xff')


@pytest.mark.parametrize('case', ['unsupported_schema', 'truncated_header', 'checksum_mismatch', 'section_overlap', 'nonfinite_sample'])
def test_contract_error_codes(decoder, case):
    header, body = parts('eeg')
    payload = pack(header, body)
    metadata = meta(payload)
    if case == 'unsupported_schema': payload = b'MBRAW999' + payload[8:]
    elif case == 'truncated_header': payload = payload[:8] + struct.pack('<I', len(payload)) + payload[12:]
    elif case == 'checksum_mismatch': payload = payload[:-1] + b'!'
    elif case == 'section_overlap':
        header['sections'][1]['offset'] = 0
        payload = pack(header, body)
    elif case == 'nonfinite_sample':
        struct.pack_into('<f', body, 3 * 17 + 9, float('inf'))
        payload = pack(header, body)
    if case != 'checksum_mismatch':
        metadata = metadata.model_copy(update={'checksum': hashlib.sha256(payload).hexdigest(), 'size_bytes': len(payload)})
    errors = {row['id']: row['expected'] for row in json.loads((FIX / 'error-cases.json').read_text())}
    with pytest.raises(decoder.DecodeError) as caught:
        decoder.decode_raw_chunk(payload, metadata)
    assert caught.value.code == errors[case]


@pytest.mark.parametrize('case', ['stride', 'metadata', 'physical', 'uint24', 'scale', 'map_truncated', 'map_duplicate', 'tick_wrap'])
def test_semantic_corruption(decoder, case):
    signal = 'ppg' if case == 'uint24' else 'eeg'
    header, body = parts(signal)
    if case == 'stride': header['sections'][0]['row_stride'] = 8
    elif case == 'physical': struct.pack_into('<f', body, 9, 1.0)
    elif case == 'uint24': struct.pack_into('<I', body, 0, 2**24)
    elif case == 'scale': header['scale'][0] = 1.0
    elif case == 'map_truncated':
        body.pop()
        body.pop()
        header['sections'][2]['length'] -= 2
    elif case in ('map_duplicate', 'tick_wrap'):
        section = header['sections'][2]
        maps = [json.loads(line) for line in body[section['offset']:].splitlines()]
        if case == 'map_duplicate': maps[1]['packet_seq'] = maps[0]['packet_seq']
        else: maps[0]['tick_unwrapped'] = '65537'
        encoded = b''.join(json.dumps(m).encode() + b'\n' for m in maps)
        body[section['offset']:] = encoded
        section['length'] = len(encoded)
    payload = pack(header, body)
    metadata = meta((FIX / f'{signal}-raw-v2.bin').read_bytes()) if case == 'stride' else meta(payload)
    metadata = metadata.model_copy(update={'checksum': hashlib.sha256(payload).hexdigest(), 'size_bytes': len(payload)})
    if case == 'metadata': metadata = metadata.model_copy(update={'header': metadata.header.model_copy(update={'chunk_index': 99})})
    with pytest.raises(decoder.DecodeError): decoder.decode_raw_chunk(payload, metadata)


@pytest.mark.parametrize('case', ['stride', 'count', 'nonfinite', 'checksum', 'v2_bytes'])
def test_legacy_rejects_corrupt_input(decoder, case):
    payload = struct.pack('<ffff', 0, 1, 2, 3)
    if case == 'stride': payload += b'!'
    if case == 'nonfinite': payload = struct.pack('<ffff', 0, 1, float('nan'), 3)
    if case == 'v2_bytes': payload = b'MBRAW002' * 2
    metadata = decoder.LegacyRawChunkMeta(checksum='a'*64 if case == 'checksum' else hashlib.sha256(payload).hexdigest(), size_bytes=len(payload), sample_count=3 if case == 'count' else 2)
    with pytest.raises(decoder.DecodeError): decoder.decode_raw_chunk(payload, metadata)


def test_native_candidate_device_relative_with_shifted_anchor(decoder):
    header, body = parts('acc')
    header['rate']['numerator'] = 25
    header['time_basis'] = 'device_relative'
    header['anchor'].update({'utc_us': None, 'relative_us': '1234567', 'sample_index': 5})
    header['parser_profile'].update({'platform': 'native-candidate', 'verification': 'unverified'})
    payload = pack(header, body)
    samples = list(decoder.decode_raw_chunk(payload, meta(payload)))
    assert [sample.relative_us for sample in samples] == [Fraction(1034567), Fraction(1074567), Fraction(1114567)]
    assert all(sample.utc_us is None and sample.null_reasons['utc_us'] for sample in samples)
    assert all(sample.time_basis == 'device_relative' for sample in samples)


def test_legacy_confirmed_origin_retains_sample_index(decoder):
    payload = struct.pack('<ffff', 1, 2, 3, 4)
    metadata = decoder.LegacyRawChunkMeta(checksum=hashlib.sha256(payload).hexdigest(), size_bytes=16, sample_count=2, first_sample_index=500, first_sample_relative_us=100_000)
    samples = list(decoder.decode_raw_chunk(payload, metadata))
    assert [s.sample_index for s in samples] == [500, 501]
    assert [s.relative_us for s in samples] == [100_000, 104_000]


@pytest.mark.parametrize('signal', ['eeg', 'ppg', 'acc'])
@pytest.mark.parametrize('field', ['tick', 'adc'])
def test_known_wire_packet_must_match_sample_section(decoder, signal, field):
    header, body = parts(signal)
    offset = header['sections'][1]['offset']
    body[offset + (0 if field == 'tick' else 5)] ^= 1
    payload = pack(header, body)
    with pytest.raises(decoder.DecodeError): decoder.decode_raw_chunk(payload, meta(payload))


def test_sample_keeps_header_time_and_stream_provenance(decoder):
    payload = (FIX / 'eeg-raw-v2.bin').read_bytes()
    metadata = meta(payload)
    sample = next(decoder.decode_raw_chunk(payload, metadata))
    assert sample.header == metadata.header
    assert sample.utc_us == int(metadata.header.anchor.utc_us)
