import { Navigate, useLocation } from 'react-router-dom';

/** SDD-323: 구 /org/counselors → 새 /counselors (쿼리·해시 유지). */
export function LegacyOrgCounselorsRedirect() {
  const { search, hash } = useLocation();
  return <Navigate to={`/counselors${search}${hash}`} replace />;
}
