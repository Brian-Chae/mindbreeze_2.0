// SDD-273 — (1) 코어에 들어가는 PPG bytes 는 BLE 원문 그대로(엔디언 해석 없음) (2) PPG 진단 카운터.
import { describe, expect, it, vi } from 'vitest';
import { parseRawPacket } from '../src/lib/biosignal/raw-capture';
import { WebMeasurementSession } from '../src/lib/measurement-web/web-measurement-session';
import { countPpgArrival, countPpgStatus, ppgDiagCode, ppgDiagSnapshot, resetPpgDiag } from '../src/lib/measurement-web/ppg-diag';
import type { WorkerLike } from '../src/lib/measurement-web/capture-adapter';
import type { RawPacket } from '../src/lib/biosignal/raw-types';

const ppgBytes = (tick: number, n: number): Uint8Array => {
  const b = new Uint8Array(4 + n * 6);
  new DataView(b.buffer).setUint32(0, tick, true); // 장치/Rust 파서: little endian
  for (let i = 4; i < b.length; i += 1) b[i] = i & 255;
  return b;
};

describe('SDD-273 PPG 엔디언: raw-capture 의 tickRaw 와 코어 입력 bytes 는 별개', () => {
  it('parseRawPacket 은 bytes 를 가공하지 않는다(복사본만). ppg tickRaw 는 big-endian 해석이라 Rust(LE)와 다르다', () => {
    const src = ppgBytes(0x00012345, 5);
    const p = parseRawPacket('ppg', new DataView(src.buffer.slice(0)));
    expect(Array.from(p.bytes)).toEqual(Array.from(src)); // 코어로 가는 입력은 원문 그대로
    const le = new DataView(src.buffer).getUint32(0, true);
    expect(le).toBe(0x00012345); // Rust PacketParser 가 읽는 값
    expect(p.tickRaw).toBe(new DataView(src.buffer).getUint32(0, false)); // raw-capture 는 BE
    expect(p.tickRaw).not.toBe(le); // → 저장 경로(raw-clock) 쪽 PPG tick 만 다르다. 코어 지표와 무관
  });

  it('web-measurement-session.onRaw 는 p.bytes 를 그대로 워커에 넘긴다(ppg 포함)', async () => {
    const posted: Record<string, unknown>[] = [];
    let raw: ((p: RawPacket) => void) | null = null;
    const w: WorkerLike = {
      onmessage: null,
      postMessage(m: unknown) { const x = m as Record<string, unknown>; posted.push(x); if (x.type === 'init') queueMicrotask(() => w.onmessage?.({ data: { type: 'ready' } })); if (x.type === 'close') queueMicrotask(() => w.onmessage?.({ data: { type: 'closed', final: null } })); },
      terminate() {},
    };
    const client = {
      request: vi.fn(async () => ({ command_id: 'c', status: 'applied', epoch: '1', cursors: [], committed: true, result: { stream_id: '33333333-3333-4333-8333-333333333333', participant_id: '22222222-2222-4222-8222-222222222222', generation: '1', owner_generation: '1', lease: { expires_at_ms: 1 } } })),
      sendMetricBatch: vi.fn(async () => ({ kind: 'acks' as const, acks: [] })), sendDevice: vi.fn(async () => ({ kind: 'ack' as const, status: 'accepted' as const })), clockProbe: vi.fn(async () => null),
    };
    const s = new WebMeasurementSession({ client: client as never, sessionId: '11111111-1111-4111-8111-111111111111', accountId: 'entry:p', createWorker: () => w, subscribeRaw: (fn) => { raw = fn; return () => undefined; }, fetchModel: async () => null });
    await s.start({ eegConsent: true, bandConnected: true });
    const src = ppgBytes(0x00012345, 5);
    (raw as unknown as (p: RawPacket) => void)(parseRawPacket('ppg', new DataView(src.buffer.slice(0)), '1760000000000000', '5000000'));
    const pk = posted.find((m) => m.type === 'packet') as { sensor: string; bytes: Uint8Array; arrivalUs: number; wallMs: number; anchorUs: number };
    expect(pk.sensor).toBe('ppg');
    expect(Array.from(pk.bytes)).toEqual(Array.from(src));
    expect(pk.arrivalUs).toBe(5_000_000);
    expect(pk.anchorUs).toBe(5_000_000);
    expect(pk.wallMs).toBe(1_760_000_000_000);
    expect(ppgDiagSnapshot().pkts).toBe(1);
    await s.stop('t');
  });
});

describe('SDD-273 ppg-diag 카운터', () => {
  it('판정·정지·몰림을 센다', () => {
    resetPpgDiag();
    for (const st of ['accepted', 'accepted', 'duplicate', 'out_of_order', 'conflict', 'invalid_remainder']) countPpgStatus(st);
    countPpgArrival(1_000_000); countPpgArrival(1_500_000); countPpgArrival(4_000_000); countPpgArrival(4_001_000);
    expect(ppgDiagCode()).toBe('a2.d1.o1.c1.i1.p4.s1.b1');
    expect(ppgDiagCode()).toMatch(/^[a-z0-9.]+$/);
  });
});
