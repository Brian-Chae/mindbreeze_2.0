import { parseRawPacket, EEG_ADC_SCALE, ACC_ADC_SCALE } from './raw-capture';
import type { MappedPacket, RawHeader, RawSection, Signal } from './raw-types';

const layouts: Record<Signal, { stride: number; encoding: RawSection['encoding']; channels: string[]; units: string[] }> = {
  eeg: { stride: 17, encoding: 'eeg-i32-i32-u8-f32-f32-le', channels: ['fp1', 'fp2'], units: ['uV', 'uV'] },
  ppg: { stride: 8, encoding: 'ppg-u32-u32-le', channels: ['red', 'ir'], units: ['ADC_count', 'ADC_count'] },
  acc: { stride: 18, encoding: 'acc-i16-i16-i16-f32-f32-f32-le', channels: ['x', 'y', 'z'], units: ['g', 'g', 'g'] },
};
const encoder = new TextEncoder();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function int64(value: string | null): boolean {
  if (value === null) return true;
  if (!/^-?(0|[1-9][0-9]{0,18})$/.test(value) || value === '-0') return false;
  const n = BigInt(value);
  return n >= -(1n << 63n) && n < (1n << 63n);
}

// G1 Python fixture의 float JSON 표기를 보존한다(정수 환산계수도 1.0).
function floatJson(n: number): string {
  if (!Number.isFinite(n)) throw new Error('nonfinite_header');
  if (n === 0) return Object.is(n, -0) ? '-0.0' : '0.0';
  if (Math.abs(n) < 1e-4 || Math.abs(n) >= 1e16) {
    return n.toExponential().replace(/e([+-])(\d)$/, 'e$10$2');
  }
  return Number.isInteger(n) ? `${n}.0` : String(n);
}
function json(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('nonfinite_header');
    return v;
  });
}
function headerJson(h: RawHeader): string {
  // JS는 float/int를 구별하지 않으므로 scale만 계약의 float 표기로 직렬화한다.
  return json(h).replace(/"scale":\[[^\]]*\]/, `"scale":[${h.scale.map(floatJson).join(',')}]`);
}
function packetMapJson(p: MappedPacket): string {
  const m = p.map;
  return json({ packet_seq: m.packet_seq, byte_offset: m.byte_offset, byte_length: m.byte_length,
    first_sample_index: m.first_sample_index, sample_count: m.sample_count, tick_raw: m.tick_raw,
    tick_unwrapped: m.tick_unwrapped, received_utc_us: m.received_utc_us,
    received_monotonic_us: m.received_monotonic_us, header_anchor: m.header_anchor,
    clock_segment_id: m.clock_segment_id, malformed_reason: m.malformed_reason }) + '\n';
}

/** T08 봉인용 section 산출. 제공된 원문과 map의 순서·샘플 범위를 검증한다. */
export function rawSections(header: Omit<RawHeader, 'sections'>, packets: MappedPacket[]): RawSection[] {
  const layout = layouts[header.signal_type];
  if (!layout) throw new Error('unsupported_signal');
  let byteOffset = 0, sampleIndex = header.first_sample_index, lastSequence = -1;
  for (const packet of packets) {
    const map = packet.map;
    const parsed = parseRawPacket(header.signal_type, new DataView(packet.bytes.buffer, packet.bytes.byteOffset, packet.bytes.byteLength));
    if (packet.bytes.length === 0 || map.byte_offset !== byteOffset || map.byte_length !== packet.bytes.length ||
        !Number.isSafeInteger(map.packet_seq) || map.packet_seq <= lastSequence ||
        map.sample_count !== parsed.rows.length || map.malformed_reason !== parsed.malformedReason ||
        map.first_sample_index !== (parsed.rows.length ? sampleIndex : null) ||
        map.tick_raw !== (parsed.tickRaw === null ? null : String(parsed.tickRaw)) ||
        map.clock_segment_id !== header.anchor.clock_segment_id ||
        ![map.tick_raw, map.tick_unwrapped, map.received_utc_us, map.received_monotonic_us].every(int64)) throw new Error('invalid_packet_map');
    byteOffset += packet.bytes.length; sampleIndex += parsed.rows.length; lastSequence = map.packet_seq;
  }
  if (sampleIndex !== header.end_sample_index_exclusive || sampleIndex - header.first_sample_index !== header.sample_count || packets.length !== header.packet_count) throw new Error('invalid_sample_count');
  const samplesLength = header.sample_count * layout.stride;
  const mapLength = encoder.encode(packets.map(packetMapJson).join('')).length;
  return [
    { name: 'samples', offset: 0, length: samplesLength, row_stride: layout.stride, encoding: layout.encoding },
    { name: 'packets', offset: samplesLength, length: byteOffset, row_stride: 0, encoding: 'bytes' },
    { name: 'packet_map', offset: samplesLength + byteOffset, length: mapLength, row_stride: 0, encoding: 'utf8-jsonl' },
  ];
}

