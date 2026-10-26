// SDD-246 T06c — T05b 계약 맞춤(웹): capture ACK result·u64 문자열·live:metric 배치/ACK·live:device·device.changed 합집합·서버 신선도.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PID, SID, STREAM, event, metricsData, snapshot } from './fixtures';
import { CaptureController } from '../../src/lib/measurement-web/capture-controller';
import { MetricOutbox } from '../../src/lib/measurement-web/metric-outbox';
import type { MetricEnvelope } from '../../src/lib/measurement-web/envelope';
import { applyEvent, applySnapshot, beginResync, createLiveState } from '../../src/lib/session-live/live-state';
import { freshnessOf } from '../../src/lib/session-live/live-view';
import { LiveClient, type LiveSocketLike, type MetricSendOutcome, type RestFallback } from '../../src/lib/session-live/live-client';
import type { CommandAck, MetricAck } from '../../src/lib/session-live/live-types';

const BIG_GEN = '18446744073709551615'; // u64 최대 — Number 로 바꾸면 18446744073709552000 이 된다
const STREAM2 = '00000015-0000-4000-8000-000000000015';
const ANCHOR = '0000000c-0000-4000-8000-00000000000c';

function env(seq: string, over: Partial<MetricEnvelope> = {}): MetricEnvelope {
  return {
    session_id: SID, participant_id: '00000000-0000-4000-8000-000000000000', stream_id: '00000000-0000-4000-8000-000000000000',
    stream_generation: '0', sequence: seq, window_start_us: `${Number(seq) * 1_000_000}`, window_end_us: `${(Number(seq) + 1) * 1_000_000}`,
    observed_at_ms: 1_760_000_000_000, clock_anchor_id: '00000000-0000-4000-8000-000000000000', clock_uncertainty_ms: 300000,
    device_profile_version: 'linkband2-v1', algorithm_version: 'core-1', model_version: 'm1',
    feature_hash: 'a'.repeat(64), contact: { fp1: 'contact', fp2: 'contact' }, sqi: 0.9, metrics: {},
    ...over,
  };
}

function mack(e: { stream_id: string; sequence: string }, status: MetricAck['status'], code?: string): MetricAck {
  return {
    session_id: SID, participant_id: PID, stream_id: e.stream_id, sequence: e.sequence, status,
    durable: status === 'accepted' || status === 'duplicate', feature_hash: 'a'.repeat(64), received_at_server_ms: 1, ...(code ? { code } : {}),
  };
}

const startAck = (over: Partial<CommandAck> = {}): CommandAck => ({
  command_id: '00000099-0000-4000-8000-000000000099', status: 'applied', epoch: '1', cursors: [], committed: true,
  result: {
    stream_id: STREAM, participant_id: PID, generation: BIG_GEN, owner_generation: BIG_GEN,
    lease: { expires_at_ms: 1_760_000_030_000, offline_bound_until_ms: 1_760_000_600_000 }, clock_uncertain: true,
  },
  ...over,
});

function fakeClient(opts: { start?: CommandAck } = {}) {
  const calls: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const batches: MetricEnvelope[][] = [];
  const devices: Array<Record<string, unknown>> = [];
  let metricReply: (w: MetricEnvelope[]) => MetricSendOutcome = (w) => ({ kind: 'acks', acks: w.map((x) => mack(x, 'accepted')) });
  let deviceReply: () => { kind: 'ack'; status: 'accepted' | 'duplicate' } | { kind: 'error'; code: string; retryable: boolean; retryAfterMs: number | null } = () => ({ kind: 'ack', status: 'accepted' });
  const client = {
    request: vi.fn(async (kind: string, payload: Record<string, unknown>): Promise<CommandAck> => {
      calls.push({ kind, payload });
      if (kind === 'capture.start') return opts.start ?? startAck();
      return { command_id: 'x', status: 'applied', epoch: '1', cursors: [], committed: true };
    }),
    sendMetricBatch: vi.fn(async (w: MetricEnvelope[]) => { batches.push(w); return metricReply(w); }),
    sendDevice: vi.fn(async (r: Record<string, unknown>) => { devices.push(r); return deviceReply(); }),
    clockProbe: vi.fn(async () => ({ probeId: '0000000b-0000-4000-8000-00000000000b', rttMs: 20, offsetMs: 3, serverReceiveMs: 1, serverSendMs: 2 })),
  };
  return {
    client, calls, batches, devices,
    setMetricReply: (f: typeof metricReply) => { metricReply = f; },
    setDeviceReply: (f: typeof deviceReply) => { deviceReply = f; },
  };
}

