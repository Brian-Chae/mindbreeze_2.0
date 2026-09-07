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
  ackEegRawChunk,
  putEegRawToPresignedUrl,
  requestEegRawPresign,
} from '../lib/api/eeg-raw';
import {
  enqueueRawChunk,
  listPendingRawChunks,
  markRawChunkAttempt,
  removeRawChunk,
  sha256Hex,
  type QueuedRawChunkItem,
} from '../lib/session-live/raw-chunk-queue';
import { createLogger } from '../lib/eeg/logger';

const logger = createLogger('useEegRawUpload');

const FLUSH_INTERVAL_MS = 4000;
const MAX_ATTEMPTS = 8;
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
    flushIntervalMs = FLUSH_INTERVAL_MS,
  } = options;

  const [pendingCount, setPendingCount] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<RawUploadStatus>('idle');
  const [lastError, setLastError] = useState<string | null>(null);

  const flushingRef = useRef(false);
  const mountedRef = useRef(true);
  const skipAuthRef = useRef(skipAuth);
  skipAuthRef.current = skipAuth;

  const refreshPendingCount = useCallback(async () => {
    try {
      const pending = await listPendingRawChunks(sessionId, participantId);
      if (mountedRef.current) setPendingCount(pending.length);
      return pending.length;
    } catch (err) {
      logger.warn('pending raw 조회 실패', err);
      return 0;
    }
  }, [sessionId, participantId]);

  const uploadOne = useCallback(
    async (item: QueuedRawChunkItem): Promise<boolean> => {
      if (item.attemptCount >= MAX_ATTEMPTS) {
        logger.warn('raw chunk 최대 재시도 초과', item.id);
        return false;
      }

      try {
        const presign = await requestEegRawPresign(
          item.sessionId,
          {
            participant_id: item.participantId,
            stream_id: item.streamId,
            chunk_index: item.chunkIndex,
            started_at: item.startedAt,
            ended_at: item.endedAt,
            sample_rate: item.sampleRate,
            channels: item.channels,
            unit: item.unit,
            schema_version: item.schemaVersion,
            checksum: item.checksum,
            byte_size: item.byteSize,
            content_type: item.contentType,
          },
          { skipAuth: skipAuthRef.current },
        );

        await putEegRawToPresignedUrl(
          presign.upload_url,
          item.payload,
          presign.headers,
        );

        await ackEegRawChunk(
          item.sessionId,
          presign.chunk_id,
          {
            checksum: item.checksum,
            byte_size: item.byteSize,
            participant_id: item.participantId,
          },
          { skipAuth: skipAuthRef.current },
        );

        await removeRawChunk(item.streamId, item.chunkIndex, item.sessionId);
        return true;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'raw 업로드 실패';
        await markRawChunkAttempt(item.streamId, item.chunkIndex, message);
        throw err;
      }
    },
    [],
  );

  const flush = useCallback(async () => {
    if (!enabled || flushingRef.current) return;
    flushingRef.current = true;
    if (mountedRef.current) setUploadStatus('uploading');

    try {
      const pending = await listPendingRawChunks(sessionId, participantId);
      if (pending.length === 0) {
        if (mountedRef.current) {
          setUploadStatus('idle');
          setPendingCount(0);
          setLastError(null);
        }
        return;
      }

      let hadFailure = false;
      let lastMsg: string | null = null;

      for (const item of pending) {
        if (item.attemptCount >= MAX_ATTEMPTS) {
          hadFailure = true;
          lastMsg = item.lastError ?? '최대 재시도 초과';
          continue;
        }
        try {
          await uploadOne(item);
        } catch (err) {
          hadFailure = true;
          lastMsg = err instanceof Error ? err.message : 'raw 업로드 실패';
          logger.warn('raw chunk 업로드 실패, 재시도 대기', item.id, lastMsg);
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
    } finally {
      flushingRef.current = false;
    }
  }, [
    enabled,
    sessionId,
    participantId,
    uploadOne,
    refreshPendingCount,
  ]);

  const enqueueChunk = useCallback(
    async (input: EnqueueRawChunkInput): Promise<QueuedRawChunkItem> => {
      const checksum =
        input.checksum ?? (await sha256Hex(input.payload));
      const item = await enqueueRawChunk({
        sessionId,
        participantId,
        streamId: input.streamId,
        chunkIndex: input.chunkIndex,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        sampleRate: input.sampleRate ?? DEFAULT_SAMPLE_RATE,
        channels: input.channels ?? [...DEFAULT_CHANNELS],
        unit: input.unit ?? DEFAULT_UNIT,
        schemaVersion: input.schemaVersion ?? DEFAULT_SCHEMA,
        checksum,
        byteSize: input.payload.byteLength,
        contentType: input.contentType ?? DEFAULT_CONTENT_TYPE,
        payload: input.payload,
      });
      await refreshPendingCount();
      // 다음 틱에 flush — 호출 스택과 분리
      queueMicrotask(() => {
        void flush();
      });
      return item;
    },
    [sessionId, participantId, refreshPendingCount, flush],
  );

  const drain = useCallback(
    async (maxMs = 15_000): Promise<boolean> => {
      if (!enabled) return true;
      if (mountedRef.current) setUploadStatus('draining');
      const deadline = Date.now() + maxMs;

      while (Date.now() < deadline) {
        await flush();
        const remaining = await listPendingRawChunks(sessionId, participantId);
        const retryable = remaining.filter((i) => i.attemptCount < MAX_ATTEMPTS);
        if (retryable.length === 0) {
          if (mountedRef.current) {
            setPendingCount(remaining.length);
            setUploadStatus(remaining.length === 0 ? 'idle' : 'failed');
          }
          return remaining.length === 0;
        }
        await sleep(300);
      }

      const left = await refreshPendingCount();
      if (mountedRef.current) {
        setUploadStatus(left === 0 ? 'idle' : 'delayed');
      }
      return left === 0;
    },
    [enabled, flush, sessionId, participantId, refreshPendingCount],
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

  return {
    pendingCount,
    uploadStatus,
    lastError,
    enqueueChunk,
    flush,
    drain,
  };
}
