/**
 * SDD-244 T08 — 신호별 영속 큐(IndexedDB v2 additive).
 * packets journal → sealed raw 청크 / feature·indices outbox → ACK receipt → GC.
 * 모든 쓰기는 같은 트랜잭션에서 lease owner/fencing token을 검사한다(탭 단일 수집).
 * payload는 검증 ACK receipt가 영속된 뒤에만 삭제한다. 실패·8회 초과·403/409는 dead_letter로 보관한다.
 */
import type { ArtifactKind, ArtifactMeta, ExpectedArtifact, GapEvent, CloseIntent, RawMeta } from '../api/biosignal';
import { idbRequest, openRawDb, transactionDone, type BiosignalStore } from './queue-db';

export interface CaptureScope { accountId: string; sessionId: string; participantId: string | null; deviceAlias: string }
export type ObjectKind = 'raw' | ArtifactKind;
export type ObjectState = 'pending' | 'dead_letter';
export interface QueuedObject {
  id: string; accountId: string; sessionId: string; participantId: string | null;
  kind: ObjectKind; alias: string; meta: RawMeta | ArtifactMeta; payload: ArrayBuffer;
  state: ObjectState; attempts: number; lastError: string | null; retryAfter: number; createdAt: number;
}
/** payload 를 뺀 큐 항목(목록·카운트·전송 선택용). 수백 건 적체에도 메모리에 payload 를 올리지 않는다. */
export type QueuedMeta = Omit<QueuedObject, 'payload'>;
export interface AckReceipt {
  id: string; accountId: string; sessionId: string; participantId: string | null;
  meta?: RawMeta | ArtifactMeta; kind: ObjectKind; alias: string; sha256: string; serverId: string; size_bytes: number; verified_at_us: string;
}
export interface JournalPacket {
  id: string; accountId: string; sessionId: string; participantId: string | null;
  signal: string; streamId: string; segmentId: string; seq: number; bytes: ArrayBuffer;
  tickRaw: number | null; tickUnwrapped: string | null; receivedUtcUs: string; receivedMonotonicUs: string; malformedReason: string | null;
  /** 이 패킷 직전까지의 running sample index(0행 패킷도 보존). packet_map에서는 0행이면 null로 변환한다. */
  firstSampleIndex: number; sampleCount: number;
  /** 같은 segment의 시간축 기준점(첫 샘플). 청크가 GC돼도 헤더를 복원할 수 있게 매 패킷에 싣는다. */
  segmentAnchor: { utcUs: string; monotonicUs: string; tickRaw: string | null; tickUnwrapped: string | null; originMonotonicUs: string };
}
interface LeaseRecord { id: string; owner: string; token: number; expiresAt: number }
interface EventRecord { id: string; accountId: string; sessionId: string; participantId: string | null; event: GapEvent | CloseIntent; sent: boolean }

export const LEASE_TTL_MS = 30_000;
export const LEASE_RENEW_MS = 2_000;
export const MAX_ATTEMPTS = 8;
export const MAX_BACKOFF_MS = 60_000;

function storeFor(kind: ObjectKind): BiosignalStore {
  return kind === 'raw' ? 'sealed_chunks' : kind === 'indices' ? 'indices_outbox' : 'feature_outbox';
}
const OBJECT_STORES: BiosignalStore[] = ['sealed_chunks', 'feature_outbox', 'indices_outbox'];

export class BiosignalQueue {
  private token = 0;
  private dbPromise: Promise<IDBDatabase> | null = null;
  private metaIndex: Map<string, QueuedMeta> | null = null;
  private metaLoading: Promise<Map<string, QueuedMeta>> | null = null;
  private readonly scope: CaptureScope;
  private readonly tabId: string;
  private readonly now: () => number;
  constructor(scope: CaptureScope, tabId: string, now: () => number = Date.now) {
    this.scope = scope; this.tabId = tabId; this.now = now;
  }

  /** lease 키에는 실제 장치 ID가 아닌 alias만 쓴다. */
  get scopeKey(): string { return [this.scope.accountId, this.scope.sessionId, this.scope.participantId ?? '-', this.scope.deviceAlias].join('|'); }
  private db(): Promise<IDBDatabase> { return this.dbPromise ??= openRawDb(); }
  get sessionId(): string { return this.scope.sessionId; }
  get participantId(): string | null { return this.scope.participantId; }
  private owns(record: { accountId: string; sessionId: string; participantId: string | null }): boolean {
    return record.accountId === this.scope.accountId && record.sessionId === this.scope.sessionId && record.participantId === this.scope.participantId;
  }

