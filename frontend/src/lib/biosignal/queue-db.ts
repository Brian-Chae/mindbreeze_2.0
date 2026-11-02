/** legacy와 v2가 같은 버전을 열어 additive upgrade 뒤 VersionError를 방지한다. v3(SDD-260): feature REST 정본 outbox 스토어 추가(additive). v4(SDD-264): 폰 생성량(기대량) 보고 마지막 값 1건 스토어 추가(additive). */
export const RAW_DB_NAME = 'mindbreeze-eeg-raw';
export const RAW_DB_VERSION = 4;
export const BIOSIGNAL_STORES = ['packets', 'next_indices', 'sealed_chunks', 'feature_outbox', 'indices_outbox', 'gaps', 'close_intents', 'leases', 'ack_receipts', 'feature_rest_outbox', 'expected_report'] as const;
export type BiosignalStore = typeof BIOSIGNAL_STORES[number];
export function upgradeRawDb(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains('pending_raw_chunks')) {
    const store = db.createObjectStore('pending_raw_chunks', { keyPath: 'id' });
    store.createIndex('by_session', 'sessionId'); store.createIndex('by_stream', 'streamId');
  }
  for (const name of BIOSIGNAL_STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
}
export function openRawDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(RAW_DB_NAME, RAW_DB_VERSION);
    request.onupgradeneeded = () => upgradeRawDb(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexeddb_open_failed'));
    request.onblocked = () => reject(new Error('indexeddb_upgrade_blocked: 다른 탭을 닫고 다시 시작해 주세요'));
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
}
export function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
export function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('indexeddb_transaction_failed')); });
}

// ── SDD-277: 장수명 저장소(영속 큐·feature outbox·기대량 보고)가 함께 쓰는 공유 연결 ──
// 이전에는 객체마다 openRawDb() 로 연결을 따로 열고 닫지 않았다(60초 관측기가 큐를 새로 만들 때마다 +1).
// iOS WKWebView 는 열린 연결이 쌓이거나 앱이 백그라운드를 다녀오면 연결이 닫혀 InvalidStateError/UnknownError 를 낸다.
// → 연결 1개를 공유하고, 닫힘(onclose·onversionchange·close())을 감지하면 버리고 다음 사용 때 다시 연다.
let sharedDb: Promise<IDBDatabase> | null = null;
let sharedFactory: IDBFactory | null = null;

/** 연결 소실로 볼 수 있는 오류(재오픈으로 회복 가능). 할당량·권한·잠금 오류는 아니다. */
export function isConnectionError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { name?: unknown; message?: unknown };
  return e.name === 'InvalidStateError' || e.name === 'UnknownError' || /connection|closing|closed/i.test(String(e.message ?? ''));
}

export function resetSharedRawDb(): void {
  const stale = sharedDb;
  sharedDb = null;
  void stale?.then((db) => { try { db.close(); } catch { /* 이미 닫힘 */ } }).catch(() => undefined);
}

export function sharedRawDb(): Promise<IDBDatabase> {
  // 시험·특수 환경에서 indexedDB 구현체가 바뀌면 이전 연결을 쓰지 않는다
  if (sharedFactory !== null && sharedFactory !== indexedDB) { sharedDb = null; }
  sharedFactory = indexedDB;
  if (sharedDb) return sharedDb;
  const opening: Promise<IDBDatabase> = openRawDb().then((db) => {
    const forget = (): void => { if (sharedDb === opening) sharedDb = null; };
    db.onclose = forget;
    db.onversionchange = () => { forget(); db.close(); };
    const nativeClose = db.close.bind(db);
    db.close = () => { forget(); nativeClose(); };
    return db;
  });
  sharedDb = opening;
  opening.catch(() => { if (sharedDb === opening) sharedDb = null; });
  return opening;
}

/** 트랜잭션을 연다. 연결 소실이면 연결을 버리고 한 번 다시 열어 재시도한다. */
export async function rawTransaction(stores: string[], mode: IDBTransactionMode): Promise<IDBTransaction> {
  try { return (await sharedRawDb()).transaction(stores, mode); } catch (error) {
    if (!isConnectionError(error)) throw error;
    resetSharedRawDb();
    return (await sharedRawDb()).transaction(stores, mode);
  }
}
