// SDD-260 W1 — feature REST 배치 정본 저장 outbox. 소켓 ACK 와 무관하게 REST ACK 로만 acked 처리한다.
// verify: V-A1(소켓 없이 저장) · V-A12(거절 격리 정책) · V-A13(웹 outbox 영속, 폐기 0) · V-C3(ACK 유실 재전송)
import { describe, expect, it, vi } from 'vitest';
import type { MetricEnvelope } from '../../src/lib/measurement-web/envelope';
import { ApiError } from '../../src/lib/api/client';
import {
  MemoryOutboxStore, MetricOutbox, QUARANTINE_CODES, fullJitterMs, MAX_BATCH_WINDOWS,
  type FeatureResult, type OutboxScope,
} from '../../src/lib/measurement-web/metric-outbox';

const SCOPE: OutboxScope = { accountId: 'user:u1', sessionId: 's1', participantId: 'p1' };
const STREAM = '0000000a-0000-4000-8000-00000000000a';

const env = (seq: number, stream = STREAM): MetricEnvelope => ({
  session_id: 's1', participant_id: 'p1', stream_id: stream, stream_generation: '1', sequence: String(seq),
  window_start_us: String(seq * 1_000_000), window_end_us: String((seq + 1) * 1_000_000), observed_at_ms: 1_760_000_000_000 + seq * 1000,
  clock_anchor_id: 'a', clock_uncertainty_ms: 10, device_profile_version: 'd', algorithm_version: 'a', model_version: 'm',
  feature_hash: 'f'.repeat(64), contact: { fp1: 'contact', fp2: 'contact' }, sqi: 0.9, metrics: {},
});

const ok = (w: MetricEnvelope[], status: FeatureResult['status'] = 'accepted'): FeatureResult[] =>
  w.map((x) => ({ stream_id: x.stream_id, sequence: x.sequence, status, durable: true }));

function make(send: (w: MetricEnvelope[]) => Promise<FeatureResult[]>, over: Partial<ConstructorParameters<typeof MetricOutbox>[0]> = {}) {
  let t = 1_000;
  const store = new MemoryOutboxStore();
  const outbox = new MetricOutbox({ scope: SCOPE, store, send, now: () => t, random: () => 1, ...over });
  return { outbox, store, advance: (ms: number) => { t += ms; } };
}

