import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AppShell from '../../components/layout/AppShell';
import { fieldClass as uiFieldClass } from '../../components/ui';
import InviteModal from '../../components/clients/InviteModal';
import { useAuthStore } from '../../stores/authStore';
import { listClients, type ClientClassRef, type ClientCounselorRef, type ClientListItem, type MemberType } from '../../lib/api/clients';
import { ApiError } from '../../lib/api/client';
import MemberTypeBadge from '../../components/clients/MemberTypeBadge';
import { MEMBER_TYPE_HELP } from '../../lib/clients/member-type';
import {
  ACTIVE_WITHIN_OPTIONS,
  ageLabel,
  formatKst,
  genderLabel,
  groupClients,
  readViewMode,
  saveViewMode,
  uniqueClientCount,
  type GroupMode,
  type ViewMode,
} from '../../lib/clients/overview';

const PAGE_SIZE = 20;
// 클래스별 그룹핑은 한 번에 더 많은 회원을 묶어 보여 준다(서버 상한 100).
const GROUP_PAGE_SIZE = 100;

// 공용 입력 규격(SDD-245): 모바일 48 / 데스크톱 44, radius 12
const fieldClass = uiFieldClass('input', 'text-sm');

function initials(name: string): string {
  const t = name.trim();
  return t ? t.charAt(0) : '?';
}

function ClassChips({ classes }: { classes?: ClientClassRef[] }) {
  if (!classes || classes.length === 0) return <span className="text-[#9CA0AE]">미소속</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {classes.map((c) => (
        <span key={c.id} className="rounded-full bg-[#F5EDFC] px-2 py-0.5 text-[12px] text-[#5F0080]">
          {c.title}
        </span>
      ))}
    </div>
  );
}

function ActivityCell({ c }: { c: ClientListItem }) {
  if (!c.last_activity_at) return <span className="text-[#9CA0AE]">활동 없음</span>;
  return (
    <div>
      <div className="font-mono text-[13px] text-[#1F1F1F]">{formatKst(c.last_activity_at)}</div>
      {c.last_activity_source && <div className="text-[12px] text-[#6F6F6F]">{c.last_activity_source}</div>}
    </div>
  );
}

function CounselorCell({ counselors }: { counselors?: ClientCounselorRef[] }) {
  if (!counselors || counselors.length === 0) return <span className="text-[#9CA0AE]">담당 없음</span>;
  return <span className="text-[#1F1F1F]">{counselors.map((c) => c.name ?? '이름 없음').join(', ')}</span>;
}

