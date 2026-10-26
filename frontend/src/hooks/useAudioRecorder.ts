import { useMobileSwipeProtection } from './use-mobile-swipe-protection';
// MediaRecorder API 래퍼 — 5초 청크로 분할해 서버에 업로드
// SDD-137: useVideoRecorder 와 동일하게 종료 시 flush 대기 + 실패 청크 재전송

import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadChunk } from '../lib/api/audio';
import { RESUME_ORDER, subscribeAppResume } from '../lib/native/app-lifecycle';
import { BASE_URL, getNativeRefreshBody, tokenStorage } from '../lib/api/client';
import {
  NATIVE_AUDIO_CHUNK_MS,
  resolveNativeAudioRecorder,
  type NativeAudioEvent,
  type NativeAudioListenerHandle,
  type NativeAudioRecorderPlugin,
  type NativeRecorderState,
} from '../lib/native-audio-recorder';

const CHUNK_DURATION_MS = 5000;

export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped' | 'error';

export interface UseAudioRecorderOptions {
  sessionId: string;
  onError?: (err: Error) => void;
}

// SDD-247: 네이티브 상태 → 훅 상태(micOff 는 UI 상 일시정지로 본다)
function mapNativeState(s: NativeRecorderState): RecorderState | null {
  switch (s) {
    case 'recording': return 'recording';
    case 'paused':
    case 'micOff': return 'paused';
    case 'stopped': return 'stopped';
    case 'error': return 'error';
    case 'idle': return 'idle';
    default: return null; // stopping 은 stop() 이 마무리한다
  }
}