export function encodeRawV2(header: RawHeader, packets: MappedPacket[]): Uint8Array {
  const layout = layouts[header.signal_type];
  if (header.schema_version !== 'mb-biosignal-raw-v2' || !layout) throw new Error('unsupported_schema');
  if (![header.stream_id, header.segment_id, header.anchor.clock_segment_id].every(v => uuid.test(v)) ||
      ![header.anchor.utc_us, header.anchor.monotonic_us, header.anchor.relative_us, header.anchor.device_tick_raw, header.anchor.device_tick_unwrapped].every(int64) ||
      header.parser_profile.tick_hz !== 32768 || header.parser_profile.tick_bits !== 32 || header.parser_profile.header_anchor !== 'last_sample' ||
      header.parser_profile.platform === 'native-candidate' || !/^[0-9a-f]{64}$/.test(header.parser_profile.parameters_hash) ||
      header.scale.some(v => v !== (header.signal_type === 'eeg' ? EEG_ADC_SCALE : header.signal_type === 'acc' ? ACC_ADC_SCALE : 1))) throw new Error('invalid_header');
  const positive = (n: number) => Number.isSafeInteger(n) && n > 0;
  const nonnegative = (n: number) => Number.isSafeInteger(n) && n >= 0;
  if (!positive(header.rate.numerator) || !positive(header.rate.denominator) ||
      (header.signal_type !== 'acc' && header.rate.numerator / header.rate.denominator !== (header.signal_type === 'eeg' ? 250 : 50)) ||
      !nonnegative(header.chunk_index) || !nonnegative(header.sample_count) || !nonnegative(header.first_sample_index) ||
      json(header.channels) !== json(layout.channels) || json(header.units) !== json(layout.units) ||
      header.scale.length !== layout.channels.length || header.scale.some(n => !Number.isFinite(n)) ||
      (header.time_basis === 'device_relative' && header.anchor.utc_us !== null) ||
      (header.time_basis === 'utc_verified' && header.anchor.utc_us === null) ||
      (header.observed_rate === null ? !header.observed_rate_reason || header.observed_rate_window_us !== null : !positive(header.observed_rate.numerator) || !positive(header.observed_rate.denominator) || header.observed_rate_window_us === null || !positive(header.observed_rate_window_us) || header.observed_rate_reason !== null)) throw new Error('invalid_header');
  const sections = rawSections(header, packets);
  if (json(header.sections) !== json(sections)) throw new Error('invalid_sections');
  const headerBytes = encoder.encode(headerJson(header));
  const bodyLength = sections.reduce((sum, section) => sum + section.length, 0);
  if (headerBytes.length > 65536 || 12 + headerBytes.length + bodyLength > 1048576) throw new Error('raw_chunk_too_large');
  const result = new Uint8Array(12 + headerBytes.length + bodyLength);
  result.set(encoder.encode('MBRAW002'));
  const data = new DataView(result.buffer);
  data.setUint32(8, headerBytes.length, true);
  result.set(headerBytes, 12);
  const bodyAt = 12 + headerBytes.length;
  let offset = bodyAt;
  for (const packet of packets) {
    const parsed = parseRawPacket(header.signal_type, new DataView(packet.bytes.buffer, packet.bytes.byteOffset, packet.bytes.byteLength));
    for (const row of parsed.rows) {
      if (header.signal_type === 'eeg') {
        data.setInt32(offset, row[0], true); data.setInt32(offset + 4, row[1], true); data.setUint8(offset + 8, row[2]);
        data.setFloat32(offset + 9, row[3], true); data.setFloat32(offset + 13, row[4], true);
      } else if (header.signal_type === 'ppg') {
        data.setUint32(offset, row[0], true); data.setUint32(offset + 4, row[1], true);
      } else {
        for (let axis = 0; axis < 3; axis++) { data.setInt16(offset + axis * 2, row[axis], true); data.setFloat32(offset + 6 + axis * 4, row[axis + 3], true); }
      }
      offset += layout.stride;
    }
  }
  for (const packet of packets) { result.set(packet.bytes, offset); offset += packet.bytes.length; }
  result.set(encoder.encode(packets.map(packetMapJson).join('')), offset);
  return result;
}
