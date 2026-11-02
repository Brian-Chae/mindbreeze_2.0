// @vitest-environment jsdom
// SDD-277 B — 밴드 없이 참여한 입장은 보고할 것이 없음을 0/0/0/0 final 로 닫아 "전송 대기(집계 대기)"에 머물지 않는다.
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IngestExpectedBody } from '../../src/lib/api/ingest-expected';

const h = vi.hoisted(() => ({ calls: [] as Array<{ sid: string; body: IngestExpectedBody; auth: { entryCredential?: string | null; skipAuth?: boolean } }>, offline: false, user: null as { id: string } | null }));
vi.mock('../../src/lib/api/ingest-expected', () => ({
  putIngestExpected: async (sid: string, body: IngestExpectedBody, auth: never) => { if (h.offline) throw new Error('offline'); h.calls.push({ sid, body, auth }); return {}; },
}));
vi.mock('../../src/stores/authStore', () => ({ useAuthStore: (sel: (s: { user: { id: string } | null }) => unknown) => sel({ user: h.user }) }));

import { currentEntryAuth, useBiosignalExpectedReporter } from '../../src/hooks/use-biosignal-expected-reporter';
import { reportNoBandFinal } from '../../src/lib/biosignal/no-band-final';
import { IdbOutboxStore, MetricOutbox } from '../../src/lib/measurement-web/metric-outbox';
import { BiosignalQueue } from '../../src/lib/biosignal/durable-queue';
import { clearEntry, saveEntry } from '../../src/lib/api/class-flow';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function Probe() { useBiosignalExpectedReporter(); return null; }
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const fresh = () => { n += 1; return { sid: `nb${n}`, pid: `np${n}` }; };
const scopeOf = (sid: string, pid: string) => ({ accountId: `entry:${pid}`, sessionId: sid, participantId: pid });
const entry = (sid: string, pid: string) => saveEntry({ sessionId: sid, credential: `cred-${pid}`, expiresAt: null, participantId: pid, isGuest: true });

async function mountAndSweep(ms = 250) {
  const host = document.createElement('div'); const root = createRoot(host);
  await act(async () => { root.render(<Probe />); await wait(30); });
  await act(async () => { window.dispatchEvent(new Event('online')); await wait(ms); });
  return () => act(async () => { root.unmount(); });
}
beforeEach(() => { h.calls.length = 0; h.offline = false; h.user = null; window.sessionStorage.clear(); });

describe('SDD-277 B — 밴드 없는 입장은 0/0/0/0 final 로 닫힌다', () => {
  it('V6 outbox·원시 사본이 없으면 feature 0·raw 0/0/0·final=true 한 건을 입장 자격으로 보고한다', async () => {
    const { sid, pid } = fresh(); entry(sid, pid);
    const scope = scopeOf(sid, pid);
    expect(await reportNoBandFinal({ scope, entryAuth: currentEntryAuth(scope) })).toBe('reported');
    const off = await mountAndSweep();
    const calls = h.calls.filter((c) => c.sid === sid);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.at(-1)?.body).toMatchObject({ participant_id: pid, feature: 0, raw: { eeg: 0, ppg: 0, acc: 0 }, final: true });
    expect(calls.at(-1)?.auth).toEqual({ entryCredential: `cred-${pid}`, skipAuth: true });
    await off();
  });

  it('V7 입장 정보를 지운(홈으로·탭 종료) 뒤에도 영속된 자격 사본으로 전송된다', async () => {
    const { sid, pid } = fresh(); entry(sid, pid);
    const scope = scopeOf(sid, pid);
    h.offline = true; // 종료 시점에는 아직 못 보낸 상태
    await reportNoBandFinal({ scope, entryAuth: currentEntryAuth(scope) });
    clearEntry(sid); window.sessionStorage.clear();
    expect(currentEntryAuth(scope)).toBeNull();
    h.offline = false;
    const off = await mountAndSweep(2600);
    const call = h.calls.filter((c) => c.sid === sid).at(-1);
    expect(call?.body).toMatchObject({ feature: 0, raw: { eeg: 0, ppg: 0, acc: 0 }, final: true });
    expect(call?.auth).toEqual({ entryCredential: `cred-${pid}`, skipAuth: true });
    await off();
  });

  it('V8 오프라인이면 보존했다가 온라인 복귀 때 전송한다', async () => {
    const { sid, pid } = fresh(); entry(sid, pid);
    const scope = scopeOf(sid, pid);
    h.offline = true;
    const off = await mountAndSweep(100);
    await reportNoBandFinal({ scope, entryAuth: currentEntryAuth(scope) });
    await act(async () => { await wait(100); });
    expect(h.calls.filter((c) => c.sid === sid)).toHaveLength(0);
    h.offline = false;
    for (let i = 0; i < 40 && h.calls.filter((c) => c.sid === sid).length === 0; i += 1) {
      await act(async () => { window.dispatchEvent(new Event('online')); await wait(150); });
    }
    expect(h.calls.filter((c) => c.sid === sid).at(-1)?.body).toMatchObject({ feature: 0, final: true });
    await off();
  });

  it('V9 측정한 사본이 있으면(outbox 창·원시 청크) 0 final 을 보내지 않는다', async () => {
    const a = fresh(); entry(a.sid, a.pid);
    const aScope = scopeOf(a.sid, a.pid);
    await new MetricOutbox({ scope: aScope, store: new IdbOutboxStore(), send: async () => [] }).enqueue({ stream_id: 'st', sequence: '1' } as never);
    expect(await reportNoBandFinal({ scope: aScope })).toBe('has_data');

    const b = fresh(); entry(b.sid, b.pid);
    const bScope = scopeOf(b.sid, b.pid);
    const q = new BiosignalQueue({ ...bScope, deviceAlias: 'LINK-BAND' }, 't');
    await q.acquire();
    await q.sealRaw({ chunk_alias: 'eeg-0', checksum: 'c', size_bytes: 1, header: { signal_type: 'eeg', stream_id: 'st', segment_id: 'sg', chunk_index: 0 } } as never, new ArrayBuffer(1), []);
    await q.release();
    expect(await reportNoBandFinal({ scope: bScope })).toBe('has_data');

    const off = await mountAndSweep();
    expect(h.calls.filter((c) => c.sid === a.sid || c.sid === b.sid).some((c) => c.body.final === true && c.body.feature === 0)).toBe(false);
    await off();
  });

  it('V9b 이미 측정한 값(feature>0)을 보고한 기록이 있으면 0 으로 덮지 않는다', async () => {
    const { sid, pid } = fresh(); entry(sid, pid);
    const scope = scopeOf(sid, pid);
    const { getExpectedHub } = await import('../../src/lib/biosignal/expected-hub');
    await getExpectedHub()!.observeWebFeatureTotal(scope, 7, false, { raw: { eeg: 1, ppg: 1, acc: 1 } });
    expect(await reportNoBandFinal({ scope })).toBe('has_data');
  });
});
