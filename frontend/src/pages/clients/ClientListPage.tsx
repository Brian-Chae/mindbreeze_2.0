import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { listClients, type ClientListItem } from '../../lib/api/clients';
import { ApiError } from '../../lib/api/client';

const PAGE_SIZE = 20;

export default function ClientListPage() {
  const navigate = useNavigate();
  const { user, isAuthenticated, isInitialized } = useAuthStore();

  const [query, setQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 인증 가드
  useEffect(() => {
    if (isInitialized && !isAuthenticated) {
      navigate('/login');
    }
  }, [isInitialized, isAuthenticated, navigate]);

  useEffect(() => {
    if (!isAuthenticated || user?.role !== 'counselor') return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    listClients({ q: searchTerm || undefined, page, size: PAGE_SIZE })
      .then((res) => {
        if (cancelled) return;
        setClients(res.clients);
        setTotal(res.total);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : '내담자 목록을 불러오지 못했습니다');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [searchTerm, page, isAuthenticated, user?.role]);

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearchTerm(query.trim());
  };

  if (!isInitialized) return null;

  if (user && user.role !== 'counselor') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-canvas p-6">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold mb-2">접근 권한이 없습니다</h1>
          <p className="text-sm text-gray-600">상담사 전용 페이지입니다.</p>
        </div>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="min-h-screen bg-surface-canvas p-6">
      <div className="max-w-5xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">내담자 관리</h1>
          <Link
            to="/clients/invite"
            className="px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 text-sm font-medium"
          >
            내담자 초대
          </Link>
        </header>

        <form onSubmit={handleSearch} className="mb-6 flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름 또는 이메일 검색"
            className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-gray-800 text-white rounded-md hover:bg-gray-900 text-sm"
          >
            검색
          </button>
        </form>

        {loading && <p className="text-center text-gray-500 py-8">불러오는 중...</p>}
        {error && <p className="text-center text-red-600 py-8">{error}</p>}

        {!loading && !error && clients.length === 0 && (
          <div className="text-center text-gray-500 py-16">
            등록된 내담자가 없습니다.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {clients.map((c) => (
            <button
              key={c.id}
              onClick={() => navigate(`/clients/${c.id}`)}
              className="text-left p-4 bg-white border border-gray-200 rounded-lg hover:border-emerald-500 hover:shadow-sm transition"
            >
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="font-semibold text-gray-900">{c.name}</h3>
                  <p className="text-sm text-gray-500">{c.email}</p>
                </div>
                {c.last_session_at && (
                  <span className="text-xs text-gray-400">
                    {new Date(c.last_session_at).toLocaleDateString('ko-KR')}
                  </span>
                )}
              </div>
              {c.concerns.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {c.concerns.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-xs rounded-full"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>

        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-3 mt-8">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1 border border-gray-300 rounded disabled:opacity-50 text-sm"
            >
              이전
            </button>
            <span className="text-sm text-gray-600">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1 border border-gray-300 rounded disabled:opacity-50 text-sm"
            >
              다음
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
