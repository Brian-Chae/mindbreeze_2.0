// SDD-260 W2 — 미완료 feature scope 이어올림 + 종료 후 summary 대조.
// 앱 시작·online·포그라운드 복귀·60초 주기에 불린다. 화면(클래스 화면 진입)과 무관하게 IndexedDB outbox 전체를 훑는다.
//  1) 현재 로그인 계정/입장 자격으로 보낼 수 있는 scope 만 전송(다른 계정 scope 는 보존만, 전송 0)
//  2) 대기 창을 REST 배치로 전량 전송
//  3) GET /features/summary 로 로컬 집합 − 서버 보유 집합을 계산해 서버에 없는 창만 다시 전송 → 재조회(최대 3회 수렴)
//  4) 결측 0 이면 완료 마커. 마커 전에는 아무 것도 삭제하지 않는다.
import { diffAgainstSummary, type FeatureSummary } from './feature-reconcile';
import type { MetricEnvelope } from './envelope';
import { MetricOutbox, type FeatureResult, type OutboxScope, type OutboxStore } from './metric-outbox';

export const SWEEP_INTERVAL_MS = 60_000;
const RECONCILE_ROUNDS = 3;

export interface SweepAuth { entryCredential?: string | null; skipAuth?: boolean }

export interface SweepDeps {
  store: OutboxStore;
  /** 이 scope 를 지금 전송할 수 있는 인증(없으면 null → 건너뛰고 보존) */
  authFor: (scope: OutboxScope) => SweepAuth | null;
  postBatch: (scope: OutboxScope, windows: MetricEnvelope[], auth: SweepAuth) => Promise<FeatureResult[]>;
  getSummary: (scope: OutboxScope, auth: SweepAuth) => Promise<FeatureSummary>;
  now?: () => number;
  random?: () => number;
}

export interface SweepResult { completed: OutboxScope[]; pending: OutboxScope[]; skipped: OutboxScope[]; done: OutboxScope[] }

let running: Promise<SweepResult> | null = null;

/** 동시 실행 1 — 트리거가 겹쳐도 같은 결과를 공유한다 */
export function sweepFeatureScopes(deps: SweepDeps): Promise<SweepResult> {
  if (running) return running;
  running = doSweep(deps).finally(() => { running = null; });
  return running;
}

async function sweepOne(deps: SweepDeps, scope: OutboxScope, auth: SweepAuth): Promise<'completed' | 'pending' | 'done'> {
  const outbox = new MetricOutbox({
    scope, store: deps.store, now: deps.now, random: deps.random,
    send: (w) => deps.postBatch(scope, w, auth),
  });
  const counts = await outbox.counts();
  const meta = await outbox.getMeta();
  if (counts.pending === 0 && meta && meta.completedCount === counts.acked) return 'done';
  outbox.resetBackoff();
  await outbox.flushAll();
  if ((await outbox.pendingCount()) > 0) return 'pending';
  for (let round = 0; round < RECONCILE_ROUNDS; round += 1) {
    let summary: FeatureSummary;
    try {
      summary = await deps.getSummary(scope, auth);
    } catch {
      return 'pending'; // 대조 못 하면 완료로 보지 않는다
    }
    const diff = diffAgainstSummary(await outbox.localSequences(), summary);
    if (diff.complete) {
      await outbox.putMeta({ completedCount: (await outbox.counts()).acked, completedAtMs: (deps.now ?? Date.now)() });
      return 'completed';
    }
    await outbox.requeue(diff.missing);
    outbox.resetBackoff();
    await outbox.flushAll();
    if ((await outbox.pendingCount()) > 0) return 'pending';
  }
  return 'pending';
}

async function doSweep(deps: SweepDeps): Promise<SweepResult> {
  const result: SweepResult = { completed: [], pending: [], skipped: [], done: [] };
  for (const scope of await deps.store.listScopes()) {
    const auth = deps.authFor(scope);
    if (!auth) { result.skipped.push(scope); continue; }
    try {
      result[await sweepOne(deps, scope, auth)].push(scope);
    } catch {
      result.pending.push(scope);
    }
  }
  return result;
}
