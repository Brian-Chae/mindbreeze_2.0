// 상담센터 검색 + 가입 신청 페이지

import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { ApiError } from '../../lib/api/client';
import {
  searchOrgs,
  joinOrg,
  getMyRequests,
  type OrgSearchItem,
  type JoinRequest,
} from '../../lib/api/org';

export default function OrgSearchPage() {
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
      navigate('/login');
      return;
    }
    if (user?.role === 'counselor') {
      getMyRequests()
        .then(setMyRequests)
        .catch(() => undefined);
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

  const isAlreadyRequested = (orgId: string): boolean =>
    myRequests.some((r) => r.org_id === orgId && r.status !== 'rejected');

  if (!isInitialized) return null;

  return (
    <div className="min-h-screen bg-surface-canvas p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-3xl font-light text-ink-primary">상담센터 검색</h1>
            <p className="text-sm text-ink-secondary mt-1">소속될 상담센터를 찾아 가입을 신청하세요</p>
          </div>
          <Link
            to="/org/register"
            className="text-sm text-brand-primary hover:text-brand-primary-hover font-medium"
          >
            + 새 센터 등록
          </Link>
        </div>

        {user?.role !== 'counselor' && (
          <div className="rounded-xl border border-border-default bg-surface-raised p-4 text-sm text-ink-secondary">
            상담사 계정으로만 가입 신청이 가능합니다 (현재 역할: {user?.role})
          </div>
        )}

        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="센터명 검색"
            className="flex-1 h-11 px-4 rounded-xl bg-surface-raised border border-border-default text-sm text-ink-primary outline-none focus:border-brand-primary"
          />
          <input
            type="text"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            placeholder="지역 (예: 서울)"
            className="sm:w-40 h-11 px-4 rounded-xl bg-surface-raised border border-border-default text-sm text-ink-primary outline-none focus:border-brand-primary"
          />
          <button
            type="submit"
            disabled={loading}
            className="h-11 px-6 rounded-pill bg-brand-primary text-ink-on-brand text-sm font-medium disabled:opacity-50"
          >
            {loading ? '검색 중...' : '검색'}
          </button>
        </form>

        {error && <p className="text-red-500 text-sm" role="alert">{error}</p>}
        {message && <p className="text-ink-secondary text-sm">{message}</p>}

        <div className="space-y-3">
          {results.map((org) => {
            const alreadyRequested = isAlreadyRequested(org.id);
            const canJoin = user?.role === 'counselor' && !alreadyRequested;
            return (
              <div
                key={org.id}
                className="rounded-xl border border-border-default bg-surface-raised p-5 flex items-center justify-between gap-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/org/${org.id}/info`}
                      className="font-medium text-ink-primary hover:text-brand-primary truncate"
                    >
                      {org.name}
                    </Link>
                    {org.verified && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-brand-primary/10 text-brand-primary">
                        인증
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-ink-tertiary mt-1 truncate">{org.address}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleJoin(org.id)}
                  disabled={!canJoin || joiningId === org.id}
                  className="shrink-0 h-9 px-4 rounded-pill bg-brand-primary text-ink-on-brand text-sm font-medium disabled:bg-surface-sunken disabled:text-ink-disabled"
                >
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
