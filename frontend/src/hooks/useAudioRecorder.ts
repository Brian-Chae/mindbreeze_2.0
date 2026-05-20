// MediaRecorder API 래퍼 — 5초 청크로 분할해 서버에 업로드

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
  const pendingRef = useRef<Blob[]>([]);

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

      rec.ondataavailable = async (ev) => {
        if (ev.data && ev.data.size > 0) {
          const idx = indexRef.current++;
          try {
            await uploadChunk(sessionId, idx, ev.data);
            setUploadedChunks((n) => n + 1);
          } catch (err) {
            // 네트워크 실패 시 로컬 버퍼링
            pendingRef.current.push(ev.data);
            onError?.(err as Error);
          }
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

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    cleanup();
    setState('stopped');
  }, [cleanup]);

  return { state, start, pause, resume, stop, uploadedChunks };
}