const flush = async (): Promise<void> => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };

function controller(f: ReturnType<typeof fakeClient>, over: Partial<ConstructorParameters<typeof CaptureController>[0]> = {}) {
  return new CaptureController({
    client: f.client, sessionId: SID, eegConsent: true, bandConnected: true,
    deviceProfile: 'linkband2-v1', algorithmVersion: 'core-1', modelVersion: 'm1', uuid: () => ANCHOR, ...over,
  });
}

describe('T06c — capture.start ACK result 직접 사용', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('ACK result 의 stream/participant/generation 을 그대로 쓰고 device 이벤트를 기다리지 않는다(u64 문자열 보존)', async () => {
    const f = fakeClient();
    const c = controller(f);
    expect(await c.start()).toBe('started');
    expect(c.capture()).toMatchObject({ streamId: STREAM, participantId: PID, generation: BIG_GEN, leaseExpiresAtMs: 1_760_000_030_000 });
    c.pushEnvelope(env('1'));
    await flush();
    expect(f.batches[0]![0]).toMatchObject({ session_id: SID, participant_id: PID, stream_id: STREAM, stream_generation: BIG_GEN, clock_anchor_id: ANCHOR, sequence: '1' });
  });

  it('applied 인데 result.stream_id 가 없으면 rejected(추측으로 stream 을 만들지 않는다)', async () => {
    const f = fakeClient({ start: startAck({ result: undefined }) });
    const c = controller(f);
    expect(await c.start()).toBe('rejected');
    c.pushEnvelope(env('1'));
    await flush();
    expect(f.batches).toHaveLength(0);
  });

  it('미착용·EEG 미동의면 capture 요청 0', async () => {
    const f = fakeClient();
    expect(await controller(f, { eegConsent: false }).start()).toBe('not_allowed');
    expect(await controller(f, { bandConnected: false }).start()).toBe('not_allowed');
    expect(f.calls).toHaveLength(0);
  });

  it('start 직후 reanchor(clock_probe→capture.reanchor) 로 time_uncertain 해소를 시도한다', async () => {
    const f = fakeClient();
    const c = controller(f, { monotonicUs: () => 5_000_000, deviceTicks: () => '1234' });
    await c.start();
    await flush();
    const re = f.calls.find((x) => x.kind === 'capture.reanchor');
    expect(re?.payload).toMatchObject({ stream_id: STREAM, clock_probe_id: '0000000b-0000-4000-8000-00000000000b', device_ticks: '1234', monotonic_us: '5000000' });
  });

  it('renew 가 stale_owner_generation 으로 거절되면 수집을 멈춘다(fencing)', async () => {
    const f = fakeClient();
    const stopped: string[] = [];
    const c = controller(f, { onStopped: (code) => stopped.push(code) });
    await c.start();
    f.client.request.mockResolvedValueOnce({ command_id: 'r', status: 'rejected', code: 'stale_owner_generation', epoch: '1', cursors: [], committed: false });
    await c.renew();
    expect(stopped).toEqual(['stale_owner_generation']);
    expect(c.capture()).toBeNull();
  });
});

describe('T06c — device.changed 로 owner 교체·권한 회수 판단', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('내 stream 이 superseded/revoked 가 되거나 더 큰 generation 이 보이면 멈춘다(문자열 u64 비교)', async () => {
    const f = fakeClient({ start: startAck({ result: { stream_id: STREAM, participant_id: PID, generation: '9007199254740993', owner_generation: '9007199254740993', lease: { expires_at_ms: 1 } } }) });
    const stopped: string[] = [];
    const c = controller(f, { onStopped: (code) => stopped.push(code) });
    await c.start();
    // 2^53+1 vs 2^53+2: Number 로는 같은 값이라 구분 불가
    c.observeDevice({ participant_id: PID, stream_id: STREAM, generation: '9007199254740993', status: 'active' });
    expect(c.capture()).not.toBeNull();
    c.observeDevice({ participant_id: PID, stream_id: STREAM2, generation: '9007199254740994', status: 'active' });
    expect(stopped).toEqual(['superseded']);
    expect(c.capture()).toBeNull();

    const g = fakeClient();
    const s2: string[] = [];
    const d = controller(g, { onStopped: (code) => s2.push(code) });
    await d.start();
    d.observeDevice({ participant_id: PID, stream_id: STREAM, generation: BIG_GEN, status: 'revoked', cutoff_code: 'consent_withdrawn' });
    expect(s2).toEqual(['consent_withdrawn']);
  });
});

