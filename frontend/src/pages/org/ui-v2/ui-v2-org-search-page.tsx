// SDD-321 — 상담센터 검색·가입 신청 D안. 기존 OrgSearchPage 와 같은 API·신청 상태 규칙·안내 문구를 그대로 쓴다.
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../../stores/authStore';
import { ApiError } from '../../../lib/api/client';
import { searchOrgs, joinOrg, getMyRequests, type OrgSearchItem, type JoinRequest } from '../../../lib/api/org';
import { Pill } from './ui-v2-org-parts';
import '../../../styles/ui-v2.css';
import '../../../styles/ui-v2-brand.css';
import '../../../styles/ui-v2-org.css';

// role enum(counselor 등)을 한글 라벨로 매핑해 원문 영문 노출을 막는다.
const ROLE_LABELS: Record<string, string> = {
  platform_admin: '플랫폼 관리자',
  org_admin: '센터 관리자',
  counselor: '코치',
  client: '내담자',
  admin: '관리자',
};

export function UiV2OrgSearchPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isInitialized = useAuthStore((s) => s.isInitialized);

  const [q, setQ] = useState('');
  const [region, setRegion] = useState('');
  const [results, setResults] = useState<OrgSearchItem[]>([]);
  const [myRequests, setMyRequests] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isInitialized) return;
    if (!isAuthenticated) {
      navigate('/login?role=counselor');
      return;
    }
    if (user?.role === 'counselor') {
      getMyRequests()
        .then(setMyRequests)
        .catch((err: unknown) => {
          // 신청 내역 조회 실패를 삼키면 이미 신청한 센터에 중복 신청하게 된다 — 사유를 안내한다
          setError(err instanceof Error && err.message ? err.message : '가입 신청 내역을 불러오지 못했습니다');
        });
    }
  }, [isInitialized, isAuthenticated, user, navigate]);

  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const data = await searchOrgs(q.trim(), region.trim() || undefined);
      setResults(data);
      if (data.length === 0) setMessage('검색 결과가 없습니다');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '검색에 실패했습니다');
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async (orgId: string) => {
    setJoiningId(orgId);
    setError(null);
    try {
      const req = await joinOrg(orgId);
      setMyRequests((prev) => [...prev, req]);
      setMessage('가입 신청이 접수되었습니다');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '가입 신청에 실패했습니다');
    } finally {
      setJoiningId(null);
    }
  };

  const isAlreadyRequested = (orgId: string): boolean => myRequests.some((r) => r.org_id === orgId && r.status !== 'rejected');

  if (!isInitialized) return null;

  return (
    <div className="ui-v2 u2-org-page">
      <div className="u2-org-page-inner">
        <header className="u2-org-reqtop">
          <div>
            <h1>상담센터 검색</h1>
            <p>소속될 상담센터를 찾아 가입을 신청하세요</p>
          </div>
          <Link to="/register/organization" className="u2-link">+ 기관 가입 상담 신청</Link>
        </header>

        {user?.role !== 'counselor' && (
          <div className="u2-notice" style={{ marginBottom: 16 }}>
            코치 계정으로만 가입 신청이 가능합니다 (현재 역할: {user?.role ? ROLE_LABELS[user.role] ?? user.role : '알 수 없음'})
          </div>
        )}

        <form onSubmit={handleSearch} className="u2-org-filter u2-org-searchform">
          <input type="text" className="u2-org-field" aria-label="센터명 검색" value={q} onChange={(e) => setQ(e.target.value)} placeholder="센터명 검색" />
          <input type="text" className="u2-org-field" aria-label="지역" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="지역 (예: 서울)" />
          <button type="submit" className="u2-primary" disabled={loading}>{loading ? '검색 중...' : '검색'}</button>
        </form>

        {error && <p className="u2-org-error" role="alert">{error}</p>}
        {message && <p className="u2-org-msg" role="status">{message}</p>}

        <div style={{ marginTop: 14 }}>
          {results.map((org) => {
            const alreadyRequested = isAlreadyRequested(org.id);
            const canJoin = user?.role === 'counselor' && !alreadyRequested;
            return (
              <div key={org.id} className="u2-org-result">
                <div className="u2-body">
                  <div className="u2-row" style={{ justifyContent: 'flex-start', gap: 8 }}>
                    <Link to={`/org/${org.id}`} className="u2-link u2-setstrong" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{org.name}</Link>
                    {org.verified && <Pill tone="accent">인증</Pill>}
                  </div>
                  <p>{org.address}</p>
                </div>
                <button type="button" className="u2-primary" onClick={() => handleJoin(org.id)} disabled={!canJoin || joiningId === org.id}>
                  {alreadyRequested ? '신청 완료' : joiningId === org.id ? '신청 중...' : '가입 신청'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
