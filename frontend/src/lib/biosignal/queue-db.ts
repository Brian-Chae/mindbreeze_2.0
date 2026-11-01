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
