import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseRawPacket, captureRawPacket, subscribeRawPackets } from '../src/lib/biosignal/raw-capture';
import { encodeRawV2, rawSections } from '../src/lib/biosignal/raw-encoder';
import { BiosignalClock, sampleTimeUs } from '../src/lib/biosignal/raw-clock';
import type { RawHeader, PacketMap, Signal } from '../src/lib/biosignal/raw-types';
import { bluetoothService } from '../src/lib/eeg/bluetoothService';

const fixture = (name: string) => readFileSync(new URL('../../specs/sdd-244-biosignal-raw-pipeline/contracts/fixtures/' + name, import.meta.url));
const headers: RawHeader[] = JSON.parse(fixture('raw-v2.json').toString());
const golden: Record<Signal, { rows: number[][]; packet_hex: string }> = JSON.parse(fixture('raw-golden.json').toString());
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
afterEach(() => vi.useRealTimers());
describe('SDD244 T07 원문 수집과 G1 인코딩', () => {
  for (const signal of ['eeg', 'ppg', 'acc'] as const) {
    it(`${signal} 경계 ADC·환산 float32·원문·map을 golden binary와 비트 일치`, () => {
      const expected = fixture(`${signal}-raw-v2.bin`);
      const header = headers.find(h => h.signal_type === signal)!;
      const bodyAt = 12 + expected.readUInt32LE(8);
      const mapSection = header.sections[2];
      const maps: PacketMap[] = expected.subarray(bodyAt + mapSection.offset).toString().trim().split('\n').map(v => JSON.parse(v));
      const bytes = Buffer.from(golden[signal].packet_hex, 'hex');
      const packets = maps.map(map => ({ bytes: bytes.subarray(map.byte_offset, map.byte_offset + map.byte_length), map }));
      expect(parseRawPacket(signal, view(packets[0].bytes)).rows).toEqual(golden[signal].rows);
      expect(Buffer.from(encodeRawV2(header, packets))).toEqual(expected);
    });
    it(`${signal} 잘린 패킷은 샘플을 위조하지 않고 원문을 복사 보존`, () => {
      const source = new Uint8Array([11, 255, 22]);
      const result = parseRawPacket(signal, new DataView(source.buffer, 1, 1));
      source[1] = 0;
      expect(result.bytes).toEqual(new Uint8Array([255]));
      expect(result.rows).toEqual([]);
      expect(result.malformedReason).toBe('truncated_packet');
    });
    it(`${signal} 분석 콜백 이전에 원문 구독자에게 전달`, () => {
      vi.useFakeTimers();
      const service = bluetoothService;
      const events: string[] = [];
      const unsubscribe = subscribeRawPackets(packet => { expect(packet.signal).toBe(signal); events.push('raw'); });
      service.onDataReceived = () => { events.push('analysis'); };
      const methods = { eeg: 'handleEEGData', ppg: 'handlePPGData', acc: 'handleAccData' } as const;
      const handler = service as unknown as Record<string, (value: DataView) => void>;
      const bytes = Buffer.from(golden[signal].packet_hex, 'hex');
      handler[methods[signal]](view(bytes.subarray(0, -1)));
      expect(events[0]).toBe('raw');
      vi.runOnlyPendingTimers();
      expect(events).toEqual(['raw', 'analysis']);
      unsubscribe();
    });
  }
  it('구독 해제와 DataView byteOffset을 보존한다', () => {
    const received: Uint8Array[] = [];
    const stop = subscribeRawPackets(p => received.push(p.bytes));
    captureRawPacket('eeg', new DataView(new Uint8Array([0, 255, 0]).buffer, 1, 1));
    stop();
    captureRawPacket('eeg', new DataView(new Uint8Array([255]).buffer));
    expect(received).toEqual([new Uint8Array([255])]);
  });
});
describe('SDD244 T07 rational clock', () => {
  it('30Hz 60분에 누적 반올림 drift가 없고 25Hz와 구별된다', () => {
    expect(sampleTimeUs(108000, { numerator: 30, denominator: 1 })).toBe('3600000000');
    expect(sampleTimeUs(1, { numerator: 30, denominator: 1 })).toBe('33333');
    expect(sampleTimeUs(2, { numerator: 30, denominator: 1 })).toBe('66667');
    expect(sampleTimeUs(1, { numerator: 25, denominator: 1 })).toBe('40000');
  });
  it('wrap은 연속이고 reset·wall jump·reanchor는 새 segment다', () => {
    let id = 0;
    const clock = new BiosignalClock(() => `segment-${id++}`);
    const first = clock.observe(4294967290, '10000000', '1000000');
    const wrap = clock.observe(4, '10000305', '1000305');
    expect(wrap.segmentId).toBe(first.segmentId);
    expect(wrap.unwrappedTick).toBe('4294967300');
    const reset = clock.observe(2, '10000400', '1000400');
    expect(reset.reason).toBe('clock_reset');
    expect(reset.segmentId).not.toBe(wrap.segmentId);
    const jump = clock.observe(3, '20000430', '1000430');
    expect(jump.reason).toBe('wall_clock_jump');
    clock.reanchor();
    expect(clock.observe(4, '20000460', '1000460').reason).toBe('reanchor');
  });
});

