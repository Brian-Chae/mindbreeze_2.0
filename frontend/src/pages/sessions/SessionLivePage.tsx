// SDD-088: 라이브 페이지는 독립형 플레이어(ClassPlayerPage)로 대체되었다.
// 기존 /sessions/:id/live 링크·북마크 하위 호환을 위해 리다이렉트만 남긴다.
// 모니터링·녹음·마커·밴드 로직은 pages/sessions/ClassPlayerPage.tsx 씬으로 이전됨.

import { Navigate, useParams } from 'react-router-dom';

export default function SessionLivePage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <Navigate to="/sessions" replace />;
  return <Navigate to={`/sessions/${id}/player`} replace />;
}
