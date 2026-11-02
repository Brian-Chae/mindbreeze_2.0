// SDD-260 W1 — feature 정본 저장 outbox(웹). 정본 저장 경로 = REST `POST /sessions/{id}/features/batch`(contract.md §1).
//  - 소켓 live:metric 은 방송 전용이다. 소켓 ACK 로는 어떤 창도 acked 처리하지 않는다(REST ACK 만 정본).
//  - 대기 상한이 없다(폐기 0). 영속 저장소(IndexedDB)에 적재하고, 새로고침·재실행 뒤에도 전량 복원해 전송한다.
//  - 응답: accepted|duplicate → acked / rejected 4종(participant_mismatch·stream_not_owned·consent_withdrawn·hash_conflict) → 격리 /
//    그 외 코드·네트워크·5xx·타임아웃·401 → full jitter 무한 재시도. 422 는 1창씩 분리해 독 창만 invalid_message 로 격리.
//  - summary 대조 완료 전에는 아무 것도 삭제하지 않는다(acked 도 보관).
import { ApiError } from '../api/client';
import { idbRequest, rawTransaction, transactionDone } from '../biosignal/queue-db';
import type { MetricEnvelope } from './envelope';

export const MAX_BATCH_WINDOWS = 60;
export const OUTBOX_STORE = 'feature_rest_outbox';
const MAX_BACKOFF_MS = 60_000;
const BASE_BACKOFF_MS = 1_000;

/** 서버가 창 단위로 돌려주는 거절 코드 중 재전송해도 같은 결과인 4종 */
export const QUARANTINE_CODES: ReadonlySet<string> = new Set(['participant_mismatch', 'stream_not_owned', 'consent_withdrawn', 'hash_conflict']);
/** 422(요청 전체 검증 실패) 단일 창 격리용 — 독 창 하나가 전체 저장을 막지 않게 한다 */
export const INVALID_MESSAGE = 'invalid_message';

export type FeatureStatus = 'accepted' | 'duplicate' | 'rejected';
export interface FeatureResult { stream_id: string; sequence: string; status: FeatureStatus; code?: string; durable?: boolean }

export interface OutboxScope { accountId: string; sessionId: string; participantId: string }
export type OutboxState = 'pending' | 'acked' | 'rejected';
export interface OutboxRecord {
  id: string; accountId: string; sessionId: string; participantId: string;
  streamId: string; sequence: string; envelope: MetricEnvelope; state: OutboxState; code: string | null; attempts: number;
}
export interface OutboxMeta { completedCount: number; completedAtMs: number }

export interface OutboxStore {
  /** 이미 있으면 덮어쓰지 않는다(멱등 enqueue) */
  putIfAbsent(record: OutboxRecord): Promise<void>;
  putMany(records: OutboxRecord[]): Promise<void>;
  list(scope: OutboxScope): Promise<OutboxRecord[]>;
  getMeta(scope: OutboxScope): Promise<OutboxMeta | null>;
  putMeta(scope: OutboxScope, meta: OutboxMeta): Promise<void>;
  /** 저장소에 적재된 모든 scope(재실행 이어올림용) */
  listScopes(): Promise<OutboxScope[]>;
}

const pad = (seq: string): string => seq.padStart(24, '0');
const prefixOf = (s: OutboxScope): string => `${s.accountId}|${s.sessionId}|${s.participantId}|`;
const META_SUFFIX = '~meta';
export const recordId = (s: OutboxScope, streamId: string, sequence: string): string => `${prefixOf(s)}${streamId}|${pad(sequence)}`;
const scopeFromId = (id: string): OutboxScope | null => {
  const parts = id.split('|');
  return parts.length >= 4 ? { accountId: parts[0]!, sessionId: parts[1]!, participantId: parts[2]! } : null;
};

/** 테스트·IndexedDB 불가 환경용 */
export class MemoryOutboxStore implements OutboxStore {
  private readonly rows = new Map<string, OutboxRecord>();
  private readonly metas = new Map<string, OutboxMeta>();
  async putIfAbsent(r: OutboxRecord): Promise<void> { if (!this.rows.has(r.id)) this.rows.set(r.id, r); }
  async putMany(rs: OutboxRecord[]): Promise<void> { for (const r of rs) this.rows.set(r.id, r); }
  async list(scope: OutboxScope): Promise<OutboxRecord[]> {
    const p = prefixOf(scope);
    return [...this.rows.values()].filter((r) => r.id.startsWith(p));
  }
  async getMeta(scope: OutboxScope): Promise<OutboxMeta | null> { return this.metas.get(prefixOf(scope)) ?? null; }
  async putMeta(scope: OutboxScope, meta: OutboxMeta): Promise<void> { this.metas.set(prefixOf(scope), meta); }
  async listScopes(): Promise<OutboxScope[]> {
    const seen = new Map<string, OutboxScope>();
    for (const r of this.rows.values()) { const s = scopeFromId(r.id); if (s) seen.set(prefixOf(s), s); }
    return [...seen.values()];
  }
}

