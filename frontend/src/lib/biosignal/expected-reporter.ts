// SDD-264 — 폰이 "자기가 만든 총량"을 서버에 보고한다(PUT /sessions/{sid}/ingest-expected).
// 규칙(contract.md §1·§7): 총량은 단조 증가 → 오프라인이면 마지막 값 1건만 영속 보관했다 복귀 시 전송.
//  - 측정 중 30초마다(값 변동 시), 종료·이어올림 완료는 final=true 즉시. 무한 재시도 full jitter(SDD-260 outbox 방식).
//  - 409/422 등 재시도해도 같은 결과인 4xx 는 로깅 후 중단(폐기 아님 — 레코드·값은 보존), 401/408/429/5xx/네트워크는 재시도.
import { ApiError } from '../api/client';
import type { FeatureAuth } from '../api/feature-batch';
import { putIngestExpected, type IngestExpectedBody, type IngestExpectedResponse } from '../api/ingest-expected';
import { idbRequest, rawTransaction, transactionDone } from './queue-db';

export const EXPECTED_STORE = 'expected_report';
/** 측정 중 값이 바뀌었을 때 보고 최소 간격 */
export const REPORT_INTERVAL_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
/** 재시도해도 결과가 같은 요청 오류(계약 §에러: 400·403·404 격리, 409·422 앱 버그/충돌) → 중단 */
const HALT_STATUSES: ReadonlySet<number> = new Set([400, 403, 404, 409, 422]);

export const SIGNALS = ['eeg', 'ppg', 'acc'] as const;
export type Signal = typeof SIGNALS[number];
export type RawTotals = Record<Signal, number>;
export interface ExpectedReport { feature: number; raw: RawTotals | null; final: boolean }

/** participantId 가 빈 문자열이면 JWT 로 본인 행을 확정한다(본문에서 생략) */
export interface ExpectedScope { accountId: string; sessionId: string; participantId: string }
/** SDD-275: 비회원 입장 자격 사본(탭 종료·"홈으로" 뒤에도 보고를 마치기 위해 보고 레코드에 함께 영속). expiresAtMs=null 이면 만료 없음 */
export interface StoredEntryAuth { credential: string; expiresAtMs: number | null }
export interface ExpectedRecord extends ExpectedScope {
  id: string;
  /** 지금까지의 최대 총량(마지막 값 1건) */
  report: ExpectedReport | null;
  /** 서버가 마지막으로 받아들인 값(없으면 아직 한 번도 못 보냄) */
  sent: ExpectedReport | null;
  lastSentAtMs: number;
  attempts: number;
  /** 요청 오류로 중단된 사유(HTTP 상태:코드). 값은 보존한다 */
  halted: string | null;
  /** SDD-275: 비회원 입장 자격 사본(additive, 없으면 sessionStorage 입장 자격만 사용) */
  entryAuth?: StoredEntryAuth | null;
}

export interface ExpectedStore {
  get(id: string): Promise<ExpectedRecord | null>;
  put(record: ExpectedRecord): Promise<void>;
  list(): Promise<ExpectedRecord[]>;
}

export const expectedRecordId = (s: ExpectedScope): string => `${s.accountId}|${s.sessionId}|${s.participantId}`;

export class MemoryExpectedStore implements ExpectedStore {
  private readonly rows = new Map<string, ExpectedRecord>();
  async get(id: string): Promise<ExpectedRecord | null> { const r = this.rows.get(id); return r ? structuredClone(r) : null; }
  async put(r: ExpectedRecord): Promise<void> { this.rows.set(r.id, structuredClone(r)); }
  async list(): Promise<ExpectedRecord[]> { return [...this.rows.values()].map((r) => structuredClone(r)); }
}

