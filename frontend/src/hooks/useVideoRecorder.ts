// SDD-084 — MediaRecorder(video/webm) 래퍼: 5초 청크 업로드 + 전면/후면 카메라 전환
// useAudioRecorder 패턴 복제. 상담사 본인 카메라만 녹화한다(내담자 영상 저장 금지).

import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadVideoChunk } from '../lib/api/video';

const CHUNK_DURATION_MS = 5000;

export type VideoRecorderState = 'idle' | 'recording' | 'paused' | 'stopped' | 'error';
export type FacingMode = 'user' | 'environment';

export interface UseVideoRecorderOptions {
  sessionId: string;
  onError?: (err: Error) => void;
}

export function useVideoRecorder({ sessionId, onError }: UseVideoRecorderOptions) {
  const [state, setState] = useState<VideoRecorderState>('idle');
  const [uploadedChunks, setUploadedChunks] = useState(0);
  const [facingMode, setFacingMode] = useState<FacingMode>('user');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const indexRef = useRef(0);
  const pendingRef = useRef<Blob[]>([]);
  // 종료 시 잔여 청크 유실 방지 — 진행 중 업로드를 stop()에서 대기한다
  const inflightRef = useRef<Set<Promise<void>>>(new Set());

  const cleanup = useCallback(() => {
    recorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  /** 현재 스트림으로 MediaRecorder 를 만들어 청크 녹화를 시작 (chunk index는 이어감) */
  const startRecorder = useCallback(
    (stream: MediaStream) => {
      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
        ? 'video/webm;codecs=vp8,opus'
        : 'video/webm';
      const rec = new MediaRecorder(stream, { mimeType: mime });
      recorderRef.current = rec;

      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          const idx = indexRef.current++;
          const task = uploadVideoChunk(sessionId, idx, ev.data)
            .then(() => {
              setUploadedChunks((n) => n + 1);
            })
            .catch((err) => {
              // 네트워크 실패 시 로컬 버퍼링 (audio와 동일 정책)
              pendingRef.current.push(ev.data);
              onError?.(err as Error);
            });
          inflightRef.current.add(task);
          void task.finally(() => inflightRef.current.delete(task));
        }
      };

      rec.onerror = (e) => {
        setState('error');
        onError?.(new Error(String((e as ErrorEvent).message ?? '영상 녹화 오류')));
      };

      rec.start(CHUNK_DURATION_MS);
    },
    [sessionId, onError],
  );

  const openStream = useCallback(async (mode: FacingMode): Promise<MediaStream> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('이 브라우저는 카메라 녹화를 지원하지 않습니다 (Chrome/Edge 권장)');
    }
    // facingMode 는 ideal 취급 — 후면 카메라가 없는 데스크톱에서도 실패하지 않음
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: mode }, audio: true });
  }, []);

  const start = useCallback(async () => {
    if (state === 'recording') return;
    try {
      const stream = await openStream(facingMode);
      streamRef.current = stream;
      startRecorder(stream);
      setState('recording');
    } catch (err) {
      setState('error');
      onError?.(err as Error);
    }
  }, [state, facingMode, openStream, startRecorder, onError]);

  /** 현재 recorder 를 멈추고 마지막 청크 flush 를 기다린다 */
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

  /** 전면/후면 카메라 전환 — 녹화 중이면 스트림을 교체하고 청크 index를 이어서 녹화 */
  const switchCamera = useCallback(async () => {
    const nextMode: FacingMode = facingMode === 'user' ? 'environment' : 'user';
    if (state !== 'recording' && state !== 'paused') {
      setFacingMode(nextMode);
      return;
    }
    try {
      await stopRecorder();
      cleanup();
      const stream = await openStream(nextMode);
      streamRef.current = stream;
      startRecorder(stream);
      setFacingMode(nextMode);
      setState('recording');
    } catch (err) {
      setState('error');
      onError?.(err as Error);
    }
  }, [facingMode, state, stopRecorder, cleanup, openStream, startRecorder, onError]);

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

  /** 녹화 종료 — 마지막 청크 업로드까지 대기 후 완료 (서버 stop 호출 전 사용) */
  const stop = useCallback(async () => {
    await stopRecorder();
    cleanup();
    await Promise.allSettled([...inflightRef.current]);
    setState('stopped');
  }, [stopRecorder, cleanup]);

  return { state, facingMode, start, pause, resume, stop, switchCamera, uploadedChunks };
}
