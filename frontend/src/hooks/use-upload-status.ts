// SDD-261: 업로드 현황 조회 훅. 폴링 + ETag(304), 서버 X-Poll-Interval 우선.
// 숨김 탭·오프라인·정지 중에는 요청하지 않고, 복귀 즉시 1회 조회한다. 응답은 메모리에만 둔다(영구 저장 금지).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../lib/api/client';
import { fetchUploadStatus, type UploadStatusResponse } from '../lib/api/upload-status';
import { errorBackoffMs, latestReceived, pollDelayMs } from '../lib/upload-status/view';

export interface UploadStatusView {
  data: UploadStatusResponse | null;
  error: ApiError | null;
  /** 403: 권한 없음. 이전 데이터는 이미 제거됐다. */
  forbidden: boolean;
  /** 404: 회차 없음·타 기관. */
  notFound: boolean;
  loading: boolean;
  paused: boolean;
  offline: boolean;
  lastFetchedAt: Date | null;
  lastReceivedAt: string | null;
  pause: () => void;
  resume: () => void;
  refresh: () => void;
}

const isAbort = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';
const isOffline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false;
const isHidden = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden';

export function useUploadStatus(classId: string | null | undefined, sessionId: string | null | undefined): UploadStatusView {
  const [data, setData] = useState<UploadStatusResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [paused, setPaused] = useState(false);
  const [offline, setOffline] = useState(isOffline);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const pausedRef = useRef(false);
  const controls = useRef<{ load: () => void; halt: () => void }>({ load: () => undefined, halt: () => undefined });

  useEffect(() => {
    setData(null); setError(null); setLastFetchedAt(null); setLoading(false);
    if (!classId || !sessionId) { controls.current = { load: () => undefined, halt: () => undefined }; return undefined; }
    let disposed = false; let stopped = false; let inflight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ctrl: AbortController | null = null;
    let failures = 0; let etag: string | null = null; let sessionStatus: string | null = null;

    const canRun = () => !disposed && !stopped && !pausedRef.current && !isHidden() && !isOffline();
    const clear = () => { if (timer !== undefined) { clearTimeout(timer); timer = undefined; } };
    const schedule = (ms: number) => { clear(); if (canRun()) timer = setTimeout(() => void load(), ms); };
    const halt = () => { clear(); ctrl?.abort(); };

    async function load(): Promise<void> {
      clear();
      if (!canRun() || inflight) return;
      inflight = true;
      const mine = new AbortController(); ctrl = mine;
      setLoading(true);
      try {
        const result = await fetchUploadStatus(classId as string, sessionId as string, { signal: mine.signal, etag });
        if (mine.signal.aborted || disposed) return;
        failures = 0; etag = result.etag ?? etag;
        if (result.kind === 'ok') { setData(result.data); sessionStatus = result.data.session_status; }
        setError(null); setLastFetchedAt(new Date());
        schedule(pollDelayMs(result.pollIntervalSec, sessionStatus));
      } catch (e) {
        if (mine.signal.aborted || disposed || isAbort(e)) return;
        const apiError = e instanceof ApiError ? e : new ApiError(0, e instanceof Error ? e.message : '조회 실패', null);
        if (apiError.status === 401 || apiError.status === 403 || apiError.status === 404) {
          // 권한·존재 문제: 이전 이름·건수를 즉시 제거하고 폴링을 멈춘다.
          stopped = true; etag = null; setData(null); setError(apiError); return;
        }
        failures += 1; setError(apiError);
        schedule(errorBackoffMs(failures));
      } finally {
        inflight = false;
        if (!disposed && ctrl === mine) setLoading(false);
      }
    }

    controls.current = { load: () => void load(), halt };
    const onVisibility = () => { if (isHidden()) { clear(); } else { void load(); } };
    const onOnline = () => { setOffline(false); void load(); };
    const onOffline = () => { setOffline(true); clear(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    void load();
    return () => {
      disposed = true; clear(); ctrl?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [classId, sessionId]);

  const pause = useCallback(() => { pausedRef.current = true; setPaused(true); controls.current.halt(); }, []);
  const resume = useCallback(() => { pausedRef.current = false; setPaused(false); controls.current.load(); }, []);
  const refresh = useCallback(() => { controls.current.load(); }, []);

  const lastReceivedAt = useMemo(() => {
    let best: string | null = null;
    for (const p of data?.participants ?? []) { const t = latestReceived(p); if (t && (!best || t > best)) best = t; }
    return best;
  }, [data]);

  return {
    data, error, forbidden: error?.status === 403, notFound: error?.status === 404,
    loading, paused, offline, lastFetchedAt, lastReceivedAt, pause, resume, refresh,
  };
}
