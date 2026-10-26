import { useEffect } from 'react';
import { apiClient } from '../lib/api/client';
import { useAuthStore } from '../stores/authStore';

type CounselorItem = { id: string; name: string; profile_image: string | null };

/**
 * 연결된 상담사 목록을 authStore 에 채운다.
 * `/app/*` 기존 셸(ClientAppPage)을 거치지 않는 새 회원 화면(홈·내 클래스)에서 담당 상담사·신청 대상이 비지 않게 한다.
 * 실패해도 화면은 그대로 두고(상담사 없음과 동일), 이미 값이 있으면 덮어쓰지 않고 최신 목록으로 갱신한다.
 */
export function useClientCounselors(): void {
  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<CounselorItem[]>('/client/counselors')
      .then((res) => {
        if (cancelled) return;
        const counselors = Array.isArray(res) ? res : [];
        const { user, setUser } = useAuthStore.getState();
        if (user) setUser({ ...user, counselors });
      })
      .catch(() => {
        /* 조회 실패는 기존 상태 유지 */
      });
    return () => {
      cancelled = true;
    };
  }, []);
}
