"""SDD-244 순수 디코더. I/O·DB·인가 없이 검증된 샘플과 반출 행을 만든다.

반출 인가와 파일 단위 시간축 선택은 호출자 책임이다. legacy의 상대 원점은
확인된 경우에만 전달하며, 수신시각을 샘플 시각으로 대신 사용하지 않는다.
"""
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from fractions import Fraction
import hashlib
import json
import math
import struct
from typing import TypeAlias

from pydantic import ValidationError

from app.schemas.biosignal import Anchor, GapEvent, PacketMap, Rate, RawChunkMeta, RawHeader


class DecodeError(ValueError):
    """손상되거나 계약과 맞지 않는 청크."""

    def __init__(self, message: str, code: str = 'invalid_chunk') -> None:
        super().__init__(message)
        self.code = code


class UnsupportedRawVersion(DecodeError):
    """내용 해석 근거가 없는 버전."""

    def __init__(self, message: str) -> None:
        super().__init__(message, 'unsupported_schema')


@dataclass(frozen=True)
class LegacyRawChunkMeta:
    """확인된 EEG v1에만 사용하는 내부 메타. 1.0을 v1로 추정하지 않는다."""

    checksum: str
    size_bytes: int
    sample_count: int
    schema_version: str = 'eeg-raw-v1'
    first_sample_index: int = 0
    first_sample_relative_us: int | None = None


Number: TypeAlias = int | float


@dataclass(frozen=True)
class DecodedSample:
    signal_type: str
    schema_version: str
    sample_index: int
    channels: tuple[str, ...]
    values: tuple[Number, ...]
    raw_values: tuple[Number, ...]
    adc: tuple[int, ...] | None
    lead_off: int | None
    relative_us: Fraction | None
    utc_us: Fraction | None
    time_basis: str
    packet: PacketMap | None
    null_reasons: dict[str, str]
    header: RawHeader | None = None

    @property
    def fp1_lead_off(self) -> bool | None:
        return None if self.lead_off is None else bool(self.lead_off & 1)

    @property
    def fp2_lead_off(self) -> bool | None:
        return None if self.lead_off is None else bool(self.lead_off & 4)


@dataclass(frozen=True)
class DecodedChunk:
    samples: tuple[DecodedSample, ...]
    packets: tuple[PacketMap, ...]
    packet_bytes: bytes
    gaps: tuple[GapEvent, ...]


def sample_relative_us(anchor: Anchor, rate: Rate, sample_index: int) -> Fraction:
    """샘플 간격을 누적 반올림하지 않는 계약 유리수 시간."""
    return Fraction(int(anchor.relative_us)) + Fraction(
        (sample_index - anchor.sample_index) * 1_000_000 * rate.denominator,
        rate.numerator,
    )


def _json(data: bytes) -> object:
    def pairs(items: list[tuple[str, object]]) -> dict[str, object]:
        result: dict[str, object] = {}
        for key, value in items:
            if key in result:
                raise DecodeError('중복 JSON key')
            result[key] = value
        return result

    def constant(value: str) -> None:
        raise DecodeError(f'비유한 JSON 숫자: {value}')

    return json.loads(data.decode('utf-8'), object_pairs_hook=pairs, parse_constant=constant)


def _integrity(payload: bytes, metadata: RawChunkMeta | LegacyRawChunkMeta) -> None:
    # 다른 해석보다 먼저 전체 객체 무결성을 검증한다.
    if hashlib.sha256(payload).hexdigest() != metadata.checksum:
        raise DecodeError('전체 SHA-256 불일치', 'checksum_mismatch')
    if len(payload) != metadata.size_bytes:
        raise DecodeError('전체 크기 불일치')


def _float32(value: float) -> bytes:
    return struct.pack('<f', value)


