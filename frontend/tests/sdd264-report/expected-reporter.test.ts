// SDD-264 — 폰 기대량 보고기: 보고 시점·단조·오프라인 1건 보관·재시도·final·scope 별
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/lib/api/client';
import type { IngestExpectedBody, IngestExpectedResponse } from '../../src/lib/api/ingest-expected';
import {
  ExpectedReporter, IdbExpectedStore, MemoryExpectedStore, expectedRecordId, fullJitterMs, mergeReport,
  type ExpectedReport, type ExpectedScope,
} from '../../src/lib/biosignal/expected-reporter';
import { ExpectedHub, parseSignals, rawTotals } from '../../src/lib/biosignal/expected-hub';

const A: ExpectedScope = { accountId: 'user:a', sessionId: 's1', participantId: 'pa' };
const B: ExpectedScope = { accountId: 'user:a', sessionId: 's2', participantId: 'pa' };
const R = (feature: number, raw: [number, number, number] | null, final = false): ExpectedReport =>
  ({ feature, raw: raw ? { eeg: raw[0], ppg: raw[1], acc: raw[2] } : null, final });
const resp = (sid: string): IngestExpectedResponse => ({ session_id: sid, participant_id: 'pa', expected: { feature: 0, raw: { eeg: null, ppg: null, acc: null } }, final: false, changed: true, ignored: [], updated_at: '' });

function harness(over: { fail?: () => unknown; intervalMs?: number } = {}) {
  let t = 1_000_000;
  const timers: Array<{ at: number; fn: () => void; cancelled: boolean }> = [];
  const calls: Array<{ sid: string; body: IngestExpectedBody }> = [];
  const store = new MemoryExpectedStore();
  const reporter = new ExpectedReporter({
    store, authFor: () => ({ skipAuth: false }), now: () => t, random: () => 0.5, intervalMs: over.intervalMs ?? 30_000, log: () => undefined,
    put: async (sid, body) => { const e = over.fail?.(); if (e) throw e; calls.push({ sid, body }); return resp(sid); },
    setTimer: (fn, ms) => { const h = { at: t + ms, fn, cancelled: false }; timers.push(h); return () => { h.cancelled = true; }; },
  });
  const advance = async (ms: number) => {
    t += ms;
    for (const h of timers.filter((x) => !x.cancelled && x.at <= t)) { h.cancelled = true; h.fn(); }
    await new Promise((r) => setTimeout(r, 5));
  };
  return { store, reporter, calls, advance, now: () => t, timers };
}
const settle = () => new Promise((r) => setTimeout(r, 5));

describe('mergeReport — 단조 병합', () => {
  it('필드별 최댓값이고 낮은 값은 무시한다', () => {
    const m = mergeReport(R(100, [10, 5, 5]), R(90, [12, 4, 5]));
    expect(m).toEqual(R(100, [12, 5, 5], false));
  });
  it('뒤처진 부분합의 final=true 도 반영한다(SDD-266 — 보내는 값은 병합 최댓값이라 서버 규칙 ① 에 걸리지 않는다)', () => {
    const m = mergeReport(R(100, null, false), R(90, null, true));
    expect(m).toEqual(R(100, null, true));
  });
  it('증가한 보고는 새 final 을, 증가 없는 같은 값 final=false 는 확정을 되돌리지 않는다(②③)', () => {
    expect(mergeReport(R(100, null, false), R(120, null, true)).final).toBe(true);
    expect(mergeReport(R(120, null, true), R(120, null, false)).final).toBe(true);
  });
  it('raw 가 한 번이라도 있으면 이후 raw 없는 보고가 지우지 않는다', () => {
    expect(mergeReport(R(1, [1, 1, 1]), R(2, null)).raw).toEqual({ eeg: 1, ppg: 1, acc: 1 });
  });
});