  // ── lease ──
  async acquire(): Promise<number> {
    const tx = (await this.db()).transaction(['leases'], 'readwrite');
    const store = tx.objectStore('leases');
    const current = await idbRequest<LeaseRecord | undefined>(store.get(this.scopeKey));
    if (current && current.owner !== this.tabId && current.expiresAt > this.now()) { tx.abort(); throw new Error('lease_held: 다른 탭이 수집 중입니다'); }
    this.token = current && current.owner === this.tabId ? current.token : (current?.token ?? 0) + 1;
    store.put({ id: this.scopeKey, owner: this.tabId, token: this.token, expiresAt: this.now() + LEASE_TTL_MS } satisfies LeaseRecord);
    await transactionDone(tx);
    return this.token;
  }
  async renew(): Promise<void> {
    const tx = (await this.db()).transaction(['leases'], 'readwrite');
    await this.checkLease(tx);
    tx.objectStore('leases').put({ id: this.scopeKey, owner: this.tabId, token: this.token, expiresAt: this.now() + LEASE_TTL_MS } satisfies LeaseRecord);
    await transactionDone(tx);
  }
  async release(): Promise<void> {
    const tx = (await this.db()).transaction(['leases'], 'readwrite');
    const store = tx.objectStore('leases');
    const current = await idbRequest<LeaseRecord | undefined>(store.get(this.scopeKey));
    if (current && current.owner === this.tabId && current.token === this.token) store.delete(this.scopeKey);
    await transactionDone(tx);
  }
  private async checkLease(tx: IDBTransaction): Promise<void> {
    const lease = await idbRequest<LeaseRecord | undefined>(tx.objectStore('leases').get(this.scopeKey));
    // 만료(expiresAt)만으로 권한을 잃지 않는다: 메인 스레드가 오래 멈췄다 돌아와도 다른 창이 가져가지 않았으면 소유자다.
    if (!lease || lease.owner !== this.tabId || lease.token !== this.token) {
      tx.abort();
      throw new Error('lease_lost: 수집 권한을 잃었습니다');
    }
  }
  /** 쓰기 트랜잭션: 같은 tx 안에서 fencing token을 검사한 뒤 body 실행. */
  private async write<T>(stores: BiosignalStore[], body: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const tx = (await this.db()).transaction([...stores, 'leases'], 'readwrite');
    const done = transactionDone(tx);
    done.catch(() => undefined);
    await this.checkLease(tx);
    const result = await body(tx);
    await done;
    return result;
  }
  private async read<T>(store: BiosignalStore, body: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const tx = (await this.db()).transaction([store], 'readonly');
    return idbRequest(body(tx.objectStore(store)));
  }

  /** 처리기 emit/표시 행도 네트워크와 무관하게 먼저 영속화한다. 카운터 store의 별도 이름공간. */
  async saveDraft<T>(kind: 'feature' | 'display', id: string, value: T): Promise<void> {
    await this.write(['next_indices'], async tx => { tx.objectStore('next_indices').put({ id: `${this.scopeKey}|draft|${kind}|${id}`, draftScope: this.scopeKey, draftKind: kind, draftId: id, value }); });
  }
  async drafts<T>(kind: 'feature' | 'display'): Promise<{ id: string; value: T }[]> {
    const rows = await this.read('next_indices', s => s.getAll() as IDBRequest<{ draftScope?: string; draftKind?: string; draftId: string; value: T }[]>);
    return rows.filter(r => r.draftScope === this.scopeKey && r.draftKind === kind).map(r => ({ id: r.draftId, value: r.value }));
  }

  /** 내용 주소 모델은 재시작 후에도 같은 슬롯을 쓰고 서로 다른 모델은 슬롯을 공유하지 않는다. */
  async artifactSequence(kind: ArtifactKind, alias: string): Promise<number> {
    return this.write(['next_indices'], async tx => {
      const store = tx.objectStore('next_indices');
      const id = `${this.scopeKey}|artifact-slot|${kind}|${alias}`;
      const existing = await idbRequest<{ sequence: number } | undefined>(store.get(id));
      if (existing) return existing.sequence;
      const counterId = `${this.scopeKey}|artifact-slot-counter|${kind}`;
      const counter = await idbRequest<{ next: number } | undefined>(store.get(counterId));
      const sequence = counter?.next ?? 0;
      store.put({ id, sequence }); store.put({ id: counterId, next: sequence + 1 });
      return sequence;
    });
  }

