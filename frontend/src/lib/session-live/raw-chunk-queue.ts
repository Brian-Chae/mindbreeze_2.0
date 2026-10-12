/**
 * SDD-027 — EEG raw chunk 영속 큐 (IndexedDB)
 *
 * SDD-026 feature-queue 패턴 재사용:
 * 전송 전 큐 적재 → presigned PUT·ack 성공 시에만 삭제.
 * 게스트(participantId) raw 지원. 재시도 카운트 보존.
 */

const DB_NAME = 'mindbreeze-eeg-raw';
const DB_VERSION = 1;
const STORE_QUEUE = 'pending_raw_chunks';

/** 큐에 넣는 raw chunk 메타 + payload */
export interface QueuedRawChunkPayload {
  sessionId: string;
  participantId: string | null;
  streamId: string;
  chunkIndex: number;
  startedAt: string;
  endedAt: string;
  sampleRate: number;
  channels: string[];
  unit: string;
  schemaVersion: string;
  checksum: string;
  byteSize: number;
  contentType: string;
  /** raw 바이트 — IDB에 ArrayBuffer로 저장 */
  payload: ArrayBuffer;
  createdAt: number;
  /** 업로드 실패 누적(재시도용) */
  attemptCount: number;
  lastError: string | null;
}

export interface QueuedRawChunkItem extends QueuedRawChunkPayload {
  /** IndexedDB 키 — streamId:chunkIndex */
  id: string;
}

function queueItemId(streamId: string, chunkIndex: number): string {
  return `${streamId}:${chunkIndex}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB를 사용할 수 없습니다'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        const store = db.createObjectStore(STORE_QUEUE, { keyPath: 'id' });
        store.createIndex('by_session', 'sessionId', { unique: false });
        store.createIndex('by_stream', 'streamId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open 실패'));
  });
}

function idbReq<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB 요청 실패'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error ?? new Error('IndexedDB 트랜잭션 실패'));
    tx.onabort = () =>
      reject(tx.error ?? new Error('IndexedDB 트랜잭션 중단'));
  });
}

/**
 * SHA-256 hex 체크섬.
 * crypto.subtle 미지원 환경에서는 길이 기반 폴백 해시(테스트/구형).
 */
export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    const bytes = new Uint8Array(digest);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // 폴백 — 프로덕션 Chromium에서는 subtle 사용
  const view = new Uint8Array(buffer);
  let h = 0;
  for (let i = 0; i < view.length; i += 1) {
    h = (Math.imul(31, h) + view[i]) | 0;
  }
  return `fallback-${view.length.toString(16)}-${(h >>> 0).toString(16)}`;
}

/**
 * raw chunk를 큐에 적재. 동일 stream/chunkIndex면 기존 항목 반환(멱등).
 */
export async function enqueueRawChunk(
  payload: Omit<QueuedRawChunkPayload, 'attemptCount' | 'lastError' | 'createdAt'> & {
    attemptCount?: number;
    lastError?: string | null;
    createdAt?: number;
  },
): Promise<QueuedRawChunkItem> {
  const item: QueuedRawChunkItem = {
    ...payload,
    attemptCount: payload.attemptCount ?? 0,
    lastError: payload.lastError ?? null,
    createdAt: payload.createdAt ?? Date.now(),
    id: queueItemId(payload.streamId, payload.chunkIndex),
  };

  const db = await openDb();
  try {
    const tx = db.transaction(STORE_QUEUE, 'readwrite');
    const store = tx.objectStore(STORE_QUEUE);
    const existing = await idbReq<QueuedRawChunkItem | undefined>(
      store.get(item.id),
    );
    if (!existing) {
      store.put(item);
    }
    await txDone(tx);
    return existing ?? item;
  } finally {
    db.close();
  }
}

export async function listPendingRawChunks(
  sessionId: string,
  participantId?: string | null,
): Promise<QueuedRawChunkItem[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_QUEUE, 'readonly');
    const store = tx.objectStore(STORE_QUEUE);
    const index = store.index('by_session');
    const all = await idbReq<QueuedRawChunkItem[]>(index.getAll(sessionId));
    await txDone(tx);
    const filtered =
      participantId === undefined
        ? all
        : all.filter((item) => item.participantId === participantId);
    return filtered.sort((a, b) => a.chunkIndex - b.chunkIndex);
  } finally {
    db.close();
  }
}

/** ack 성공 후 큐에서 삭제 */
export async function removeRawChunk(
  streamId: string,
  chunkIndex: number,
  sessionId?: string,
): Promise<QueuedRawChunkItem | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_QUEUE, 'readwrite');
    const store = tx.objectStore(STORE_QUEUE);
    const id = queueItemId(streamId, chunkIndex);
    const item = await idbReq<QueuedRawChunkItem | undefined>(store.get(id));
    if (!item) {
      await txDone(tx);
      return null;
    }
    if (sessionId && item.sessionId !== sessionId) {
      await txDone(tx);
      return null;
    }
    store.delete(id);
    await txDone(tx);
    return item;
  } finally {
    db.close();
  }
}

/** 실패 시 attemptCount·lastError 갱신(재시도용) */
export async function markRawChunkAttempt(
  streamId: string,
  chunkIndex: number,
  errorMessage: string,
): Promise<QueuedRawChunkItem | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_QUEUE, 'readwrite');
    const store = tx.objectStore(STORE_QUEUE);
    const id = queueItemId(streamId, chunkIndex);
    const item = await idbReq<QueuedRawChunkItem | undefined>(store.get(id));
    if (!item) {
      await txDone(tx);
      return null;
    }
    const updated: QueuedRawChunkItem = {
      ...item,
      attemptCount: item.attemptCount + 1,
      lastError: errorMessage,
    };
    store.put(updated);
    await txDone(tx);
    return updated;
  } finally {
    db.close();
  }
}

/** 세션 큐 비우기(테스트/강제 정리) */
export async function clearSessionRawQueue(sessionId: string): Promise<void> {
  const pending = await listPendingRawChunks(sessionId);
  if (pending.length === 0) return;
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_QUEUE, 'readwrite');
    const store = tx.objectStore(STORE_QUEUE);
    for (const item of pending) {
      store.delete(item.id);
    }
    await txDone(tx);
  } finally {
    db.close();
  }
}