/** IndexedDB(`mindbreeze-eeg-raw` v3 / `feature_rest_outbox`) — 탭 새로고침·앱 재실행 뒤에도 보존 */
export class IdbOutboxStore implements OutboxStore {
  private range(scope: OutboxScope): IDBKeyRange {
    const p = prefixOf(scope);
    return IDBKeyRange.bound(p, `${p}\uffff`);
  }
  async putIfAbsent(r: OutboxRecord): Promise<void> {
    const tx = await rawTransaction([OUTBOX_STORE], 'readwrite');
    const store = tx.objectStore(OUTBOX_STORE);
    if (!(await idbRequest(store.get(r.id)))) store.put(r);
    await transactionDone(tx);
  }
  async putMany(rs: OutboxRecord[]): Promise<void> {
    if (rs.length === 0) return;
    const tx = await rawTransaction([OUTBOX_STORE], 'readwrite');
    const store = tx.objectStore(OUTBOX_STORE);
    for (const r of rs) store.put(r);
    await transactionDone(tx);
  }
  async list(scope: OutboxScope): Promise<OutboxRecord[]> {
    const tx = await rawTransaction([OUTBOX_STORE], 'readonly');
    const rows = await idbRequest(tx.objectStore(OUTBOX_STORE).getAll(this.range(scope)) as IDBRequest<Array<OutboxRecord & { id: string }>>);
    return rows.filter((r) => !r.id.endsWith(META_SUFFIX));
  }
  async getMeta(scope: OutboxScope): Promise<OutboxMeta | null> {
    const tx = await rawTransaction([OUTBOX_STORE], 'readonly');
    const row = await idbRequest(tx.objectStore(OUTBOX_STORE).get(`${prefixOf(scope)}${META_SUFFIX}`) as IDBRequest<{ meta?: OutboxMeta } | undefined>);
    return row?.meta ?? null;
  }
  async putMeta(scope: OutboxScope, meta: OutboxMeta): Promise<void> {
    const tx = await rawTransaction([OUTBOX_STORE], 'readwrite');
    tx.objectStore(OUTBOX_STORE).put({ id: `${prefixOf(scope)}${META_SUFFIX}`, meta });
    await transactionDone(tx);
  }
  async listScopes(): Promise<OutboxScope[]> {
    const tx = await rawTransaction([OUTBOX_STORE], 'readonly');
    const keys = await idbRequest(tx.objectStore(OUTBOX_STORE).getAllKeys());
    const seen = new Map<string, OutboxScope>();
    for (const k of keys) { const s = scopeFromId(String(k)); if (s) seen.set(prefixOf(s), s); }
    return [...seen.values()];
  }
}

/** full jitter: 0..min(60s, 1s×2^n) */
export function fullJitterMs(attempt: number, random: () => number = Math.random): number {
  const cap = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.min(attempt, 20));
  return Math.floor(cap * random());
}

export interface MetricOutboxOptions {
  scope: OutboxScope;
  store?: OutboxStore;
  /** REST 배치 전송. 던지면(네트워크·5xx·타임아웃) 전부 재시도 대상 */
  send: (windows: MetricEnvelope[]) => Promise<FeatureResult[]>;
  now?: () => number;
  random?: () => number;
}

export interface OutboxCounts { pending: number; acked: number; rejected: number }

const keyOf = (r: { streamId: string; sequence: string }): string => `${r.streamId}:${r.sequence}`;
const bySeq = (a: OutboxRecord, b: OutboxRecord): number => {
  if (a.streamId !== b.streamId) return a.streamId < b.streamId ? -1 : 1;
  const x = BigInt(a.sequence), y = BigInt(b.sequence);
  return x < y ? -1 : x > y ? 1 : 0;
};

export class MetricOutbox {
  private readonly o: MetricOutboxOptions;
  private readonly store: OutboxStore;
  private inflight: Promise<boolean> | null = null;
  private notBeforeMs = 0;
  private failures = 0;
  private singleMode = false;

  constructor(o: MetricOutboxOptions) {
    this.o = o;
    this.store = o.store ?? new MemoryOutboxStore();
  }

  get scope(): OutboxScope { return this.o.scope; }
  private now(): number { return (this.o.now ?? Date.now)(); }