  // ── packet journal / raw 봉인 ──
  async journalPacket(packet: JournalPacket): Promise<void> {
    await this.write(['packets'], async tx => { tx.objectStore('packets').put({ ...packet, accountId: this.scope.accountId, sessionId: this.scope.sessionId, participantId: this.scope.participantId }); });
  }
  async packets(signal: string, streamId: string, segmentId: string): Promise<JournalPacket[]> {
    const all = await this.read('packets', s => s.getAll() as IDBRequest<JournalPacket[]>);
    return all.filter(p => this.owns(p) && p.signal === signal && p.streamId === streamId && p.segmentId === segmentId).sort((a, b) => a.seq - b.seq);
  }
  async allPackets(): Promise<JournalPacket[]> {
    return (await this.read('packets', s => s.getAll() as IDBRequest<JournalPacket[]>)).filter(p => this.owns(p));
  }
  /** 다음 chunk_index(신호·stream·segment별 0부터). */
  async nextIndex(signal: string, streamId: string, segmentId: string): Promise<number> {
    const row = await this.read('next_indices', s => s.get(this.indexKey(signal, streamId, segmentId)) as IDBRequest<{ next: number } | undefined>);
    return row?.next ?? 0;
  }
  private indexKey(signal: string, streamId: string, segmentId: string): string { return `${this.scopeKey}|${signal}|${streamId}|${segmentId}`; }
  /** index 할당 + payload 등록 + journal GC를 한 트랜잭션으로 묶는다. */
  async sealRaw(meta: RawMeta, payload: ArrayBuffer, packetIds: string[]): Promise<QueuedObject> {
    const { signal_type: signal, stream_id: stream, segment_id: segment, chunk_index: index } = meta.header;
    const sealed = await this.write(['sealed_chunks', 'next_indices', 'packets'], async tx => {
      const indices = tx.objectStore('next_indices');
      const key = this.indexKey(signal, stream, segment);
      const row = await idbRequest<{ next: number } | undefined>(indices.get(key));
      if ((row?.next ?? 0) !== index) throw new Error('chunk_index_conflict: 봉인 중 index가 바뀌었습니다');
      const object = this.newObject('raw', meta.chunk_alias, meta, payload);
      await this.putObject(tx.objectStore('sealed_chunks'), object);
      indices.put({ id: key, next: index + 1 });
      const packets = tx.objectStore('packets');
      for (const id of packetIds) packets.delete(id);
      return object;
    });
    this.indexPut(sealed);
    return sealed;
  }

  /** gap 순번은 회차 단위로 영속 증가한다(재시작해도 되돌아가지 않음). */
  async addGap(gap: Omit<GapEvent, 'sequence' | 'event_type'>): Promise<GapEvent> {
    // 역방향 구간은 저장하지 않고 순번도 소비하지 않는다.
    if (gap.end_us !== null && BigInt(gap.end_us) < BigInt(gap.start_us)) throw new Error('negative_gap');
    const key = `${this.scopeKey}|gapseq`;
    return this.write(['gaps', 'next_indices'], async tx => {
      const counter = tx.objectStore('next_indices');
      const row = await idbRequest<{ next: number } | undefined>(counter.get(key));
      const sequence = row?.next ?? 0;
      const event: GapEvent = { ...gap, event_type: 'gap', sequence };
      counter.put({ id: key, next: sequence + 1 });
      tx.objectStore('gaps').put({ id: `${this.scopeKey}|gap|${event.event_id}`, accountId: this.scope.accountId, sessionId: this.scope.sessionId, participantId: this.scope.participantId, event, sent: false } satisfies EventRecord);
      return event;
    });
  }
  async lastGapSequence(): Promise<number | null> {
    const row = await this.read('next_indices', s => s.get(`${this.scopeKey}|gapseq`) as IDBRequest<{ next: number } | undefined>);
    return row && row.next > 0 ? row.next - 1 : null;
  }

