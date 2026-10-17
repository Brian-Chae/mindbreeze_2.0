// SDD-209 M1 — 입장 자격 기반 본인 상태 폴링(GET entry-state). 읽기 전용이라 호스트에게 알림을 쏘지 않는다.
// 승격(is_waitlisted true→false)·클래스 열림·시작·종료·취소를 감지하는 정본이다(WS 이벤트는 빠른 반영용 보조).
import { useCallback, useEffect, useRef, useState } from 'react';
import { getEntryState, type EntryStateDto } from '../lib/api/class-flow';

const DEFAULT_INTERVAL_MS = 5_000;

interface UseEntryStateOptions {
  sessionId: string;
  credential: string | null;
  enabled: boolean;
  intervalMs?: number;
}

export interface UseEntryStateResult {
  state: EntryStateDto | null;
  /** 마지막 조회가 실패했으면 그 오류(성공하면 null) */
  error: unknown;
  refresh: () => Promise<void>;
}

export function useEntryState({ sessionId, credential, enabled, intervalMs = DEFAULT_INTERVAL_MS }: UseEntryStateOptions): UseEntryStateResult {
  const [state, setState] = useState<EntryStateDto | null>(null);
  const [error, setError] = useState<unknown>(null);
  const inFlightRef = useRef(false);
  const aliveRef = useRef(true);

  const refresh = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const next = await getEntryState(sessionId, credential);
      if (!aliveRef.current) return;
      setState(next);
      setError(null);
    } catch (e) {
      if (aliveRef.current) setError(e);
    } finally {
      inFlightRef.current = false;
    }
  }, [sessionId, credential]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    void refresh();
    const timer = window.setInterval(() => void refresh(), intervalMs);
    const onOnline = (): void => void refresh();
    window.addEventListener('online', onOnline);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', onOnline);
    };
  }, [enabled, intervalMs, refresh]);

  return { state, error, refresh };
}
