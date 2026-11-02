// @vitest-environment jsdom
// SDD-275 — 비회원(코드 입장)·브라우저 회원 웹 측정의 기대량 보고: IndexedDB outbox 영속, raw 총량, 입장 자격 복원, final
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IngestExpectedBody } from '../../src/lib/api/ingest-expected';

const h = vi.hoisted(() => ({ calls: [] as Array<{ sid: string; body: IngestExpectedBody; auth: { entryCredential?: string | null; skipAuth?: boolean } }>, offline: false }));
vi.mock('../../src/lib/api/ingest-expected', () => ({
  putIngestExpected: async (sid: string, body: IngestExpectedBody, auth: never) => { if (h.offline) throw new Error('offline'); h.calls.push({ sid, body, auth }); return {}; },
}));
vi.mock('../../src/stores/authStore', () => ({ useAuthStore: (sel: (s: { user: { id: string } | null }) => unknown) => sel({ user: h.user }) }));

import { currentEntryAuth, resolveExpectedAuth, useBiosignalExpectedReporter } from '../../src/hooks/use-biosignal-expected-reporter';
import { CaptureController } from '../../src/lib/measurement-web/capture-controller';
import { IdbOutboxStore, MetricOutbox } from '../../src/lib/measurement-web/metric-outbox';
import { getExpectedHub } from '../../src/lib/biosignal/expected-hub';
import { BiosignalQueue } from '../../src/lib/biosignal/durable-queue';
import { computeWebRawTotals } from '../../src/lib/biosignal/web-raw-totals';
import { clearEntry, saveEntry } from '../../src/lib/api/class-flow';

(h as unknown as { user: { id: string } | null }).user = null;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() { useBiosignalExpectedReporter(); return null; }
const env = (seq: number) => ({ stream_id: 'st', sequence: String(seq) }) as never;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const fresh = () => { n += 1; return { sid: `s${n}`, pid: `p${n}` }; };

async function mountAndSweep() {
  const host = document.createElement('div'); const root = createRoot(host);
  await act(async () => { root.render(<Probe />); await wait(30); });
  await act(async () => { window.dispatchEvent(new Event('online')); await wait(250); });
  return () => act(async () => { root.unmount(); });
}

async function seedGuest(sid: string, pid: string, count: number, complete = false) {
  const store = new IdbOutboxStore();
  const scope = { accountId: `entry:${pid}`, sessionId: sid, participantId: pid };
  const ob = new MetricOutbox({ scope, store, send: async () => [] });
  for (let i = 1; i <= count; i++) await ob.enqueue(env(i));
  if (complete) { // 전송·대조 완료 상태 모사
    const rows = await store.list(scope);
    await store.putMany(rows.map((r) => ({ ...r, state: 'acked' as const })));
    await store.putMeta(scope, { completedCount: count, completedAtMs: 1 });
  }
  return scope;
}
const entry = (sid: string, pid: string, expiresAt: string | null = null) => saveEntry({ sessionId: sid, credential: `cred-${pid}`, expiresAt, participantId: pid, isGuest: true });

beforeEach(() => { h.calls.length = 0; h.offline = false; (h as unknown as { user: null }).user = null; window.sessionStorage.clear(); });

