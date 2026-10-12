/**
 * SDD-026 — 영속 미확정 EEG feature 큐 (IndexedDB)
 *
 * 전송 전에 큐에 저장하고, 서버 ACK(stream/sequence + payload 일치) 시에만 삭제한다.
 * 확정 cursor·stream_id 도 함께 보존해 새로고침/훅 재생성 시 offset 0 재시작을 막는다.
 */

import type { DeviceStatus, EegFeatureItem } from '../api/session';
import type { LeadOffStatus } from '../eeg/types/eeg';

const DB_NAME = 'mindbreeze-session-live';
const DB_VERSION = 1;
const STORE_QUEUE = 'pending_features';
const STORE_CURSOR = 'stream_cursors';

export interface QueuedFeaturePayload {
  sessionId: string;
  participantId: string | null;
  streamId: string;
  sequence: number;
  feature: EegFeatureItem;
  bandBattery: number | null;
  deviceStatus: DeviceStatus | null;
  leadOff: LeadOffStatus | null;
  /** API 0~1 */
  signalQuality: number | null;
  createdAt: number;
}

export interface QueuedFeatureItem extends QueuedFeaturePayload {
  /** IndexedDB 키 — streamId:sequence */
  id: string;
}

export interface StreamCursor {
  sessionId: string;
  participantId: string | null;
  streamId: string;
  /** 다음에 사용할 sequence (= 확정·미확정 포함 최대 + 1) */
  nextSequence: number;
  /** ACK로 확정된 최대 sequence (없으면 -1) */
  confirmedSequence: number;
  updatedAt: number;
}

/** ACK 식별용 — stream/sequence + payload 일치 */
export interface FeatureAckIdentity {
  stream_id: string;
  sequence: number;
  feature?: Partial<EegFeatureItem> | null;
  second_offset?: number | null;
}

function queueItemId(streamId: string, sequence: number): string {
  return `${streamId}:${sequence}`;
}

function cursorKey(sessionId: string, participantId: string | null): string {
  return `${sessionId}:${participantId ?? 'anonymous'}`;
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
      if (!db.objectStoreNames.contains(STORE_CURSOR)) {
        db.createObjectStore(STORE_CURSOR, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open 실패'));
  });
}

function idbReq<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 요청 실패'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 트랜잭션 실패'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 트랜잭션 중단'));
  });
}

/** payload 일치 — ACK에 feature/offset이 있으면 검증, 없으면 stream+sequence만 */
export function ackMatchesItem(
  item: QueuedFeatureItem,
  ack: FeatureAckIdentity,
): boolean {
  if (item.streamId !== ack.stream_id) return false;
  if (item.sequence !== ack.sequence) return false;

  const offset =
    ack.second_offset ??
    (ack.feature && typeof ack.feature.second_offset === 'number'
      ? ack.feature.second_offset
      : null);
  if (offset != null && offset !== item.feature.second_offset) return false;

  if (ack.feature) {
    const keys: (keyof EegFeatureItem)[] = [
      'relaxation_index',
      'focus_index',
      'stress_index',
      'signal_quality',
      'timestamp',
    ];
    for (const key of keys) {
      const expected = ack.feature[key];
      if (expected == null) continue;
      if (item.feature[key] !== expected) return false;
    }
  }
  return true;
}

export function createStreamId(sessionId: string, participantId: string | null): string {
  const pid = participantId ?? 'anonymous';
  return `eeg:${sessionId}:${pid}`;
}

/**
 * 세션·참가자 커서 로드. 없으면 새 stream + sequence 0.
 */
export async function loadStreamCursor(
  sessionId: string,
  participantId: string | null,
): Promise<StreamCursor> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_CURSOR, 'readonly');
    const store = tx.objectStore(STORE_CURSOR);
    const raw = await idbReq<
      (StreamCursor & { id: string }) | undefined
    >(store.get(cursorKey(sessionId, participantId)));
    await txDone(tx);
    if (raw) {
      return {
        sessionId: raw.sessionId,
        participantId: raw.participantId,
        streamId: raw.streamId,
        nextSequence: raw.nextSequence,
        confirmedSequence: raw.confirmedSequence,
        updatedAt: raw.updatedAt,
      };
    }
  } finally {
    db.close();
  }

  return {
    sessionId,
    participantId,
    streamId: createStreamId(sessionId, participantId),
    nextSequence: 0,
    confirmedSequence: -1,
    updatedAt: Date.now(),
  };
}