/** IndexedDB(`mindbreeze-eeg-raw` v4 / `expected_report`) — 앱 재실행 뒤에도 마지막 값 1건이 남는다 */
export class IdbExpectedStore implements ExpectedStore {
  async get(id: string): Promise<ExpectedRecord | null> {
    const tx = await rawTransaction([EXPECTED_STORE], 'readonly');
    return (await idbRequest(tx.objectStore(EXPECTED_STORE).get(id) as IDBRequest<ExpectedRecord | undefined>)) ?? null;
  }
  async put(r: ExpectedRecord): Promise<void> {
    const tx = await rawTransaction([EXPECTED_STORE], 'readwrite');
    tx.objectStore(EXPECTED_STORE).put(r);
    await transactionDone(tx);
  }
  async list(): Promise<ExpectedRecord[]> {
    const tx = await rawTransaction([EXPECTED_STORE], 'readonly');
    return idbRequest(tx.objectStore(EXPECTED_STORE).getAll() as IDBRequest<ExpectedRecord[]>);
  }
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10_000_000;

/**
 * 두 보고의 병합(단조): 필드별 최댓값. final 은 **한 번 true 면 되돌리지 않는다**(OR).
 * 서버 규칙 ①(뒤처진 보고의 final 무시)은 "서버 저장값보다 낮은 값을 보낼 때"의 규칙인데, 우리는 항상 병합 최댓값을 보내므로
 * 뒤처진 값이 서버에 가지 않는다. 따라서 이어올림 스윕이 꼬리만 센 부분합(예: 1/1/1)과 complete=true 를 내도
 * final 신호를 버리지 않는다(SDD-266). 증가 보고가 final=false 로 확정을 되돌리는 일도 막는다(서버 ②는 증가 시 새 값을 덮어씀).
 */
export function mergeReport(prev: ExpectedReport | null, next: ExpectedReport): ExpectedReport {
  if (!prev) return { feature: next.feature, raw: next.raw ? { ...next.raw } : null, final: next.final };
  const raw: RawTotals | null = prev.raw && next.raw
    ? { eeg: Math.max(prev.raw.eeg, next.raw.eeg), ppg: Math.max(prev.raw.ppg, next.raw.ppg), acc: Math.max(prev.raw.acc, next.raw.acc) }
    : (next.raw ?? prev.raw);
  return { feature: Math.max(prev.feature, next.feature), raw, final: prev.final || next.final };
}

export const sameReport = (a: ExpectedReport | null, b: ExpectedReport | null): boolean => {
  if (a === null || b === null) return a === b;
  const rawSame = a.raw === null || b.raw === null ? a.raw === b.raw : SIGNALS.every((s) => a.raw![s] === b.raw![s]);
  return a.feature === b.feature && a.final === b.final && rawSame;
};

/** full jitter: 0..min(60s, 1s×2^n) */
export function fullJitterMs(attempt: number, random: () => number = Math.random): number {
  return Math.floor(Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.min(attempt, 20)) * random());
}

export interface ExpectedReporterDeps {
  store: ExpectedStore;
  /** 이 scope 를 지금 보낼 수 있는 인증(없으면 null → 보존만) */
  authFor: (scope: ExpectedScope) => FeatureAuth | null;
  put?: (sessionId: string, body: IngestExpectedBody, auth: FeatureAuth) => Promise<IngestExpectedResponse>;
  now?: () => number;
  random?: () => number;
  intervalMs?: number;
  log?: (msg: string, detail?: Record<string, unknown>) => void;
  /** 간격 대기용 타이머(테스트 주입). 반환 = 취소 */
  setTimer?: (fn: () => void, ms: number) => () => void;
}

export class ExpectedReporter {
  private readonly d: ExpectedReporterDeps;
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly notBefore = new Map<string, number>();
  private readonly timers = new Map<string, () => void>();
  private authFor: (scope: ExpectedScope) => FeatureAuth | null;

  constructor(d: ExpectedReporterDeps) { this.d = d; this.authFor = d.authFor; }

  /** 로그인 상태가 바뀌면 인증 해석기를 교체한다 */
  setAuthResolver(fn: (scope: ExpectedScope) => FeatureAuth | null): void { this.authFor = fn; }

  private now(): number { return (this.d.now ?? Date.now)(); }
  private interval(): number { return this.d.intervalMs ?? REPORT_INTERVAL_MS; }
  private log(msg: string, detail?: Record<string, unknown>): void { (this.d.log ?? ((m, x) => console.warn(`[ingest-expected] ${m}`, x ?? '')))(msg, detail); }

  /** 관측된 총량을 병합해 영속하고(마지막 값 1건) 전송을 시도한다. 영속이 끝난 뒤 resolve — 전송 결과는 기다리지 않는다 */
  async submit(scope: ExpectedScope, obs: ExpectedReport): Promise<void> {
    if (!isCount(obs.feature) || (obs.raw !== null && !SIGNALS.every((s) => isCount(obs.raw![s])))) return; // 형식 불일치는 보고하지 않는다
    const id = expectedRecordId(scope);
    // 같은 scope 의 submit 이 겹쳐도 병합이 유실되지 않도록 직렬화한다
    const prev = this.chain.get(id) ?? Promise.resolve();
    const run = prev.then(async () => {
      const stored = await this.d.store.get(id);
      const cur = stored ?? this.blank(scope);
      const report = mergeReport(cur.report, obs);
      if (!stored || !sameReport(report, cur.report)) await this.d.store.put({ ...cur, report });
    });
    this.chain.set(id, run.catch(() => undefined));
    await run;
    this.kick(scope);
  }
  private readonly chain = new Map<string, Promise<void>>();

  /** SDD-275: 입장 자격 사본을 레코드에 영속(같은 scope 직렬 체인). 값이 같으면 쓰지 않는다 */
  async attachEntryAuth(scope: ExpectedScope, entryAuth: StoredEntryAuth): Promise<void> {
    const id = expectedRecordId(scope);
    const prev = this.chain.get(id) ?? Promise.resolve();
    const run = prev.then(async () => {
      const cur = (await this.d.store.get(id)) ?? this.blank(scope);
      const same = cur.entryAuth?.credential === entryAuth.credential && cur.entryAuth?.expiresAtMs === entryAuth.expiresAtMs;
      if (!same) await this.d.store.put({ ...cur, entryAuth });
    });
    this.chain.set(id, run.catch(() => undefined));
    await run;
  }

