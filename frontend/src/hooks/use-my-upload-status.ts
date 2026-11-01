// SDD-265: 회원 최근 회차 현황 훅. 서버 X-Poll-Interval(진행 중 5초) 우선, 없으면 진행 중 5초·그 외 60초.
// 숨김 탭·오프라인 중지, 401/403/404 는 이전 수치를 즉시 제거. 응답은 메모리에만 둔다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api/client';
import { fetchMySessions, type MySessionRow } from '../lib/api/my-upload-status';
import { errorBackoffMs } from '../lib/upload-status/view';

export interface MyUploadStatusView {
  items: MySessionRow[] | null;
  nextCursor: string | null;
  hasMore: boolean;
  error: ApiError | null;
  forbidden: boolean;
  loading: boolean;
  offline: boolean;
  lastFetchedAt: Date | null;
  refresh: () => void;
}
const isAbort = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';
const isOffline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false;
const isHidden = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden';
const hasLive = (rows: readonly MySessionRow[]): boolean => rows.some((r) => r.session_status === 'in_progress' || r.session_status === 'open');

export function useMyUploadStatus(cursor: string | null = null, limit = 10): MyUploadStatusView {
  const [items, setItems] = useState<MySessionRow[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(isOffline);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const loadRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    setItems(null); setNextCursor(null); setError(null); setLastFetchedAt(null); setLoading(false);
    let disposed = false; let stopped = false; let inflight = false; let failures = 0; let etag: string | null = null; let current: MySessionRow[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined; let ctrl: AbortController | null = null;
    const clear = () => { if (timer !== undefined) { clearTimeout(timer); timer = undefined; } };
    const canRun = () => !disposed && !stopped && !isHidden() && !isOffline();
    const schedule = (ms: number) => { clear(); if (canRun()) timer = setTimeout(() => void load(), ms); };
    async function load(): Promise<void> {
      clear();
      if (!canRun() || inflight) return;
      inflight = true; const mine = new AbortController(); ctrl = mine; setLoading(true);
      try {
        const result = await fetchMySessions({ limit, cursor }, { signal: mine.signal, etag });
        if (mine.signal.aborted || disposed) return;
        failures = 0; etag = result.etag ?? etag;
        if (result.kind === 'ok') { current = result.data.items; setItems(current); setNextCursor(result.data.next_cursor); }
        setError(null); setLastFetchedAt(new Date());
        schedule(result.pollIntervalSec ? result.pollIntervalSec * 1000 : hasLive(current) ? 5000 : 60_000);
      } catch (e) {
        if (mine.signal.aborted || disposed || isAbort(e)) return;
        const apiError = e instanceof ApiError ? e : new ApiError(0, e instanceof Error ? e.message : '조회 실패', null);
        if (apiError.status === 401 || apiError.status === 403 || apiError.status === 404) { stopped = true; etag = null; current = []; setItems(null); setNextCursor(null); setError(apiError); return; }
        failures += 1; setError(apiError); schedule(errorBackoffMs(failures));
      } finally { inflight = false; if (!disposed && ctrl === mine) setLoading(false); }
    }
    loadRef.current = () => void load();
    const onVisibility = () => { if (isHidden()) clear(); else void load(); };
    const onOnline = () => { setOffline(false); void load(); };
    const onOffline = () => { setOffline(true); clear(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline);
    void load();
    return () => {
      disposed = true; clear(); ctrl?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline);
    };
  }, [cursor, limit]);

  const refresh = useCallback(() => { loadRef.current(); }, []);
  return { items, nextCursor, hasMore: nextCursor !== null, error, forbidden: error?.status === 403, loading, offline, lastFetchedAt, refresh };
}
