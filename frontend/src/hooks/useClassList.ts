// SDD-209 SH5 — 클래스 목록 공용 로딩: 첫 로딩 + 30초 폴링 + 창 포커스/온라인 복귀 시 갱신.
// 갱신이 실패해도 이미 받은 목록은 유지하고 stale(연결 끊김)로만 알린다. 첫 로딩 실패만 error.
import { useCallback, useEffect, useRef, useState } from 'react';
import { listSessions, type SessionDto } from '../lib/api/session';

interface UseClassListOptions {
  /** 폴링 주기(ms). 기본 30초 */
  intervalMs?: number;
}

export interface ClassListState {
  sessions: SessionDto[];
  /** 첫 로딩 중 */
  loading: boolean;
  /** 첫 로딩 실패 메시지(받은 목록이 없을 때만) */
  error: string | null;
  /** 목록은 있으나 최신 갱신에 실패 */
  stale: boolean;
  refresh: () => Promise<void>;
}

export function useClassList({ intervalMs = 30_000 }: UseClassListOptions = {}): ClassListState {
  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const loadedRef = useRef(false);
  const aliveRef = useRef(true);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await listSessions();
      if (!aliveRef.current) return;
      loadedRef.current = true;
      setSessions(res.sessions);
      setError(null);
      setStale(false);
    } catch (e: unknown) {
      if (!aliveRef.current) return;
      if (loadedRef.current) setStale(true);
      else setError(e instanceof Error ? e.message : '클래스 목록을 불러오지 못했어요');
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, intervalMs);
    const onWake = (): void => { void refresh(); };
    window.addEventListener('focus', onWake);
    window.addEventListener('online', onWake);
    return () => {
      aliveRef.current = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('online', onWake);
    };
  }, [refresh, intervalMs]);

  return { sessions, loading, error, stale, refresh };
}
