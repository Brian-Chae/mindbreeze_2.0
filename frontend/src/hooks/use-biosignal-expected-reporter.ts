// SDD-264 — 앱 셸: 폰이 만든 총량(기대량)을 서버에 보고한다. 클래스 화면 진입과 무관(앱 시작·online·복귀·60초에 밀린 값 전송).
import { useEffect } from 'react';
import { loadEntry } from '../lib/api/class-flow';
import { getExpectedHub } from '../lib/biosignal/expected-hub';
import type { ExpectedScope } from '../lib/biosignal/expected-reporter';
import { getNativeMeasurement, isNativeMeasurementAvailable } from '../lib/native-measurement';
import { subscribeAppResume } from '../lib/native/app-lifecycle';
import { IdbOutboxStore, MetricOutbox } from '../lib/measurement-web/metric-outbox';
import { useAuthStore } from '../stores/authStore';
import type { FeatureAuth } from '../lib/api/feature-batch';

export const EXPECTED_SWEEP_MS = 60_000;

/** scope.accountId 가 지금 이 기기의 로그인/입장 자격과 일치할 때만 인증을 돌려준다(아니면 null → 보존만) */
export function resolveExpectedAuth(scope: ExpectedScope, userId: string | null): FeatureAuth | null {
  if (scope.accountId.startsWith('user:')) return userId !== null && scope.accountId === `user:${userId}` ? { skipAuth: false } : null;
  if (scope.accountId.startsWith('entry:')) {
    const entry = loadEntry(scope.sessionId);
    return entry && entry.participantId === scope.participantId && scope.accountId === `entry:${scope.participantId}`
      ? { entryCredential: entry.credential, skipAuth: true } : null;
  }
  return null;
}

export function useBiosignalExpectedReporter(): void {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  useEffect(() => {
    const hub = getExpectedHub();
    if (!hub) return undefined;
    hub.userId = userId;
    hub.reporter.setAuthResolver((scope) => resolveExpectedAuth(scope, userId));
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
      for (const scope of await outboxStore.listScopes()) {
        if (resolveExpectedAuth({ ...scope }, userId) === null) continue;
        const ob = new MetricOutbox({ scope, store: outboxStore, send: async () => { throw new Error('observe_only'); } });
        const c = await ob.counts();
        const meta = await ob.getMeta();
        await hub.observeWebFeatureTotal(scope, c.pending + c.acked + c.rejected, c.pending === 0 && meta !== null && meta.completedCount === c.acked);
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
