// SDD-260 W2 — 앱 시작·online·복귀·60초마다 미완료 scope 를 이어올린다(V-C5·V-C6·V-A10 웹판).
import { describe, expect, it, vi } from 'vitest';
import type { MetricEnvelope } from '../../src/lib/measurement-web/envelope';
import { MemoryOutboxStore, MetricOutbox, type FeatureResult, type OutboxScope } from '../../src/lib/measurement-web/metric-outbox';
import { sweepFeatureScopes, type SweepDeps } from '../../src/lib/measurement-web/feature-sweeper';
import type { FeatureSummary } from '../../src/lib/measurement-web/feature-reconcile';

const STREAM = 'st-1';
const env = (sid: string, pid: string, seq: number): MetricEnvelope => ({
  session_id: sid, participant_id: pid, stream_id: STREAM, stream_generation: '1', sequence: String(seq),
  window_start_us: '0', window_end_us: '1', observed_at_ms: 1, clock_anchor_id: 'a', clock_uncertainty_ms: 1,
  device_profile_version: 'd', algorithm_version: 'a', model_version: 'm', feature_hash: 'f'.repeat(64),
  contact: { fp1: 'contact', fp2: 'contact' }, sqi: 1, metrics: {},
});
const ok = (w: MetricEnvelope[]): FeatureResult[] => w.map((x) => ({ stream_id: x.stream_id, sequence: x.sequence, status: 'accepted', durable: true }));

async function seed(store: MemoryOutboxStore, scope: OutboxScope, n: number) {
  const ob = new MetricOutbox({ scope, store, send: async () => { throw new Error('x'); } });
  for (let i = 0; i < n; i += 1) await ob.enqueue(env(scope.sessionId, scope.participantId, i));
}

/** 서버 시뮬레이터: 받은 창을 보관하고 summary 를 계산한다 */
function fakeServer() {
  const held = new Map<string, Set<number>>(); // scopeKey → seqs
  const key = (s: OutboxScope) => `${s.sessionId}|${s.participantId}`;
  const summaryOf = (s: OutboxScope): FeatureSummary => {
    const seqs = [...(held.get(key(s)) ?? [])].sort((a, b) => a - b);
    if (seqs.length === 0) return { session_id: s.sessionId, participant_id: s.participantId, total_count: 0, streams: [], updated_at: null };
    const missing: Array<[number, number]> = [];
    for (let i = 1; i < seqs.length; i += 1) if (seqs[i]! - seqs[i - 1]! > 1) missing.push([seqs[i - 1]! + 1, seqs[i]! - 1]);
    let contiguous = -1; if (seqs[0] === 0) { contiguous = 0; for (let i = 1; i < seqs.length && seqs[i] === seqs[i - 1]! + 1; i += 1) contiguous = seqs[i]!; }
    return { session_id: s.sessionId, participant_id: s.participantId, total_count: seqs.length, updated_at: null,
      streams: [{ stream_id: STREAM, count: seqs.length, min_index: seqs[0]!, max_index: seqs.at(-1)!, contiguous_through: contiguous, missing_ranges: missing, truncated: false }] };
  };
  return { held, key, summaryOf };
}

function deps(store: MemoryOutboxStore, srv: ReturnType<typeof fakeServer>, over: Partial<SweepDeps> = {}): SweepDeps {
  return {
    store,
    authFor: (scope) => (scope.accountId === 'user:u1' ? { skipAuth: false } : null),
    postBatch: async (scope, w) => { const set = srv.held.get(srv.key(scope)) ?? new Set<number>(); w.forEach((x) => set.add(Number(x.sequence))); srv.held.set(srv.key(scope), set); return ok(w); },
    getSummary: async (scope) => srv.summaryOf(scope),
    now: () => 10_000_000,
    ...over,
  };
}

describe('sweepFeatureScopes', () => {
  it('재실행 후 미전송 scope 를 전량 올리고 summary 대조로 완료 마커를 남긴다', async () => {
    const store = new MemoryOutboxStore(); const srv = fakeServer();
    const scope = { accountId: 'user:u1', sessionId: 's1', participantId: 'p1' };
    await seed(store, scope, 150);
    const r = await sweepFeatureScopes(deps(store, srv));
    expect(r.completed).toEqual([scope]);
    expect(srv.held.get('s1|p1')?.size).toBe(150);
    expect(await new MetricOutbox({ scope, store, send: async (w) => ok(w) }).getMeta()).toMatchObject({ completedCount: 150 });
  });

  it('다른 계정 scope 는 전송 0·보존(V-C6)', async () => {
    const store = new MemoryOutboxStore(); const srv = fakeServer(); const post = vi.fn();
    const other = { accountId: 'user:other', sessionId: 's9', participantId: 'p9' };
    await seed(store, other, 10);
    const r = await sweepFeatureScopes(deps(store, srv, { postBatch: post }));
    expect(post).not.toHaveBeenCalled();
    expect(r.skipped).toEqual([other]);
    expect(await new MetricOutbox({ scope: other, store, send: async (w) => ok(w) }).pendingCount()).toBe(10);
  });

  it('acked 인데 서버에 없는 창(max_index 이후 포함)은 다시 보낸다 — 빈 missing_ranges 만으로 완료하지 않는다', async () => {
    const store = new MemoryOutboxStore(); const srv = fakeServer();
    const scope = { accountId: 'user:u1', sessionId: 's1', participantId: 'p1' };
    await seed(store, scope, 100);
    // 서버가 앞 60창만 갖고 있는 상태: 로컬은 100창 acked(서버 유실 가정)
    const ob = new MetricOutbox({ scope, store, send: async (w) => ok(w) });
    await ob.flushAll();
    srv.held.set('s1|p1', new Set(Array.from({ length: 60 }, (_, i) => i)));
    const r = await sweepFeatureScopes(deps(store, srv));
    expect(r.completed).toEqual([scope]);
    expect(srv.held.get('s1|p1')?.size).toBe(100);
  });

  it('전송 실패(오프라인)면 완료로 표시하지 않고 다음 라운드에 이어간다', async () => {
    const store = new MemoryOutboxStore(); const srv = fakeServer();
    const scope = { accountId: 'user:u1', sessionId: 's1', participantId: 'p1' };
    await seed(store, scope, 5);
    const r = await sweepFeatureScopes(deps(store, srv, { postBatch: async () => { throw new TypeError('offline'); } }));
    expect(r.completed).toEqual([]);
    expect(r.pending).toEqual([scope]);
  });

  it('이미 완료 마커가 있고 대기 0 이면 건너뛴다(불필요한 summary 호출 없음)', async () => {
    const store = new MemoryOutboxStore(); const srv = fakeServer(); const sum = vi.fn();
    const scope = { accountId: 'user:u1', sessionId: 's1', participantId: 'p1' };
    await seed(store, scope, 3);
    await sweepFeatureScopes(deps(store, srv));
    await sweepFeatureScopes(deps(store, srv, { getSummary: sum }));
    expect(sum).not.toHaveBeenCalled();
  });
});