  // ── 산출물 outbox ──
  private newObject(kind: ObjectKind, alias: string, meta: RawMeta | ArtifactMeta, payload: ArrayBuffer): QueuedObject {
    return { id: `${this.scopeKey}|${kind}|${alias}`, accountId: this.scope.accountId, sessionId: this.scope.sessionId, participantId: this.scope.participantId,
      kind, alias, meta, payload, state: 'pending', attempts: 0, lastError: null, retryAfter: 0, createdAt: this.now() };
  }
  private async putObject(store: IDBObjectStore, object: QueuedObject): Promise<QueuedObject> {
    const existing = await idbRequest<QueuedObject | undefined>(store.get(object.id));
    if (existing) {
      // 같은 alias는 같은 내용만 멱등. 다른 내용은 덮어쓰지 않고 충돌로 거절한다.
      if (existing.meta.checksum !== object.meta.checksum) throw new Error('alias_conflict: 같은 alias에 다른 내용');
      return existing;
    }
    store.put(object);
    return object;
  }
  async enqueueArtifact(meta: ArtifactMeta, payload: ArrayBuffer, drafts: { kind: 'feature' | 'display'; id: string }[] = []): Promise<QueuedObject> {
    const object = this.newObject(meta.artifact_kind, meta.artifact_alias, meta, payload);
    const saved = await this.write([storeFor(meta.artifact_kind), 'next_indices'], async tx => {
      const saved = await this.putObject(tx.objectStore(storeFor(meta.artifact_kind)), object);
      for (const draft of drafts) tx.objectStore('next_indices').delete(`${this.scopeKey}|draft|${draft.kind}|${draft.id}`);
      return saved;
    });
    this.indexPut(saved);
    return saved;
  }