describe('T06c — MetricOutbox(live:metric 응답 처리)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('accepted·duplicate 만 제거, rejected 는 재시도 금지, 창별 retryable 은 유지', async () => {
    const sent: MetricEnvelope[][] = [];
    const ob = new MetricOutbox({
      send: async (w) => { sent.push(w); return { kind: 'acks', acks: [mack(w[0]!, 'accepted'), mack(w[1]!, 'duplicate'), mack(w[2]!, 'rejected', 'feature_hash_conflict'), mack(w[3]!, 'retryable')] }; },
    });
    for (const s of ['1', '2', '3', '4']) ob.enqueue(env(s, { stream_id: STREAM }));
    await ob.flush();
    expect(ob.pendingKeys()).toEqual([`${STREAM}:4`]);
    expect(ob.rejected()).toEqual([{ key: `${STREAM}:3`, code: 'feature_hash_conflict' }]);
    await vi.advanceTimersByTimeAsync(5_000);
    await ob.flush();
    expect(sent.at(-1)!.map((x) => x.sequence)).toEqual(['4']); // 3 은 다시 보내지 않는다
  });

  it('not_ready(retryable) 는 전부 보존하고 retry_after_ms 이후 재전송, 비재시도 배치 오류는 버린다', async () => {
    let reply: MetricSendOutcome = { kind: 'error', code: 'not_ready', retryable: true, retryAfterMs: 500 };
    const sent: MetricEnvelope[][] = [];
    const ob = new MetricOutbox({ send: async (w) => { sent.push(w); return reply; } });
    ob.enqueue(env('1', { stream_id: STREAM }));
    await ob.flush();
    expect(ob.pendingKeys()).toEqual([`${STREAM}:1`]);
    await ob.flush(); // 대기 시간 전에는 보내지 않는다
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(600);
    reply = { kind: 'error', code: 'invalid_message', retryable: false, retryAfterMs: null };
    await ob.flush();
    expect(sent).toHaveLength(2);
    expect(ob.pendingKeys()).toEqual([]);
    expect(ob.rejected()).toEqual([{ key: `${STREAM}:1`, code: 'invalid_message' }]);
  });

  it('stream 단위 거절(stale_owner_generation)은 그 stream 의 대기 창을 모두 버리고 onFenced 를 알린다', async () => {
    const fenced: string[] = [];
    const ob = new MetricOutbox({
      maxBatch: 1,
      send: async (w) => ({ kind: 'acks', acks: [mack(w[0]!, 'rejected', 'stale_owner_generation')] }),
      onFenced: (code) => fenced.push(code),
    });
    ob.enqueue(env('1', { stream_id: STREAM }));
    ob.enqueue(env('2', { stream_id: STREAM }));
    await ob.flush();
    expect(fenced).toEqual(['stale_owner_generation']);
    expect(ob.pendingKeys()).toEqual([]);
  });

  it('배치 상한 60창, 대기 상한 초과 시 가장 오래된 창부터 버린다(archive 가 정본)', async () => {
    const sent: MetricEnvelope[][] = [];
    const ob = new MetricOutbox({ maxPending: 3, send: async (w) => { sent.push(w); return { kind: 'not_sent' }; } });
    for (const s of ['1', '2', '3', '4']) ob.enqueue(env(s, { stream_id: STREAM }));
    expect(ob.pendingKeys()).toEqual([`${STREAM}:2`, `${STREAM}:3`, `${STREAM}:4`]);
    expect(ob.droppedCount()).toBe(1);
    const big = new MetricOutbox({ send: async (w) => { sent.push(w); return { kind: 'acks', acks: w.map((x) => mack(x, 'accepted')) }; } });
    for (let i = 1; i <= 70; i += 1) big.enqueue(env(String(i), { stream_id: STREAM }));
    sent.length = 0;
    await big.flush();
    expect(sent[0]).toHaveLength(60);
  });
});

describe('T06c — live:device 보고', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('device_seq 는 단조 증가 문자열, Device wire 필드만 보낸다', async () => {
    const f = fakeClient();
    const c = controller(f);
    await c.start();
    const band = { band_state: 'connected' as const, contact: { fp1: 'contact', fp2: 'leadoff' }, sqi: 0.7, battery_pct: 80, state_reason: null };
    expect(await c.reportDevice(band)).toBe('accepted');
    expect(await c.reportDevice(band)).toBe('accepted');
    expect(f.devices.map((d) => d.device_seq)).toEqual(['1', '2']);
    expect(Object.keys(f.devices[0]!).sort()).toEqual(['band_state', 'battery_pct', 'contact', 'device_seq', 'session_id', 'sqi', 'state_reason', 'stream_id']);
  });

  it('stream_not_active 를 받으면 이후 보고를 멈춘다', async () => {
    const f = fakeClient();
    const c = controller(f);
    await c.start();
    f.setDeviceReply(() => ({ kind: 'error', code: 'stream_not_active', retryable: false, retryAfterMs: null }));
    const band = { band_state: 'connected' as const, contact: { fp1: 'contact', fp2: 'contact' }, sqi: null, battery_pct: null, state_reason: null };
    expect(await c.reportDevice(band)).toBe('stopped');
    expect(await c.reportDevice(band)).toBe('stopped');
    expect(f.devices).toHaveLength(1);
  });
});

