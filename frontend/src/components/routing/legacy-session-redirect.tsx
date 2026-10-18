import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { getSession } from '../../lib/api/session';
import { useAuthStore } from '../../stores/authStore';
import { resolveLegacySessionPath } from './legacy-session-path';

interface Destination {
  sessionId: string;
  userId: string | undefined;
  role: string | undefined;
  path: string;
}

/** 기존 회차 URL의 부모를 한 번 조회하고 새 상세로 이동한다. */
export function LegacySessionRedirect() {
  const { id } = useParams<{ id: string }>();
  const userId = useAuthStore((state) => state.user?.id);
  const role = useAuthStore((state) => state.user?.role);
  const [destination, setDestination] = useState<Destination | null>(null);
  useEffect(() => {
    if (!id) return;
    let active = true;
    const finish = (path: string) => { if (active) setDestination({ sessionId: id, userId, role, path }); };
    void getSession(id).then(
      (response) => finish(resolveLegacySessionPath(id, response)),
      () => finish('/classes'),
    );
    return () => { active = false; };
  }, [id, userId, role]);
  if (!id) return <Navigate to="/classes" replace />;
  if (destination?.sessionId === id && destination.userId === userId && destination.role === role) {
    return <Navigate to={destination.path} replace />;
  }
  return <div role="status">화면을 확인하고 있어요</div>;
}