describe('MetricOutbox — 정본은 REST 배치', () => {
  it('300창을 적재해도 폐기하지 않고(상한 없음) 60창씩 오름차순으로 보낸다', async () => {
    const sent: MetricEnvelope[][] = [];
    const { outbox } = make(async (w) => { sent.push(w); return ok(w); });
    for (let i = 0; i < 300; i += 1) await outbox.enqueue(env(i));
    expect(await outbox.pendingCount()).toBe(300);
    await outbox.flush();
    expect(sent[0]).toHaveLength(MAX_BATCH_WINDOWS);
    expect(sent[0]!.map((e) => e.sequence)).toEqual(Array.from({ length: 60 }, (_, i) => String(i)));
    expect(await outbox.pendingCount()).toBe(240);
  });

  it('accepted·duplicate 는 acked(전송 대기에서 제외), 재enqueue 해도 중복 적재 없음', async () => {
    const { outbox } = make(async (w) => [...ok([w[0]!]), ...ok([w[1]!], 'duplicate')]);
    await outbox.enqueue(env(1)); await outbox.enqueue(env(2)); await outbox.enqueue(env(1));
    await outbox.flush();
    expect(await outbox.pendingCount()).toBe(0);
    expect((await outbox.snapshot()).filter((r) => r.state === 'acked')).toHaveLength(2);
  });

  it('rejected 4종만 격리(재전송 0), 그 외 코드는 계속 재시도 대상', async () => {
    expect([...QUARANTINE_CODES].sort()).toEqual(['consent_withdrawn', 'hash_conflict', 'participant_mismatch', 'stream_not_owned']);
    const sent: string[][] = [];
    const { outbox, advance } = make(async (w) => {
      sent.push(w.map((x) => x.sequence));
      return [
        { stream_id: STREAM, sequence: '1', status: 'rejected', code: 'consent_withdrawn' },
        { stream_id: STREAM, sequence: '2', status: 'rejected', code: 'something_new' },
      ];
    });
    await outbox.enqueue(env(1)); await outbox.enqueue(env(2));
    await outbox.flush();
    expect((await outbox.snapshot()).find((r) => r.sequence === '1')).toMatchObject({ state: 'rejected', code: 'consent_withdrawn' });
    expect((await outbox.snapshot()).find((r) => r.sequence === '2')?.state).toBe('pending');
    advance(120_000);
    await outbox.flush();
    expect(sent.at(-1)).toEqual(['2']); // 격리된 1번은 다시 보내지 않는다
  });

  it('소켓 ACK 같은 외부 신호로는 acked 되지 않는다 — send 가 던지면 모두 pending 유지(V-A12)', async () => {
    const { outbox } = make(async () => { throw new TypeError('Failed to fetch'); });
    await outbox.enqueue(env(1));
    await outbox.flush();
    expect(await outbox.pendingCount()).toBe(1);
  });

  it('네트워크 오류는 full jitter 로 대기 후 재시도하고 성공하면 acked', async () => {
    let fail = true;
    const send = vi.fn(async (w: MetricEnvelope[]) => { if (fail) throw new TypeError('offline'); return ok(w); });
    const { outbox, advance } = make(send);
    await outbox.enqueue(env(1));
    await outbox.flush();
    expect(send).toHaveBeenCalledTimes(1);
    await outbox.flush(); // 대기 시간 내 → 호출 없음
    expect(send).toHaveBeenCalledTimes(1);
    fail = false;
    advance(2_000);
    await outbox.flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(await outbox.pendingCount()).toBe(0);
  });

  it('5xx·401 도 재시도, 응답에 없는 창은 pending 유지', async () => {
    const { outbox, advance } = make(async () => { throw new ApiError(503, 'unavailable', null); });
    await outbox.enqueue(env(1));
    await outbox.flush();
    expect(await outbox.pendingCount()).toBe(1);
    advance(120_000);
    const partial = make(async (w) => ok([w[0]!]));
    await partial.outbox.enqueue(env(1)); await partial.outbox.enqueue(env(2));
    await partial.outbox.flush();
    expect(await partial.outbox.pendingCount()).toBe(1);
  });

  it('422 는 1창씩 분리 전송해 독 창만 invalid_message 로 격리한다', async () => {
    const sent: string[][] = [];
    const { outbox, advance } = make(async (w) => {
      sent.push(w.map((x) => x.sequence));
      if (w.some((x) => x.sequence === '2')) throw new ApiError(422, 'invalid', { detail: { code: 'invalid_message' } });
      return ok(w);
    });
    for (const i of [1, 2, 3]) await outbox.enqueue(env(i));
    for (let i = 0; i < 6; i += 1) { await outbox.flush(); advance(120_000); }
    const snap = await outbox.snapshot();
    expect(snap.find((r) => r.sequence === '2')).toMatchObject({ state: 'rejected', code: 'invalid_message' });
    expect(snap.filter((r) => r.state === 'acked').map((r) => r.sequence).sort()).toEqual(['1', '3']);
  });

  it('동시 flush 는 1개만 진행한다', async () => {
    let n = 0;
    const { outbox } = make(async (w) => { n += 1; await new Promise((r) => setTimeout(r, 5)); return ok(w); });
    await outbox.enqueue(env(1));
    await Promise.all([outbox.flush(), outbox.flush(), outbox.flush()]);
    expect(n).toBe(1);
  });

  it('영속: 새 인스턴스(새로고침)가 같은 store 에서 전량 복원해 전송한다(V-A13)', async () => {
    const store = new MemoryOutboxStore();
    const a = new MetricOutbox({ scope: SCOPE, store, send: async () => { throw new TypeError('offline'); }, random: () => 0 });
    for (let i = 0; i < 360; i += 1) await a.enqueue(env(i));
    const sent: number[] = [];
    const b = new MetricOutbox({ scope: SCOPE, store, send: async (w) => { sent.push(w.length); return ok(w); }, random: () => 0 });
    expect(await b.pendingCount()).toBe(360);
    while ((await b.pendingCount()) > 0) await b.flush();
    expect(sent.reduce((x, y) => x + y, 0)).toBe(360);
  });

  it('다른 scope(계정·참가자) 레코드는 건드리지 않는다(V-C6)', async () => {
    const store = new MemoryOutboxStore();
    const other = new MetricOutbox({ scope: { ...SCOPE, accountId: 'user:other' }, store, send: async (w) => ok(w) });
    await other.enqueue(env(1));
    const mine = new MetricOutbox({ scope: SCOPE, store, send: async (w) => ok(w) });
    expect(await mine.pendingCount()).toBe(0);
    await mine.flush();
    expect(await other.pendingCount()).toBe(1);
  });

  it('fullJitterMs: 0..min(60s, 1s×2^n)', () => {
    expect(fullJitterMs(0, () => 1)).toBe(1_000);
    expect(fullJitterMs(3, () => 1)).toBe(8_000);
    expect(fullJitterMs(20, () => 1)).toBe(60_000);
    expect(fullJitterMs(5, () => 0)).toBe(0);
  });
});