describe('SDD-275 V1/V2 — 웹 측정 feature outbox 는 운영에서 IndexedDB 에 영속된다', () => {
  it('V1 CaptureController 가 outboxStore 없이 만들어도 enqueue 한 창이 IdbOutboxStore.listScopes() 에 보인다', async () => {
    const { sid } = fresh();
    const client = { request: async () => ({ status: 'applied', result: { stream_id: 'st', participant_id: 'pg', owner_generation: '1' } }), sendMetricBatch: async () => undefined, sendDevice: async () => ({ kind: 'not_sent' }), clockProbe: async () => undefined };
    const c = new CaptureController({ accountId: 'entry:pg', sendFeatures: async () => { throw new Error('offline'); }, client: client as never, sessionId: sid, eegConsent: true, bandConnected: true, deviceProfile: 'p', algorithmVersion: 'a', modelVersion: 'm' });
    expect(await c.start()).toBe('started');
    c.pushEnvelope({ stream_id: 'st', sequence: '1' } as never);
    await wait(50);
    const scopes = await new IdbOutboxStore().listScopes();
    expect(scopes.some((s) => s.sessionId === sid && s.accountId === 'entry:pg')).toBe(true);
    c.dispose?.();
  });
  it('V2 indexedDB 가 없으면 메모리 outbox 로 폴백한다(예외 없음)', async () => {
    const saved = (globalThis as { indexedDB?: unknown }).indexedDB;
    (globalThis as { indexedDB?: unknown }).indexedDB = undefined;
    try {
      const client = { request: async () => ({ status: 'applied', result: { stream_id: 'st', participant_id: 'pg', owner_generation: '1' } }), sendMetricBatch: async () => undefined, sendDevice: async () => ({ kind: 'not_sent' }), clockProbe: async () => undefined };
      const c = new CaptureController({ accountId: 'entry:pg', sendFeatures: async () => [], client: client as never, sessionId: 'sx', eegConsent: true, bandConnected: true, deviceProfile: 'p', algorithmVersion: 'a', modelVersion: 'm' });
      expect(await c.start()).toBe('started');
      expect(c.pushEnvelope({ stream_id: 'st', sequence: '1' } as never)).toBe(true);
    } finally { (globalThis as { indexedDB?: unknown }).indexedDB = saved; }
  });
});

describe('SDD-275 V3~V5 — 게스트 scope outbox → 기대량 PUT', () => {
  it('V3 feature 총량 보고(입장 자격 인증, final=false)', async () => {
    const { sid, pid } = fresh();
    await seedGuest(sid, pid, 3); entry(sid, pid);
    const off = await mountAndSweep();
    const call = h.calls.find((c) => c.sid === sid);
    expect(call?.body).toMatchObject({ participant_id: pid, feature: 3, final: false });
    expect(call?.auth).toEqual({ entryCredential: `cred-${pid}`, skipAuth: true });
    await off();
  });
  it('V4 완료 마커(pending 0, completedCount=acked) → final=true', async () => {
    const { sid, pid } = fresh();
    await seedGuest(sid, pid, 4, true); entry(sid, pid);
    const off = await mountAndSweep();
    expect(h.calls.filter((c) => c.sid === sid).at(-1)?.body).toMatchObject({ feature: 4, final: true });
    await off();
  });
  it('V5/V6 raw 총량(신호별, 0 포함)을 함께 보고한다 — sealed(pending·dead_letter)+receipt, superseded 제외', async () => {
    const { sid, pid } = fresh();
    const scope = await seedGuest(sid, pid, 2, true); entry(sid, pid);
    const q = new BiosignalQueue({ ...scope, deviceAlias: 'LINK-BAND' }, 't');
    const rawMeta = (sig: string, idx: number) => ({ chunk_alias: `${sig}-${idx}`, checksum: `c${sig}${idx}`, size_bytes: 1, header: { signal_type: sig, stream_id: 'st', segment_id: 'sg', chunk_index: idx } });
    await q.acquire();
    await q.sealRaw(rawMeta('eeg', 0) as never, new ArrayBuffer(1), []);
    await q.sealRaw(rawMeta('eeg', 1) as never, new ArrayBuffer(1), []);
    await q.sealRaw(rawMeta('ppg', 0) as never, new ArrayBuffer(1), []);
    const eeg1 = (await q.objectsMeta()).find((m) => m.alias === 'eeg-1')!;
    await q.complete({ ...(await q.dueBatch(10, Date.now())).batch.find((o) => o.alias === 'eeg-1')! }, { kind: 'raw', alias: 'eeg-1', sha256: 'x', serverId: 's', size_bytes: 1, verified_at_us: '1', meta: eeg1.meta });
    await q.release();
    expect(await computeWebRawTotals(q)).toEqual({ eeg: 2, ppg: 1, acc: 0 });
    const off = await mountAndSweep();
    expect(h.calls.filter((c) => c.sid === sid).at(-1)?.body).toMatchObject({ feature: 2, raw: { eeg: 2, ppg: 1, acc: 0 }, final: true });
    await off();
  });
});

