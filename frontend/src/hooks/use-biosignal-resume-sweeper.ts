// SDD-260 W2 — 앱 셸에서 미완료 feature scope 를 이어올린다. 클래스 화면 진입과 무관하게
// 앱 시작·online·포그라운드 복귀·60초 주기(미완료 scope 가 있을 때만 의미)에 IndexedDB outbox 를 훑는다.
import { useEffect } from 'react';
import { getFeatureSummary, postFeatureBatch } from '../lib/api/feature-batch';
import { loadEntry } from '../lib/api/class-flow';
import { IdbOutboxStore, type OutboxScope } from '../lib/measurement-web/metric-outbox';
import { SWEEP_INTERVAL_MS, sweepFeatureScopes, type SweepAuth } from '../lib/measurement-web/feature-sweeper';
import { subscribeAppResume } from '../lib/native/app-lifecycle';
import { useAuthStore } from '../stores/authStore';

/** scope.accountId 가 지금 이 기기의 로그인/입장 자격과 일치할 때만 인증을 돌려준다(아니면 null → 보존만) */
export function resolveSweepAuth(scope: OutboxScope, userId: string | null): SweepAuth | null {
  if (scope.accountId.startsWith('user:')) {
    return userId !== null && scope.accountId === `user:${userId}` ? { skipAuth: false } : null;
  }
  if (scope.accountId.startsWith('entry:')) {
    const entry = loadEntry(scope.sessionId);
    return entry && entry.participantId === scope.participantId && scope.accountId === `entry:${scope.participantId}`
      ? { entryCredential: entry.credential, skipAuth: true } : null;
  }
  return null;
}

export function useBiosignalResumeSweeper(): void {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  useEffect(() => {
    if (typeof indexedDB === 'undefined') return undefined;
    const store = new IdbOutboxStore();
    const run = (): void => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      void sweepFeatureScopes({
        store,
        authFor: (scope) => resolveSweepAuth(scope, userId),
        postBatch: async (scope, windows, auth) => (await postFeatureBatch(scope.sessionId, scope.participantId, windows, auth)).results,
        getSummary: (scope, auth) => getFeatureSummary(scope.sessionId, scope.participantId, auth),
      }).catch(() => undefined);
    };
    run(); // 앱 시작
    const timer = setInterval(run, SWEEP_INTERVAL_MS);
    const onVisible = (): void => { if (document.visibilityState === 'visible') run(); };
    window.addEventListener('online', run);
    document.addEventListener('visibilitychange', onVisible);
    const offResume = subscribeAppResume(run);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', run);
      document.removeEventListener('visibilitychange', onVisible);
      offResume();
    };
  }, [userId]);
}