def _rows(body: bytes, header: RawHeader) -> list[tuple[Number, ...]]:
    fmt = {'eeg': '<iiBff', 'ppg': '<II', 'acc': '<hhhfff'}[header.signal_type]
    rows = list(struct.iter_unpack(fmt, body[:header.sections[0].length]))
    expected_scale = {'eeg': 4.033 / 12 / (2**23 - 1) * 1e6, 'ppg': 1.0, 'acc': 2 / 32768}[header.signal_type]
    if any(scale != expected_scale for scale in header.scale):
        raise DecodeError('알 수 없는 환산계수')
    for row in rows:
        if not all(math.isfinite(v) for v in row):
            raise DecodeError('비유한 샘플', 'nonfinite_sample')
        if header.signal_type == 'eeg':
            if not all(-(2**23) <= v < 2**23 for v in row[:2]):
                raise DecodeError('signed24 범위 초과')
            for adc, physical in zip(row[:2], row[3:]):
                if _float32(adc * 4.033 / 12 / (2**23 - 1) * 1e6) != _float32(physical):
                    raise DecodeError('ADC/물리량 불일치')
        elif header.signal_type == 'ppg':
            if not all(0 <= v < 2**24 for v in row):
                raise DecodeError('unsigned24 범위 초과')
        else:
            for adc, physical in zip(row[:3], row[3:]):
                if _float32(adc * expected_scale) != _float32(physical):
                    raise DecodeError('ADC/물리량 불일치')
    return rows


def _packet_maps(body: bytes, header: RawHeader) -> tuple[tuple[PacketMap, ...], bytes]:
    section = header.sections[1]
    packets = body[section.offset:section.offset + section.length]
    maps = tuple(PacketMap.model_validate(_json(line)) for line in body[header.sections[2].offset:].splitlines())
    if len(maps) != header.packet_count:
        raise DecodeError('packet count 불일치')
    byte_cursor, sample_cursor = 0, header.first_sample_index
    last_sequence = -1
    for packet in maps:
        if packet.byte_offset != byte_cursor or packet.packet_seq <= last_sequence:
            raise DecodeError('packet 범위/순번 불일치')
        byte_cursor += packet.byte_length
        last_sequence = packet.packet_seq
        if byte_cursor > len(packets):
            raise DecodeError('잘린 packet section')
        if packet.clock_segment_id != header.anchor.clock_segment_id:
            raise DecodeError('clock segment 불일치')
        if packet.sample_count and packet.header_anchor != header.parser_profile.header_anchor:
            raise DecodeError('packet anchor 불일치')
        if packet.tick_raw is not None:
            tick = int(packet.tick_raw)
            bits = header.parser_profile.tick_bits
            if bits > 63 or not 0 <= tick < 2**bits:
                raise DecodeError('device tick 범위 불일치')
            if packet.tick_unwrapped is not None and int(packet.tick_unwrapped) % (2**bits) != tick:
                raise DecodeError('wrapped tick 불일치')
        if packet.sample_count:
            if packet.first_sample_index != sample_cursor:
                raise DecodeError('packet sample 범위 불일치')
            sample_cursor += packet.sample_count
        elif packet.first_sample_index is not None:
            raise DecodeError('빈 packet sample index')
    if byte_cursor != len(packets) or sample_cursor != header.end_sample_index_exclusive:
        raise DecodeError('packet byte/sample coverage 불일치')
    return maps, packets


