// SDD-265: 데이터 현황 목록(숫자 중심 상황판, 시안 안3-A). 최근 10건 페이지, 확인할 곳 먼저·정상은 접기.
// 전송 현황·참여자 도착·데이터 크기·측정 길이·마지막 도착을 숫자로 보이고, 조치는 짧은 한 줄만 둔다.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useUploadOverview } from '../../hooks/use-upload-overview';
import { listAdminOrganizations, type AdminOrganizationDto } from '../../lib/api/admin';
import type { UploadOverviewItem } from '../../lib/api/upload-overview';
import { useAuthStore } from '../../stores/authStore';
import {
  BOARD_LABEL, BOARD_ORDER, COACH_OK_NOTE, percentText, arrivedText, attentionCount, boardState, coachAction, finalPendingCount, showFinalPending, FINAL_PENDING_COACH, formatBytes, formatMinutes,
  formatTotalHours, transferPercent, type BoardState,
} from '../../lib/upload-status/board';
import { PERIOD_LABEL, detailPathFor, periodSince, type OverviewPeriod } from '../../lib/upload-status/overview-view';
import { formatClock, formatCount } from '../../lib/upload-status/view';
import { FinalPendingChip, Metric, StateBadge, TransferBar, cardClass, fieldClass } from './upload-board-parts';
import { UploadStatusLiveBar } from './upload-status-live-bar';

export const PAGE_LIMIT = 10;
type StateFilter = BoardState | 'all';

const sessionName = (i: UploadOverviewItem) => `${i.class_title ?? '이름 없는 클래스'} · ${i.seq ?? '?'}회차`;
const dateText = (iso: string | null): string => {
  if (!iso) return '일정 미정';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '일정 미정' : d.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
};

function Num({ value, label, children }: { value: string; label: string; children?: ReactNode }) {
  return <div className="min-w-0"><b className="block text-[14px] md:text-[17px]">{value}</b><small className="block text-[10px] text-[#776D7B] md:text-[12px]">{label}</small>{children}</div>;
}