  /** 창을 영속 적재한다(같은 키는 무시). 폐기하지 않는다. */
  async enqueue(env: MetricEnvelope): Promise<void> {
    const s = this.o.scope;
    await this.store.putIfAbsent({
      id: recordId(s, env.stream_id, env.sequence), ...s, streamId: env.stream_id, sequence: env.sequence,
      envelope: env, state: 'pending', code: null, attempts: 0,
    });
  }

  snapshot(): Promise<OutboxRecord[]> { return this.store.list(this.o.scope); }

  async counts(): Promise<OutboxCounts> {
    const c: OutboxCounts = { pending: 0, acked: 0, rejected: 0 };
    for (const r of await this.snapshot()) c[r.state] += 1;
    return c;
  }

  async pendingCount(): Promise<number> { return (await this.counts()).pending; }

  /** 대조용 로컬 창 목록(격리된 창 제외) stream → 오름차순 sequence */
  async localSequences(): Promise<Record<string, string[]>> {
    const out: Record<string, string[]> = {};
    for (const r of (await this.snapshot()).filter((x) => x.state !== 'rejected').sort(bySeq)) (out[r.streamId] ??= []).push(r.sequence);
    return out;
  }

  /** 서버에 없는 창을 다시 전송 대기로 되돌린다(summary 대조 결과) */
  async requeue(missing: Record<string, string[]>): Promise<number> {
    const want = new Set(Object.entries(missing).flatMap(([stream, seqs]) => seqs.map((q) => `${stream}:${q}`)));
    const rows = (await this.snapshot()).filter((r) => r.state === 'acked' && want.has(keyOf(r))).map((r) => ({ ...r, state: 'pending' as const }));
    await this.store.putMany(rows);
    if (rows.length > 0) this.notBeforeMs = 0;
    return rows.length;
  }

  getMeta(): Promise<OutboxMeta | null> { return this.store.getMeta(this.o.scope); }
  putMeta(meta: OutboxMeta): Promise<void> { return this.store.putMeta(this.o.scope, meta); }

  /** 재시도 대기를 무시하고 바로 보내게 한다(종료·복귀·네트워크 복귀 트리거) */
  resetBackoff(): void { this.notBeforeMs = 0; }

  /** 한 배치(≤60창)를 보낸다. 이미 보내는 중이면 그 결과를 공유한다. 진행(acked/격리)이 있었으면 true */
  flush(): Promise<boolean> {
    if (this.inflight) return this.inflight;
    if (this.now() < this.notBeforeMs) return Promise.resolve(false);
    this.inflight = this.flushOnce().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  /** 대기 창이 없거나 더 진행되지 않을 때까지 반복 전송 */
  async flushAll(maxRounds = 200): Promise<void> {
    for (let i = 0; i < maxRounds; i += 1) {
      if (!(await this.flush())) return;
      if ((await this.pendingCount()) === 0) return;
    }
  }

  private async flushOnce(): Promise<boolean> {
    const pending = (await this.snapshot()).filter((r) => r.state === 'pending').sort(bySeq);
    if (pending.length === 0) return false;
    const batch = pending.slice(0, this.singleMode ? 1 : MAX_BATCH_WINDOWS);
    let results: FeatureResult[];
    try {
      results = await this.o.send(batch.map((r) => r.envelope));
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) return this.onInvalid(batch);
      this.backoff();
      return false;
    }
    const byKey = new Map(results.map((x) => [`${x.stream_id}:${x.sequence}`, x]));
    let progressed = false;
    let retry = false;
    const next: OutboxRecord[] = [];
    for (const r of batch) {
      const res = byKey.get(keyOf(r));
      if (res && (res.status === 'accepted' || res.status === 'duplicate')) { next.push({ ...r, state: 'acked', code: null }); progressed = true; }
      else if (res && res.status === 'rejected' && res.code && QUARANTINE_CODES.has(res.code)) { next.push({ ...r, state: 'rejected', code: res.code }); progressed = true; }
      else { next.push({ ...r, attempts: r.attempts + 1, code: res?.code ?? r.code }); retry = true; }
    }
    await this.store.putMany(next);
    if (retry) this.backoff(); else { this.failures = 0; this.notBeforeMs = 0; }
    return progressed;
  }

  /** 요청 전체 422: 다건이면 1창씩 분리, 단건이면 그 창만 격리 */
  private async onInvalid(batch: OutboxRecord[]): Promise<boolean> {
    if (batch.length > 1) { this.singleMode = true; return true; }
    await this.store.putMany([{ ...batch[0]!, state: 'rejected', code: INVALID_MESSAGE }]);
    this.singleMode = false;
    return true;
  }

  private backoff(): void {
    this.notBeforeMs = this.now() + fullJitterMs(this.failures, this.o.random);
    this.failures += 1;
  }
}