def _validate_known_wire(
    header: RawHeader,
    rows: list[tuple[Number, ...]],
    maps: tuple[PacketMap, ...],
    packets: bytes,
) -> None:
    # native/미지 parser의 framing을 웹 규격으로 추정하지 않는다.
    profile = header.parser_profile
    if (profile.profile_id, profile.version) != ('mb-web-clock-v1', '1') or profile.platform not in ('synthetic', 'mb-web', 'mb-app-js'):
        return
    stride = 7 if header.signal_type == 'eeg' else 6
    for packet in maps:
        wire = packets[packet.byte_offset:packet.byte_offset + packet.byte_length]
        if packet.malformed_reason:
            continue
        if len(wire) != 4 + stride * packet.sample_count:
            raise DecodeError('정상 wire packet 길이 불일치')
        endian = 'big' if header.signal_type == 'ppg' else 'little'
        if packet.tick_raw is None or int.from_bytes(wire[:4], endian) != int(packet.tick_raw):
            raise DecodeError('wire device tick 불일치')
        for offset in range(packet.sample_count):
            start = 4 + offset * stride
            row = rows[packet.first_sample_index - header.first_sample_index + offset]
            if header.signal_type == 'eeg':
                actual = (int.from_bytes(wire[start+1:start+4], 'big', signed=True),
                          int.from_bytes(wire[start+4:start+7], 'big', signed=True), wire[start])
                expected = row[:3]
            elif header.signal_type == 'ppg':
                actual = (int.from_bytes(wire[start:start+3], 'big'), int.from_bytes(wire[start+3:start+6], 'big'))
                expected = row
            else:
                actual = struct.unpack_from('<hhh', wire, start)
                expected = row[:3]
            if actual != expected:
                raise DecodeError('wire ADC/lead-off 불일치')


def _v2(payload: bytes, metadata: RawChunkMeta, gaps: tuple[GapEvent, ...]) -> DecodedChunk:
    if len(payload) < 12:
        raise DecodeError('잘린 header', 'truncated_header')
    if len(payload) > 1_048_576:
        raise DecodeError('raw-v2 크기 초과')
    if payload[:8] != b'MBRAW002':
        raise UnsupportedRawVersion('지원하지 않는 raw magic')
    length = struct.unpack_from('<I', payload, 8)[0]
    if not 0 < length <= 65_536 or 12 + length > len(payload):
        raise DecodeError('잘린/초과 header', 'truncated_header')
    data = _json(payload[12:12+length])
    if not isinstance(data, dict):
        raise DecodeError('header 객체 필요')
    if data.get('schema_version') != 'mb-biosignal-raw-v2':
        raise UnsupportedRawVersion('지원하지 않는 raw schema')
    try:
        header = RawHeader.model_validate(data)
    except ValidationError as exc:
        # G1 section 교차 검증 실패도 동결된 오류 코드로 노출한다.
        code = 'invalid_sections' if any('section' in e['msg'] or 'sample bytes/count' in e['msg'] or (e['loc'] and e['loc'][0] == 'sections') for e in exc.errors()) else 'invalid_header'
        raise DecodeError('raw header 계약 불일치', code) from exc
    if header != metadata.header:
        raise DecodeError('외부 메타/header 불일치')
    body = payload[12+length:]
    if sum(section.length for section in header.sections) != len(body):
        raise DecodeError('section 전체 길이 불일치', 'invalid_sections')
    rows = _rows(body, header)
    maps, packets = _packet_maps(body, header)
    _validate_known_wire(header, rows, maps, packets)
    samples: list[DecodedSample] = []
    row_cursor = 0
    for packet in maps:
        for _ in range(packet.sample_count):
            row = rows[row_cursor]
            index = header.first_sample_index + row_cursor
            relative = sample_relative_us(header.anchor, header.rate, index)
            utc = None if header.anchor.utc_us is None else Fraction(int(header.anchor.utc_us)) + relative - int(header.anchor.relative_us)
            reasons: dict[str, str] = {}
            if utc is None:
                reasons['utc_us'] = 'utc_anchor_unavailable'
            if header.signal_type == 'eeg':
                adc, values, lead_off = tuple(row[:2]), tuple(row[3:]), row[2]
            elif header.signal_type == 'ppg':
                adc, values, lead_off = tuple(row), tuple(row), None
            else:
                adc, values, lead_off = tuple(row[:3]), tuple(row[3:]), None
            if lead_off is None:
                reasons['lead_off'] = 'not_applicable'
            samples.append(DecodedSample(header.signal_type, header.schema_version, index,
                tuple(header.channels), values, tuple(row), adc, lead_off, relative, utc,
                header.time_basis, packet, reasons, header))
            row_cursor += 1
    return DecodedChunk(tuple(samples), maps, packets, gaps)


