/**
 * useEegRawUpload — SDD-027 raw chunk 업로드 훅
 *
 * 로컬 영속 큐(IndexedDB) → presigned PUT → ack → 삭제.
 * SDD-026 feature-queue 패턴 + 재시도. 게스트 skipAuth 지원.
 *
 * useBand 라이브 경로에 강제 연결하지 않음(회귀 방지).
 * SDK/호출부가 enqueueChunk로 raw를 넘기면 flush가 업로드한다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ackEegRawChunks,
  putEegRawToPresignedUrl,
  requestEegRawPresign,
} from '../lib/api/eeg-raw';
import { ackEntryEegRawChunks, requestEntryEegRawPresign } from '../lib/api/class-flow';
import {
  enqueueRawChunk,
  listPendingRawChunks,
  markRawChunkAttempt,
  removeRawChunk,
  sha256Hex,
  type QueuedRawChunkItem,
} from '../lib/session-live/raw-chunk-queue';
import { createLogger } from '../lib/eeg/logger';
import { RESUME_ORDER } from '../lib/native/app-lifecycle';
import { PAUSE_ORDER, useAppLifecycle } from './useAppResume';
import { ApiError } from '../lib/api/client';
import { useAuthStore } from '../stores/authStore';

const logger = createLogger('useEegRawUpload');

const FLUSH_INTERVAL_MS = 4000;
const MAX_ATTEMPTS = 8;
// IndexedDB 장애 때도 프로세스 내 재마운트에서 유일한 사본을 복구한다.
const memoryPending = new Map<string, { input: EnqueueRawChunkInput; sessionId: string; participantId: string | null; ownerId: string | null; promise?: Promise<QueuedRawChunkItem> }>();

async function persistMemory(key: string): Promise<QueuedRawChunkItem> {
  const entry = memoryPending.get(key)!;
  if (entry.promise) return entry.promise;
  const { input, sessionId, participantId, ownerId } = entry;
  entry.promise = (async () => {
    const item = await enqueueRawChunk({
      sessionId, participantId, ownerId, ...input,
      checksum: input.checksum ?? await sha256Hex(input.payload),
      sampleRate: input.sampleRate ?? DEFAULT_SAMPLE_RATE,
      channels: input.channels ?? [...DEFAULT_CHANNELS],
      unit: input.unit ?? DEFAULT_UNIT, schemaVersion: input.schemaVersion ?? DEFAULT_SCHEMA,
      contentType: input.contentType ?? DEFAULT_CONTENT_TYPE, byteSize: input.payload.byteLength,
    });
    memoryPending.delete(key);
    return item;
  })();
  try { return await entry.promise; } finally { entry.promise = undefined; }
}
const DEFAULT_CHANNELS = ['fp1', 'fp2'] as const;
const DEFAULT_UNIT = 'uV';
const DEFAULT_SCHEMA = 'eeg-raw-v1';
const DEFAULT_SAMPLE_RATE = 250;
const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

export type RawUploadStatus =
  | 'idle'
  | 'uploading'
  | 'delayed'
  | 'failed'
  | 'draining';

export interface EnqueueRawChunkInput {
  streamId: string;
  chunkIndex: number;
  /** ISO 시작 시각 */
  startedAt: string;
  /** ISO 종료 시각 */
  endedAt: string;
  /** raw 바이트 */
  payload: ArrayBuffer;
  sampleRate?: number;
  channels?: string[];
  unit?: string;
  schemaVersion?: string;
  contentType?: string;
  /** 사전 계산 체크섬(없으면 SHA-256) */
  checksum?: string;
}

export interface UseEegRawUploadOptions {
  sessionId: string;
  participantId: string | null;
  enabled?: boolean;
  /** 게스트 등 비인증 업로드 */
  skipAuth?: boolean;
  /** SDD-209: 입장 자격(X-Entry-Credential)으로 소유를 증명하는 업로드. 없으면 현행 동작 */
  entryCredential?: string | null;
  /** flush 주기(ms). 0이면 수동 flush만 */
  flushIntervalMs?: number;
}