describe('ExpectedReporter — 보고 시점', () => {
  it('첫 보고는 즉시 전송하고 본문에 participant_id·feature·raw·final 을 싣는다', async () => {
    const h = harness();
    await h.reporter.submit(A, R(1200, [80, 40, 40]));
    await settle();
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.body).toEqual({ participant_id: 'pa', feature: 1200, raw: { eeg: 80, ppg: 40, acc: 40 }, final: false });
  });
  it('값 변동은 30초 간격으로 묶어 최신값 1건만 보낸다', async () => {
    const h = harness();
    await h.reporter.submit(A, R(10, null)); await settle();
    await h.reporter.submit(A, R(20, null)); await h.reporter.submit(A, R(30, null)); await settle();
    expect(h.calls).toHaveLength(1);
    await h.advance(29_000); expect(h.calls).toHaveLength(1);
    await h.advance(2_000);
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]!.body.feature).toBe(30);
  });
  it('값이 안 변했으면 다시 보내지 않는다', async () => {
    const h = harness();
    await h.reporter.submit(A, R(10, null)); await settle();
    await h.reporter.submit(A, R(10, null)); await h.advance(60_000);
    expect(h.calls).toHaveLength(1);
  });
  it('종료 final=true 는 간격과 무관하게 즉시 보낸다', async () => {
    const h = harness();
    await h.reporter.submit(A, R(10, null)); await settle();
    await h.reporter.submit(A, R(12, null, true)); await settle();
    expect(h.calls.map((c) => c.body.final)).toEqual([false, true]);
    expect(h.calls[1]!.body.feature).toBe(12);
  });
  it('이어올림 완료 final=true 재보고: 같은 총량에 final 만 바뀌어도 즉시 보낸다', async () => {
    const h = harness();
    await h.reporter.submit(A, R(500, [30, 10, 10])); await settle();
    await h.reporter.submit(A, R(500, [30, 10, 10], true)); await settle();
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]!.body).toMatchObject({ feature: 500, final: true });
  });
  it('raw 가 없으면(구 네이티브) feature 만 보고하고 raw 키를 싣지 않는다', async () => {
    const h = harness();
    await h.reporter.submit(A, R(7, null)); await settle();
    expect('raw' in h.calls[0]!.body).toBe(false);
  });
  it('착용 안 한 신호는 0 으로 보고한다(생략 아님)', async () => {
    const h = harness();
    await h.reporter.submit(A, R(7, [5, 0, 0])); await settle();
    expect(h.calls[0]!.body.raw).toEqual({ eeg: 5, ppg: 0, acc: 0 });
  });
  it('범위·형식 위반 값은 보고하지 않는다', async () => {
    const h = harness();
    await h.reporter.submit(A, R(-1, null)); await h.reporter.submit(A, R(1.5, null)); await h.reporter.submit(A, R(10_000_001, null));
    await settle();
    expect(h.calls).toHaveLength(0);
    expect(await h.store.list()).toHaveLength(0);
  });
});

describe('ExpectedReporter — 오프라인·재시도', () => {
  it('오프라인 동안 값이 늘어도 영속 레코드는 1건이고 마지막(최대) 값만 남는다', async () => {
    const h = harness({ fail: () => new TypeError('offline') });
    for (const f of [10, 20, 30, 40]) await h.reporter.submit(A, R(f, [f, 1, 1]));
    await settle();
    const rows = await h.store.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.report).toEqual(R(40, [40, 1, 1]));
    expect(rows[0]!.sent).toBeNull();
    expect(rows[0]!.halted).toBeNull();
  });
  it('복귀하면 마지막 값 1건만 전송한다', async () => {
    let offline = true;
    const h = harness({ fail: () => (offline ? new TypeError('offline') : null) });
    for (const f of [10, 20, 30]) await h.reporter.submit(A, R(f, null));
    await settle();
    offline = false;
    await h.advance(120_000);
    await h.reporter.flushAll(); await settle();
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.body.feature).toBe(30);
    expect((await h.store.list())[0]!.sent?.feature).toBe(30);
  });
  it('429·5xx·네트워크는 full jitter 로 무한 재시도(폐기·중단 없음)', async () => {
    for (const status of [429, 500, 503, 408, 401]) {
      let n = 0;
      const h = harness({ fail: () => (n++ < 3 ? new ApiError(status, 'x', {}) : null) });
      await h.reporter.submit(A, R(5, null));
      for (let i = 0; i < 8 && h.calls.length === 0; i += 1) await h.advance(70_000);
      expect(h.calls, `status ${status}`).toHaveLength(1);
      expect((await h.store.list())[0]!.halted).toBeNull();
    }
  });
  it('409·422·403·404·400 은 로깅 후 중단하되 값은 보존한다(재시도 안 함)', async () => {
    for (const status of [409, 422, 403, 404, 400]) {
      let n = 0;
      const h = harness({ fail: () => { n += 1; return new ApiError(status, 'x', { detail: { code: 'invalid_message', field: 'feature' } }); } });
      await h.reporter.submit(A, R(5, null)); await settle();
      await h.advance(300_000);
      expect(n, `status ${status}`).toBe(1);
      const row = (await h.store.list())[0]!;
      expect(row.halted).toMatch(new RegExp(`^${status}`));
      expect(row.report?.feature).toBe(5);
    }
  });
  it('fullJitterMs 는 0..min(60s,1s×2^n)', () => {
    expect(fullJitterMs(0, () => 0.99)).toBeLessThan(1000);
    expect(fullJitterMs(30, () => 0.999)).toBeLessThan(60_000);
    expect(fullJitterMs(3, () => 0)).toBe(0);
  });
  it('인증이 없는 scope(다른 계정)는 보내지 않고 보존만 한다', async () => {
    const h = harness();
    h.reporter.setAuthResolver(() => null);
    await h.reporter.submit(A, R(9, null)); await settle();
    expect(h.calls).toHaveLength(0);
    expect((await h.store.list())[0]!.report?.feature).toBe(9);
    h.reporter.setAuthResolver(() => ({ skipAuth: false }));
    await h.reporter.flushAll(); await settle();
    expect(h.calls).toHaveLength(1);
  });
});