  private blank(s: ExpectedScope): ExpectedRecord {
    return { id: expectedRecordId(s), accountId: s.accountId, sessionId: s.sessionId, participantId: s.participantId, report: null, sent: null, lastSentAtMs: 0, attempts: 0, halted: null };
  }

  /** 지금 보내도 되면 보내고, 간격 때문에 이르면 남은 시간 뒤로 예약한다 */
  kick(scope: ExpectedScope): void {
    const id = expectedRecordId(scope);
    void this.flushOne(id).catch(() => undefined);
  }

  listRecords(): Promise<ExpectedRecord[]> { return this.d.store.list(); }

  /** 앱 시작·online·복귀·주기: 영속된 모든 scope 를 훑어 밀린 값을 보낸다 */
  async flushAll(): Promise<void> {
    for (const r of await this.d.store.list()) await this.flushOne(r.id).catch(() => undefined);
  }

  private flushOne(id: string): Promise<void> {
    const cur = this.inflight.get(id);
    if (cur) return cur;
    const p = this.doFlush(id).finally(() => { this.inflight.delete(id); });
    this.inflight.set(id, p);
    return p;
  }

  private arm(id: string, delayMs: number): void {
    this.timers.get(id)?.();
    const set = this.d.setTimer ?? ((fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); });
    this.timers.set(id, set(() => { this.timers.delete(id); void this.flushOne(id).catch(() => undefined); }, Math.max(0, delayMs)));
  }

  private async doFlush(id: string): Promise<void> {
    const rec = await this.d.store.get(id);
    if (!rec || !rec.report || rec.halted) return;
    if (sameReport(rec.report, rec.sent)) return;
    const auth = this.authFor(rec);
    if (!auth) return; // 보존만
    const now = this.now();
    const wait = (this.notBefore.get(id) ?? 0) - now;
    if (wait > 0) { this.arm(id, wait); return; }
    // 간격 제한: 첫 보고·final 변화는 즉시, 그 외 값 변동은 30초에 한 번
    const finalChange = rec.report.final && !rec.sent?.final;
    const since = now - rec.lastSentAtMs;
    if (rec.sent !== null && !finalChange && since < this.interval()) { this.arm(id, this.interval() - since); return; }
    this.timers.get(id)?.(); this.timers.delete(id);
    const posting = rec.report;
    const body: IngestExpectedBody = { ...(rec.participantId ? { participant_id: rec.participantId } : {}), feature: posting.feature, final: posting.final, ...(posting.raw ? { raw: { ...posting.raw } } : {}) };
    try {
      await (this.d.put ?? putIngestExpected)(rec.sessionId, body, auth);
    } catch (err) {
      await this.onError(rec, err);
      return;
    }
    this.notBefore.delete(id);
    const latest = (await this.d.store.get(id)) ?? rec;
    // final 이 서버에 반영되면 자격 사본은 더 쓸 데가 없으니 지운다(SDD-275)
    await this.d.store.put({ ...latest, sent: posting, lastSentAtMs: this.now(), attempts: 0, halted: null, ...(posting.final ? { entryAuth: null } : {}) });
    // 전송 중에 값이 더 늘었으면 이어서 처리(간격 제한 적용)
    const after = await this.d.store.get(id);
    if (after && !sameReport(after.report, after.sent)) this.arm(id, after.report?.final && !after.sent?.final ? 0 : this.interval());
  }

  private async onError(rec: ExpectedRecord, err: unknown): Promise<void> {
    const status = err instanceof ApiError ? err.status : 0;
    if (HALT_STATUSES.has(status)) {
      const code = (err instanceof ApiError && typeof err.data === 'object' && err.data !== null && 'detail' in err.data)
        ? JSON.stringify((err.data as { detail: unknown }).detail).slice(0, 120) : '';
      const halted = `${status}${code ? `:${code}` : ''}`;
      this.log('중단(재시도 안 함, 값은 보존)', { sessionId: rec.sessionId, status });
      const latest = (await this.d.store.get(rec.id)) ?? rec;
      await this.d.store.put({ ...latest, halted });
      return;
    }
    // 401(토큰 갱신 대기)·408·429·5xx·네트워크·시간초과 → full jitter 무한 재시도
    const attempts = rec.attempts + 1;
    this.notBefore.set(rec.id, this.now() + fullJitterMs(attempts, this.d.random));
    const latest = (await this.d.store.get(rec.id)) ?? rec;
    await this.d.store.put({ ...latest, attempts });
    this.arm(rec.id, (this.notBefore.get(rec.id) ?? this.now()) - this.now());
  }

  /** 테스트·로그아웃 정리용: 예약된 타이머를 모두 취소 */
  dispose(): void { for (const c of this.timers.values()) c(); this.timers.clear(); }
}