export interface UseEegRawUploadResult {
  pendingCount: number;
  uploadStatus: RawUploadStatus;
  lastError: string | null;
  /** raw chunk를 큐에 넣고(선택) 즉시 flush 예약 */
  enqueueChunk: (input: EnqueueRawChunkInput) => Promise<QueuedRawChunkItem>;
  /** 대기 큐 업로드 시도 */
  flush: () => Promise<void>;
  /** 종료 시 남은 큐 drain(최대 maxMs) */
  drain: (maxMs?: number) => Promise<boolean>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function useEegRawUpload(
  options: UseEegRawUploadOptions,
): UseEegRawUploadResult {
  const {
    sessionId,
    participantId,
    enabled = true,
    skipAuth = false,
    entryCredential = null,
    flushIntervalMs = FLUSH_INTERVAL_MS,
  } = options;

  const userId = useAuthStore((state) => state.user?.id ?? null);
  const ownerId = !skipAuth && !entryCredential ? userId : null;
  const scopeRef = useRef({ sessionId, participantId, ownerId, skipAuth, entryCredential });
  scopeRef.current = { sessionId, participantId, ownerId, skipAuth, entryCredential };
  const matchesMemory = useCallback((entry: { sessionId: string; participantId: string | null; ownerId: string | null }) => ownerId ? entry.ownerId === ownerId : !entry.ownerId && entry.sessionId === sessionId && entry.participantId === participantId, [ownerId, sessionId, participantId]);

  const [pendingCount, setPendingCount] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<RawUploadStatus>('idle');
  const [lastError, setLastError] = useState<string | null>(null);

  const flushingRef = useRef(false);
  const mountedRef = useRef(true);

  const refreshPendingCount = useCallback(async () => {
    try {
      const pending = await listPendingRawChunks(sessionId, participantId, ownerId);
      const count = pending.length + [...memoryPending.values()].filter(matchesMemory).length;
      if (mountedRef.current) setPendingCount(count);
      return count;
    } catch (err) {
      logger.warn('pending raw 조회 실패', err);
      // 조회 불가는 비어 있다는 증거가 아니다. drain 성공으로 오인하지 않는다.
      const count = Math.max(1, [...memoryPending.values()].filter(matchesMemory).length);
      if (mountedRef.current) { setPendingCount(count); setUploadStatus('failed'); }
      return count;
    }
  }, [sessionId, participantId, ownerId, matchesMemory]);

  const uploadOne = useCallback(
    async (item: QueuedRawChunkItem): Promise<boolean> => {
      const scope = scopeRef.current;
      const assertScope = () => {
        const current = scopeRef.current;
        const ownsItem = item.ownerId ? item.ownerId === scope.ownerId : item.sessionId === scope.sessionId && item.participantId === scope.participantId;
        if (!ownsItem) throw new Error('raw 청크 소유 범위가 다릅니다');
        if (current.ownerId !== scope.ownerId || current.entryCredential !== scope.entryCredential || current.skipAuth !== scope.skipAuth || current.sessionId !== scope.sessionId || current.participantId !== scope.participantId || (!scope.skipAuth && !scope.entryCredential && (useAuthStore.getState().user?.id ?? null) !== scope.ownerId)) throw new Error('raw 업로드 소유 자격이 변경되었습니다');
      };
      let uploadingToStorage = false;
      try {
        assertScope();
        const presignBody = {
            participant_id: item.participantId,
            chunks: [
              {
                stream_id: item.streamId,
                chunk_index: item.chunkIndex,
                start_ms: item.startedAt ? new Date(item.startedAt).getTime() : null,
                end_ms: item.endedAt ? new Date(item.endedAt).getTime() : null,
                sample_rate: item.sampleRate,
                channel_count: item.channels.length,
                unit: item.unit,
                schema_version: item.schemaVersion,
                checksum: item.checksum,
                size_bytes: item.byteSize,
                content_type: item.contentType,
              },
            ],
          };
        const presign = scope.entryCredential
          ? await requestEntryEegRawPresign(item.sessionId, scope.entryCredential, presignBody)
          : await requestEegRawPresign(item.sessionId, presignBody, { skipAuth: scope.skipAuth });

        const chunk = presign.chunks[0];
        if (!chunk || chunk.stream_id !== item.streamId || chunk.chunk_index !== item.chunkIndex) {
          throw new Error('raw presign 응답이 요청한 청크와 일치하지 않습니다');
        }

        assertScope();
        // 저장소 서명 만료 등은 새 presign으로 복구할 수 있으므로 재시도를 유지한다.
        uploadingToStorage = true;
        await putEegRawToPresignedUrl(chunk.upload_url, item.payload);
        uploadingToStorage = false;

        const ackBody = {
            participant_id: item.participantId,
            chunks: [
              {
                chunk_id: chunk.chunk_id,
                checksum: item.checksum,
                size_bytes: item.byteSize,
              },
            ],
          };
        assertScope();
        const ack = scope.entryCredential
          ? await ackEntryEegRawChunks(item.sessionId, scope.entryCredential, ackBody)
          : await ackEegRawChunks(item.sessionId, ackBody, { skipAuth: scope.skipAuth });
        assertScope();
        const results = Array.isArray(ack?.chunks)
          ? ack.chunks.filter((result) => result?.chunk_id === chunk.chunk_id)
          : [];
        const confirmed = ack?.session_id === item.sessionId && results.length === 1
          && results[0].upload_status === 'uploaded'
          && results[0].checksum === item.checksum && results[0].size_bytes === item.byteSize;
        if (!confirmed) throw new Error('서버가 해당 raw 청크 저장을 확인하지 않았습니다');
        await removeRawChunk(item.streamId, item.chunkIndex, item.sessionId);
        return true;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'raw 업로드 실패';
        const permanent = !uploadingToStorage && err instanceof ApiError && [400, 403, 404, 409, 413, 422].includes(err.status);
        await markRawChunkAttempt(item.streamId, item.chunkIndex, message, permanent);
        throw err;
      }
    },
    [],
  );

  const flush = useCallback(async () => {
    if (!enabled || flushingRef.current) return;
    // SDD-222 Q3: 오프라인(비행기 모드 등)에서는 업로드를 시도하지 않는다.
    // 오프라인 동안 불필요한 실패 횟수를 늘리지 않고 사본을 보존한다.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      if (mountedRef.current) setUploadStatus('delayed');
      return;
    }
    flushingRef.current = true;
    if (mountedRef.current) setUploadStatus('uploading');

    try {
      let hadFailure = false;
      let lastMsg: string | null = null;
      for (const [key, entry] of memoryPending) {
        if (!matchesMemory(entry)) continue;
        try { await persistMemory(key); } catch (error) {
          hadFailure = true;
          lastMsg = error instanceof Error ? error.message : 'raw 로컬 적재 실패';
        }
      }
      const pending = await listPendingRawChunks(sessionId, participantId, ownerId);
      for (const item of pending) {
        if ((item.retryAfter ?? 0) > Date.now()) continue;
        try { await uploadOne(item); } catch (err) {
          hadFailure = true;
          lastMsg = err instanceof Error ? err.message : 'raw 업로드 실패';
          logger.warn('raw chunk 업로드 실패, 사본 보존', item.id, lastMsg);
        }
      }

      const remaining = await refreshPendingCount();
      if (!mountedRef.current) return;

      if (remaining === 0) {
        setUploadStatus('idle');
        setLastError(null);
      } else if (hadFailure) {
        setUploadStatus(
          pending.some((p) => p.attemptCount + 1 >= MAX_ATTEMPTS)
            ? 'failed'
            : 'delayed',
        );
        setLastError(lastMsg);
      } else {
        setUploadStatus('delayed');
      }
    } catch (error) {
      logger.warn('raw 영속 큐 접근 실패 — 메모리 사본 유지', error);
      if (mountedRef.current) {
        setUploadStatus('failed');
        setLastError(error instanceof Error ? error.message : 'raw 영속 큐 접근 실패');
      }
    } finally {
      flushingRef.current = false;
    }
  }, [
    enabled,
    sessionId,
    participantId,
    uploadOne,
    refreshPendingCount,
    ownerId,
    matchesMemory,
  ]);

