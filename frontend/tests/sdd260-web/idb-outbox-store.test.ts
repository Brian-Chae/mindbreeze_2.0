// SDD-260 W1 — 실제 IndexedDB(fake-indexeddb)로 IdbOutboxStore 영속·scope 격리·u64 정렬 검증 (V-A13)
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { MetricEnvelope } from '../../src/lib/measurement-web/envelope';
import { IdbOutboxStore, MetricOutbox, type FeatureResult, type OutboxScope } from '../../src/lib/measurement-web/metric-outbox';

const env = (seq: string, pid: string): MetricEnvelope => ({
  session_id: 's1', participant_id: pid, stream_id: 'st', stream_generation: '1', sequence: seq, window_start_us: '0', window_end_us: '1',
  observed_at_ms: 1, clock_anchor_id: 'a', clock_uncertainty_ms: 1, device_profile_version: 'd', algorithm_version: 'a', model_version: 'm',
  feature_hash: 'f'.repeat(64), contact: { fp1: 'contact', fp2: 'contact' }, sqi: 1, metrics: {},
});
const ok = (w: MetricEnvelope[]): FeatureResult[] => w.map((x) => ({ stream_id: x.stream_id, sequence: x.sequence, status: 'accepted', durable: true }));
const A: OutboxScope = { accountId: 'user:a', sessionId: 's1', participantId: 'pa' };
const B: OutboxScope = { accountId: 'user:b', sessionId: 's1', participantId: 'pb' };

describe('IdbOutboxStore', () => {
  it('360창 오프라인 적재 → 새 인스턴스(새로고침)가 전량 복원해 전송, 폐기 0', async () => {
    const off = new MetricOutbox({ scope: A, store: new IdbOutboxStore(), send: async () => { throw new TypeError('offline'); }, random: () => 0 });
    for (let i = 0; i < 360; i += 1) await off.enqueue(env(String(i), 'pa'));
    const sent: number[] = [];
    const back = new MetricOutbox({ scope: A, store: new IdbOutboxStore(), send: async (w) => { sent.push(w.length); return ok(w); } });
    expect(await back.pendingCount()).toBe(360);
    await back.flushAll();
    expect(sent.reduce((x, y) => x + y, 0)).toBe(360);
    expect((await back.counts()).acked).toBe(360);
  });

  it('scope(계정) 가 다르면 서로 보이지 않고 listScopes 가 둘 다 찾는다', async () => {
    const store = new IdbOutboxStore();
    await new MetricOutbox({ scope: B, store, send: async (w) => ok(w) }).enqueue(env('1', 'pb'));
    const scopes = (await store.listScopes()).map((s) => s.accountId).sort();
    expect(scopes).toEqual(expect.arrayContaining(['user:a', 'user:b']));
    expect(await new MetricOutbox({ scope: B, store, send: async (w) => ok(w) }).pendingCount()).toBe(1);
  });

  it('sequence 는 자릿수 패딩으로 사전순=숫자순 (9 < 10 < 100), u64 최대값도 보존', async () => {
    const scope: OutboxScope = { accountId: 'user:c', sessionId: 's1', participantId: 'pc' };
    const store = new IdbOutboxStore();
    const sent: string[] = [];
    const ob = new MetricOutbox({ scope, store, send: async (w) => { sent.push(...w.map((x) => x.sequence)); return ok(w); } });
    for (const q of ['100', '9', '10', '18446744073709551615']) await ob.enqueue(env(q, 'pc'));
    await ob.flushAll();
    expect(sent).toEqual(['9', '10', '100', '18446744073709551615']);
  });

  it('완료 마커 메타가 영속되고 창 목록에 섞이지 않는다', async () => {
    const scope: OutboxScope = { accountId: 'user:d', sessionId: 's1', participantId: 'pd' };
    const store = new IdbOutboxStore();
    const ob = new MetricOutbox({ scope, store, send: async (w) => ok(w) });
    await ob.enqueue(env('1', 'pd'));
    await ob.putMeta({ completedCount: 1, completedAtMs: 5 });
    const again = new MetricOutbox({ scope, store: new IdbOutboxStore(), send: async (w) => ok(w) });
    expect(await again.getMeta()).toEqual({ completedCount: 1, completedAtMs: 5 });
    expect((await again.snapshot())).toHaveLength(1);
  });
});