function ClientTable({ clients, showCounselor }: { clients: ClientListItem[]; showCounselor: boolean }) {
  return (
    <div className="overflow-x-auto" data-testid="client-table-scroll" tabIndex={0} aria-label="회원 표 (가로 스크롤)">
      <table className="w-full min-w-[860px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-[#EFEFEF] bg-[#FBF8FD] text-[12px] text-[#6F6F6F]">
            <th scope="col" className="sticky left-0 z-10 bg-[#FBF8FD] px-4 py-3 font-semibold">이름</th>
            <th scope="col" className="px-4 py-3 font-semibold">성별</th>
            <th scope="col" className="px-4 py-3 font-semibold">만 나이</th>
            <th scope="col" className="px-4 py-3 font-semibold">연락처</th>
            <th scope="col" className="px-4 py-3 font-semibold">최근 활동</th>
            <th scope="col" className="px-4 py-3 font-semibold">소속 클래스</th>
            {showCounselor && <th scope="col" className="px-4 py-3 font-semibold">담당 상담사</th>}
          </tr>
        </thead>
        <tbody>
          {clients.map((c) => (
            <tr key={c.id} className="border-b border-[#F3F0F4] last:border-0 hover:bg-[#FBF8FD]">
              <th scope="row" className="sticky left-0 z-10 bg-white px-4 py-3 font-normal">
                <Link
                  to={`/clients/${c.id}`}
                  className="inline-flex min-h-[44px] flex-col justify-center font-bold text-[#5F0080] hover:underline"
                >
                  {c.name}
                  <span className="text-[12px] font-normal text-[#6F6F6F]">{c.email}</span>
                </Link>
                {showCounselor && <div><MemberTypeBadge type={c.member_type} /></div>}
              </th>
              <td className="px-4 py-3 text-[#1F1F1F]">{genderLabel(c.gender)}</td>
              <td className="px-4 py-3 text-[#1F1F1F]">{ageLabel(c.age)}</td>
              <td className="px-4 py-3 font-mono text-[13px] text-[#1F1F1F]">{c.phone_masked ?? '미입력'}</td>
              <td className="px-4 py-3"><ActivityCell c={c} /></td>
              <td className="px-4 py-3"><ClassChips classes={c.classes} /></td>
              {showCounselor && <td className="px-4 py-3"><CounselorCell counselors={c.counselors} /></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClientCards({ clients, showCounselor }: { clients: ClientListItem[]; showCounselor: boolean }) {
  return (
    <ul className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
      {clients.map((c) => (
        <li key={c.id} className="rounded-[20px] border border-[#EFEFEF] bg-white p-5 hover:border-[#5F0080]">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#F5EDFC] font-bold text-[#5F0080]">
              {initials(c.name)}
            </div>
            <div className="min-w-0 flex-1">
              <Link to={`/clients/${c.id}`} className="inline-flex min-h-[44px] max-w-full flex-col justify-center font-bold text-[#5F0080] hover:underline">
                {c.name}
                <span className="truncate text-[12px] font-normal text-[#6F6F6F]">{c.email}</span>
              </Link>
              {showCounselor && <div><MemberTypeBadge type={c.member_type} /></div>}
              <p className="text-[13px] text-[#6F6F6F]">
                {genderLabel(c.gender)} · {ageLabel(c.age)} · <span className="font-mono">{c.phone_masked ?? '미입력'}</span>
              </p>
              <div className="mt-3"><ActivityCell c={c} /></div>
              <div className="mt-3"><ClassChips classes={c.classes} /></div>
              {showCounselor && (
                <p className="mt-2 text-[13px] text-[#6F6F6F]">담당 상담사 · <CounselorCell counselors={c.counselors} /></p>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function ClientListPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isInitialized = useAuthStore((s) => s.isInitialized);

  // 검색·필터·그룹·페이지는 URL 쿼리에 둔다(뒤로 가기 복원). 연락처 등 개인정보는 넣지 않는다.
  const [params, setParams] = useSearchParams();
  const searchTerm = params.get('q') ?? '';
  const classId = params.get('class') ?? '';
  const counselorId = params.get('counselor') ?? '';
  const memberTypeParam = params.get('member_type');
  const memberType: MemberType | '' = memberTypeParam === 'member' || memberTypeParam === 'non_member' ? memberTypeParam : '';
  const days = params.get('days') ? Number(params.get('days')) : null;
  const group: GroupMode = params.get('group') === 'class' ? 'class' : 'none';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const size = group === 'class' ? GROUP_PAGE_SIZE : PAGE_SIZE;

  const [view, setView] = useState<ViewMode>(readViewMode);
  const [query, setQuery] = useState(searchTerm);
  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [classOptions, setClassOptions] = useState<ClientClassRef[]>([]);
  const [counselorOptions, setCounselorOptions] = useState<ClientCounselorRef[]>([]);
  const isOrgAdmin = user?.role === 'org_admin';
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [showInvite, setShowInvite] = useState(false);

  const patchParams = (patch: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    if (resetPage) next.delete('page');
    setParams(next);
  };

  useEffect(() => {
    if (isInitialized && !isAuthenticated) navigate('/login?role=counselor');
  }, [isInitialized, isAuthenticated, navigate]);

  useEffect(() => {
    if (!isAuthenticated || (user?.role !== 'counselor' && user?.role !== 'org_admin')) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    listClients({
      q: searchTerm || undefined,
      page,
      size,
      class_id: classId || undefined,
      active_within_days: days ?? undefined,
      counselor_id: isOrgAdmin && counselorId ? counselorId : undefined,
      member_type: isOrgAdmin && memberType ? memberType : undefined,
    })
      .then((res) => {
        if (cancelled) return;
        setClients(res.clients);
        setTotal(res.total);
        setClassOptions(res.class_options ?? []);
        setCounselorOptions(res.counselor_options ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : '회원 목록을 불러오지 못했습니다');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [searchTerm, classId, counselorId, memberType, days, page, size, reloadKey, isAuthenticated, user?.role, isOrgAdmin]);

  // 로그아웃 시 메모리 캐시 폐기
  useEffect(() => {
    if (!isAuthenticated) {
      setClients([]);
      setTotal(0);
    }
  }, [isAuthenticated]);

  const groups = useMemo(() => groupClients(clients, group), [clients, group]);
  const hasFilter = Boolean(searchTerm || classId || counselorId || memberType || days || group !== 'none');

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    patchParams({ q: query.trim() || null });
  };

  const resetFilters = () => {
    setQuery('');
    setParams(new URLSearchParams());
  };

  const changeView = (mode: ViewMode) => {
    setView(mode);
    saveViewMode(mode);
  };

  if (!isInitialized) return null;

  if (user && user.role !== 'counselor' && user.role !== 'org_admin') {
    return (
      <AppShell title="회원">
        <div className="flex items-center justify-center py-24">
          <div className="max-w-md text-center">
            <h1 className="mb-2 text-xl font-bold text-[#1F1F1F]">접근 권한이 없습니다</h1>
            <p className="text-sm text-[#6F6F6F]">상담사·기관관리자 전용 페이지입니다.</p>
          </div>
        </div>
      </AppShell>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / size));

  const rightSlot = (
    <button data-header-action="primary" type="button" onClick={() => setShowInvite(true)} className="mb-btn">
      회원 초대
    </button>
  );

  return (
    <AppShell title="회원" sub="CLIENTS" rightSlot={rightSlot} wide>
      <div className="mx-auto w-full max-w-mb-content space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[#6F6F6F]" aria-live="polite">
            전체 <b className="text-[#5F0080]">{total}</b>명
            {group === 'class' && ` · 그룹 ${groups.length}개 (복수 클래스 회원은 각 그룹에 표시, 고유 ${uniqueClientCount(groups)}명)`}
          </p>
          <div role="group" aria-label="보기 전환" className="flex rounded-[13px] border border-[#DDDEE7] bg-white p-1">
            {(['table', 'cards'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={view === mode}
                onClick={() => changeView(mode)}
                className={`min-h-[40px] min-w-[76px] rounded-[10px] px-3 text-sm ${
                  view === mode ? 'bg-[#F5EDFC] font-bold text-[#5F0080]' : 'text-[#6F6F6F]'
                }`}
              >
                {mode === 'table' ? '표' : '카드'}
              </button>
            ))}
          </div>
        </div>

        {isOrgAdmin && (
          <p className="text-[13px] text-[#6F6F6F]" data-testid="member-type-help">
            <b>회원</b> = {MEMBER_TYPE_HELP.member} · <b>비회원</b> = {MEMBER_TYPE_HELP.non_member}
          </p>
        )}

        <section aria-label="검색과 필터" className="rounded-[20px] border border-[#E6E3E6] bg-white p-5">
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              type="text"
              aria-label="회원 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="이름 또는 이메일 검색"
              className="h-12 min-w-0 flex-1 rounded-[12px] border border-[#DDDEE7] bg-white px-4 text-sm text-[#1F1F1F] outline-none placeholder:text-[#9CA0AE] focus:border-[#5F0080] focus:ring-2 focus:ring-purple-900/15"
            />
            <button type="submit" className="mb-btn mb-btn--ghost">검색</button>
          </form>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="grid min-w-[145px] flex-1 gap-1.5 text-[12px] text-[#6F6F6F]">
              소속 클래스
              <select
                className={fieldClass}
                value={classId}
                onChange={(e) => patchParams({ class: e.target.value || null })}
              >
                <option value="">전체</option>
                {classOptions.map((c) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
            </label>
            {isOrgAdmin && (
              <label className="grid min-w-[145px] flex-1 gap-1.5 text-[12px] text-[#6F6F6F]">
                회원 구분
                <select
                  className={fieldClass}
                  value={memberType}
                  onChange={(e) => patchParams({ member_type: e.target.value || null })}
                >
                  <option value="">전체</option>
                  <option value="member">회원</option>
                  <option value="non_member">비회원</option>
                </select>
              </label>
            )}
            {isOrgAdmin && (
              <label className="grid min-w-[145px] flex-1 gap-1.5 text-[12px] text-[#6F6F6F]">
                담당 상담사
                <select
                  className={fieldClass}
                  value={counselorId}
                  onChange={(e) => patchParams({ counselor: e.target.value || null })}
                >
                  <option value="">전체</option>
                  {counselorOptions.map((c) => (
                    <option key={c.id} value={c.id}>{c.name ?? '이름 없음'}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="grid min-w-[145px] flex-1 gap-1.5 text-[12px] text-[#6F6F6F]">
              최근 활동
              <select
                className={fieldClass}
                value={days ?? ''}
                onChange={(e) => patchParams({ days: e.target.value || null })}
              >
                {ACTIVE_WITHIN_OPTIONS.map((o) => (
                  <option key={o.label} value={o.value ?? ''}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="grid min-w-[145px] flex-1 gap-1.5 text-[12px] text-[#6F6F6F]">
              그룹핑
              <select
                className={fieldClass}
                value={group}
                onChange={(e) => patchParams({ group: e.target.value === 'class' ? 'class' : null })}
              >
                <option value="none">그룹 없음</option>
                <option value="class">클래스별</option>
              </select>
            </label>
            <button
              type="button"
              onClick={resetFilters}
              disabled={!hasFilter}
              className="min-h-[44px] px-3 text-sm text-[#5F0080] disabled:opacity-40"
            >
              필터 초기화
            </button>
          </div>
        </section>

        {loading && <p className="py-8 text-center text-[#6F6F6F]">불러오는 중...</p>}
        {error && (
          <div role="alert" className="py-8 text-center text-red-600">
            <p>{error}</p>
            <button type="button" className="mb-btn mb-btn--ghost mt-3" onClick={() => setReloadKey((k) => k + 1)}>
              다시 시도
            </button>
          </div>
        )}

        {!loading && !error && clients.length === 0 && (
          <div className="rounded-[20px] border border-[#EFEFEF] bg-white p-12 text-center text-[#6F6F6F]">
            {hasFilter ? (
              <>
                조건에 맞는 회원이 없습니다.{' '}
                <button type="button" className="text-[#5F0080] underline" onClick={resetFilters}>필터 초기화</button>
              </>
            ) : (
              '등록된 회원이 없습니다.'
            )}
          </div>
        )}

        {!error && clients.length > 0 && (
          <>
            {view === 'table' && (
              <p className="text-[12px] text-[#6F6F6F] md:hidden">표를 좌우로 밀어 모든 열을 볼 수 있습니다.</p>
            )}
            {groups.map((g) => (
              <section key={g.id} aria-label={g.title} className="overflow-hidden rounded-[20px] border border-[#E6E3E6] bg-white">
                {group === 'class' && (
                  <h2 className="border-b border-[#EFEFEF] bg-[#FBF8FD] px-4 py-3 text-[15px] font-bold text-[#1F1F1F]">
                    {g.title} <span className="text-[13px] font-normal text-[#6F6F6F]">{g.clients.length}명</span>
                  </h2>
                )}
                {view === 'table' ? <ClientTable clients={g.clients} showCounselor={isOrgAdmin} /> : <ClientCards clients={g.clients} showCounselor={isOrgAdmin} />}
              </section>
            ))}
          </>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => patchParams({ page: String(Math.max(1, page - 1)) }, false)}
              disabled={page <= 1}
              className="mb-btn mb-btn--ghost disabled:opacity-40"
            >
              이전
            </button>
            <span className="font-mono text-sm text-[#6F6F6F]">{page} / {totalPages}</span>
            <button
              type="button"
              onClick={() => patchParams({ page: String(Math.min(totalPages, page + 1)) }, false)}
              disabled={page >= totalPages}
              className="mb-btn mb-btn--ghost disabled:opacity-40"
            >
              다음
            </button>
          </div>
        )}
      </div>
      <InviteModal open={showInvite} onClose={() => setShowInvite(false)} />
    </AppShell>
  );
}