export async function saveStreamCursor(cursor: StreamCursor): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_CURSOR, 'readwrite');
    const store = tx.objectStore(STORE_CURSOR);
    store.put({
      id: cursorKey(cursor.sessionId, cursor.participantId),
      ...cursor,
      updatedAt: Date.now(),
    });
    await txDone(tx);
  } finally {
    db.close();
  }
}

/**
 * feature를 큐에 적재하고 nextSequence를 갱신한다.
 * 동일 stream/sequence가 있으면 덮어쓰지 않고 기존 항목을 반환한다(멱등).
 */
export async function enqueueFeature(
  payload: QueuedFeaturePayload,
): Promise<QueuedFeatureItem> {
  const item: QueuedFeatureItem = {
    ...payload,
    id: queueItemId(payload.streamId, payload.sequence),
  };
  const db = await openDb();
  try {
    const tx = db.transaction([STORE_QUEUE, STORE_CURSOR], 'readwrite');
    const queue = tx.objectStore(STORE_QUEUE);
    const cursors = tx.objectStore(STORE_CURSOR);

    const existing = await idbReq<QueuedFeatureItem | undefined>(queue.get(item.id));
    if (!existing) {
      queue.put(item);
    }

    const key = cursorKey(payload.sessionId, payload.participantId);
    const prev = await idbReq<(StreamCursor & { id: string }) | undefined>(
      cursors.get(key),
    );
    const nextSequence = Math.max(
      (prev?.nextSequence ?? 0),
      payload.sequence + 1,
    );
    cursors.put({
      id: key,
      sessionId: payload.sessionId,
      participantId: payload.participantId,
      streamId: payload.streamId,
      nextSequence,
      confirmedSequence: prev?.confirmedSequence ?? -1,
      updatedAt: Date.now(),
    });

    await txDone(tx);
    return existing ?? item;
  } finally {
    db.close();
  }
}

export async function listPendingFeatures(
  sessionId: string,
  participantId?: string | null,
): Promise<QueuedFeatureItem[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_QUEUE, 'readonly');
    const store = tx.objectStore(STORE_QUEUE);
    const index = store.index('by_session');
    const all = await idbReq<QueuedFeatureItem[]>(index.getAll(sessionId));
    await txDone(tx);
    const filtered =
      participantId === undefined
        ? all
        : all.filter((item) => item.participantId === participantId);
    return filtered.sort((a, b) => a.sequence - b.sequence);
  } finally {
    db.close();
  }
}

export async function removeAckedFeature(
  ack: FeatureAckIdentity,
  sessionId?: string,
): Promise<QueuedFeatureItem | null> {
  const db = await openDb();
  try {
    const tx = db.transaction([STORE_QUEUE, STORE_CURSOR], 'readwrite');
    const queue = tx.objectStore(STORE_QUEUE);
    const cursors = tx.objectStore(STORE_CURSOR);

    const id = queueItemId(ack.stream_id, ack.sequence);
    const item = await idbReq<QueuedFeatureItem | undefined>(queue.get(id));
    if (!item || !ackMatchesItem(item, ack)) {
      await txDone(tx);
      return null;
    }
    if (sessionId && item.sessionId !== sessionId) {
      await txDone(tx);
      return null;
    }

    queue.delete(id);

    const key = cursorKey(item.sessionId, item.participantId);
    const prev = await idbReq<(StreamCursor & { id: string }) | undefined>(
      cursors.get(key),
    );
    if (prev) {
      cursors.put({
        ...prev,
        confirmedSequence: Math.max(prev.confirmedSequence, item.sequence),
        nextSequence: Math.max(prev.nextSequence, item.sequence + 1),
        updatedAt: Date.now(),
      });
    }

    await txDone(tx);
    return item;
  } finally {
    db.close();
  }
}

/** 세션의 미확정 큐를 모두 비운다 (테스트/강제 정리용) */
export async function clearSessionQueue(sessionId: string): Promise<void> {
  const pending = await listPendingFeatures(sessionId);
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
