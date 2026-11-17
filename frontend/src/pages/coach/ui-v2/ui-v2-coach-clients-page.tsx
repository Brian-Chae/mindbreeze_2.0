// SDD-320 F-1 — 코치 회원 목록(시안 members.html). PC 표(검색·필터·그룹핑) / 모바일 카드. 데이터·URL 쿼리 규칙은 기존 ClientListPage 와 같다.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AppShell from '../../../components/layout/AppShell';
import InviteModal from '../../../components/clients/InviteModal';
import { getClientsSummary, listClients, type ClientClassRef, type ClientListFilter, type ClientListItem } from '../../../lib/api/clients';
import { UiV2SummaryCards } from '../../../components/ui-v2/ui-v2-summary-cards';
import { buildClientSummaryCards, type ClientSummaryState } from '../../../lib/client-summary-cards';
import { ApiError } from '../../../lib/api/client';
import { ACTIVE_WITHIN_OPTIONS, formatKst, groupClients, uniqueClientCount, type GroupMode } from '../../../lib/clients/overview';
import { useAuthStore } from '../../../stores/authStore';
import '../../../styles/ui-v2.css';
import '../../../styles/ui-v2-brand.css';
import '../../../styles/ui-v2-coach-pc.css';

const PAGE_SIZE = 20;
const GROUP_PAGE_SIZE = 100;

function classText(classes?: ClientClassRef[]): string {
  return classes && classes.length > 0 ? classes.map((c) => c.title).join(', ') : '미소속';
}
function activityText(c: ClientListItem): string {
  return c.last_activity_at ? `${formatKst(c.last_activity_at)}${c.last_activity_source ? ` · ${c.last_activity_source}` : ''}` : '활동 없음';
}

