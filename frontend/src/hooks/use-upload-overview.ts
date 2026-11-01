// SDD-263: 전체 회차 업로드 현황 목록 조회 훅. SDD-261 훅과 같은 규칙(ETag/304, X-Poll-Interval 우선,
// 숨김 탭·오프라인·정지 중 요청 없음, 403/404 시 이전 데이터 즉시 제거). 응답은 메모리에만 둔다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../lib/api/client';
import { fetchUploadOverview, type UploadOverviewItem, type UploadOverviewQuery } from '../lib/api/upload-overview';
import { overviewPollMs } from '../lib/upload-status/overview-view';
import { errorBackoffMs } from '../lib/upload-status/view';

export interface UploadOverviewView {
  items: UploadOverviewItem[] | null;
  asOf: string | null;
  truncated: boolean;
  error: ApiError | null;
  forbidden: boolean;
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

export function useUploadOverview(query: UploadOverviewQuery, enabled = true): UploadOverviewView {
  const [items, setItems] = useState<UploadOverviewItem[] | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [paused, setPaused] = useState(false);
  const [offline, setOffline] = useState(isOffline);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const pausedRef = useRef(false);
  const controls = useRef<{ load: () => void; halt: () => void }>({ load: () => undefined, halt: () => undefined });
  const { limit, since, orgId, classId, status } = query;

  useEffect(() => {
    setItems(null); setAsOf(null); setTruncated(false); setError(null); setLastFetchedAt(null); setLoading(false);
    if (!enabled) { controls.current = { load: () => undefined, halt: () => undefined }; return undefined; }
    let disposed = false; let stopped = false; let inflight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ctrl: AbortController | null = null;
    let failures = 0; let etag: string | null = null; let current: UploadOverviewItem[] = [];

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
        const result = await fetchUploadOverview({ limit, since, orgId, classId, status }, { signal: mine.signal, etag });
        if (mine.signal.aborted || disposed) return;
        failures = 0; etag = result.etag ?? etag;
        if (result.kind === 'ok') { current = result.data.items; setItems(current); setAsOf(result.data.as_of); setTruncated(result.data.truncated); }
        setError(null); setLastFetchedAt(new Date());
        schedule(overviewPollMs(result.pollIntervalSec, current));
      } catch (e) {
        if (mine.signal.aborted || disposed || isAbort(e)) return;
        const apiError = e instanceof ApiError ? e : new ApiError(0, e instanceof Error ? e.message : '조회 실패', null);
        if (apiError.status === 401 || apiError.status === 403 || apiError.status === 404) {
          // 권한 문제: 이전 회차·건수를 즉시 제거하고 폴링을 멈춘다.
          stopped = true; etag = null; current = []; setItems(null); setError(apiError); return;
        }
        failures += 1; setError(apiError);
        schedule(errorBackoffMs(failures));
      } finally {
        inflight = false;
        if (!disposed && ctrl === mine) setLoading(false);
      }
    }

    controls.current = { load: () => void load(), halt };
    const onVisibility = () => { if (isHidden()) clear(); else void load(); };
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
  }, [enabled, limit, since, orgId, classId, status]);

  const pause = useCallback(() => { pausedRef.current = true; setPaused(true); controls.current.halt(); }, []);
  const resume = useCallback(() => { pausedRef.current = false; setPaused(false); controls.current.load(); }, []);
  const refresh = useCallback(() => { controls.current.load(); }, []);

  const lastReceivedAt = useMemo(() => {
    let best: string | null = null;
    for (const i of items ?? []) if (i.last_received_at && (!best || i.last_received_at > best)) best = i.last_received_at;
    return best;
  }, [items]);

  return { items, asOf, truncated, error, forbidden: error?.status === 403, loading, paused, offline, lastFetchedAt, lastReceivedAt, pause, resume, refresh };
}