def _legacy(payload: bytes, metadata: LegacyRawChunkMeta, gaps: tuple[GapEvent, ...]) -> DecodedChunk:
    if metadata.schema_version != 'eeg-raw-v1':
        raise UnsupportedRawVersion(f'지원 근거 없는 legacy schema: {metadata.schema_version}')
    if payload.startswith(b'MBRAW'):
        raise DecodeError('v2 컨테이너를 v1로 해석 금지')
    if metadata.sample_count < 0 or metadata.first_sample_index < 0 or len(payload) != metadata.sample_count * 8:
        raise DecodeError('legacy sample count/stride 불일치')
    samples: list[DecodedSample] = []
    for offset, row in enumerate(struct.iter_unpack('<ff', payload)):
        if not all(math.isfinite(v) for v in row):
            raise DecodeError('비유한 legacy 샘플', 'nonfinite_sample')
        relative = None if metadata.first_sample_relative_us is None else Fraction(metadata.first_sample_relative_us + offset * 4000)
        reasons = {key: 'not_recorded_in_legacy' for key in ('adc', 'lead_off', 'packet', 'utc_us')}
        if relative is None:
            reasons['relative_us'] = 'legacy_time_origin_unknown'
        samples.append(DecodedSample('eeg', metadata.schema_version, metadata.first_sample_index + offset,
            ('fp1', 'fp2'), row, row, None, None, relative, None,
            'unknown' if relative is None else 'session_relative', None, reasons))
    return DecodedChunk(tuple(samples), (), b'', gaps)


def decode_raw_chunk_with_gaps(
    payload: bytes,
    metadata: RawChunkMeta | LegacyRawChunkMeta,
    *,
    gaps: Iterable[GapEvent] = (),
) -> DecodedChunk:
    """gap 및 malformed packet을 별도 보존한다. gap에 샘플을 보간하지 않는다."""
    _integrity(payload, metadata)
    try:
        preserved = tuple(GapEvent.model_validate(gap) for gap in gaps)
        if isinstance(metadata, LegacyRawChunkMeta):
            return _legacy(payload, metadata, preserved)
        return _v2(payload, metadata, preserved)
    except (ValidationError, UnicodeError, json.JSONDecodeError, struct.error, OverflowError) as exc:
        raise DecodeError(f'raw 계약 검증 실패: {exc}') from exc


def decode_raw_chunk(payload: bytes, metadata: RawChunkMeta | LegacyRawChunkMeta) -> Iterator[DecodedSample]:
    """전체 청크 검증을 마친 뒤에만 첫 샘플을 제공한다(청크 최대 1MiB)."""
    return iter(decode_raw_chunk_with_gaps(payload, metadata).samples)


def iter_csv_rows(samples: Iterable[DecodedSample]) -> Iterator[dict[str, str]]:
    """csv.DictWriter에 전달할 기본 행. float32 9자리·timestamp 상대 초."""
    for sample in samples:
        row = {'timestamp': '' if sample.relative_us is None else format(float(sample.relative_us / 1_000_000), '.12g')}
        row.update({channel: str(value) if isinstance(value, int) else format(value, '.9g')
                    for channel, value in zip(sample.channels, sample.values, strict=True)})
        yield row


def iter_parquet_rows(samples: Iterable[DecodedSample]) -> Iterator[dict[str, Number | None]]:
    """Arrow 의존성 없는 typed 행. 호출자가 float32 채널 schema를 지정한다."""
    for sample in samples:
        row: dict[str, Number | None] = {'timestamp': None if sample.relative_us is None else float(sample.relative_us / 1_000_000)}
        row.update(zip(sample.channels, sample.values, strict=True))
        yield row
