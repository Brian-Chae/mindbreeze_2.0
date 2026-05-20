import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../../components/layout/AppShell';
import { useAuthStore } from '../../stores/authStore';
import { listClients, type ClientListItem } from '../../lib/api/clients';
import { ApiError } from '../../lib/api/client';

const PAGE_SIZE = 20;

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return trimmed.charAt(0);
}

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
      <AppShell title="내담자">
        <div className="flex items-center justify-center py-24">
          <div className="max-w-md text-center">
            <h1 className="text-xl font-bold mb-2 text-[#1F1F1F]">접근 권한이 없습니다</h1>
            <p className="text-sm text-[#6F6F6F]">상담사 전용 페이지입니다.</p>
          </div>
        </div>
      </AppShell>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const rightSlot = (
    <button
      type="button"
      onClick={() => navigate('/clients/invite')}
      className="mb-btn"
    >
      내담자 초대
    </button>
  );

  return (
    <AppShell title="내담자" sub="CLIENTS" rightSlot={rightSlot}>
      <div className="max-w-5xl mx-auto space-y-6">
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름 또는 이메일 검색"
            className="flex-1 h-11 px-5 rounded-full border border-[#DDDEE7] bg-white text-sm text-[#1F1F1F] placeholder:text-[#9CA0AE] outline-none focus:border-[#5F0080] focus:ring-2 focus:ring-purple-900/15 transition"
          />
          <button type="submit" className="mb-btn mb-btn--ghost">
            검색
          </button>
        </form>

        {loading && (
          <p className="text-center text-[#6F6F6F] py-8">불러오는 중...</p>
        )}
        {error && <p className="text-center text-red-600 py-8">{error}</p>}

        {!loading && !error && clients.length === 0 && (
          <div className="bg-white rounded-[20px] border border-[#EFEFEF] p-12 text-center text-[#6F6F6F]">
            등록된 내담자가 없습니다.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {clients.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => navigate(`/clients/${c.id}`)}
              className="text-left bg-white rounded-[20px] border border-[#EFEFEF] p-6 hover:border-[#5F0080] hover:shadow-sm transition-all"
            >
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-full bg-[#F5EDFC] ring-2 ring-[#5F0080]/20 flex items-center justify-center text-[#5F0080] font-bold text-lg shrink-0">
                  {initials(c.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-bold text-[15px] text-[#1F1F1F] truncate">
                        {c.name}
                      </h3>
                      <p className="text-[12px] text-[#6F6F6F] truncate mt-0.5">
                        {c.email}
                      </p>
                    </div>
                    {c.last_session_at && (
                      <span className="shrink-0 px-2.5 py-1 rounded-full bg-[#F5EDFC] text-[#5F0080] text-[11px] font-mono">
                        {new Date(c.last_session_at).toLocaleDateString('ko-KR')}
                      </span>
                    )}
                  </div>
                  {c.concerns.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-3">
                      {c.concerns.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 bg-[#F5EDFC] text-[#5F0080] text-[11px] rounded-full"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>

        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-3 pt-4">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="mb-btn mb-btn--ghost disabled:opacity-40"
            >
              이전
            </button>
            <span className="text-sm text-[#6F6F6F] font-mono">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="mb-btn mb-btn--ghost disabled:opacity-40"
            >
              다음
            </button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
