// 플랫폼 관리자 회원(내담자) 관리 페이지

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import AppShell from '../../components/layout/AppShell';
import { ApiError } from '../../lib/api/client';
import {
  createAdminClient,
  deleteUser,
  listUsers,
  suspendUser,
  unsuspendUser,
  type UserDto,
} from '../../lib/api/admin';
import { useNotificationStore } from '../../stores/notificationStore';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
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

function CounselorCell({ counselor }: { counselor: UserDto['primary_counselor'] }) {
  if (!counselor) {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#FEF3C7] text-[#92400E]">
        미배정
      </span>
    );
  }
  return (
    <span className="text-[#1F1F1F]" title={counselor.email}>
      {counselor.name}
    </span>
  );
}

interface CounselorPickerProps {
  selected: UserDto | null;
  onSelect: (counselor: UserDto | null) => void;
  error?: string | null;
}

function CounselorPicker({ selected, onSelect, error }: CounselorPickerProps) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [results, setResults] = useState<UserDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const fetchCounselors = async () => {
      setLoading(true);
      try {
        const res = await listUsers({
          role: 'counselor',
          q: debouncedQuery || undefined,
          page: 1,
          size: 20,
        });
        if (!cancelled) {
          setResults(res.items);
          setHighlightIndex(0);
        }
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchCounselors();
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, open]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectableResults = results.filter((c) => !c.suspended);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'Enter') setOpen(true);
      return;
    }
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, Math.max(selectableResults.length - 1, 0)));
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    }
    if (event.key === 'Enter' && selectableResults[highlightIndex]) {
      event.preventDefault();
      onSelect(selectableResults[highlightIndex]);
      setQuery('');
      setOpen(false);
    }
  };

  if (selected) {
    return (
      <div>
        <div className="flex items-center gap-2 rounded-xl border border-[#EFEFEF] bg-[#F8FAFC] px-3 py-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-[#E0F2FE] px-2.5 py-1 text-[12px] font-medium text-[#075985]">
            {selected.name}
            <button
              type="button"
              onClick={() => onSelect(null)}
              className="ml-1 text-[#075985]/70 hover:text-[#075985]"
              aria-label="상담사 선택 해제"
            >
              ×
            </button>
          </span>
          <span className="text-[12px] text-[#6F6F6F] truncate">{selected.email}</span>
        </div>
        {error && <p className="mt-1 text-[12px] text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="상담사 이름 또는 이메일 검색..."
          className="w-full rounded-xl border border-[#EFEFEF] px-4 py-2.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#5F0080]/20"
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#9B9B9B]">
            검색 중...
          </span>
        )}
      </div>
      {error && <p className="mt-1 text-[12px] text-red-600">{error}</p>}
      {open && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-[#EFEFEF] bg-white shadow-lg">
          {selectableResults.length === 0 && !loading ? (
            <li className="px-4 py-3 text-[13px] text-[#6F6F6F]">검색 결과가 없습니다</li>
          ) : (
            selectableResults.slice(0, 8).map((counselor, index) => (
              <li key={counselor.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(counselor);
                    setQuery('');
                    setOpen(false);
                  }}
                  className={`w-full px-4 py-3 text-left hover:bg-[#F8FAFC] ${
                    index === highlightIndex ? 'bg-[#F5EDFC]' : ''
                  }`}
                >
                  <div className="font-medium text-[#1F1F1F] text-[14px]">{counselor.name}</div>
                  <div className="text-[12px] text-[#6F6F6F]">{counselor.email}</div>
                </button>
              </li>
            ))
          )}
          {results.some((c) => c.suspended) && (
            <li className="border-t border-[#EFEFEF] px-4 py-2 text-[11px] text-[#9B9B9B]">
              정지된 상담사는 선택할 수 없습니다
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

type ActionModal =
  | { user: UserDto; action: 'suspend' | 'unsuspend' }
  | { user: UserDto; action: 'delete'; step: 1 | 2 };

export default function ClientManagementPage() {
  const showToast = useNotificationStore((s) => s.showToast);
  const [users, setUsers] = useState<UserDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<ActionModal | null>(null);
  const [reason, setReason] = useState('');
  const [deleteEmailConfirm, setDeleteEmailConfirm] = useState('');
  const [acting, setActing] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addCounselor, setAddCounselor] = useState<UserDto | null>(null);
  const [sendInvite, setSendInvite] = useState(true);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addFieldErrors, setAddFieldErrors] = useState<{ email?: string; counselor?: string }>({});

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number> = { page, size: 20, role: 'client' };
      if (q) params.q = q;
      const res = await listUsers(params as { role?: string; q?: string; page?: number; size?: number });
      setUsers(res.items);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : '회원 조회 실패');
    } finally {
      setLoading(false);
    }
  }, [page, q]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  const resetAddForm = () => {
    setAddName('');
    setAddEmail('');
    setAddCounselor(null);
    setSendInvite(true);
    setAddError(null);
    setAddFieldErrors({});
  };

  const closeAddModal = () => {
    setAddOpen(false);
    resetAddForm();
  };

  const handleAddSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedName = addName.trim();
    const normalizedEmail = addEmail.trim();
    const fieldErrors: { email?: string; counselor?: string } = {};

    if (!normalizedName) {
      setAddError('이름을 입력해주세요.');
      return;
    }
    if (!normalizedEmail) {
      fieldErrors.email = '이메일을 입력해주세요.';
    }
    if (!addCounselor) {
      fieldErrors.counselor = '담당 상담사를 선택해주세요.';
    }
    if (Object.keys(fieldErrors).length > 0) {
      setAddFieldErrors(fieldErrors);
      return;
    }

    setAddSubmitting(true);
    setAddError(null);
    setAddFieldErrors({});
    try {
      const result = await createAdminClient({
        name: normalizedName,
        email: normalizedEmail,
        counselor_id: addCounselor!.id,
        send_invite: sendInvite,
      });
      showToast({
        id: `client-added-${Date.now()}`,
        type: 'success',
        title: '회원 추가 완료',
        body: result.invite_sent
          ? `${result.client.name} 님이 추가되었고 ${addCounselor!.name} 상담사와 연결되었습니다. 초대 메일을 발송했습니다.`
          : `${result.client.name} 님이 추가되었고 ${addCounselor!.name} 상담사와 연결되었습니다.`,
      });
      closeAddModal();
      await fetchUsers();
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 409) {
          setAddFieldErrors({ email: '이미 등록된 이메일입니다.' });
        } else if (e.status === 404 || e.status === 422) {
          setAddFieldErrors({ counselor: '선택한 상담사를 찾을 수 없거나 배정할 수 없습니다.' });
        } else {
          setAddError(e.message);
        }
      } else {
        setAddError(e instanceof Error ? e.message : '회원 추가 실패');
      }
    } finally {
      setAddSubmitting(false);
    }
  };

  const handleAction = useCallback(async () => {
    if (!modal) return;

    if (modal.action === 'delete' && modal.step === 1) {
      setModal({ user: modal.user, action: 'delete', step: 2 });
      setDeleteEmailConfirm('');
      return;
    }

    if (modal.action === 'delete' && modal.step === 2) {
      if (deleteEmailConfirm.trim() !== modal.user.email) return;
    }

    setActing(true);
    setError(null);
    try {
      if (modal.action === 'suspend') {
        await suspendUser(modal.user.id, reason);
      } else if (modal.action === 'delete') {
        await deleteUser(modal.user.id);
      } else {
        await unsuspendUser(modal.user.id);
      }
      setModal(null);
      setReason('');
      setDeleteEmailConfirm('');
      await fetchUsers();
    } catch (e) {
      setError(e instanceof Error ? e.message : '처리 실패');
    } finally {
      setActing(false);
    }
  }, [modal, reason, deleteEmailConfirm, fetchUsers]);

  const totalPages = Math.max(1, Math.ceil(total / 20));

  const addButton = (
    <button
      type="button"
      onClick={() => setAddOpen(true)}
      className="px-4 py-2 rounded-xl text-[14px] font-medium text-white bg-[#5F0080] hover:bg-[#4A0066] transition-colors"
    >
      + 회원 추가
    </button>
  );

  return (
    <AppShell title="회원 관리" sub="CLIENT MANAGEMENT" rightSlot={addButton}>
      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 text-red-700 text-sm">{error}</div>
      )}

      <div className="flex flex-col md:flex-row md:items-center gap-3 mb-6">
        <input
          type="text"
          placeholder="이름 또는 이메일 검색..."
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
          className="rounded-xl border border-[#EFEFEF] px-4 py-2 text-[13px] w-full md:w-64 focus:outline-none focus:ring-2 focus:ring-[#5F0080]/20"
        />
        <span className="text-[13px] text-[#6F6F6F]">총 {total}명</span>
      </div>

      {loading ? (
        <div className="text-[#6F6F6F]">불러오는 중...</div>
      ) : users.length === 0 ? (
        <div className="border border-dashed border-[#DDDEE7] rounded-2xl p-12 text-center">
          <div className="text-[#6F6F6F] text-sm mb-4">등록된 회원이 없습니다.</div>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="text-[14px] font-medium text-[#5F0080] hover:underline"
          >
            + 회원 추가로 첫 회원을 등록하세요
          </button>
        </div>
      ) : (
        <>
          <div className="block md:hidden space-y-3">
            {users.map((u) => (
              <div key={u.id} className="bg-white border border-[#EFEFEF] rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-[#1F1F1F]">{u.name}</span>
                  <StatusBadge suspended={u.suspended} />
                </div>
                <div className="text-[13px] text-[#6F6F6F] break-all">{u.email}</div>
                <div className="mt-2">
                  <CounselorCell counselor={u.primary_counselor} />
                </div>
                <div className="text-[12px] text-[#9B9B9B] font-mono mt-1">{formatDate(u.created_at)}</div>
                <div className="flex items-center justify-end gap-3 mt-3">
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
                  <button
                    onClick={() => setModal({ user: u, action: 'delete', step: 1 })}
                    className="text-[13px] font-medium text-[#EF4444] hover:underline"
                  >
                    삭제
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="hidden md:block bg-white border border-[#EFEFEF] rounded-2xl overflow-hidden">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="bg-[#F8FAFC] border-b border-[#EFEFEF]">
                  <th className="text-left px-6 py-3 text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider">이름</th>
                  <th className="text-left px-6 py-3 text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider">이메일</th>
                  <th className="text-left px-6 py-3 text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider">담당 상담사</th>
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
                    <td className="px-6 py-4"><CounselorCell counselor={u.primary_counselor} /></td>
                    <td className="px-6 py-4"><StatusBadge suspended={u.suspended} /></td>
                    <td className="px-6 py-4 text-[#9B9B9B] font-mono text-[12px]">{formatDate(u.created_at)}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
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
                            title="플랫폼 관리자에 의한 계정 정지(로그인 차단)"
                          >
                            정지
                          </button>
                        )}
                        <button
                          onClick={() => setModal({ user: u, action: 'delete', step: 1 })}
                          className="text-[13px] font-medium text-[#EF4444] hover:underline"
                        >
                          삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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

      {/* 정지/해제/삭제 모달 */}
      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => {
            setModal(null);
            setReason('');
            setDeleteEmailConfirm('');
          }}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {modal.action === 'delete' && modal.step === 1 ? (
              <>
                <h3 className="text-[17px] font-bold text-[#1F1F1F] mb-2">회원 삭제</h3>
                <p className="text-[14px] text-[#6F6F6F] mb-2">
                  &quot;{modal.user.name}&quot; ({modal.user.email}) 님을 삭제하시겠습니까?
                </p>
                <ul className="text-[13px] text-[#991B1B] mb-4 list-disc pl-5 space-y-1">
                  <li>세션 기록, 리포트, 뇌파 데이터 등이 영구 삭제될 수 있습니다.</li>
                  <li>이 작업은 되돌릴 수 없습니다.</li>
                </ul>
                <div className="flex items-center gap-3 justify-end">
                  <button
                    onClick={() => setModal(null)}
                    className="px-4 py-2 rounded-xl text-[14px] text-[#6F6F6F] border border-[#EFEFEF]"
                  >
                    취소
                  </button>
                  <button
                    onClick={() => void handleAction()}
                    className="px-4 py-2 rounded-xl text-[14px] font-medium text-white bg-[#EF4444]"
                  >
                    계속
                  </button>
                </div>
              </>
            ) : modal.action === 'delete' && modal.step === 2 ? (
              <>
                <h3 className="text-[17px] font-bold text-[#1F1F1F] mb-2">삭제 확인</h3>
                <p className="text-[14px] text-[#6F6F6F] mb-4">
                  삭제하려면 아래에 회원 이메일을 정확히 입력하세요.
                </p>
                <input
                  type="email"
                  value={deleteEmailConfirm}
                  onChange={(e) => setDeleteEmailConfirm(e.target.value)}
                  placeholder={modal.user.email}
                  className="w-full rounded-xl border border-[#EFEFEF] px-4 py-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#EF4444]/20 mb-4"
                />
                <div className="flex items-center gap-3 justify-end">
                  <button
                    onClick={() => setModal(null)}
                    className="px-4 py-2 rounded-xl text-[14px] text-[#6F6F6F] border border-[#EFEFEF]"
                  >
                    취소
                  </button>
                  <button
                    onClick={() => void handleAction()}
                    disabled={acting || deleteEmailConfirm.trim() !== modal.user.email}
                    className="px-4 py-2 rounded-xl text-[14px] font-medium text-white bg-[#EF4444] disabled:opacity-50"
                  >
                    {acting ? '처리 중...' : '영구 삭제'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-[17px] font-bold text-[#1F1F1F] mb-2">
                  {modal.action === 'suspend' ? '회원 정지' : '정지 해제'}
                </h3>
                <p className="text-[14px] text-[#6F6F6F] mb-4">
                  {modal.action === 'suspend'
                    ? `"${modal.user.name}" (${modal.user.email}) 님을 정지하시겠습니까? 정지 시 로그인 및 서비스 이용이 차단됩니다.`
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
                    onClick={() => void handleAction()}
                    disabled={acting || (modal.action === 'suspend' && !reason.trim())}
                    className={`px-4 py-2 rounded-xl text-[14px] font-medium text-white disabled:opacity-50 ${
                      modal.action === 'suspend' ? 'bg-[#EF4444]' : 'bg-[#10B981]'
                    }`}
                  >
                    {acting ? '처리 중...' : modal.action === 'suspend' ? '정지' : '해제'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 회원 추가 모달 */}
      {addOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={closeAddModal}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[17px] font-bold text-[#1F1F1F] mb-1">회원 추가</h3>
            <p className="text-[13px] text-[#6F6F6F] mb-5">내담자(client) 계정을 생성하고 담당 상담사를 배정합니다.</p>

            {addError && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 text-red-700 text-sm">{addError}</div>
            )}

            <form onSubmit={(e) => void handleAddSubmit(e)} className="space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-[#1F1F1F] mb-1.5">
                  이름 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="홍길동"
                  maxLength={50}
                  className="w-full rounded-xl border border-[#EFEFEF] px-4 py-2.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#5F0080]/20"
                />
              </div>

              <div>
                <label className="block text-[13px] font-medium text-[#1F1F1F] mb-1.5">
                  이메일 <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={addEmail}
                  onChange={(e) => setAddEmail(e.target.value)}
                  placeholder="client@example.com"
                  className="w-full rounded-xl border border-[#EFEFEF] px-4 py-2.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#5F0080]/20"
                />
                {addFieldErrors.email && (
                  <p className="mt-1 text-[12px] text-red-600">{addFieldErrors.email}</p>
                )}
              </div>

              <div>
                <label className="block text-[13px] font-medium text-[#1F1F1F] mb-1.5">
                  담당 상담사 <span className="text-red-500">*</span>
                </label>
                <CounselorPicker
                  selected={addCounselor}
                  onSelect={setAddCounselor}
                  error={addFieldErrors.counselor}
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sendInvite}
                  onChange={(e) => setSendInvite(e.target.checked)}
                  className="rounded border-[#EFEFEF] text-[#5F0080] focus:ring-[#5F0080]/20"
                />
                <span className="text-[14px] text-[#1F1F1F]">초대 메일 발송 (비밀번호 설정 링크)</span>
              </label>

              <div className="flex items-center gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={closeAddModal}
                  className="px-4 py-2 rounded-xl text-[14px] text-[#6F6F6F] border border-[#EFEFEF]"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={addSubmitting || !addCounselor}
                  className="px-4 py-2 rounded-xl text-[14px] font-medium text-white bg-[#5F0080] hover:bg-[#4A0066] disabled:opacity-50"
                >
                  {addSubmitting ? '추가 중...' : '회원 추가'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