  /** 이 범위(scopeKey)의 큐 항목 메타를 한 번 훑어 메모리 인덱스로 만든다(payload 는 버린다). */
  private async ensureIndex(): Promise<Map<string, QueuedMeta>> {
    if (this.metaIndex) return this.metaIndex;
    this.metaLoading ??= (async () => {
      const db = await this.db();
      const index = new Map<string, QueuedMeta>();
      const prefix = `${this.scopeKey}|`;
      for (const store of OBJECT_STORES) {
        await new Promise<void>((resolve, reject) => {
          const request = db.transaction([store], 'readonly').objectStore(store).openCursor();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) { resolve(); return; }
            if (String(cursor.key).startsWith(prefix)) {
              const { payload: _payload, ...meta } = cursor.value as QueuedObject;
              if (this.owns(meta)) index.set(meta.id, meta);
            }
            cursor.continue();
          };
        });
      }
      this.metaIndex = index;
      return index;
    })();
    return this.metaLoading;
  }
  private indexPut(object: QueuedObject | QueuedMeta): void {
    if (!this.metaIndex) return;
    const { payload: _payload, ...meta } = object as QueuedObject;
    this.metaIndex.set(meta.id, meta);
  }
  /** payload 없는 전체 목록(생성 순). close/복구/카운트용. */
  async objectsMeta(): Promise<QueuedMeta[]> {
    return [...(await this.ensureIndex()).values()].sort((a, b) => a.createdAt - b.createdAt);
  }
  async counts(): Promise<{ pending: number; blocked: number }> {
    let pending = 0, blocked = 0;
    for (const m of (await this.ensureIndex()).values()) { if (m.state === 'dead_letter') blocked += 1; else pending += 1; }
    return { pending, blocked };
  }
  /** 지금 보낼 수 있는 항목 최대 limit 건(payload 포함, 오래된 순). 나머지는 읽지 않는다. */
  async dueBatch(limit: number, now: number): Promise<{ batch: QueuedObject[]; blocked: number }> {
    const metas = await this.objectsMeta();
    const due = metas.filter(m => m.state === 'pending' && m.retryAfter <= now).slice(0, limit);
    const batch: QueuedObject[] = [];
    for (const m of due) {
      const object = await this.read(storeFor(m.kind), s => s.get(m.id) as IDBRequest<QueuedObject | undefined>);
      if (object) batch.push(object);
    }
    return { batch, blocked: metas.filter(m => m.state === 'dead_letter').length };
  }
  /** 저장소에 항목이 하나라도 있는지(payload 를 읽지 않음). 재진입 복구 판단용. */
  async hasStoredObjects(): Promise<boolean> {
    const prefix = `${this.scopeKey}|`;
    for (const store of OBJECT_STORES) {
      const keys = await this.read(store, s => s.getAllKeys() as IDBRequest<IDBValidKey[]>);
      if (keys.some(key => String(key).startsWith(prefix))) return true;
    }
    return false;
  }

  async objects(): Promise<QueuedObject[]> {
    const result: QueuedObject[] = [];
    for (const store of OBJECT_STORES) result.push(...(await this.read(store, s => s.getAll() as IDBRequest<QueuedObject[]>)).filter(o => this.owns(o)));
    return result.sort((a, b) => a.createdAt - b.createdAt);
  }
  async receipts(): Promise<AckReceipt[]> {
    return (await this.read('ack_receipts', s => s.getAll() as IDBRequest<AckReceipt[]>)).filter(r => this.owns(r));
  }
  /** close intent의 expected set. 검증 receipt가 있는 항목만. */
  async expected(): Promise<ExpectedArtifact[]> {
    return (await this.receipts()).map(r => ({ kind: r.kind, alias: r.alias, sha256: r.sha256 }));
  }

  /** 검증 ACK receipt 영속 → payload GC를 한 트랜잭션으로(receipt 없이 삭제되는 경로 없음). */
  async complete(object: QueuedObject, receipt: Omit<AckReceipt, 'id' | 'accountId' | 'sessionId' | 'participantId'>): Promise<void> {
    const store = storeFor(object.kind);
    await this.write([store, 'ack_receipts'], async tx => {
      tx.objectStore('ack_receipts').put({ ...receipt, meta: object.meta, id: object.id, accountId: object.accountId, sessionId: object.sessionId, participantId: object.participantId } satisfies AckReceipt);
      tx.objectStore(store).delete(object.id);
    });
    this.metaIndex?.delete(object.id);
  }
  /** permanent(403/409 등)·8회 초과는 dead_letter로 보관. 재시도 횟수로 삭제하지 않는다. */
  async fail(id: string, reason: string, permanent = false): Promise<void> {
    const known = (await this.ensureIndex()).get(id);
    if (!known) return;
    const object = await this.read(storeFor(known.kind), s => s.get(id) as IDBRequest<QueuedObject | undefined>);
    if (!object) { this.metaIndex?.delete(id); return; }
    const attempts = object.attempts + 1;
    const state: ObjectState = permanent || attempts >= MAX_ATTEMPTS ? 'dead_letter' : object.state;
    const next: QueuedObject = { ...object, attempts, state, lastError: reason, retryAfter: this.now() + Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempts) };
    await this.write([storeFor(object.kind)], async tx => { tx.objectStore(storeFor(object.kind)).put(next); });
    this.indexPut(next);
  }
  /** 명시 재개(재인증 후): dead_letter를 pending으로 되돌린다. payload는 그대로. */
  async resume(id: string): Promise<void> {
    const known = (await this.ensureIndex()).get(id);
    if (!known) return;
    const object = await this.read(storeFor(known.kind), s => s.get(id) as IDBRequest<QueuedObject | undefined>);
    if (!object) return;
    const resumed: QueuedObject = { ...object, state: 'pending', attempts: 0, retryAfter: 0 };
    await this.write([storeFor(object.kind)], async tx => { tx.objectStore(storeFor(object.kind)).put(resumed); });
    this.indexPut(resumed);
  }

  // ── gap / close intent (멱등 events outbox) ──
  async addEvent(event: GapEvent | CloseIntent): Promise<void> {
    const eventId = event.event_type === 'gap' ? event.event_id : event.intent_id;
    const record: EventRecord = { id: `${this.scopeKey}|${event.event_type}|${eventId}`, accountId: this.scope.accountId, sessionId: this.scope.sessionId, participantId: this.scope.participantId, event, sent: false };
    await this.write([event.event_type === 'gap' ? 'gaps' : 'close_intents'], async tx => {
      const store = tx.objectStore(event.event_type === 'gap' ? 'gaps' : 'close_intents');
      if (!(await idbRequest(store.get(record.id)))) store.put(record);
    });
  }
  async pendingEvents(): Promise<{ id: string; store: BiosignalStore; event: GapEvent | CloseIntent }[]> {
    const out: { id: string; store: BiosignalStore; event: GapEvent | CloseIntent }[] = [];
    for (const store of ['gaps', 'close_intents'] as const) {
      for (const r of await this.read(store, s => s.getAll() as IDBRequest<EventRecord[]>)) if (this.owns(r) && !r.sent) out.push({ id: r.id, store, event: r.event });
    }
    return out;
  }
  async markEventsSent(items: { id: string; store: BiosignalStore }[]): Promise<void> {
    for (const store of ['gaps', 'close_intents'] as const) {
      const mine = items.filter(i => i.store === store);
      if (!mine.length) continue;
      await this.write([store], async tx => {
        const s = tx.objectStore(store);
        for (const item of mine) { const row = await idbRequest<EventRecord | undefined>(s.get(item.id)); if (row) s.put({ ...row, sent: true }); }
      });
    }
  }
}
