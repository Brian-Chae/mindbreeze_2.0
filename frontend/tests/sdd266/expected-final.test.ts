// SDD-266 — 기대량 final 유실 재현·수정: 스윕 부분합 lagging, 종료 이벤트 누락, stop 합성 이벤트, 오프라인 복귀
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { IngestExpectedBody, IngestExpectedResponse } from '../../src/lib/api/ingest-expected';
import { ExpectedReporter, IdbExpectedStore, MemoryExpectedStore, mergeReport, type ExpectedReport, type ExpectedScope } from '../../src/lib/biosignal/expected-reporter';
import { ExpectedHub } from '../../src/lib/biosignal/expected-hub';
import { NativeMeasurementFacade } from '../../src/lib/native-measurement';
import type { NativeMeasurementPlugin } from '../../src/lib/native-measurement';

const R = (feature: number, raw: [number, number, number] | null, final = false): ExpectedReport =>
  ({ feature, raw: raw ? { eeg: raw[0], ppg: raw[1], acc: raw[2] } : null, final });
const settle = () => new Promise((r) => setTimeout(r, 8));
const resp = (sid: string): IngestExpectedResponse => ({ session_id: sid, participant_id: '', expected: { feature: 0, raw: { eeg: null, ppg: null, acc: null } }, final: false, changed: true, ignored: [], updated_at: '' });
const SID = '4ff9eb00-0000-0000-0000-000000000000';

function hubHarness(opts: { offline?: () => boolean; store?: MemoryExpectedStore } = {}) {
  let t = 1_000_000;
  const calls: IngestExpectedBody[] = [];
  const store = opts.store ?? new MemoryExpectedStore();
  const reporter = new ExpectedReporter({
    store, authFor: () => ({ skipAuth: false }), now: () => t, random: () => 0, intervalMs: 30_000, log: () => undefined,
    put: async (_sid, body) => { if (opts.offline?.()) throw new Error('offline'); calls.push(body); return resp(SID); },
    // 지연 0 은 실제로 실행(전송 중 들어온 final 의 이어 보내기), 간격(30초) 대기는 실행하지 않는다
    setTimer: (fn, ms) => { if (ms > 0) return () => undefined; const h = setTimeout(fn, 0); return () => clearTimeout(h); },
  });
  const hub = new ExpectedHub(reporter, store);
  hub.userId = 'u1';
  return { hub, reporter, calls, store, tick: (ms: number) => { t += ms; } };
}
const counts = (p: [number, number, number]) => ({ sessionId: SID, pending: 0, uploading: 0, verified: 0, quarantined: 0, signals: {
  eeg: { pending: 0, uploading: 0, verified: p[0], quarantined: 0 }, ppg: { pending: 0, uploading: 0, verified: p[1], quarantined: 0 }, acc: { pending: 0, uploading: 0, verified: p[2], quarantined: 0 } } });

describe('SDD-266 mergeReport — 스윕 부분합이 final 을 버리지 않는다 (V-F01~03, 11)', () => {
  it('V-F01 prev{87,8/8/7,false}+next{87,1/1/1,true} → final=true, raw 유지', () => {
    const m = mergeReport(R(87, [8, 8, 7]), R(87, [1, 1, 1], true));
    expect(m.final).toBe(true);
    expect(m.raw).toEqual({ eeg: 8, ppg: 8, acc: 7 });
  });
  it('V-F02 뒤처진 final=false 는 prev.final 유지', () => {
    expect(mergeReport(R(87, [8, 8, 7], false), R(80, [1, 1, 1], false)).final).toBe(false);
  });
  it('V-F03 prev.final=true 는 어떤 next 로도 되돌려지지 않는다', () => {
    expect(mergeReport(R(87, [8, 8, 7], true), R(10, [1, 1, 1], false)).final).toBe(true);
    expect(mergeReport(R(87, [8, 8, 7], true), R(90, [9, 9, 8], false)).final).toBe(true);
  });
  it('V-F11 총량은 단조(낮은 값이 와도 max)', () => {
    expect(mergeReport(R(87, [8, 8, 7]), R(87, [1, 1, 1], true)).feature).toBe(87);
  });
});

