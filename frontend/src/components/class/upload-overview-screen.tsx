// SDD-263: 전체 회차 업로드 현황 목록. 선택 없이 내가 볼 수 있는 회차를 최근순으로 보이고, 행을 누르면 SDD-261 상세 표로 간다.
// 데스크톱=테이블, 390px=카드. 서버 수신 기준 용어만 쓴다(완료·보증·점수 표현 금지).
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useUploadOverview } from '../../hooks/use-upload-overview';
import { listAdminOrganizations, type AdminOrganizationDto } from '../../lib/api/admin';
import type { UploadOverviewItem } from '../../lib/api/upload-overview';
import { useAuthStore } from '../../stores/authStore';
import {
  DEFAULT_OVERVIEW_FILTERS, PERIOD_LABEL, detailPathFor, filterOverview, groupOverview, isLiveSession, overviewStatus, overviewTotals,
  periodSince, sessionStatusLabel, type OverviewFilters, type OverviewGrouping, type OverviewPeriod,
} from '../../lib/upload-status/overview-view';
import { STATUS_ICON, STATUS_LABEL, STATUS_ORDER, formatClock, formatCount } from '../../lib/upload-status/view';
import { UploadStatusLiveBar } from './upload-status-live-bar';

const field = 'min-h-11 min-w-0 rounded-xl border border-[#E8E2ED] bg-white px-3 text-[14px]';
const tone = (k: ReturnType<typeof overviewStatus>) =>
  k === 'needs_attention' ? 'bg-amber-50 text-amber-900' : k === 'uploading' ? 'bg-[#F3E9F8] text-[#5B1A8A]' : 'bg-gray-100 text-gray-700';
const sessionName = (i: UploadOverviewItem) => `${i.class_title ?? '이름 없는 클래스'} · ${i.seq ?? '?'}회차`;
const groupLabel = (by: OverviewGrouping, key: string, label: string) => (by === 'status' ? STATUS_LABEL[key as keyof typeof STATUS_LABEL] : label);