describe('T06c — device.changed 합집합 reducer', () => {
  function ready() {
    const s0 = beginResync(createLiveState({ sessionId: SID }), { requestId: 'r', generation: '1' });
    return applySnapshot(s0, snapshot({ request_id: 'r', connection_generation: '1', through: [{ audience: 'host', domain: 'device', seq: '1' }] })).state;
  }

  it('같은 stream 의 stream 수명 event(밴드 필드 부재)는 이전 밴드 값을 유지하고 stream 필드만 갱신', () => {
    let s = ready();
    s = applyEvent(s, event('device', 'device.changed', '2', '1', { participant_id: PID, stream_id: STREAM, generation: '1', status: 'active', clock_uncertain: true, cutoff_code: null, device_seq: '3', band_state: 'connected', contact: { fp1: 'contact', fp2: 'contact' }, sqi: 0.8, battery_pct: 70, state_reason: null })).state;
    s = applyEvent(s, event('device', 'device.changed', '3', '2', { participant_id: PID, stream_id: STREAM, generation: '1', status: 'active', clock_uncertain: false, cutoff_code: null })).state;
    expect(s.devices[PID]!.data).toMatchObject({ clock_uncertain: false, band_state: 'connected', battery_pct: 70, sqi: 0.8, device_seq: '3' });
  });

  it('새 stream(entity_version 이 1 부터 다시 시작)의 event 는 수용하고, 밴드 필드는 미보고로 둔다(이전 stream 값을 끌고 오지 않는다)', () => {
    let s = ready();
    s = applyEvent(s, event('device', 'device.changed', '2', '3', { participant_id: PID, stream_id: STREAM, generation: '1', status: 'superseded', clock_uncertain: true, cutoff_code: null, device_seq: '3', band_state: 'connected', contact: { fp1: 'contact', fp2: 'contact' }, sqi: 0.8, battery_pct: 70, state_reason: null })).state;
    s = applyEvent(s, event('device', 'device.changed', '3', '1', { participant_id: PID, stream_id: STREAM2, generation: '2', status: 'active', clock_uncertain: true, cutoff_code: null })).state;
    const d = s.devices[PID]!.data;
    expect(d.stream_id).toBe(STREAM2);
    expect(d.band_state).toBeUndefined();
    expect(d.battery_pct).toBeUndefined();
  });

  it('더 작은 generation 의 늦은 event 는 현재 stream 을 덮지 못한다', () => {
    let s = ready();
    s = applyEvent(s, event('device', 'device.changed', '2', '1', { participant_id: PID, stream_id: STREAM2, generation: '9007199254740994', status: 'active', clock_uncertain: true, cutoff_code: null })).state;
    s = applyEvent(s, event('device', 'device.changed', '3', '5', { participant_id: PID, stream_id: STREAM, generation: '9007199254740993', status: 'superseded', clock_uncertain: true, cutoff_code: null })).state;
    expect(s.devices[PID]!.data).toMatchObject({ stream_id: STREAM2, status: 'active' });
  });
});

describe('T06c — 신선도는 서버 판정을 따른다', () => {
  it('서버가 stale/delayed 면 관측 시각이 최근이어도 fresh 로 올리지 않는다', () => {
    expect(freshnessOf(1_000, 1_500, 'stale')).toBe('stale');
    expect(freshnessOf(1_000, 1_500, 'delayed')).toBe('delayed');
  });
  it('서버 fresh 라도 새 관측이 없으면 시간 경과로 낮출 수만 있다', () => {
    expect(freshnessOf(1_000, 1_500, 'fresh')).toBe('fresh');
    expect(freshnessOf(1_000, 5_000, 'fresh')).toBe('delayed');
    expect(freshnessOf(1_000, 12_000, 'delayed')).toBe('stale');
  });
  it('time_uncertain 이면 관측 시각과 무관하게 time_uncertain, 서버 판정이 없으면 none(자체 fresh 판정 금지)', () => {
    expect(freshnessOf(null, 1_500, 'time_uncertain')).toBe('time_uncertain');
    expect(freshnessOf(1_400, 1_500, undefined)).toBe('none');
  });
  it('reducer 에 실린 time_uncertain metric 은 observed_at_ms=null 로 보존된다', () => {
    const s0 = beginResync(createLiveState({ sessionId: SID }), { requestId: 'r', generation: '1' });
    let s = applySnapshot(s0, snapshot({ request_id: 'r', connection_generation: '1' })).state;
    s = applyEvent(s, event('metrics', 'metrics.updated', '42', '4', { ...metricsData('42', 0), observed_at_ms: null, freshness: 'time_uncertain' })).state;
    expect(s.metrics[PID]!.data).toMatchObject({ observed_at_ms: null, freshness: 'time_uncertain' });
  });
});