describe('SDD-266 hub — 종료 이벤트 없이 스윕 complete 만 와도 final 이 나간다 (V-F04, 05, 12, 13)', () => {
  it('V-F04/05 측정 중 보고(8/8/7) → 스윕 세대 archive.counts(1/1/1) + reconcile complete → PUT final=true, raw 8/8/7', async () => {
    const h = hubHarness();
    h.hub.observeNative('archive.counts', counts([8, 8, 7]));
    h.hub.observeNative('feature.counts', { sessionId: SID, pending: 0, acked: 87, rejected: 0 });
    await settle();
    expect(h.calls.at(-1)).toMatchObject({ feature: 87, raw: { eeg: 8, ppg: 8, acc: 7 }, final: false });
    // measurementUpdated(SEALING) 는 오지 않는다. 스윕이 꼬리만 센 값을 낸 뒤 complete
    h.hub.observeNative('archive.counts', counts([1, 1, 1]));
    h.hub.observeNative('reconcile.state', { sessionId: SID, feature: 'complete', raw: 'complete', complete: true });
    await settle();
    const last = h.calls.at(-1)!;
    expect(last.final).toBe(true);
    expect(last.raw).toEqual({ eeg: 8, ppg: 8, acc: 7 });
  });
  it('V-F12 종료 후 총량이 늘면(9/9/8) final=true 유지한 채 증가 보고', async () => {
    const h = hubHarness();
    h.hub.observeNative('archive.counts', counts([8, 8, 7]));
    h.hub.observeNative('feature.counts', { sessionId: SID, pending: 0, acked: 87, rejected: 0 });
    h.hub.markEnding(SID); await settle();
    h.tick(40_000);
    h.hub.observeNative('archive.counts', counts([9, 9, 8])); await settle();
    await h.reporter.flushAll(); await settle();
    const last = h.calls.at(-1)!;
    expect(last).toMatchObject({ final: true, raw: { eeg: 9, ppg: 9, acc: 8 } });
  });
  it('V-F13 같은 최종 값 반복 제출은 추가 PUT 이 없다', async () => {
    const h = hubHarness();
    h.hub.observeNative('archive.counts', counts([8, 8, 7]));
    h.hub.observeNative('feature.counts', { sessionId: SID, pending: 0, acked: 87, rejected: 0 });
    h.hub.markEnding(SID); await settle();
    const n = h.calls.length;
    h.hub.markEnding(SID); h.hub.observeNative('measurementUpdated', { sessionId: SID, state: 'CLOSED' }); await settle();
    expect(h.calls.length).toBe(n);
  });
});

