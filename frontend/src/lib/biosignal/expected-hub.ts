// SDD-264 — 네이티브 저장 진행 이벤트(feature.counts·archive.counts[signals]·reconcile.state)·종료 신호를
// 기대량 보고(ExpectedReporter)로 잇는다. 화면과 무관(앱 셸 훅이 소유). 값은 폰이 만든 총량이며 서버 수신과 무관하다.
import { ExpectedReporter, IdbExpectedStore, SIGNALS, type ExpectedReport, type ExpectedScope, type ExpectedStore, type RawTotals, type Signal, type StoredEntryAuth } from './expected-reporter';

export interface SignalState { pending: number; uploading: number; verified: number; quarantined: number }
export type SignalStates = Record<Signal, SignalState>;

const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

/** archive.counts 의 additive `signals` 파싱. 3신호 모두·4상태 모두 숫자일 때만 인정(아니면 null → raw 생략) */
export function parseSignals(v: unknown): SignalStates | null {
  if (typeof v !== 'object' || v === null) return null;
  const out = {} as SignalStates;
  for (const sig of SIGNALS) {
    const o = (v as Record<string, unknown>)[sig];
    if (typeof o !== 'object' || o === null) return null;
    const r = o as Record<string, unknown>;
    const pending = n(r.pending), uploading = n(r.uploading), verified = n(r.verified), quarantined = n(r.quarantined);
    if (pending === null || uploading === null || verified === null || quarantined === null) return null;
    out[sig] = { pending, uploading, verified, quarantined };
  }
  return out;
}

/** 신호별 총량 = pending+uploading+verified+quarantined (contract §1) */
export function rawTotals(s: SignalStates): RawTotals {
  const t = (x: SignalState): number => x.pending + x.uploading + x.verified + x.quarantined;
  return { eeg: t(s.eeg), ppg: t(s.ppg), acc: t(s.acc) };
}

interface SessionObs {
  scope: ExpectedScope;
  feature: number | null;
  signals: SignalStates | null;
  complete: boolean;
  ending: boolean;
  /** SDD-275: 웹 경로의 신호별 원시 총량 */
  rawWeb?: RawTotals;
}

export class ExpectedHub {
  private readonly bySession = new Map<string, SessionObs[]>();
  readonly reporter: ExpectedReporter;
  private readonly store: ExpectedStore;
  /** 현재 로그인 사용자(앱 셸 훅이 갱신) */
  userId: string | null = null;

  constructor(reporter: ExpectedReporter, store: ExpectedStore) { this.reporter = reporter; this.store = store; }

  private entries(sessionId: string): SessionObs[] { return this.bySession.get(sessionId) ?? []; }

  /** 측정 시작 시 scope 를 영속 등록 — 앱이 죽었다 살아나도 어느 계정·참가자의 총량인지 안다(다른 계정 세션은 보내지 않는다) */
  async registerScope(scope: ExpectedScope): Promise<void> {
    this.remember(scope);
    const id = `${scope.accountId}|${scope.sessionId}|${scope.participantId}`;
    if (!(await this.store.get(id))) {
      await this.store.put({ id, ...scope, report: null, sent: null, lastSentAtMs: 0, attempts: 0, halted: null });
    }
  }

  private remember(scope: ExpectedScope): SessionObs {
    const list = this.bySession.get(scope.sessionId) ?? [];
    let e = list.find((x) => x.scope.accountId === scope.accountId && x.scope.participantId === scope.participantId);
    if (!e) { e = { scope, feature: null, signals: null, complete: false, ending: false }; list.push(e); this.bySession.set(scope.sessionId, list); }
    return e;
  }

  /** 앱 시작: 영속된 scope 를 메모리에 복원(보고는 이어서 flushAll 이 맡는다) */
  async restore(): Promise<void> { for (const r of await this.store.list()) this.remember({ accountId: r.accountId, sessionId: r.sessionId, participantId: r.participantId }); }

  /**
   * 네이티브 이벤트 1건. 앱은 항상 JWT(startWithCredentials)로 측정하므로, 처음 보는 세션은 현재 로그인 계정(`user:<id>`)으로
   * 등록하고 participant_id 는 생략한다(서버가 JWT 로 본인 행 확정). 로그아웃 상태면 무시.
   */
  observeNative(name: string, payload: unknown, userId: string | null = this.userId): void {
    if (typeof payload !== 'object' || payload === null) return;
    const p = payload as Record<string, unknown>;
    const sid = typeof p.sessionId === 'string' ? p.sessionId : null;
    if (!sid) return;
    if (name === 'measurementUpdated') {
      const st = p.state;
      if (st === 'SEALING' || st === 'DRAINING' || st === 'CLOSED') this.markEnding(sid);
      return;
    }
    if (userId !== null && !this.entries(sid).some((x) => x.scope.accountId === `user:${userId}`)) {
      void this.registerScope({ accountId: `user:${userId}`, sessionId: sid, participantId: '' }).catch(() => undefined);
    }
    for (const e of this.entries(sid)) {
      if (name === 'feature.counts') {
        const pend = n(p.pending), acked = n(p.acked), rej = n(p.rejected);
        if (pend === null || acked === null || rej === null) continue;
        e.feature = pend + acked + rej;
      } else if (name === 'archive.counts') {
        e.signals = parseSignals(p.signals) ?? e.signals; // signals 없으면(구 네이티브) raw 는 계속 생략
      } else if (name === 'reconcile.state') {
        e.complete = p.complete === true;
      } else continue;
      this.push(e);
    }
  }

  /** 측정 종료(사용자 정지·회차 종료): 이후 총량은 늘지 않으니 즉시 final=true. 이후 관측도 final=true 로 보낸다(서버 규칙 ②) */
  markEnding(sessionId: string): void { for (const e of this.entries(sessionId)) { e.ending = true; this.push(e); } }

  /** 웹 브라우저 경로: outbox 총량(feature 만, raw 는 생략)과 완료 여부. scope 는 outbox 가 아는 계정·참가자 그대로 쓴다 */
  async observeWebFeatureTotal(scope: ExpectedScope, total: number, complete: boolean, extra: { raw?: RawTotals | null; entryAuth?: StoredEntryAuth | null } = {}): Promise<void> {
    await this.registerScope(scope);
    if (extra.entryAuth) await this.reporter.attachEntryAuth(scope, extra.entryAuth);
    const e = this.remember(scope);
    e.feature = total; e.complete = complete;
    // SDD-275: 웹 경로도 원시 신호별 총량을 보고한다(서버는 raw 미보고를 "집계 대기"로 본다). 네이티브 signals 파싱 경로는 건드리지 않는다
    if (extra.raw) e.rawWeb = { ...extra.raw };
    this.push(e);
  }

  private push(e: SessionObs): void {
    if (e.feature === null) return; // feature 총량 없이는 보고하지 않는다(필수 필드)
    const report: ExpectedReport = { feature: e.feature, raw: e.signals ? rawTotals(e.signals) : (e.rawWeb ?? null), final: e.ending || e.complete };
    void this.reporter.submit(e.scope, report).catch(() => undefined);
  }
}

let singleton: ExpectedHub | null = null;
export function getExpectedHub(): ExpectedHub | null {
  if (typeof indexedDB === 'undefined') return null;
  if (!singleton) {
    const store = new IdbExpectedStore();
    singleton = new ExpectedHub(new ExpectedReporter({ store, authFor: () => null }), store);
  }
  return singleton;
}