describe('SDD244 T07 실패 격리와 잘못된 입력', () => {
  it('원문 subscriber 실패는 알리고 기존 분석을 계속한다', () => {
    const error = vi.fn();
    const stop = subscribeRawPackets(() => { throw new Error('journal unavailable'); }, error);
    const analysis = vi.fn();
    bluetoothService.onDataReceived = analysis;
    const bytes = Buffer.from(golden.eeg.packet_hex, 'hex').subarray(0, -1);
    const service = bluetoothService as unknown as { handleEEGData(value: DataView): void };
    expect(() => service.handleEEGData(view(bytes))).not.toThrow();
    expect(error).toHaveBeenCalledOnce();
    expect(analysis).toHaveBeenCalledOnce();
    stop();
  });
  it('wrap 후보가 monotonic 경과와 불일치하면 reset으로 구분한다', () => {
    const clock = new BiosignalClock();
    clock.observe(4294967280, '10000000', '1000000');
    const result = clock.observe(16, '20000000', '11000000');
    expect(result.reason).toBe('clock_reset');
    expect(result.unwrappedTick).toBe('16');
  });
  it('잘린 BLE notify는 raw에 남고 분석에는 전달하지 않는다', () => {
    const packets: number[] = [];
    const stop = subscribeRawPackets(p => packets.push(p.bytes.length));
    const analysis = vi.fn();
    bluetoothService.onDataReceived = analysis;
    const service = bluetoothService as unknown as { handleEEGData(value: DataView): void };
    service.handleEEGData(view(new Uint8Array([255])));
    expect(packets).toEqual([1]);
    expect(analysis).not.toHaveBeenCalled();
    stop();
  });
  it('정수·int64·UUID·clock profile 메타 위조를 거절한다', () => {
    const expected = fixture('eeg-raw-v2.bin');
    const header = headers[0];
    const bodyAt = 12 + expected.readUInt32LE(8);
    const maps: PacketMap[] = expected.subarray(bodyAt + header.sections[2].offset).toString().trim().split('\n').map(v => JSON.parse(v));
    const bytes = Buffer.from(golden.eeg.packet_hex, 'hex');
    const packets = maps.map(map => ({ bytes: bytes.subarray(map.byte_offset, map.byte_offset + map.byte_length), map }));
    const altered = (update: Partial<RawHeader>) => ({ ...structuredClone(header), ...update });
    for (const bad of [altered({ stream_id: 'invalid' }), altered({ anchor: { ...header.anchor, relative_us: '-0' } }), altered({ parser_profile: { ...header.parser_profile, tick_hz: 1 } })]) {
      expect(() => encodeRawV2(bad, packets)).toThrow();
    }
    expect(() => encodeRawV2(altered({ scale: [NaN, 1] }), packets)).toThrow();
    expect(() => encodeRawV2(altered({ sections: header.sections.map(s => ({ ...s, offset: 0 })) }), packets)).toThrow();
    expect(() => encodeRawV2(header, packets.map((p, i) => i === 0 ? { ...p, map: { ...p.map, sample_count: 8 } } : p))).toThrow();
    expect(() => encodeRawV2(altered({ observed_rate_reason: 'x'.repeat(65536) }), packets)).toThrow('raw_chunk_too_large');
  });
});


it('raw-v2 전체 컨테이너 1MiB 상한을 초과하면 봉인을 거절한다', () => {
  const bytes = Buffer.from(golden.eeg.packet_hex, 'hex').subarray(0, -1);
  const h = structuredClone(headers[0]);
  const count = 3000;
  h.sample_count = count * 4;
  h.end_sample_index_exclusive = h.sample_count;
  h.packet_count = count;
  const packets = Array.from({ length: count }, (_, i) => ({ bytes, map: {
    packet_seq: i, byte_offset: i * bytes.length, byte_length: bytes.length,
    first_sample_index: i * 4, sample_count: 4, tick_raw: '65536', tick_unwrapped: '65536',
    received_utc_us: '1780000000000000', received_monotonic_us: '2000000',
    header_anchor: 'last_sample' as const, clock_segment_id: h.anchor.clock_segment_id, malformed_reason: null,
  } }));
  h.sections = rawSections(h, packets);
  expect(() => encodeRawV2(h, packets)).toThrow('raw_chunk_too_large');
});

it('device tick의 전방 도약은 수신 monotonic과 비교하여 reanchor한다', () => {
  const clock = new BiosignalClock();
  const a = clock.observe(32768, '1000000', '1000000');
  const b = clock.observe(3276800, '2000000', '2000000');
  expect(b.reason).toBe('reanchor');
  expect(b.segmentId).not.toBe(a.segmentId);
  expect(b.mappedUtcUs).toBe('2000000');
});


it('실측 rate의 양의 정수 numerator/denominator와 관측창을 검증한다', () => {
  const expected = fixture('eeg-raw-v2.bin');
  const header = headers[0];
  const bodyAt = 12 + expected.readUInt32LE(8);
  const maps: PacketMap[] = expected.subarray(bodyAt + header.sections[2].offset).toString().trim().split('\n').map(v => JSON.parse(v));
  const bytes = Buffer.from(golden.eeg.packet_hex, 'hex');
  const packets = maps.map(map => ({ bytes: bytes.subarray(map.byte_offset, map.byte_offset + map.byte_length), map }));
  for (const [numerator, denominator, window] of [[250, 0, 1000], [0, 1, 1000], [250.5, 1, 1000], [250, 1.5, 1000], [250, 1, -1000], [250, 1, 0.5]]) {
    const h: RawHeader = { ...structuredClone(header), observed_rate: { numerator, denominator }, observed_rate_window_us: window, observed_rate_reason: null };
    expect(() => encodeRawV2(h, packets)).toThrow('invalid_header');
  }
});