export function UiV2CoachClientsPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const [params, setParams] = useSearchParams();
  const searchTerm = params.get('q') ?? '';
  const classId = params.get('class') ?? '';
  const days = params.get('days') ? Number(params.get('days')) : null;
  const FILTERS: ClientListFilter[] = ['inactive_14d', 'never_attended', 'week_attended', 'report_unread'];
  const filterParam = params.get('filter') as ClientListFilter | null;
  const filter: ClientListFilter | null = filterParam && FILTERS.includes(filterParam) ? filterParam : null;
  const group: GroupMode = params.get('group') === 'class' ? 'class' : 'none';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const size = group === 'class' ? GROUP_PAGE_SIZE : PAGE_SIZE;
  const [query, setQuery] = useState(searchTerm);
  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [classOptions, setClassOptions] = useState<ClientClassRef[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [showInvite, setShowInvite] = useState(false);
  const [sum, setSum] = useState<ClientSummaryState>({ connected: null, d7: null, d30: null, extra: null });
  const [sumLoaded, setSumLoaded] = useState(false);

  const patchParams = (patch: Record<string, string | null>, resetPage = true): void => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    if (resetPage) next.delete('page');
    setParams(next);
  };
  useEffect(() => { if (isInitialized && !isAuthenticated) navigate('/login?role=counselor'); }, [isInitialized, isAuthenticated, navigate]);
  useEffect(() => {
    if (!isAuthenticated || user?.role !== 'counselor') return;
    let cancelled = false;
    setLoading(true); setError(null);
    listClients({ q: searchTerm || undefined, page, size, class_id: classId || undefined, active_within_days: days ?? undefined, filter: filter ?? undefined })
      .then((res) => { if (cancelled) return; setClients(res.clients); setTotal(res.total); setClassOptions(res.class_options ?? []); })
      .catch((err) => { if (!cancelled) setError(err instanceof ApiError ? err.message : '회원 목록을 불러오지 못했습니다'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [searchTerm, classId, days, filter, page, size, reloadKey, isAuthenticated, user?.role]);
  useEffect(() => { if (!isAuthenticated) { setClients([]); setTotal(0); } }, [isAuthenticated]);
  useEffect(() => {
    if (!isAuthenticated || user?.role !== 'counselor') return;
    let cancelled = false;
    // SDD-324: 전체 범위 요약은 GET /clients/summary 한 번. 실패하면 기존 total 3회 조회로 대체(0 으로 숨기지 않는다).
    getClientsSummary().then((x) => {
      if (cancelled) return;
      setSum({ connected: x.total ?? null, d7: x.active_7d ?? null, d30: x.active_30d ?? null, extra: x });
      setSumLoaded(true);
    }).catch(() => Promise.allSettled([listClients({ size: 1 }), listClients({ size: 1, active_within_days: 7 }), listClients({ size: 1, active_within_days: 30 })]).then(([all, w, m]) => {
      if (cancelled) return;
      setSum({ connected: all.status === 'fulfilled' ? all.value.total : null, d7: w.status === 'fulfilled' ? w.value.total : null, d30: m.status === 'fulfilled' ? m.value.total : null, extra: null });
      setSumLoaded(true);
    }));
    return () => { cancelled = true; };
  }, [reloadKey, isAuthenticated, user?.role]);

  const groups = useMemo(() => groupClients(clients, group), [clients, group]);
  const hasFilter = Boolean(searchTerm || classId || days || filter || group !== 'none');
  const totalPages = Math.max(1, Math.ceil(total / size));
  const submit = (e: FormEvent): void => { e.preventDefault(); patchParams({ q: query.trim() || null }); };
  const reset = (): void => { setQuery(''); setParams(new URLSearchParams()); };
  if (!isInitialized) return null;

  return (
    <AppShell title="한 사람씩 살펴요" rightSlot={<button data-header-action="primary" type="button" onClick={() => setShowInvite(true)} className="mb-btn">회원 초대</button>}>
      <div className="ui-v2 u2f u2f-clients">
        {sumLoaded && <UiV2SummaryCards label="회원 요약" items={buildClientSummaryCards(sum, days, (d) => patchParams({ days: d ? String(d) : null, filter: null }), filter, (f) => patchParams({ filter: f, days: null }))} />}
        <p className="u2f-lead" aria-live="polite">{hasFilter ? '현재 조건' : '목록'} <b>{total}</b>명{group === 'class' && ` · 그룹 ${groups.length}개 (고유 ${uniqueClientCount(groups)}명)`}</p>
        <form onSubmit={submit} className="u2f-filters" aria-label="검색과 필터">
          <label className="u2-search"><span className="sr-only">회원 검색</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름 또는 이메일 검색" aria-label="회원 검색" /></label>
          <select aria-label="소속 클래스" value={classId} onChange={(e) => patchParams({ class: e.target.value || null })}><option value="">전체 클래스</option>{classOptions.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select>
          <select aria-label="최근 활동" value={days ?? ''} onChange={(e) => patchParams({ days: e.target.value || null })}>{ACTIVE_WITHIN_OPTIONS.map((o) => <option key={o.label} value={o.value ?? ''}>{o.label}</option>)}</select>
          <select aria-label="그룹 기준" value={group} onChange={(e) => patchParams({ group: e.target.value === 'class' ? 'class' : null })}><option value="none">그룹 없음</option><option value="class">클래스별 그룹</option></select>
          <button type="submit" className="u2-secondary" style={{ width: 'auto' }}>검색</button>
          <button type="button" className="u2-textlink" onClick={reset} disabled={!hasFilter}>필터 초기화</button>
        </form>
        {loading && <p className="u2-empty" role="status">불러오는 중...</p>}
        {error && <div className="u2-alert" role="alert"><p>{error}</p><button type="button" className="u2-secondary u2-gap" onClick={() => setReloadKey((k) => k + 1)}>다시 시도</button></div>}
        {!loading && !error && clients.length === 0 && <p className="u2-empty">{hasFilter ? <>조건에 맞는 회원이 없어요. <button type="button" className="u2-textlink" onClick={reset}>필터 초기화</button></> : '아직 연결된 회원이 없어요. 회원 초대로 코치 코드를 보내 보세요.'}</p>}
        {!error && clients.length > 0 && groups.map((g) => (
          <section key={g.id} aria-label={g.title}>
            {group === 'class' && <h2 className="u2f-group">{g.title} · {g.clients.length}명</h2>}
            <div className="u2f-table"><div className="u2f-table-box" data-testid="client-table-scroll">
              <div className="u2f-tr u2f-th" aria-hidden="true"><span>회원</span><span>참여 클래스</span><span>최근 활동</span><span>상세</span></div>
              {g.clients.map((c) => (
                <div className="u2f-tr" key={c.id}>
                  <span><b>{c.name}</b><small>{c.email}</small></span>
                  <span>{classText(c.classes)}</span>
                  <span>{activityText(c)}</span>
                  <Link className="u2-secondary" to={`/clients/${c.id}`}>회원 보기</Link>
                </div>
              ))}
            </div></div>
            <div className="u2f-cards">
              {g.clients.map((c) => (
                <article className="u2-card" key={c.id}>
                  <h3>{c.name}</h3>
                  <p className="u2-muted">{c.email}</p>
                  <p className="u2-muted">{classText(c.classes)}</p>
                  <p className="u2-muted">최근 활동 {activityText(c)}</p>
                  <Link className="u2-primary u2f-btn" to={`/clients/${c.id}`}>회원 보기</Link>
                </article>
              ))}
            </div>
          </section>
        ))}
        {totalPages > 1 && <div className="u2-pager">
          <button type="button" onClick={() => patchParams({ page: String(Math.max(1, page - 1)) }, false)} disabled={page <= 1}>이전</button>
          <span>{page} / {totalPages}</span>
          <button type="button" onClick={() => patchParams({ page: String(Math.min(totalPages, page + 1)) }, false)} disabled={page >= totalPages}>다음</button>
        </div>}
        <button type="button" className="u2-primary u2f-btn" onClick={() => setShowInvite(true)}>회원 초대</button>
      </div>
      <InviteModal open={showInvite} onClose={() => setShowInvite(false)} />
    </AppShell>
  );
}
