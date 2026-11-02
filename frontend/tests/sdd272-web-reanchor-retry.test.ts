// SDD-272 — 웹 capture 시각 보정(reanchor) 실패 시 짧은 간격 재시도(2·4·8·15초…, 최대 8회) 후 5분 주기 복귀.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryOutboxStore } from '../src/lib/measurement-web/metric-outbox';
import { CaptureController, REANCHOR_RETRY_DELAYS_MS } from '../src/lib/measurement-web/capture-controller';
import type { CommandAck } from '../src/lib/session-live/live-types';

const SID = '00000001-0000-4000-8000-000000000001';
const STREAM = '00000014-0000-4000-8000-000000000014';
const PID = '00000002-0000-4000-8000-000000000002';

type ProbeResult = { probeId: string; rttMs: number; offsetMs: number; serverReceiveMs: number; serverSendMs: number } | null;

function fake(opts: { probe?: (n: number) => ProbeResult; reanchor?: (n: number) => Partial<CommandAck> } = {}) {
  let probes = 0;
  let reanchors = 0;
  const probeIds: string[] = [];
  const client = {
    request: vi.fn(async (kind: string): Promise<CommandAck> => {
      if (kind === 'capture.start') {
        return { command_id: 'c', status: 'applied', epoch: '1', cursors: [], committed: true,
          result: { stream_id: STREAM, participant_id: PID, generation: '1', owner_generation: '1', lease: { expires_at_ms: 1 }, clock_uncertain: true } } as CommandAck;
      }
      if (kind === 'capture.reanchor') {
        reanchors += 1;
        return { command_id: 'c', status: 'applied', epoch: '1', cursors: [], committed: true, ...(opts.reanchor?.(reanchors) ?? {}) } as CommandAck;
      }
      return { command_id: 'c', status: 'applied', epoch: '1', cursors: [], committed: true } as CommandAck;
    }),
    sendMetricBatch: vi.fn(async () => ({ kind: 'acks' as const, acks: [] })),
    sendDevice: vi.fn(async () => ({ kind: 'ack' as const, status: 'accepted' as const })),
    clockProbe: vi.fn(async () => {
      probes += 1;
      const p = opts.probe ? opts.probe(probes) : { probeId: `00000000-0000-4000-8000-${String(probes).padStart(12, '0')}`, rttMs: 20, offsetMs: 0, serverReceiveMs: 1, serverSendMs: 2 };
      if (p) probeIds.push(p.probeId);
      return p;
    }),
  };
  return { client, probes: () => probes, reanchors: () => reanchors, probeIds };
}

const flush = async (): Promise<void> => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };
const make = (f: ReturnType<typeof fake>) => new CaptureController({
  accountId: 'user:u1', outboxStore: new MemoryOutboxStore(), sendFeatures: async () => [], client: f.client as never,
  sessionId: SID, eegConsent: true, bandConnected: true, deviceProfile: 'linkband2-v1', algorithmVersion: 'core-1', modelVersion: 'm1',
  uuid: () => '0000000c-0000-4000-8000-00000000000c',
});

describe('SDD-272 웹 reanchor 재시도', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('V8 probe 실패(null) → 2초 뒤 새 probe 로 재시도 → 성공하면 멈춘다', async () => {
    const f = fake({ probe: (n) => (n === 1 ? null : { probeId: '0000000b-0000-4000-8000-00000000000b', rttMs: 20, offsetMs: 0, serverReceiveMs: 1, serverSendMs: 2 }) });
    const c = make(f);
    await c.start(); await flush();
    expect(f.probes()).toBe(1); expect(f.reanchors()).toBe(0);
    await vi.advanceTimersByTimeAsync(1_999); expect(f.probes()).toBe(1);
    await vi.advanceTimersByTimeAsync(2); await flush();
    expect(f.probes()).toBe(2); expect(f.reanchors()).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000); await flush();
    expect(f.probes()).toBe(2); // 성공 뒤 추가 재시도 없음
  });

  it('V9 ACK 는 applied 인데 clock_uncertain=true 면 계속 재시도하고, 매번 새 probe_id 를 쓴다', async () => {
    const f = fake({ reanchor: () => ({ result: { clock_uncertain: true } as never }) });
    const c = make(f);
    await c.start(); await flush();
    await vi.advanceTimersByTimeAsync(2_000); await flush();
    await vi.advanceTimersByTimeAsync(4_000); await flush();
    expect(f.probes()).toBe(3);
    expect(new Set(f.probeIds).size).toBe(3);
  });

  it('재시도 간격은 2·4·8·15·15… 초, 최대 8회 후 5분 주기까지 추가 시도가 없다', async () => {
    expect(REANCHOR_RETRY_DELAYS_MS).toEqual([2_000, 4_000, 8_000, 15_000, 15_000, 15_000, 15_000, 15_000]);
    const f = fake({ reanchor: () => ({ status: 'rejected' as const }) });
    const c = make(f);
    await c.start(); await flush();
    for (const d of REANCHOR_RETRY_DELAYS_MS) { await vi.advanceTimersByTimeAsync(d); await flush(); }
    expect(f.probes()).toBe(1 + REANCHOR_RETRY_DELAYS_MS.length);
    // 재시도 합계 89초 지점. 5분(300초) 직전까지 추가 시도 없음
    await vi.advanceTimersByTimeAsync(200_000); await flush();
    expect(f.probes()).toBe(1 + REANCHOR_RETRY_DELAYS_MS.length);
    await vi.advanceTimersByTimeAsync(11_000); await flush(); // t=300초: 기존 5분 주기 시도
    expect(f.probes()).toBe(2 + REANCHOR_RETRY_DELAYS_MS.length);
  });

  it('성공(clock_uncertain 없음/false) 시 재시도 없이 5분 주기만 유지한다', async () => {
    const f = fake();
    const c = make(f);
    await c.start(); await flush();
    expect(f.reanchors()).toBe(1);
    await vi.advanceTimersByTimeAsync(4 * 60_000); await flush();
    expect(f.reanchors()).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000); await flush();
    expect(f.reanchors()).toBe(2);
  });

  it('close 하면 대기 중인 재시도도 멈춘다', async () => {
    const f = fake({ probe: () => null });
    const c = make(f);
    await c.start(); await flush();
    await c.close('test'); await flush();
    await vi.advanceTimersByTimeAsync(120_000); await flush();
    expect(f.probes()).toBe(1);
  });
});
