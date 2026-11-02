// SDD-264 — 앱 셸: 폰이 만든 총량(기대량)을 서버에 보고한다. 클래스 화면 진입과 무관(앱 시작·online·복귀·60초에 밀린 값 전송).
import { useEffect } from 'react';
import { loadEntry } from '../lib/api/class-flow';
import { getExpectedHub } from '../lib/biosignal/expected-hub';
import type { ExpectedScope, StoredEntryAuth } from '../lib/biosignal/expected-reporter';
import { BiosignalQueue } from '../lib/biosignal/durable-queue';
import { computeWebRawTotals } from '../lib/biosignal/web-raw-totals';
import { getNativeMeasurement, isNativeMeasurementAvailable } from '../lib/native-measurement';
import { subscribeAppResume } from '../lib/native/app-lifecycle';
import { IdbOutboxStore, MetricOutbox } from '../lib/measurement-web/metric-outbox';
import { useAuthStore } from '../stores/authStore';
import type { FeatureAuth } from '../lib/api/feature-batch';

export const EXPECTED_SWEEP_MS = 60_000;

/** scope.accountId 가 지금 이 기기의 로그인/입장 자격과 일치할 때만 인증을 돌려준다(아니면 null → 보존만) */
export function resolveExpectedAuth(scope: ExpectedScope & { entryAuth?: StoredEntryAuth | null }, userId: string | null, now: number = Date.now()): FeatureAuth | null {
  if (scope.accountId.startsWith('user:')) return userId !== null && scope.accountId === `user:${userId}` ? { skipAuth: false } : null;
  if (scope.accountId.startsWith('entry:')) {
    if (scope.accountId !== `entry:${scope.participantId}`) return null;
    const entry = loadEntry(scope.sessionId);
    if (entry && entry.participantId === scope.participantId) return { entryCredential: entry.credential, skipAuth: true };
    // SDD-275: 탭 종료·"홈으로" 뒤에는 sessionStorage 가 비므로 레코드에 영속한 자격 사본(만료 전)으로 보고를 마친다
    const saved = scope.entryAuth;
    return saved && (saved.expiresAtMs === null || saved.expiresAtMs > now) ? { entryCredential: saved.credential, skipAuth: true } : null;
  }
  return null;
}

/** 지금 sessionStorage 에 있는 입장 자격을 영속용 사본으로 바꾼다(참가자 일치할 때만) */
export function currentEntryAuth(scope: ExpectedScope): StoredEntryAuth | null {
  if (!scope.accountId.startsWith('entry:')) return null;
  const entry = loadEntry(scope.sessionId);
  if (!entry || entry.participantId !== scope.participantId) return null;
  const exp = entry.expiresAt ? new Date(entry.expiresAt).getTime() : null;
  return { credential: entry.credential, expiresAtMs: exp !== null && Number.isFinite(exp) ? exp : null };
}

export function useBiosignalExpectedReporter(): void {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  useEffect(() => {
    const hub = getExpectedHub();
    if (!hub) return undefined;
    hub.userId = userId;
    hub.reporter.setAuthResolver((scope) => resolveExpectedAuth(scope, userId));
    const entryAuthOf = (scope: ExpectedScope): StoredEntryAuth | null => currentEntryAuth(scope);
    let offNative: (() => void) | null = null;
    let disposed = false;
    void hub.restore().then(() => hub.reporter.flushAll()).catch(() => undefined);
    if (isNativeMeasurementAvailable()) {
      void getNativeMeasurement().subscribeUploadEvents((name, payload) => hub.observeNative(name, payload, userId))
        .then((off) => { if (disposed) off(); else offNative = off; }).catch(() => undefined);
    }
    // 웹 브라우저 경로: IndexedDB feature outbox 의 총량(pending+acked+rejected)을 관측한다. 완료 마커(summary 대조 끝) 이후만 final=true.
    const outboxStore = new IdbOutboxStore();
    const observeWebOutbox = async (): Promise<void> => {
      const saved = new Map((await hub.reporter.listRecords()).map((r) => [`${r.accountId}|${r.sessionId}|${r.participantId}`, r]));
      for (const scope of await outboxStore.listScopes()) {
        // 화면 이탈 뒤에도 보고하도록 레코드에 영속된 자격 사본까지 인정한다(SDD-275)
        if (resolveExpectedAuth({ ...scope, entryAuth: saved.get(`${scope.accountId}|${scope.sessionId}|${scope.participantId}`)?.entryAuth ?? null }, userId) === null) continue;
        const ob = new MetricOutbox({ scope, store: outboxStore, send: async () => { throw new Error('observe_only'); } });
        const c = await ob.counts();
        const meta = await ob.getMeta();
        const raw = await computeWebRawTotals(new BiosignalQueue({ ...scope, deviceAlias: 'LINK-BAND' }, 'expected-observer')).catch(() => null);
        await hub.observeWebFeatureTotal(scope, c.pending + c.acked + c.rejected, c.pending === 0 && meta !== null && meta.completedCount === c.acked, { raw, entryAuth: entryAuthOf(scope) });
      }
    };
    const run = (): void => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      void observeWebOutbox().catch(() => undefined).then(() => hub.reporter.flushAll()).catch(() => undefined);
    };
    const timer = setInterval(run, EXPECTED_SWEEP_MS);
    const onVisible = (): void => { if (document.visibilityState === 'visible') run(); };
    window.addEventListener('online', run);
    document.addEventListener('visibilitychange', onVisible);
    const offResume = subscribeAppResume(run);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener('online', run);
      document.removeEventListener('visibilitychange', onVisible);
      offResume(); offNative?.();
    };
  }, [userId]);
}