describe('ExpectedReporter — 여러 회차(scope)별', () => {
  it('회차마다 별도 레코드·별도 보고, 한 회차의 오류가 다른 회차를 막지 않는다', async () => {
    const h = harness({ fail: undefined });
    let failA = true;
    const store = h.store;
    const calls: string[] = [];
    const rep = new ExpectedReporter({
      store, authFor: () => ({ skipAuth: false }), now: () => 1, random: () => 0, log: () => undefined,
      put: async (sid) => { if (sid === 's1' && failA) throw new ApiError(409, 'x', {}); calls.push(sid); return resp(sid); },
    });
    await rep.submit(A, R(1, null)); await rep.submit(B, R(2, null)); await settle();
    expect(calls).toEqual(['s2']);
    const rows = await store.list();
    expect(rows.map((r) => r.id).sort()).toEqual([expectedRecordId(A), expectedRecordId(B)].sort());
    expect(rows.find((r) => r.sessionId === 's1')!.halted).toMatch(/^409/);
    expect(rows.find((r) => r.sessionId === 's2')!.sent?.feature).toBe(2);
    failA = false;
  });
  it('IndexedDB 에 영속 — 새 인스턴스(앱 재기동)가 마지막 값 1건을 복원해 보낸다', async () => {
    const calls: IngestExpectedBody[] = [];
    const down = new ExpectedReporter({ store: new IdbExpectedStore(), authFor: () => ({ skipAuth: false }), log: () => undefined, put: async () => { throw new TypeError('offline'); }, random: () => 0, setTimer: () => () => undefined });
    for (const f of [5, 8, 13]) await down.submit({ ...A, sessionId: 'persist' }, R(f, [f, 2, 2]));
    await settle();
    const up = new ExpectedReporter({ store: new IdbExpectedStore(), authFor: () => ({ skipAuth: false }), log: () => undefined, put: async (_s, b) => { calls.push(b); return resp('persist'); } });
    await up.flushAll(); await settle();
    expect(calls).toEqual([{ participant_id: 'pa', feature: 13, raw: { eeg: 13, ppg: 2, acc: 2 }, final: false }]);
  });
});

