import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import {
  addClientCounselor,
  getClientCounselors,
  type ClientCounselor,
} from '../lib/api/client-counselors';

// 조회 요청 세대: 늦게 도착한 오래된 GET 이 추가 직후 목록을 덮지 않게 한다.
let generation = 0;

function writeCounselors(userId: string, updater: (prev: ClientCounselor[]) => ClientCounselor[]): void {
  const { user, setUser } = useAuthStore.getState();
  // 계정 전환 중 늦게 끝난 요청이 다른 사용자의 store 를 오염시키지 않게 한다.
  if (!user || user.id !== userId) return;
  setUser({ ...user, counselors: updater(user.counselors ?? []) });
}

/** 불변 병합: 같은 id 는 새 값으로 교체, 없으면 뒤에 추가. */
export function mergeCounselor(list: ClientCounselor[], next: ClientCounselor): ClientCounselor[] {
  return list.some((c) => c.id === next.id)
    ? list.map((c) => (c.id === next.id ? { ...c, ...next } : c))
    : [...list, next];
}

export interface UseClientCounselorsResult {
  counselors: ClientCounselor[];
  loading: boolean;
  error: boolean;
  refresh: () => Promise<boolean>;
  /** POST 성공 시 즉시 병합하고 true 반환. 실패는 throw. 이후 GET 재검증 결과는 refreshed 로 알린다. */
  addCounselor: (code: string) => Promise<{ counselor: ClientCounselor; refreshed: boolean }>;
}

/**
 * 연결된 상담사 목록을 authStore 에 채운다.
 * 실패해도 기존 목록은 유지하고(0명으로 오인하지 않음) error 만 켠다. 마운트 시 1회 자동 조회.
 */
export function useClientCounselors(): UseClientCounselorsResult {
  const user = useAuthStore((s) => s.user);
  const userId = user?.id ?? null;
  const counselors = (user?.counselors ?? []) as ClientCounselor[];
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!userId) return false;
    const mine = ++generation;
    setLoading(true);
    try {
      const list = await getClientCounselors();
      if (mine !== generation) return true; // 더 최신 요청이 있으면 결과 무시
      writeCounselors(userId, () => list);
      setError(false);
      return true;
    } catch {
      if (mine === generation) setError(true);
      return false;
    } finally {
      if (mine === generation) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addCounselor = useCallback(
    async (code: string) => {
      if (!userId) throw new Error('not authenticated');
      const counselor = await addClientCounselor(code);
      generation += 1; // 진행 중이던 이전 GET 무효화
      writeCounselors(userId, (prev) => mergeCounselor(prev, counselor));
      const refreshed = await refresh();
      return { counselor, refreshed };
    },
    [userId, refresh],
  );

  return { counselors, loading, error, refresh, addCounselor };
}