describe('SDD-266 stop 합성 종료 이벤트 (V-F06~08, 15)', () => {
  const plugin = (resp: unknown) => ({
    stopMeasurement: async () => resp,
    addListener: async () => ({ remove: async () => undefined }),
  }) as unknown as NativeMeasurementPlugin;

  it('V-F06/07 stop 응답이 SEALING 이면 구독 콜백에 {sessionId,state:SEALING} measurementUpdated 1회', async () => {
    const f = new NativeMeasurementFacade(plugin({ accepted: true, state: 'SEALING', seal_started: true }));
    f.noteSession(SID);
    const got: Array<[string, unknown]> = [];
    await f.subscribeUploadEvents((n, p) => got.push([n, p]));
    await f.stop({ reason: 'user', requestId: 'r1' });
    expect(got).toEqual([['measurementUpdated', { sessionId: SID, state: 'SEALING' }]]);
  });
  it('V-F15 세션을 모르면 합성 이벤트 없음·예외 없음', async () => {
    const f = new NativeMeasurementFacade(plugin({ accepted: true }));
    const got: unknown[] = [];
    await f.subscribeUploadEvents((n, p) => got.push([n, p]));
    await expect(f.stop({ reason: 'user', requestId: 'r1' })).resolves.toBeDefined();
    expect(got).toEqual([]);
  });
  it('해제한 구독자에게는 보내지 않는다', async () => {
    const f = new NativeMeasurementFacade(plugin({ accepted: true, state: 'SEALING' }));
    f.noteSession(SID);
    const got: unknown[] = [];
    const off = await f.subscribeUploadEvents((n, p) => got.push([n, p]));
    off();
    await f.stop({ reason: 'user', requestId: 'r1' });
    expect(got).toEqual([]);
  });
  it('V-F06 합성 이벤트 → hub.markEnding → 즉시 final=true, V-F08 네이티브 SEALING 이 또 와도 중복 PUT 없음', async () => {
    const h = hubHarness();
    h.hub.observeNative('feature.counts', { sessionId: SID, pending: 0, acked: 87, rejected: 0 });
    h.hub.observeNative('archive.counts', counts([8, 8, 7])); await settle();
    h.hub.observeNative('measurementUpdated', { sessionId: SID, state: 'SEALING' }); await settle();
    expect(h.calls.at(-1)!.final).toBe(true);
    const n = h.calls.length;
    h.hub.observeNative('measurementUpdated', { sessionId: SID, state: 'SEALING' }); await settle();
    expect(h.calls.length).toBe(n);
  });
});

describe('SDD-266 오프라인·재기동 (V-F09, 10, 14)', () => {
  it('V-F09 오프라인 종료 → 복귀 시 final=true 1건, 레코드 1건', async () => {
    let off = true;
    const h = hubHarness({ offline: () => off });
    await h.hub.registerScope({ accountId: 'user:u1', sessionId: SID, participantId: '' });
    h.hub.observeNative('feature.counts', { sessionId: SID, pending: 0, acked: 87, rejected: 0 });
    h.hub.observeNative('archive.counts', counts([8, 8, 7]));
    h.hub.markEnding(SID); await settle();
    expect((await h.store.list())).toHaveLength(1);
    expect((await h.store.list())[0]!.report).toMatchObject({ final: true });
    off = false; h.tick(120_000);
    await h.reporter.flushAll(); await settle();
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({ feature: 87, final: true, raw: { eeg: 8, ppg: 8, acc: 7 } });
  });
  it('V-F10 재기동(IDB) 후 영속된 final=true 가 전송된다', async () => {
    const idb = new IdbExpectedStore();
    const scope: ExpectedScope = { accountId: 'user:u1', sessionId: SID, participantId: '' };
    const r1 = new ExpectedReporter({ store: idb, authFor: () => null, log: () => undefined, setTimer: () => () => undefined });
    await r1.submit(scope, R(87, [8, 8, 7], true));
    const calls: IngestExpectedBody[] = [];
    const r2 = new ExpectedReporter({ store: idb, authFor: () => ({ skipAuth: false }), log: () => undefined, setTimer: () => () => undefined,
      put: async (_s, b) => { calls.push(b); return resp(SID); } });
    await r2.flushAll(); await settle();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ final: true, raw: { eeg: 8, ppg: 8, acc: 7 } });
  });
  it('V-F14 전송되는 raw 는 항상 이전 전송값 이상(단조)', async () => {
    const h = hubHarness();
    h.hub.observeNative('archive.counts', counts([8, 8, 7]));
    h.hub.observeNative('feature.counts', { sessionId: SID, pending: 0, acked: 87, rejected: 0 });
    for (const p of [[8, 8, 7], [1, 1, 1], [9, 9, 8], [2, 2, 2]] as Array<[number, number, number]>) { h.hub.observeNative('archive.counts', counts(p)); h.tick(40_000); await settle(); }
    h.hub.markEnding(SID); await settle();
    for (let i = 1; i < h.calls.length; i++) {
      for (const s of ['eeg', 'ppg', 'acc'] as const) expect(h.calls[i]!.raw![s]).toBeGreaterThanOrEqual(h.calls[i - 1]!.raw![s]);
    }
  });
});