describe('ExpectedHub — 네이티브 이벤트 → 보고', () => {
  const sigs = { eeg: { pending: 3, uploading: 1, verified: 70, quarantined: 2 }, ppg: { pending: 0, uploading: 0, verified: 40, quarantined: 0 }, acc: { pending: 0, uploading: 0, verified: 0, quarantined: 0 } };
  it('parseSignals: 3신호·4상태가 모두 숫자일 때만 인정', () => {
    expect(parseSignals(sigs)).not.toBeNull();
    expect(parseSignals({ eeg: sigs.eeg, ppg: sigs.ppg })).toBeNull();
    expect(parseSignals({ ...sigs, acc: { pending: 1 } })).toBeNull();
    expect(parseSignals(undefined)).toBeNull();
  });
  it('rawTotals = 신호별 pending+uploading+verified+quarantined', () => {
    expect(rawTotals(parseSignals(sigs)!)).toEqual({ eeg: 76, ppg: 40, acc: 0 });
  });
  async function hub() {
    const h = harness({ intervalMs: 30_000 });
    const hubx = new ExpectedHub(h.reporter, h.store);
    hubx.userId = 'a';
    return { ...h, hub: hubx };
  }
  it('feature.counts(pending+acked+rejected)와 archive.counts.signals 를 합쳐 한 건으로 보고한다', async () => {
    const { hub: hb, calls } = await hub();
    hb.observeNative('feature.counts', { sessionId: 's1', pending: 3, acked: 90, rejected: 7 });
    await settle(); await settle();
    expect(calls[0]!.body).toMatchObject({ feature: 100, final: false });
    expect('raw' in calls[0]!.body).toBe(false); // signals 아직 없음
    hb.observeNative('archive.counts', { sessionId: 's1', pending: 3, uploading: 1, verified: 110, quarantined: 2, signals: sigs });
    await settle();
    expect(calls).toHaveLength(1); // 30초 간격 대기
  });
  it('signals 없는 구 archive.counts 는 raw 를 만들지 않는다', async () => {
    const { hub: hb, calls } = await hub();
    hb.observeNative('archive.counts', { sessionId: 's1', pending: 1, uploading: 0, verified: 1, quarantined: 0 });
    hb.observeNative('feature.counts', { sessionId: 's1', pending: 0, acked: 5, rejected: 0 });
    await settle(); await settle();
    expect('raw' in calls[0]!.body).toBe(false);
  });
  it('종료(SEALING)·완료(reconcile complete)는 final=true 로 즉시 보고한다', async () => {
    const { hub: hb, calls } = await hub();
    hb.observeNative('feature.counts', { sessionId: 's1', pending: 0, acked: 50, rejected: 0 }); await settle(); await settle();
    hb.observeNative('measurementUpdated', { sessionId: 's1', state: 'SEALING' }); await settle(); await settle();
    expect(calls.map((c) => c.body.final)).toEqual([false, true]);
    hb.observeNative('reconcile.state', { sessionId: 's2', feature: 'complete', raw: 'complete', complete: true });
    hb.observeNative('feature.counts', { sessionId: 's2', pending: 0, acked: 9, rejected: 0 }); await settle(); await settle();
    expect(calls.at(-1)!.body).toMatchObject({ feature: 9, final: true });
  });
  it('로그아웃 상태(userId=null)면 처음 보는 세션을 등록하지 않는다', async () => {
    const { hub: hb, calls, store } = await hub();
    hb.userId = null;
    hb.observeNative('feature.counts', { sessionId: 's9', pending: 0, acked: 4, rejected: 0 }, null); await settle();
    expect(calls).toHaveLength(0); expect(await store.list()).toHaveLength(0);
  });
  it('JWT 로 등록한 세션은 participant_id 를 본문에서 생략한다', async () => {
    const { hub: hb, calls } = await hub();
    hb.observeNative('feature.counts', { sessionId: 's1', pending: 0, acked: 4, rejected: 0 }); await settle(); await settle();
    expect('participant_id' in calls[0]!.body).toBe(false);
  });
  it('회차별 총량은 섞이지 않는다', async () => {
    const { hub: hb, calls } = await hub();
    hb.observeNative('feature.counts', { sessionId: 's1', pending: 0, acked: 4, rejected: 0 });
    hb.observeNative('feature.counts', { sessionId: 's2', pending: 0, acked: 8, rejected: 0 });
    await settle(); await settle();
    expect(calls.map((c) => [c.sid, c.body.feature]).sort()).toEqual([['s1', 4], ['s2', 8]]);
  });
});

describe('ExpectedHub — 웹 outbox 경로', () => {
  it('outbox 총량을 feature 만 보고하고(raw 생략), 완료 마커가 있으면 final=true', async () => {
    const h = harness();
    const hub = new ExpectedHub(h.reporter, h.store);
    await hub.observeWebFeatureTotal(A, 40, false); await settle(); await settle();
    expect(h.calls[0]!.body).toEqual({ participant_id: 'pa', feature: 40, final: false });
    await hub.observeWebFeatureTotal(A, 40, true); await settle(); await settle();
    expect(h.calls[1]!.body).toEqual({ participant_id: 'pa', feature: 40, final: true });
  });
});
