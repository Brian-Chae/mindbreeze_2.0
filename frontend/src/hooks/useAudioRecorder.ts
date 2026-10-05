// MediaRecorder API 래퍼 — 5초 청크로 분할해 서버에 업로드
// SDD-137: useVideoRecorder 와 동일하게 종료 시 flush 대기 + 실패 청크 재전송

import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadChunk } from '../lib/api/audio';

const CHUNK_DURATION_MS = 5000;

export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped' | 'error';

export interface UseAudioRecorderOptions {
  sessionId: string;
  onError?: (err: Error) => void;
}

export function useAudioRecorder({ sessionId, onError }: UseAudioRecorderOptions) {
  const [state, setState] = useState<RecorderState>('idle');
  const [uploadedChunks, setUploadedChunks] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const indexRef = useRef(0);
  // SDD-137: 업로드 실패 청크를 {index, blob} 으로 보관 — 종료 시 원래 인덱스로 재전송
  const pendingRef = useRef<Array<{ index: number; blob: Blob }>>([]);
  // SDD-137: 진행 중 업로드를 stop()에서 대기 — 마지막 청크 유실 방지
  const inflightRef = useRef<Set<Promise<void>>>(new Set());

  const cleanup = useCallback(() => {
    recorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const start = useCallback(async () => {
    if (state === 'recording') return;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('이 브라우저는 마이크 녹음을 지원하지 않습니다');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const rec = new MediaRecorder(stream, { mimeType: mime });
      recorderRef.current = rec;

      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          const idx = indexRef.current++;
          const task = uploadChunk(sessionId, idx, ev.data)
            .then(() => {
              setUploadedChunks((n) => n + 1);
            })
            .catch((err) => {
              // SDD-137: 네트워크 실패 시 인덱스와 함께 로컬 버퍼링 — 종료 시 재전송
              pendingRef.current.push({ index: idx, blob: ev.data });
              onError?.(err as Error);
            });
          inflightRef.current.add(task);
          void task.finally(() => inflightRef.current.delete(task));
        }
      };

      rec.onerror = (e) => {
        setState('error');
        onError?.(new Error(String((e as ErrorEvent).message ?? '녹음 오류')));
      };

      rec.start(CHUNK_DURATION_MS);
      setState('recording');
    } catch (err) {
      setState('error');
      onError?.(err as Error);
    }
  }, [sessionId, state, onError]);

  const pause = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.pause();
      setState('paused');
    }
  }, []);

  const resume = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state === 'paused') {
      recorderRef.current.resume();
      setState('recording');
    }
  }, []);

  // SDD-137: recorder 를 멈추고 마지막 청크 flush 를 기다린다
  const stopRecorder = useCallback(
    () =>
      new Promise<void>((resolve) => {
        const rec = recorderRef.current;
        if (!rec || rec.state === 'inactive') {
          resolve();
          return;
        }
        rec.onstop = () => resolve();
        rec.stop();
      }),
    [],
  );

  // SDD-137: 업로드 실패로 pendingRef 에 쌓인 청크를 원래 인덱스로 재전송
  const retryPendingChunks = useCallback(() => {
    const pending = pendingRef.current.splice(0);
    for (const { index, blob } of pending) {
      const task = uploadChunk(sessionId, index, blob)
        .then(() => {
          setUploadedChunks((n) => n + 1);
        })
        .catch(() => {
          pendingRef.current.push({ index, blob });
        });
      inflightRef.current.add(task);
      void task.finally(() => inflightRef.current.delete(task));
    }
  }, [sessionId]);

  // SDD-137: 종료 — 마지막 청크 업로드까지 대기 후 완료 (서버 stop 호출 전 사용)
  const stop = useCallback(async () => {
    await stopRecorder();
    cleanup();
    retryPendingChunks();
    await Promise.allSettled([...inflightRef.current]);
    setState('stopped');
  }, [stopRecorder, cleanup, retryPendingChunks]);

  return { state, start, pause, resume, stop, uploadedChunks };
}