function Badge({ i }: { i: UploadOverviewItem }) {
  const k = overviewStatus(i);
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold ${tone(k)}`}><span aria-hidden="true">{STATUS_ICON[k]}</span>{STATUS_LABEL[k]}</span>;
}

function Counts({ i }: { i: UploadOverviewItem }) {
  const s = i.summary;
  return <>수신 확인 {formatCount(s.received_unreconciled)} · 업로드 중 {formatCount(s.uploading)} · 확인 필요 {formatCount(s.needs_attention)} · 미수신 {formatCount(s.no_data)}</>;
}

function Row({ i, to }: { i: UploadOverviewItem; to: string }) {
  return (
    <li data-testid="overview-row" data-status={overviewStatus(i)} data-session-id={i.session_id} className="border-b border-[#F0EBF2] last:border-b-0">
      <Link to={to} className="grid items-center gap-2 px-4 py-3 text-[14px] hover:bg-[#FAF7FC] md:grid-cols-[1.6fr_0.8fr_0.7fr_2fr_0.9fr_1.2fr]">
        <div className="min-w-0 break-words font-semibold text-[#2C2133]">{sessionName(i)}{i.org_name && <span className="ml-1 text-[12px] font-normal text-[#776D7B]">{i.org_name}</span>}{i.host_name && <span className="block text-[12px] font-normal text-[#776D7B]">{i.host_name} 코치</span>}</div>
        <div className="text-[#4A3F52]">{isLiveSession(i.session_status) && <span aria-hidden="true" className="mr-1 text-[#5B1A8A]">●</span>}{sessionStatusLabel(i.session_status)}</div>
        <div className="text-[#4A3F52]">{formatCount(i.summary.participants)}명</div>
        <div className="text-[13px] text-[#4A3F52]"><Counts i={i} />{i.summary.excluded > 0 && ` · 수집 제외 ${formatCount(i.summary.excluded)}`}{i.band_not_connected > 0 && <span className="block text-[12px] text-[#776D7B]">밴드 연결 안 됨 {formatCount(i.band_not_connected)}명 (미착용 확정 아님)</span>}</div>
        <div className="text-[13px] text-[#776D7B]"><span className="md:hidden">마지막 수신 </span>{formatClock(i.last_received_at)}</div>
        <div><Badge i={i} /></div>
      </Link>
    </li>
  );
}

const HEADERS = ['클래스 · 회차', '회차 상태', '참여자', '서버 수신 요약', '마지막 수신', '확인 상태'];

export function UploadOverviewScreen({ platform = false }: { platform?: boolean }) {
  const role = useAuthStore((s) => s.user?.role);
  const [filters, setFilters] = useState<OverviewFilters>(DEFAULT_OVERVIEW_FILTERS);
  const [grouping, setGrouping] = useState<OverviewGrouping>('none');
  const [orgId, setOrgId] = useState('');
  const [orgs, setOrgs] = useState<AdminOrganizationDto[]>([]);
  const [orgsFailed, setOrgsFailed] = useState(false);
  useEffect(() => {
    if (!platform) return undefined;
    const c = new AbortController();
    listAdminOrganizations('active').then((r) => { if (!c.signal.aborted) setOrgs(r); }, () => { if (!c.signal.aborted) setOrgsFailed(true); });
    return () => c.abort();
  }, [platform]);

  // 기간은 서버 상한(since)에도 보낸다. 시각 문자열은 마운트 시점 기준으로 고정해 불필요한 재조회를 막는다.
  const since = useMemo(() => periodSince(filters.period, new Date()), [filters.period]);
  const needsOrg = platform && !orgId;
  const v = useUploadOverview({ limit: 50, since, orgId: platform ? orgId : null }, !needsOrg);
  const filtered = useMemo(() => filterOverview(v.items ?? [], filters, new Date()), [v.items, filters]);
  const groups = useMemo(() => groupOverview(filtered, grouping), [filtered, grouping]);
  const totals = useMemo(() => overviewTotals(filtered), [filtered]);
  const classOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of v.items ?? []) m.set(i.class_id, i.class_title ?? '이름 없는 클래스');
    return [...m.entries()];
  }, [v.items]);
  const set = <K extends keyof OverviewFilters>(key: K, value: OverviewFilters[K]) => setFilters((f) => ({ ...f, [key]: value }));

  if (v.forbidden) return <p role="alert" className="rounded-2xl border border-[#E9E2EB] bg-white p-6 text-[#4A3F52]">데이터 현황을 볼 권한이 없어요. 기관 관리자에게 문의해 주세요.</p>;
  if (v.error?.status === 401) return <p role="alert" className="rounded-2xl border border-[#E9E2EB] bg-white p-6 text-[#4A3F52]">로그인이 필요해요. 다시 로그인해 주세요.</p>;

  return (
    <div className="space-y-4" data-testid="upload-overview">
      {platform && (
        <label className="flex max-w-sm flex-col gap-1 text-[12px] text-[#776D7B]">기관 · platform_admin
          <select aria-label="기관 선택" className={field} value={orgId} onChange={(e) => { setOrgId(e.target.value); setFilters((f) => ({ ...f, classId: 'all' })); }}>
            <option value="">기관 선택</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
      )}
      {orgsFailed && <p role="alert" className="text-[13px] text-amber-900">기관 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>}
      {needsOrg ? <p role="status" className="rounded-2xl border border-[#E9E2EB] bg-white p-6 text-center text-[#776D7B]">기관 선택 후 해당 기관의 회차를 조회해요.</p> : (
        <>
          <UploadStatusLiveBar paused={v.paused} loading={v.loading} error={v.error} forbidden={v.forbidden} offline={v.offline}
            lastFetchedAt={v.lastFetchedAt} lastReceivedAt={v.lastReceivedAt} onPause={v.pause} onResume={v.resume} onRefresh={v.refresh} />
          <section aria-label="요약" className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-[#E9E2EB] bg-white p-4"><p className="text-[13px] text-[#776D7B]">회차</p><p className="text-[22px] font-bold text-[#2C2133]">{formatCount(totals.sessions)}<span className="text-[14px] font-semibold">개</span></p></div>
            <div className="rounded-2xl border border-[#E9E2EB] bg-white p-4"><p className="text-[13px] text-[#776D7B]">! 확인 필요 회차</p><p className="text-[22px] font-bold text-amber-900">{formatCount(totals.attentionSessions)}<span className="text-[14px] font-semibold">개</span></p></div>
            <div className="rounded-2xl border border-[#E9E2EB] bg-white p-4"><p className="text-[13px] text-[#776D7B]">◷ 등록 건 업로드 중</p><p className="text-[22px] font-bold text-[#2C2133]">{formatCount(totals.uploading)}<span className="text-[14px] font-semibold">명</span></p></div>
            <div className="rounded-2xl border border-[#E9E2EB] bg-white p-4"><p className="text-[13px] text-[#776D7B]">미수신 · 착용 여부 미확인</p><p className="text-[22px] font-bold text-[#2C2133]">{formatCount(totals.no_data)}<span className="text-[14px] font-semibold">명</span></p></div>
          </section>
          {v.truncated && <p role="status" className="rounded-xl bg-amber-50 px-3 py-2 text-[13px] text-amber-900">최근 회차 50개까지만 보여요. 더 오래된 회차는 기간을 좁혀 확인해 주세요.</p>}
          <p className="text-[13px] text-[#776D7B]">ⓘ 서버에서 받은 데이터만 표시해요. 전체 생성 범위와의 대조는 미확인이에요.</p>

          <div className="flex flex-wrap gap-2" role="search">
            <input type="search" aria-label="클래스·코치 검색" placeholder="클래스·코치" value={filters.query} onChange={(e) => set('query', e.target.value)} className={`${field} min-w-0 flex-1`} />
            <select aria-label="클래스 필터" value={filters.classId} onChange={(e) => set('classId', e.target.value)} className={field}>
              <option value="all">전체 클래스</option>{classOptions.map(([id, t]) => <option key={id} value={id}>{t}</option>)}
            </select>
            <select aria-label="상태 필터" value={filters.status} onChange={(e) => set('status', e.target.value as OverviewFilters['status'])} className={field}>
              <option value="all">전체 상태</option>{STATUS_ORDER.map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
            </select>
            <select aria-label="기간 필터" value={filters.period} onChange={(e) => set('period', e.target.value as OverviewPeriod)} className={field}>
              {(Object.keys(PERIOD_LABEL) as OverviewPeriod[]).map((k) => <option key={k} value={k}>{PERIOD_LABEL[k]}</option>)}
            </select>
            <select aria-label="그룹핑" value={grouping} onChange={(e) => setGrouping(e.target.value as OverviewGrouping)} className={field}>
              <option value="none">그룹 없음</option><option value="class">클래스별</option><option value="status">상태별</option><option value="date">날짜별</option>
            </select>
          </div>

          {v.items === null ? <p role="status" className="text-[#776D7B]">불러오는 중이에요…</p>
            : v.items.length === 0 ? <p role="status" className="rounded-2xl border border-[#E9E2EB] bg-white p-6 text-center text-[#776D7B]">조회 기간에 볼 수 있는 회차가 없어요</p>
              : filtered.length === 0 ? <p role="status" className="rounded-2xl border border-[#E9E2EB] bg-white p-6 text-center text-[#776D7B]">조건에 맞는 회차가 없어요</p> : (
                <div className="overflow-hidden rounded-2xl border border-[#E9E2EB] bg-white">
                  <div className="hidden bg-[#FAF7FC] px-4 py-2 text-[12px] text-[#776D7B] md:grid md:grid-cols-[1.6fr_0.8fr_0.7fr_2fr_0.9fr_1.2fr] md:gap-2" aria-hidden="true">
                    {HEADERS.map((h) => <div key={h}>{h}</div>)}
                  </div>
                  {groups.map((g) => (
                    <section key={g.key} aria-label={groupLabel(grouping, g.key, g.label)}>
                      {grouping !== 'none' && <h3 className="border-y border-[#F0EBF2] bg-[#FDFBFE] px-4 py-2 text-[13px] font-semibold text-[#5B1A8A]">{groupLabel(grouping, g.key, g.label)} · {formatCount(g.rows.length)}개 회차</h3>}
                      <ul>{g.rows.map((i) => <Row key={i.session_id} i={i} to={detailPathFor(role, i.class_id, i.session_id)} />)}</ul>
                    </section>
                  ))}
                </div>
              )}
        </>
      )}
    </div>
  );
}