describe('T06c — LiveClient live:metric/live:device wire', () => {
  class FakeSocket implements LiveSocketLike {
    connected = true;
    handlers = new Map<string, Array<(...a: unknown[]) => void>>();
    emitted: Array<{ ev: string; payload: unknown }> = [];
    ackFor: (ev: string, payload: unknown) => unknown = () => ({ ok: true });
    on(ev: string, fn: (...a: unknown[]) => void): void { this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), fn]); }
    off(): void { /* 시험용 */ }
    emit(ev: string, payload: unknown, ack?: (r: unknown) => void): void {
      this.emitted.push({ ev, payload });
      if (ack) queueMicrotask(() => ack(this.ackFor(ev, payload)));
    }
    fire(ev: string, ...a: unknown[]): void { for (const fn of this.handlers.get(ev) ?? []) fn(...a); }
  }
  async function ready() {
    const sock = new FakeSocket();
    let n = 0;
    const client = new LiveClient({
      sessionId: SID, selfParticipantId: PID, socket: sock, now: () => 1_000,
      uuid: () => `00000${(++n).toString().padStart(3, '0')}-0000-4000-8000-000000000000`,
      clientInstanceId: '00000050-0000-4000-8000-000000000050',
      rest: { getSnapshot: vi.fn(), postCommand: vi.fn() } as unknown as RestFallback,
    });
    client.start(); await flush();
    const join = sock.emitted[1]!.payload as { request_id: string; generation: string };
    sock.fire('live:snapshot', snapshot({ request_id: join.request_id, connection_generation: join.generation }));
    await flush();
    return { sock, client };
  }
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sendMetricBatch 는 {protocol_version,schema_version,windows} 로 emit 하고 {acks} 를 돌려준다', async () => {
    const { sock, client } = await ready();
    sock.ackFor = (ev, p) => (ev === 'live:metric'
      ? { protocol_version: 2, schema_version: 1, acks: (p as { windows: MetricEnvelope[] }).windows.map((w) => mack(w, 'accepted')) }
      : { ok: true });
    const out = await client.sendMetricBatch([env('7', { stream_id: STREAM })]);
    const sent = sock.emitted.find((e) => e.ev === 'live:metric')!.payload as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(['protocol_version', 'schema_version', 'windows']);
    expect(out).toMatchObject({ kind: 'acks', acks: [{ sequence: '7', status: 'accepted' }] });
  });

  it('{ok:false} 응답은 code·retryable 로 돌려준다, READY 가 아니면 not_sent', async () => {
    const { sock, client } = await ready();
    sock.ackFor = () => ({ ok: false, code: 'not_ready', retryable: true, retry_after_ms: 500 });
    expect(await client.sendMetricBatch([env('1')])).toEqual({ kind: 'error', code: 'not_ready', retryable: true, retryAfterMs: 500 });
    sock.connected = false;
    expect(await client.sendMetricBatch([env('2')])).toEqual({ kind: 'not_sent' });
  });

  it('sendDevice 는 versions 를 붙여 live:device 로 emit 하고 status 를 돌려준다', async () => {
    const { sock, client } = await ready();
    sock.ackFor = (ev) => (ev === 'live:device' ? { status: 'duplicate', durable: true } : { ok: true });
    const out = await client.sendDevice({ session_id: SID, stream_id: STREAM, device_seq: '1', band_state: 'connected', contact: { fp1: 'contact', fp2: 'contact' }, sqi: null, battery_pct: null, state_reason: null });
    expect(sock.emitted.find((e) => e.ev === 'live:device')!.payload).toMatchObject({ protocol_version: 2, schema_version: 1, device_seq: '1' });
    expect(out).toEqual({ kind: 'ack', status: 'duplicate' });
  });
});
