// SDD-262: 회원 본인 저장 현황 훅. 진행 중 회차만 5초 폴링, 숨김 탭·오프라인 중지, 복귀 즉시 1회.
// 403/404/5xx 는 이전 수치를 즉시 제거한다. 응답은 메모리에만 둔다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api/client';
import { getMyUploadSummaries } from '../lib/api/my-upload-status';
import { buildMyStatus, type MyStatusModel } from '../lib/upload-status/member-view';

export const MY_POLL_MS = 5000;
const isHidden = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden';
const isOffline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false;

export interface MyUploadStatusView {
  model: MyStatusModel | null; error: ApiError | null; loading: boolean; offline: boolean;
  forbidden: boolean; notFound: boolean; lastFetchedAt: Date | null; refresh: () => void;
}

export function useMyUploadStatus(sessionId: string | null, live: boolean): MyUploadStatusView {
  const [model, setModel] = useState<MyStatusModel | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(isOffline);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const loadRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    setModel(null); setError(null); setLastFetchedAt(null); setLoading(false);
    loadRef.current = () => undefined;
    if (!sessionId) return undefined;
    let disposed = false; let stopped = false; let inflight = false;
    let timer: ReturnType<typeof setTimeout> | undefined; let ctrl: AbortController | null = null;
    const clear = () => { if (timer !== undefined) { clearTimeout(timer); timer = undefined; } };
    const canRun = () => !disposed && !stopped && !isHidden() && !isOffline();
    async function load(): Promise<void> {
      clear();
      if (!canRun() || inflight) return;
      inflight = true; const mine = new AbortController(); ctrl = mine; setLoading(true);
      try {
        const { feature, raw } = await getMyUploadSummaries(sessionId as string, mine.signal);
        if (mine.signal.aborted || disposed) return;
        setModel(buildMyStatus(feature, raw)); setError(null); setLastFetchedAt(new Date());
        if (live && canRun()) timer = setTimeout(() => void load(), MY_POLL_MS);
      } catch (e) {
        if (mine.signal.aborted || disposed || (e as { name?: string })?.name === 'AbortError') return;
        const apiError = e instanceof ApiError ? e : new ApiError(0, e instanceof Error ? e.message : '조회 실패', null);
        setModel(null); setError(apiError);
        if (apiError.status === 401 || apiError.status === 403 || apiError.status === 404) stopped = true;
        else if (live && canRun()) timer = setTimeout(() => void load(), 10_000);
      } finally { inflight = false; if (!disposed && ctrl === mine) setLoading(false); }
    }
    loadRef.current = () => void load();
    const onVisibility = () => { if (!live) return; if (isHidden()) clear(); else void load(); };
    const onOnline = () => { setOffline(false); if (live) void load(); };
    const onOffline = () => { setOffline(true); clear(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline);
    void load();
    return () => {
      disposed = true; clear(); ctrl?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline);
    };
  }, [sessionId, live]);

  const refresh = useCallback(() => { loadRef.current(); }, []);
  return { model, error, loading, offline, forbidden: error?.status === 403, notFound: error?.status === 404, lastFetchedAt, refresh };
}