  const enqueueChunk = useCallback(
    async (input: EnqueueRawChunkInput): Promise<QueuedRawChunkItem> => {
      const key = `${sessionId}:${participantId}:${input.streamId}:${input.chunkIndex}`;
      const existing = memoryPending.get(key);
      if (existing && (existing.ownerId !== ownerId || existing.input.payload.byteLength !== input.payload.byteLength || !new Uint8Array(existing.input.payload).every((byte, index) => byte === new Uint8Array(input.payload)[index]))) throw new Error('메모리 raw 청크 키 충돌');
      if (!existing) memoryPending.set(key, { input, sessionId, participantId, ownerId });
      const item = await persistMemory(key);
      await refreshPendingCount();
      // 다음 틱에 flush — 호출 스택과 분리
      queueMicrotask(() => {
        void flush();
      });
      return item;
    },
    [sessionId, participantId, ownerId, refreshPendingCount, flush],
  );

  const drain = useCallback(
    async (maxMs = 15_000): Promise<boolean> => {
      if (!enabled) return true;
      if (mountedRef.current) setUploadStatus('draining');
      const deadline = Date.now() + maxMs;

      while (Date.now() < deadline) {
        await flush();
        let remaining: QueuedRawChunkItem[];
        try { remaining = await listPendingRawChunks(sessionId, participantId, ownerId); }
        catch { await refreshPendingCount(); return false; }
        const retryable = remaining.filter((i) => (i.retryAfter ?? 0) <= Date.now());
        if (retryable.length === 0) {
          const count = await refreshPendingCount();
          if (mountedRef.current) setUploadStatus(count === 0 ? 'idle' : 'failed');
          return count === 0;
        }
        await sleep(300);
      }

      const left = await refreshPendingCount();
      if (mountedRef.current) {
        setUploadStatus(left === 0 ? 'idle' : 'delayed');
      }
      return left === 0;
    },
    [enabled, flush, sessionId, participantId, ownerId, refreshPendingCount],
  );

  // 마운트 시 미전송 복구 + 주기 flush
  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) return undefined;

    void refreshPendingCount().then((count) => {
      if (count > 0) void flush();
    });

    if (flushIntervalMs <= 0) {
      return () => {
        mountedRef.current = false;
      };
    }

    const timer = window.setInterval(() => {
      void flush();
    }, flushIntervalMs);

    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
    };
  }, [enabled, flushIntervalMs, refreshPendingCount, flush]);

  // SDD-222 G1·G6: 앱 복귀 즉시 flush(주기 타이머는 백그라운드에서 스로틀·정지됨),
  // 백그라운드 전환 직전에도 한 번 시도한다. 중복 호출은 flushingRef 가드가 막는다.
  useAppLifecycle({
    onResume: () => flush(),
    onPause: () => flush(),
    order: RESUME_ORDER.rawFlush,
    pauseOrder: PAUSE_ORDER.rawFlush,
  });

  return {
    pendingCount,
    uploadStatus,
    lastError,
    enqueueChunk,
    flush,
    drain,
  };
}