/** 현재 토큰 쌍 — 하나라도 없으면 null (토큰 값은 로그로 남기지 않는다) */
function currentCredentials(): { accessToken: string; refreshToken: string } | null {
  const accessToken = tokenStorage.getAccess();
  const refreshToken = getNativeRefreshBody()?.refresh_token;
  return accessToken && refreshToken ? { accessToken, refreshToken } : null;
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
  // SDD-247: 네이티브 녹음 경로 상태 — 활성 플러그인, 이벤트 리스너, 토큰 재인계 필요 여부
  const nativeRef = useRef<NativeAudioRecorderPlugin | null>(null);
  const nativeHandlesRef = useRef<NativeAudioListenerHandle[]>([]);
  const authExpiredRef = useRef(false);
  useMobileSwipeProtection(() => state === 'recording' || state === 'paused' || inflightRef.current.size > 0);

  const cleanup = useCallback(() => {
    recorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const removeNativeListeners = useCallback(() => {
    const handles = nativeHandlesRef.current;
    nativeHandlesRef.current = [];
    for (const h of handles) void h.remove().catch(() => undefined);
  }, []);

  useEffect(
    () => () => {
      cleanup();
      // 언마운트 시 네이티브 마이크가 계속 켜져 있지 않도록 정리(리스너 해제 + best-effort 정지)
      const plugin = nativeRef.current;
      nativeRef.current = null;
      removeNativeListeners();
      if (plugin) void plugin.stop().catch(() => undefined);
    },
    [cleanup, removeNativeListeners],
  );

  const handleNativeEvent = useCallback(
    (ev: NativeAudioEvent) => {
      if (ev.event === 'chunkUploaded') {
        setUploadedChunks(ev.uploadedCount);
      } else if (ev.event === 'stateChanged') {
        const next = mapNativeState(ev.state);
        if (next) setState(next);
      } else if (ev.event === 'error') {
        if (ev.code === 'auth_expired') authExpiredRef.current = true;
        if (!ev.recoverable) setState('error');
        onError?.(new Error(`네이티브 녹음 오류(${ev.code}): ${ev.message}`));
      }
    },
    [onError],
  );

  // 네이티브 녹음 시작 — 성공하면 true. 토큰이 없거나 플러그인을 못 쓰면 false(기존 경로 폴백).
  const startNative = useCallback(async (): Promise<boolean> => {
    const plugin = await resolveNativeAudioRecorder();
    if (!plugin) return false;
    const creds = currentCredentials();
    if (!creds) return false;
    authExpiredRef.current = false;
    const handles = await Promise.all(
      (['chunkUploaded', 'stateChanged', 'error'] as const).map((name) => plugin.addListener(name, handleNativeEvent)),
    );
    nativeHandlesRef.current = handles;
    try {
      await plugin.start({
        sessionId,
        apiBase: BASE_URL,
        accessToken: creds.accessToken,
        refreshToken: creds.refreshToken,
        chunkMs: NATIVE_AUDIO_CHUNK_MS,
        startChunkIndex: indexRef.current,
      });
    } catch (err) {
      removeNativeListeners();
      throw err; // permission_denied 등은 MediaRecorder 로 폴백하지 않고 사용자에게 알린다
    }
    nativeRef.current = plugin;
    return true;
  }, [sessionId, handleNativeEvent, removeNativeListeners]);

  // 스트림 + MediaRecorder 를 새로 만들어 청크 업로드에 연결한다(시작·복귀 복구 공용). 인덱스는 이어간다.
  const attachRecorder = useCallback(async () => {
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
  }, [sessionId, onError]);

  const start = useCallback(async () => {
    // MB2-10: idle/stopped/error 에서만 시작을 허용한다. recording/paused 등
    // 진행 중 상태에서 재진입하면 기존 recorder·stream 을 정리하지 않고 ref 를
    // 덮어써 중복 스트림이 새므로 차단한다.
    if (state !== 'idle' && state !== 'stopped' && state !== 'error') return;
    // error 등으로 남아 있을 수 있는 이전 recorder/stream 을 먼저 정리한다.
    cleanup();
    try {
      if (await startNative()) {
        setState('recording');
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('이 브라우저는 마이크 녹음을 지원하지 않습니다');
      }
      await attachRecorder();
      setState('recording');
    } catch (err) {
      setState('error');
      onError?.(err as Error);
    }
  }, [state, cleanup, attachRecorder, startNative, onError]);

  // 백그라운드 복구: iOS 인터럽션·OS 회수로 마이크 track 이 끝났거나 recorder 가 멈췄으면 새로 이어서 녹음한다.
  // 녹음 중(recording)일 때만 동작 — 마이크 오프·정지·일시정지 상태는 건드리지 않는다.
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(
    () =>
      subscribeAppResume(async () => {
        // SDD-247: 네이티브 경로는 MediaRecorder 복구 대신 상태 동기화 + 필요 시 토큰 재인계
        const native = nativeRef.current;
        if (native) {
          try {
            if (authExpiredRef.current) {
              const creds = currentCredentials();
              if (creds) {
                await native.updateCredentials(creds);
                authExpiredRef.current = false;
              }
            }
            const status = await native.getStatus();
            const next = mapNativeState(status.state);
            if (next) setState(next);
            setUploadedChunks(status.uploadedCount);
          } catch (err) {
            onError?.(err as Error);
          }
          return;
        }
        if (stateRef.current !== 'recording') return;
        const rec = recorderRef.current;
        const trackEnded = streamRef.current?.getTracks().some((t) => t.readyState === 'ended') ?? true;
        if (rec && rec.state === 'recording' && !trackEnded) return;
        try {
          if (rec && rec.state !== 'inactive') rec.stop();
          if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
          await attachRecorder();
        } catch (err) {
          setState('error');
          onError?.(err as Error);
        }
      }, RESUME_ORDER.audio),
    [attachRecorder, onError],
  );

  const pause = useCallback(() => {
    const native = nativeRef.current;
    if (native) {
      if (stateRef.current !== 'recording') return;
      setState('paused');
      native.pause().catch((err) => {
        setState('error');
        onError?.(err as Error);
      });
      return;
    }
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.pause();
      setState('paused');
    }
  }, [onError]);

  const resume = useCallback(() => {
    const native = nativeRef.current;
    if (native) {
      if (stateRef.current !== 'paused') return;
      setState('recording');
      native.resume().catch((err) => {
        setState('error');
        onError?.(err as Error);
      });
      return;
    }
    if (recorderRef.current && recorderRef.current.state === 'paused') {
      recorderRef.current.resume();
      setState('recording');
    }
  }, [onError]);

  // SDD-247: 마이크 오프/온 — 네이티브는 setMicEnabled(구간 제외·인덱스 비진행), 웹은 pause/resume 과 동일
  const setMicEnabled = useCallback(
    (enabled: boolean) => {
      const native = nativeRef.current;
      if (!native) {
        if (enabled) resume();
        else pause();
        return;
      }
      if (enabled ? stateRef.current !== 'paused' : stateRef.current !== 'recording') return;
      setState(enabled ? 'recording' : 'paused');
      native.setMicEnabled({ enabled }).catch((err) => {
        setState('error');
        onError?.(err as Error);
      });
    },
    [pause, resume, onError],
  );

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
    const native = nativeRef.current;
    if (native) {
      try {
        const res = await native.stop();
        // 같은 세션 이어 녹음 시 청크 인덱스가 이어지도록 보존
        indexRef.current = res.lastChunkIndex + 1;
        setUploadedChunks(res.uploadedCount);
        setState('stopped');
      } catch (err) {
        setState('error');
        onError?.(err as Error);
      } finally {
        nativeRef.current = null;
        removeNativeListeners();
      }
      return;
    }
    await stopRecorder();
    cleanup();
    retryPendingChunks();
    await Promise.allSettled([...inflightRef.current]);
    setState('stopped');
  }, [stopRecorder, cleanup, retryPendingChunks, removeNativeListeners, onError]);

  return { state, start, pause, resume, setMicEnabled, stop, uploadedChunks };
}