function Row({ i, to }: { i: UploadOverviewItem; to: string }) {
  const state = boardState(i);
  const n = attentionCount(i);
  const percent = transferPercent(i.metrics, i.progress?.overall, state === 'ok');
  const action = coachAction(state, n);
  const showFinal = showFinalPending(state, finalPendingCount(i));
  return (
    <li data-testid="overview-row" data-state={state} data-session-id={i.session_id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 border-t border-[#EEE8F1] px-3 py-1 md:grid-cols-[1.3fr_3fr_auto] md:gap-y-1.5 md:px-4 md:py-3">
      <div className="min-w-0">
        <b className="block break-words text-[13px] md:text-[14px]">{sessionName(i)}</b>
        <small className="text-[12px] text-[#776D7B]">{dateText(i.session_at)} · 마지막 도착 {formatClock(i.last_received_at)}{i.org_name ? ` · ${i.org_name}` : ''}{i.host_name ? ` · ${i.host_name} 코치` : ''}</small>
      </div>
      <div className="order-3 col-span-2 grid grid-cols-5 items-start gap-1.5 md:order-none md:col-span-1 md:gap-2.5">
        <div className="min-w-0"><StateBadge state={state} label={state === 'warn' ? `${BOARD_LABEL.warn} ${n}명` : BOARD_LABEL[state]} className="!px-1.5 text-[10px] md:!px-2.5 md:text-[12px]" />{showFinal && <FinalPendingChip className="mt-1 !px-1.5 !text-[10px] md:!text-[12px]" />}</div>
        <Num value={arrivedText(i.metrics)} label="도착한 참여자" />
        <Num value={percentText(percent)} label="전송 현황"><TransferBar percent={percent} thin /></Num>
        <Num value={formatBytes(i.metrics.bytes_arrived)} label="데이터 크기" />
        <Num value={formatMinutes(i.metrics.duration_min)} label={i.metrics.participant_minutes_total === null ? '측정 길이' : `합계 ${formatTotalHours(i.metrics.participant_minutes_total)}`} />
      </div>
      <Link to={to} aria-label={`${sessionName(i)} 상세`} className="inline-flex min-h-11 items-center rounded-[10px] border border-[#E8E2ED] bg-white px-3 text-[14px] text-[#5F0080]">상세</Link>
      {showFinal && <p data-testid="final-pending-line" className="order-4 col-span-2 text-[12px] text-[#655173] md:order-none md:col-span-3">{FINAL_PENDING_COACH}</p>}
      {(action || state === 'ok') && <p className={`order-4 col-span-2 text-[12px] md:order-none md:col-span-3 ${state === 'warn' ? 'text-[#805000]' : 'text-[#776D7B]'}`}>{action ?? COACH_OK_NOTE}</p>}
    </li>
  );
}

export function UploadOverviewScreen({ platform = false }: { platform?: boolean }) {
  const role = useAuthStore((s) => s.user?.role);
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [period, setPeriod] = useState<OverviewPeriod>('30d');
  const [orgId, setOrgId] = useState('');
  const [orgs, setOrgs] = useState<AdminOrganizationDto[]>([]);
  const [orgsFailed, setOrgsFailed] = useState(false);
  // 커서 스택: cursors[page] 가 그 페이지의 시작 커서(첫 페이지 null).
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const page = cursors.length - 1;
  useEffect(() => {
    if (!platform) return undefined;
    const c = new AbortController();
    listAdminOrganizations('active').then((r) => { if (!c.signal.aborted) setOrgs(r); }, () => { if (!c.signal.aborted) setOrgsFailed(true); });
    return () => c.abort();
  }, [platform]);

  const since = useMemo(() => periodSince(period, new Date()), [period]);
  const needsOrg = platform && !orgId;
  const v = useUploadOverview(
    { limit: PAGE_LIMIT, since, orgId: platform ? orgId : null, cursor: cursors[page], needsAttentionOnly: stateFilter === 'warn' },
    !needsOrg,
  );
  const resetPaging = () => setCursors([null]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (v.items ?? [])
      .filter((i) => (!q || `${i.class_title ?? ''} ${i.seq ?? ''}회차 ${i.host_name ?? ''}`.toLowerCase().includes(q)) && (stateFilter === 'all' || boardState(i) === stateFilter));
  }, [v.items, query, stateFilter]);
  const groups = useMemo(() => BOARD_ORDER.map((s) => ({ state: s, rows: rows.filter((i) => boardState(i) === s) })).filter((g) => g.rows.length > 0), [rows]);
  const all = v.items ?? [];
  const hero = {
    warnSessions: all.filter((i) => boardState(i) === 'warn').length,
    people: all.reduce((n, i) => n + attentionCount(i), 0),
    live: all.filter((i) => boardState(i) === 'live').length,
    ok: all.filter((i) => boardState(i) === 'ok').length,
  };

  if (v.forbidden) return <p role="alert" className="rounded-2xl border border-[#E8E2ED] bg-white p-6 text-[#4A3F52]">데이터 현황을 볼 권한이 없어요. 기관 관리자에게 문의해 주세요.</p>;
  if (v.error?.status === 401) return <p role="alert" className="rounded-2xl border border-[#E8E2ED] bg-white p-6 text-[#4A3F52]">로그인이 필요해요. 다시 로그인해 주세요.</p>;

  return (
    <div className="space-y-2 md:space-y-3" data-testid="upload-overview">
      {platform && (
        <label className="flex max-w-sm flex-col gap-1 text-[12px] text-[#776D7B]">기관 · platform_admin
          <select aria-label="기관 선택" className={fieldClass} value={orgId} onChange={(e) => { setOrgId(e.target.value); resetPaging(); }}>
            <option value="">기관 선택</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
      )}
      {orgsFailed && <p role="alert" className="text-[13px] text-amber-900">기관 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>}
      {needsOrg ? <p role="status" className={`${cardClass} text-center text-[#776D7B]`}>기관 선택 후 해당 기관의 회차를 조회해요.</p> : (
        <>
          <section aria-label="요약" className={`${cardClass} border-t-[3px] border-t-[#5F0080] !p-3 md:!p-5`}>
            <p className="hidden text-[12px] text-[#776D7B] md:block">최근 {formatCount(PAGE_LIMIT)}회차 · 확인할 곳 먼저</p>
            <h2 className="text-[16px] font-bold md:text-[18px]">{hero.warnSessions > 0 ? `확인할 회차 ${formatCount(hero.warnSessions)}건` : '확인할 회차가 없어요'}</h2>
            <div className="mt-2 grid grid-cols-4 gap-1.5 md:mt-3 md:gap-3">
              <Metric compact testId="hero-people" title="확인할 사람" value={`${formatCount(hero.people)}명`} />
              <Metric compact title="측정 중" value={`${formatCount(hero.live)}회차`} />
              <Metric compact title="모두 도착" value={`${formatCount(hero.ok)}회차`} />
              <Metric compact title="이 쪽 회차" value={`${formatCount(all.length)}건`} />
            </div>
          </section>

          <div className="flex flex-wrap gap-2" role="search">
            <input type="search" aria-label="회차 검색" placeholder="클래스·회차 검색" value={query} onChange={(e) => setQuery(e.target.value)} className={`${fieldClass} min-w-0 flex-1`} />
            <select aria-label="상태 필터" value={stateFilter} onChange={(e) => { setStateFilter(e.target.value as StateFilter); resetPaging(); }} className={`${fieldClass} w-[120px] md:w-auto`}>
              <option value="all">전체 상태</option>{BOARD_ORDER.map((s) => <option key={s} value={s}>{BOARD_LABEL[s]}</option>)}
            </select>
            <select aria-label="기간 필터" value={period} onChange={(e) => { setPeriod(e.target.value as OverviewPeriod); resetPaging(); }} className={`${fieldClass} w-[120px] md:w-auto`}>
              {(Object.keys(PERIOD_LABEL) as OverviewPeriod[]).map((k) => <option key={k} value={k}>{PERIOD_LABEL[k]}</option>)}
            </select>
          </div>
          <UploadStatusLiveBar paused={v.paused} loading={v.loading} error={v.error} forbidden={v.forbidden} offline={v.offline}
            lastFetchedAt={v.lastFetchedAt} lastReceivedAt={v.lastReceivedAt} compactMobile onPause={v.pause} onResume={v.resume} onRefresh={v.refresh} />

          {v.items === null ? <p role="status" className="text-[#776D7B]">불러오는 중이에요…</p>
            : v.items.length === 0 ? <p role="status" className={`${cardClass} text-center text-[#776D7B]`}>조회 기간에 볼 수 있는 회차가 없어요</p>
              : rows.length === 0 ? <p role="status" className={`${cardClass} text-center text-[#776D7B]`}>조건에 맞는 회차가 없어요</p> : (
                <div id="overview-rows">
                  {groups.map((g) => (
                    <details key={g.state} open={g.state !== 'ok'} data-testid={`group-${g.state}`} className="my-1.5 overflow-hidden rounded-[20px] border border-[#E8E2ED] bg-white md:my-2">
                      <summary className="min-h-11 cursor-pointer px-3 py-2.5 font-bold text-[#655173] md:px-4 md:py-3">{g.state === 'warn' ? '확인할 곳 먼저' : BOARD_LABEL[g.state]} · {formatCount(g.rows.length)}회차</summary>
                      <ul>{g.rows.map((i) => <Row key={i.session_id} i={i} to={detailPathFor(role, i.class_id, i.session_id)} />)}</ul>
                    </details>
                  ))}
                </div>
              )}

          <nav aria-label="페이지" className="flex items-center justify-between">
            <button type="button" data-testid="page-prev" disabled={page === 0} onClick={() => setCursors((c) => c.slice(0, -1))} className={`${fieldClass} disabled:opacity-40`}>이전</button>
            <span data-testid="page-info" className="text-[13px] text-[#776D7B]">{page + 1}쪽 · 한 쪽에 {formatCount(PAGE_LIMIT)}회차</span>
            <button type="button" data-testid="page-next" disabled={!v.hasMore} onClick={() => { const c = v.nextCursor; if (c) setCursors((s) => [...s, c]); }} className={`${fieldClass} disabled:opacity-40`}>다음</button>
          </nav>
          <p className="hidden text-[11px] text-[#776D7B] md:block">서버에 도착한 기록 기준이에요. 데이터 크기와 측정 길이는 도착한 기록에서 계산해요.</p>
        </>
      )}
    </div>
  );
}
