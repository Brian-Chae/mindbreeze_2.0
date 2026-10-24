import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { webcrypto } from 'node:crypto';
import { BiosignalQueue, type CaptureScope, type JournalPacket } from '../src/lib/biosignal/durable-queue';
import { BiosignalCaptureSession } from '../src/lib/biosignal/capture-session';
import { parseRawPacket } from '../src/lib/biosignal/raw-capture';
import type { Signal } from '../src/lib/biosignal/raw-types';
import type { RawMeta } from '../src/lib/api/biosignal';

const scope: CaptureScope = { accountId: 'a', sessionId: 's', participantId: 'p', deviceAlias: 'LINK-BAND' };
let uuid = 0;
const createId = () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`;
const RATE = { eeg: 250, ppg: 50, acc: 30 } as const;
const STRIDE = { eeg: 7, ppg: 6, acc: 6 } as const;
// 명목 rate에 맞춘 tick(32768Hz)·monotonic을 가진 패킷. 같은 신호 안에서는 연속 시간으로 흐른다.
function packetFactory(signal: Signal, rows: number) {
  let n = 0;
  return () => {
    const bytes = new Uint8Array(4 + rows * STRIDE[signal]);
    const tick = Math.round(n * rows / RATE[signal] * 32768);
    new DataView(bytes.buffer).setUint32(0, tick, signal !== 'ppg');
    for (let i = 4; i < bytes.length; i++) bytes[i] = (n + i) & 0x3f;
    const mono = String(Math.round(1_000_000 + n * rows / RATE[signal] * 1e6));
    n += 1;
    return parseRawPacket(signal, new DataView(bytes.buffer), String(1_780_000_000_000_000n + BigInt(mono)), mono);
  };
}
async function build(options: Partial<ConstructorParameters<typeof BiosignalCaptureSession>[0]> = {}) {
  const queue = new BiosignalQueue(scope, 'tab-a');
  const session = new BiosignalCaptureSession({ queue, createId, ...options });
  await session.start();
  return { queue, session };
}
const rawMeta = async (queue: BiosignalQueue) => (await queue.objects()).filter(o => o.kind === 'raw').map(o => o.meta as RawMeta);
beforeEach(() => { uuid = 0; globalThis.indexedDB = new IDBFactory(); Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true }); });

describe('SDD244 T08 capture session', () => {
  it('신호별로 10초 분량에서 봉인하고 index는 신호마다 0부터 독립 증가한다', async () => {
    const { queue, session } = await build();
    const eeg = packetFactory('eeg', 50), ppg = packetFactory('ppg', 50);
    for (let i = 0; i < 100; i++) session.receive(eeg());   // 5000샘플 = 20초 → 2청크
    for (let i = 0; i < 10; i++) session.receive(ppg());    // 500샘플 = 10초 → 1청크
    await session.flush();
    const metas = await rawMeta(queue);
    const by = (s: Signal) => metas.filter(m => m.header.signal_type === s).map(m => m.header.chunk_index).sort();
    expect(by('eeg')).toEqual([0, 1]); expect(by('ppg')).toEqual([0]);
    const first = metas.find(m => m.header.signal_type === 'eeg' && m.header.chunk_index === 0)!;
    expect(first.header.sample_count).toBe(2500);
    expect(first.chunk_alias).toMatch(/^RAW-EEG-[0-9a-f]{8}-[0-9a-f]{8}-000000$/);
    expect(first.checksum).toMatch(/^[0-9a-f]{64}$/);
    const stored = (await queue.objects()).find(o => o.alias === first.chunk_alias)!;
    expect(stored.payload.byteLength).toBe(first.size_bytes);
    expect(new TextDecoder().decode(new Uint8Array(stored.payload, 0, 8))).toBe('MBRAW002');
    expect((await queue.allPackets()).length).toBe(0 + 0);
  });

  it('clock reset은 새 segment로 봉인하고 새 segment index는 0부터 시작한다', async () => {
    const { queue, session } = await build();
    const make = packetFactory('eeg', 50);
    for (let i = 0; i < 3; i++) session.receive(make());
    const reset = parseRawPacket('eeg', new DataView(new Uint8Array([1, 0, 0, 0, 0, 1, 2, 3, 0, 1, 2, 3]).buffer.slice(0, 11)), String(1_780_000_100_000_000n), '9000000');
    session.receive(reset);
    await session.flush();
    const metas = await rawMeta(queue);
    expect(metas).toHaveLength(1);                      // 리셋 전 150샘플이 부분 청크로 봉인
    expect(metas[0].header.sample_count).toBe(150);
    const events = (await queue.pendingEvents()).map(e => e.event);
    expect(events.some(e => e.event_type === 'gap' && ['clock_reset', 'wall_clock_jump'].includes(e.reason))).toBe(true);
  });

  it('journal 실패는 침묵하지 않고 수집을 중단하며 local_write_failed gap을 남긴다', async () => {
    const { queue, session } = await build();
    vi.spyOn(queue, 'journalPacket').mockRejectedValue(new Error('quota exceeded'));
    const make = packetFactory('eeg', 50);
    session.receive(make()); await session.flush();
    expect(session.status).toBe('stopped'); expect(session.stopReason).toBe('journal_failed');
    session.receive(make()); await session.flush();
    expect(session.droppedWhileStopped).toBe(1);
    const gap = (await queue.pendingEvents()).map(e => e.event).find(e => e.event_type === 'gap');
    expect(gap).toMatchObject({ reason: 'local_write_failed', expected_samples: null, observed_or_estimated: 'unknown' });
  });

  it('미영속 메모리가 8MiB를 넘으면 중단한다', async () => {
    const { queue, session } = await build();
    vi.spyOn(queue, 'journalPacket').mockImplementation(() => new Promise(() => undefined));
    const big = packetFactory('eeg', 1_000_000 / 7 | 0);
    for (let i = 0; i < 10; i++) session.receive(big());
    expect(session.status).toBe('stopped'); expect(session.stopReason).toBe('memory_cap');
  });

  it('다른 탭이 lease를 가져가면 오래된 탭은 중단한다', async () => {
    let now = 1000;
    const queue = new BiosignalQueue(scope, 'tab-a', () => now);
    const session = new BiosignalCaptureSession({ queue, createId }); await session.start();
    now = 20_000; const other = new BiosignalQueue(scope, 'tab-b', () => now); await other.acquire();
    session.receive(packetFactory('eeg', 50)()); await session.flush();
    expect(session.status).toBe('stopped'); expect(session.stopReason).toBe('lease_lost');
  });

  it('quota 95% 이상이면 안전 중단한다(삭제로 공간을 만들지 않는다)', async () => {
    const { queue, session } = await build({ quota: async () => ({ usage: 96, quota: 100 }) });
    await session.checkQuota();
    expect(session.status).toBe('stopped'); expect(session.stopReason).toBe('quota');
    expect(await queue.objects()).toHaveLength(0);
  });

  it('재시작 시 이전 실행의 journal을 새 청크로 봉인하고 process_terminated unknown gap을 남긴다', async () => {
    const q1 = new BiosignalQueue(scope, 'tab-old');
    await q1.acquire();
    const make = packetFactory('eeg', 50);
    const p = make();
    const packet: JournalPacket = { id: 'old-1', accountId: 'a', sessionId: 's', participantId: 'p', signal: 'eeg', streamId: createId(), segmentId: createId(), seq: 0, bytes: p.bytes.buffer as ArrayBuffer,
      tickRaw: 0, tickUnwrapped: '0', receivedUtcUs: p.receivedUtcUs, receivedMonotonicUs: p.receivedMonotonicUs, malformedReason: null, firstSampleIndex: 0, sampleCount: 50,
      segmentAnchor: { utcUs: p.receivedUtcUs, monotonicUs: p.receivedMonotonicUs, tickRaw: '0', tickUnwrapped: '0', originMonotonicUs: p.receivedMonotonicUs } };
    await q1.journalPacket(packet);
    await q1.release();
    const { queue } = await build();
    expect(await queue.allPackets()).toHaveLength(0);
    expect((await rawMeta(queue))[0].header.sample_count).toBe(50);
    const gap = (await queue.pendingEvents()).map(e => e.event).find(e => e.event_type === 'gap');
    expect(gap).toMatchObject({ reason: 'process_terminated', expected_samples: null, observed_or_estimated: 'unknown' });
  });

  it('close는 마지막 부분 청크를 봉인하고 expected set(raw alias+sha)과 신호별 마지막 sequence를 먼저 영속한다', async () => {
    const { queue, session } = await build();
    const make = packetFactory('eeg', 50);
    for (let i = 0; i < 53; i++) session.receive(make());   // 2650샘플 → 2500 + 150
    const intent = await session.close('user_end');
    const metas = await rawMeta(queue);
    expect(metas.map(m => m.header.chunk_index).sort()).toEqual([0, 1]);
    expect(intent.streams).toEqual([expect.objectContaining({ signal: 'eeg', last_chunk_sequence: 1, received_samples: 2650, last_feature_sequence: null })]);
    expect(intent.expected_artifacts.map(a => a.alias).sort()).toEqual(metas.map(m => m.chunk_alias).sort());
    expect(intent.end_reason).toBe('user_end');
    expect((await queue.pendingEvents()).some(e => e.event.event_type === 'close_intent')).toBe(true);
  });
});