describe('SDD-275 V7~V10 — 화면 이탈·앱 종료 뒤 영속된 입장 자격으로 보고', () => {
  it('V7 자격 사본 영속 → sessionStorage 비움 → 재마운트해도 보고가 나간다', async () => {
    const { sid, pid } = fresh();
    await seedGuest(sid, pid, 5); entry(sid, pid, new Date(Date.now() + 3600_000).toISOString());
    // 측정 화면이 값·자격 사본을 영속한 상태(인증 해석기 설치 전이라 아직 전송 0)
    const scope = { accountId: `entry:${pid}`, sessionId: sid, participantId: pid };
    const cred = currentEntryAuth(scope)!;
    await getExpectedHub()!.observeWebFeatureTotal(scope, 5, false, { entryAuth: cred });
    expect(h.calls.filter((c) => c.sid === sid)).toHaveLength(0);
    clearEntry(sid); window.sessionStorage.clear(); // 탭 종료·"홈으로"
    expect(currentEntryAuth(scope)).toBeNull();
    const off = await mountAndSweep();
    const call = h.calls.find((c) => c.sid === sid);
    expect(call?.body).toMatchObject({ feature: 5 });
    expect(call?.auth).toEqual({ entryCredential: `cred-${pid}`, skipAuth: true });
    await off();
  });
  it('V8 영속 자격이 만료되면 보내지 않는다(값은 보존)', () => {
    const scope = { accountId: 'entry:p', sessionId: 's', participantId: 'p', entryAuth: { credential: 'c', expiresAtMs: 1000 } };
    expect(resolveExpectedAuth(scope, null, 2000)).toBeNull();
    expect(resolveExpectedAuth(scope, null, 500)).toEqual({ entryCredential: 'c', skipAuth: true });
  });
  it('V9 accountId 가 참가자와 다르면 영속 자격도 쓰지 않는다', () => {
    expect(resolveExpectedAuth({ accountId: 'entry:other', sessionId: 's', participantId: 'p', entryAuth: { credential: 'c', expiresAtMs: null } }, null)).toBeNull();
  });
  it('V9b sessionStorage 입장 자격의 참가자가 다르면 currentEntryAuth 는 null', () => {
    saveEntry({ sessionId: 'sz', credential: 'c', expiresAt: null, participantId: 'zz', isGuest: true });
    expect(currentEntryAuth({ accountId: 'entry:p', sessionId: 'sz', participantId: 'p' })).toBeNull();
  });
  it('V10 회원 user: scope 는 기존대로 JWT', () => {
    expect(resolveExpectedAuth({ accountId: 'user:u1', sessionId: 's', participantId: '' }, 'u1')).toEqual({ skipAuth: false });
    expect(resolveExpectedAuth({ accountId: 'user:u1', sessionId: 's', participantId: '' }, 'u2')).toBeNull();
  });
});

describe('SDD-275 — 허브', () => {
  it('final 전송 뒤 자격 사본은 지워진다', async () => {
    const { sid, pid } = fresh();
    await seedGuest(sid, pid, 1, true); entry(sid, pid);
    const off = await mountAndSweep(); await off();
    const rec = (await getExpectedHub()!.reporter.listRecords()).find((r) => r.sessionId === sid);
    expect(rec?.sent?.final).toBe(true);
    expect(rec?.entryAuth ?? null).toBeNull();
  });
});
