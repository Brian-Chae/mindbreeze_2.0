// 어드민 사용자 관리 페이지

import { useEffect, useState, useCallback } from 'react';
import AppShell from '../../components/layout/AppShell';
import { listUsers, suspendUser, unsuspendUser, type UserDto } from '../../lib/api/admin';

const ROLE_LABELS: Record<string, string> = {
  platform_admin: '플랫폼 관리자',
  org_admin: '센터 관리자',
  counselor: '상담사',
  client: '내담자',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    platform_admin: 'bg-[#F5EDFC] text-[#5F0080]',
    org_admin: 'bg-[#F5EDFC] text-[#6E1A8C]',
    counselor: 'bg-[#E0F2FE] text-[#075985]',
    client: 'bg-[#E6F8F3] text-[#1F8A5B]',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold ${colors[role] ?? 'bg-gray-100 text-gray-600'}`}>
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

function StatusBadge({ suspended }: { suspended: boolean }) {
  return suspended ? (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#FEE2E2] text-[#991B1B]">
      정지됨
    </span>
  ) : (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#D1FAE5] text-[#065F46]">
      활성
    </span>
  );
}

export default function UserManagementPage() {
  const [users, setUsers] = useState<UserDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ user: UserDto; action: 'suspend' | 'unsuspend' } | null>(null);
  const [reason, setReason] = useState('');
  const [acting, setActing] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number> = { page, size: 20 };
      if (role) params.role = role;
      if (q) params.q = q;
      const res = await listUsers(params as { role?: string; q?: string; page?: number; size?: number });
      setUsers(res.users);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : '사용자 조회 실패');
    } finally {
      setLoading(false);
    }
  }, [page, role, q]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleAction = useCallback(async () => {
    if (!modal) return;
    setActing(true);
    setError(null);
    try {
      if (modal.action === 'suspend') {
        await suspendUser(modal.user.id, reason);
      } else {
        await unsuspendUser(modal.user.id);
      }
      setModal(null);
      setReason('');
      await fetchUsers();
    } catch (e) {
      setError(e instanceof Error ? e.message : '처리 실패');
    } finally {
      setActing(false);
    }
  }, [modal, reason, fetchUsers]);

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <AppShell title="사용자 관리" sub="USER MANAGEMENT">
      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 text-red-700 text-sm">{error}</div>
      )}

      {/* 필터 */}
      <div className="flex flex-col md:flex-row md:items-center gap-3 mb-6">
        <input
          type="text"
          placeholder="이름 또는 이메일 검색..."
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
          className="rounded-xl border border-[#EFEFEF] px-4 py-2 text-[13px] w-full md:w-64 focus:outline-none focus:ring-2 focus:ring-[#5F0080]/20"
        />
        <select
          value={role}
          onChange={(e) => { setRole(e.target.value); setPage(1); }}
          className="rounded-xl border border-[#EFEFEF] px-3 py-2 text-[13px]"
        >
          <option value="">전체 역할</option>
          {Object.entries(ROLE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <span className="text-[13px] text-[#6F6F6F]">총 {total}명</span>
      </div>

      {loading ? (
        <div className="text-[#6F6F6F]">불러오는 중...</div>
      ) : users.length === 0 ? (
        <div className="border border-dashed border-[#DDDEE7] rounded-2xl p-12 text-center">
          <div className="text-[#6F6F6F] text-sm">사용자가 없습니다.</div>
        </div>
      ) : (
        <>
          {/* 모바일 카드 뷰 */}
          <div className="block md:hidden space-y-3">
            {users.map((u) => (
              <div key={u.id} className="bg-white border border-[#EFEFEF] rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-[#1F1F1F]">{u.name}</span>
                  <StatusBadge suspended={u.suspended} />
                </div>
                <div className="text-[13px] text-[#6F6F6F] break-all">{u.email}</div>
                <div className="text-[12px] text-[#9B9B9B] font-mono mt-1">{formatDate(u.created_at)}</div>
                <div className="flex items-center justify-between mt-3">
                  <RoleBadge role={u.role} />
                  {u.suspended ? (
                    <button
                      onClick={() => setModal({ user: u, action: 'unsuspend' })}
                      className="text-[13px] font-medium text-[#10B981] hover:underline"
                    >
                      해제
                    </button>
                  ) : (
                    <button
                      onClick={() => setModal({ user: u, action: 'suspend' })}
                      className="text-[13px] font-medium text-[#EF4444] hover:underline"
                    >
                      정지
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* 데스크톱 테이블 */}
          <div className="hidden md:block bg-white border border-[#EFEFEF] rounded-2xl overflow-hidden">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="bg-[#F8FAFC] border-b border-[#EFEFEF]">
                  <th className="text-left px-6 py-3 text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider">이름</th>
                  <th className="text-left px-6 py-3 text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider">이메일</th>
                  <th className="text-left px-6 py-3 text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider">역할</th>
                  <th className="text-left px-6 py-3 text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider">상태</th>
                  <th className="text-left px-6 py-3 text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider">가입일</th>
                  <th className="text-left px-6 py-3 text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider">관리</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-[#EFEFEF] last:border-0 hover:bg-[#F8FAFC] transition-colors">
                    <td className="px-6 py-4 font-medium text-[#1F1F1F]">{u.name}</td>
                    <td className="px-6 py-4 text-[#6F6F6F]">{u.email}</td>
                    <td className="px-6 py-4"><RoleBadge role={u.role} /></td>
                    <td className="px-6 py-4"><StatusBadge suspended={u.suspended} /></td>
                    <td className="px-6 py-4 text-[#9B9B9B] font-mono text-[12px]">{formatDate(u.created_at)}</td>
                    <td className="px-6 py-4">
                      {u.suspended ? (
                        <button
                          onClick={() => setModal({ user: u, action: 'unsuspend' })}
                          className="text-[13px] font-medium text-[#10B981] hover:underline"
                        >
                          해제
                        </button>
                      ) : (
                        <button
                          onClick={() => setModal({ user: u, action: 'suspend' })}
                          className="text-[13px] font-medium text-[#EF4444] hover:underline"
                        >
                          정지
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 페이지네이션 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 rounded-lg text-[13px] border border-[#EFEFEF] disabled:opacity-30"
              >
                이전
              </button>
              <span className="text-[13px] text-[#6F6F6F]">{page} / {totalPages}</span>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 rounded-lg text-[13px] border border-[#EFEFEF] disabled:opacity-30"
              >
                다음
              </button>
            </div>
          )}
        </>
      )}

      {/* 모달 */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setModal(null)}>
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[17px] font-bold text-[#1F1F1F] mb-2">
              {modal.action === 'suspend' ? '사용자 정지' : '정지 해제'}
            </h3>
            <p className="text-[14px] text-[#6F6F6F] mb-4">
              {modal.action === 'suspend'
                ? `"${modal.user.name}" (${modal.user.email}) 님을 정지하시겠습니까?`
                : `"${modal.user.name}" (${modal.user.email}) 님의 정지를 해제하시겠습니까?`}
            </p>

            {modal.action === 'suspend' && (
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="정지 사유를 입력하세요 (필수)..."
                rows={3}
                className="w-full rounded-xl border border-[#EFEFEF] px-4 py-3 text-[14px] resize-none focus:outline-none focus:ring-2 focus:ring-[#5F0080]/20 mb-4"
              />
            )}

            <div className="flex items-center gap-3 justify-end">
              <button
                onClick={() => setModal(null)}
                className="px-4 py-2 rounded-xl text-[14px] text-[#6F6F6F] border border-[#EFEFEF]"
              >
                취소
              </button>
              <button
                onClick={handleAction}
                disabled={acting || (modal.action === 'suspend' && !reason.trim())}
                className={`px-4 py-2 rounded-xl text-[14px] font-medium text-white disabled:opacity-50 ${
                  modal.action === 'suspend' ? 'bg-[#EF4444]' : 'bg-[#10B981]'
                }`}
              >
                {acting ? '처리 중...' : modal.action === 'suspend' ? '정지' : '해제'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
