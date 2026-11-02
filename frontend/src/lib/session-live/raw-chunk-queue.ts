/**
 * SDD-027 — EEG raw chunk 영속 큐 (IndexedDB)
 *
 * SDD-026 feature-queue 패턴 재사용:
 * 전송 전 큐 적재 → presigned PUT·ack 성공 시에만 삭제.
 * 게스트(participantId) raw 지원. 재시도 카운트 보존.
 */

import { openRawDb } from '../biosignal/queue-db';
const STORE_QUEUE = 'pending_raw_chunks';
// SDD-276: 레거시(v1) 뇌파 청크는 ack 되면 큐에서 지워지므로, "만든 청크 수"를 별도 카운터로 남긴다(폰 보고 기대량용).
// 기존 next_indices 스토어를 재사용하고(스키마 버전 불변) 키 접두사로 구분한다.
const STORE_COUNTER = 'next_indices';
const legacyCountKey = (sessionId: string, participantId: string | null): string => `legacy-raw|${sessionId}|${participantId ?? '-'}`;
const MAX_QUEUE_BYTES = 64 * 1024 * 1024;
const QUARANTINE_MS = 60_000;
const LOSS_LOG_KEY = 'mindbreeze:eeg-raw-loss-events';

/** raw·자격 증명 없이 진단을 영속 기록한다. 기록 불가 시 용량 삭제도 중단한다. */
function recordLoss(item: QueuedRawChunkItem, reason: 'capacity_eviction' | 'upload_unavailable'): void {
  const event = { at: Date.now(), chunkId: item.id, bytes: item.byteSize, reason };
  const previous: unknown = JSON.parse(localStorage.getItem(LOSS_LOG_KEY) ?? '[]');
  const events = Array.isArray(previous) ? previous.slice(-999) : [];
  localStorage.setItem(LOSS_LOG_KEY, JSON.stringify([...events, event]));
  console.error('[eeg-raw] 원데이터 손실/업로드 불가', event);
}

/** 큐에 넣는 raw chunk 메타 + payload */
export interface QueuedRawChunkPayload {
  sessionId: string;
  ownerId?: string | null;
  state?: 'pending' | 'quarantine';
  retryAfter?: number;
  permanentFailureCount?: number;
  unavailableRecorded?: boolean;
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

const openDb = openRawDb;

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
    const tx = db.transaction([STORE_QUEUE, STORE_COUNTER], 'readwrite');
    const store = tx.objectStore(STORE_QUEUE);
    const existing = await idbReq<QueuedRawChunkItem | undefined>(
      store.get(item.id),
    );
    if (existing && (existing.sessionId !== item.sessionId || existing.participantId !== item.participantId || existing.ownerId !== item.ownerId || existing.checksum !== item.checksum || existing.byteSize !== item.byteSize || !new Uint8Array(existing.payload).every((byte, index) => byte === new Uint8Array(item.payload)[index]))) {
      throw new Error('raw 청크 키 충돌: 기존 사본을 보존합니다');
    }
    if (!existing) {
      const all = await idbReq<QueuedRawChunkItem[]>(store.getAll());
      const candidates = [...all, item].sort((a, b) => a.createdAt - b.createdAt);
      let bytes = candidates.reduce((sum, candidate) => sum + candidate.byteSize, 0);
      const evicted = new Set<string>();
      for (const candidate of candidates) {
        if (bytes <= MAX_QUEUE_BYTES) break;
        recordLoss(candidate, 'capacity_eviction');
        evicted.add(candidate.id);
        bytes -= candidate.byteSize;
      }
      // 로그 기록까지 모두 성공해야 단일 IDB 트랜잭션에서 큐를 변경한다.
      for (const id of evicted) store.delete(id);
      if (!evicted.has(item.id)) store.put(item);
      // SDD-276: 새로 만들어진 청크만 센다(같은 청크 재적재는 existing 으로 여기 오지 않는다). 용량 초과로 밀려난 청크도 만들어진 것이므로 센다.
      const counters = tx.objectStore(STORE_COUNTER);
      const key = legacyCountKey(item.sessionId, item.participantId);
      const row = await idbReq<{ id: string; count: number } | undefined>(counters.get(key));
      counters.put({ id: key, count: (row?.count ?? 0) + 1 });
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
  ownerId?: string | null,
): Promise<QueuedRawChunkItem[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_QUEUE, 'readonly');
    const store = tx.objectStore(STORE_QUEUE);
    const all = await idbReq<QueuedRawChunkItem[]>(store.getAll());
    await txDone(tx);
    const filtered =
      all.filter((item) => {
        if (ownerId && item.ownerId === ownerId) return true;
        if (item.ownerId && item.ownerId !== ownerId && participantId !== undefined) return false;
        return item.sessionId === sessionId && (participantId === undefined || item.participantId === participantId);
      });
    return filtered.sort((a, b) => a.chunkIndex - b.chunkIndex);
  } finally {
    db.close();
  }
}

/** SDD-276: 이 회차·참가자가 지금까지 레거시(v1) 경로로 만든 뇌파 청크 수(ack 로 지워져도 유지). 읽기 실패는 0. */
export async function readLegacyRawCount(sessionId: string, participantId: string | null): Promise<number> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_COUNTER, 'readonly');
    const row = await idbReq<{ count?: number } | undefined>(tx.objectStore(STORE_COUNTER).get(legacyCountKey(sessionId, participantId)));
    return typeof row?.count === 'number' && row.count > 0 ? row.count : 0;
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
  permanent = false,
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
    const permanentCount = (item.permanentFailureCount ?? 0) + (permanent ? 1 : 0);
    updated.permanentFailureCount = permanentCount;
    if (permanent || updated.attemptCount >= 8) {
      updated.state = 'quarantine';
      updated.retryAfter = Date.now() + QUARANTINE_MS;
    }
    if (permanentCount >= 3 && !item.unavailableRecorded) {
      try {
        recordLoss(updated, 'upload_unavailable');
        updated.unavailableRecorded = true;
      } catch (error) {
        console.error('[eeg-raw] 업로드 불가 진단 저장 실패; payload는 유지합니다', error);
      }
    }
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
