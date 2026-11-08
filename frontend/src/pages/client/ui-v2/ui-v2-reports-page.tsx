// SDD-318 — 리포트 목록(D안). 검색·정렬·코치별 그룹·전체 읽음·페이지네이션·딥링크(?report=)·검토 중 비노출을 그대로 보존한다.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UiV2ClientShell } from '../../../components/ui-v2/ui-v2-client-shell';
import { UiV2ArcRing } from '../../../components/ui-v2/ui-v2-arc-ring';
import { UiV2ReportSheet } from '../../../components/ui-v2/ui-v2-report-sheet';
import { useMobileSwipeProtection } from '../../../hooks/use-mobile-swipe-protection';
import { listReports, markAllReportsRead, type ReportDto } from '../../../lib/api/reports';
import { useReportStore } from '../../../stores/reportStore';
import { isReportDelayed, isReportInReview, REPORT_IN_REVIEW_BADGE, REPORT_IN_REVIEW_DELAYED_NOTICE } from '../../../lib/report-review-copy';

type SortKey = 'newest' | 'oldest' | 'title';
const PAGE_LIMIT = 20;
const SORT_LABEL: Record<SortKey, string> = { newest: '최신순', oldest: '오래된순', title: '제목순' };

const sessionTitle = (r: ReportDto) => r.session_title || (typeof r.content?.headline === 'string' ? r.content.headline : '리포트');
/** B8: 서사 제목(content.headline)이 있으면 제목, 회차 제목은 부제. 없으면 기존 제목 유지. */
const narrative = (r: ReportDto) => (typeof r.content?.headline === 'string' && r.content.headline.trim() && !isReportInReview(r) ? r.content.headline.trim() : '');
const title = (r: ReportDto) => narrative(r) || sessionTitle(r);
const coach = (r: ReportDto) => r.counselor_name || '코치';
const keyOf = (r: ReportDto) => r.id ?? `${r.session_id}-${r.type}-${r.participant_id ?? r.user_id ?? 'unknown'}`;
function summary(r: ReportDto): string {
  if (isReportInReview(r)) return '';
  const s = r.content?.summary;
  if (typeof s === 'string' && s.trim()) return s;
  return typeof r.content?.headline === 'string' ? r.content.headline : '';
}
function shortDate(iso: string | null): string {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}` : '';
}
function filterSort(reports: ReportDto[], search: string, sort: SortKey): ReportDto[] {
  const q = search.trim().toLowerCase();
  return reports.filter((r) => !q || [title(r), sessionTitle(r), summary(r)].some((t) => t.toLowerCase().includes(q))).sort((a, b) => {
    if (sort === 'title') return title(a).localeCompare(title(b), 'ko');
    const at = new Date(a.scheduled_at ?? a.created_at ?? 0).getTime();
    const bt = new Date(b.scheduled_at ?? b.created_at ?? 0).getTime();
    return sort === 'newest' ? bt - at : at - bt;
  });
}

export function UiV2ReportsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reports, setReports] = useState<ReportDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');
  const [group, setGroup] = useState(true);
  const [marking, setMarking] = useState(false);
  useMobileSwipeProtection(() => marking);
  const setUnread = useReportStore((s) => s.setUnread);
  const refreshReports = useReportStore((s) => s.refresh);
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    const id = params.get('report');
    if (!id) return;
    setSelectedId(id);
    setParams((prev) => { const next = new URLSearchParams(prev); next.delete('report'); return next; }, { replace: true });
  }, [params, setParams]);

  const searchActive = search.trim() !== '';
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    (async () => {
      try {
        const full = searchActive ? await listReports() : null;
        const result = await listReports({ page, limit: PAGE_LIMIT });
        if (cancelled) return;
        if (full) {
          const seen = new Set<string>();
          const merged = [...result.reports, ...full.reports].filter((r) => { const k = keyOf(r); if (seen.has(k)) return false; seen.add(k); return true; });
          setReports(merged); setTotal(Math.max(full.total, result.total, merged.length));
        } else {
          setTotal(result.total);
          const start = (page - 1) * PAGE_LIMIT;
          setReports(result.reports.length > PAGE_LIMIT ? result.reports.slice(start, start + PAGE_LIMIT) : result.reports);
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : '리포트 조회 실패');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [page, reloadKey, searchActive]);

  const handleMarkAll = async () => {
    if (marking) return;
    setMarking(true); setError(null);
    try {
      await markAllReportsRead();
      setReports((prev) => prev.map((r) => (isReportInReview(r) ? r : { ...r, is_read: true })));
      setUnread(0);
    } catch (e) { setError(e instanceof Error ? e.message : '전체 읽음 처리 실패'); } finally { setMarking(false); }
  };

  const filtered = useMemo(() => filterSort(reports, search, sort), [reports, search, sort]);
  const grouped = useMemo(() => {
    if (!group) return null;
    const map = new Map<string, ReportDto[]>();
    for (const r of filtered) map.set(coach(r), [...(map.get(coach(r)) ?? []), r]);
    return Array.from(map.entries());
  }, [group, filtered]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));
  const nextSort = (): SortKey => (sort === 'newest' ? 'oldest' : sort === 'oldest' ? 'title' : 'newest');

  const card = (r: ReportDto, first: boolean) => {
    const inReview = isReportInReview(r);
    const unread = !r.is_read && !inReview;
    return (
      <button key={keyOf(r)} type="button" aria-haspopup="dialog" disabled={!r.id} onClick={() => setSelectedId(r.id)} className="u2-card" style={{ width: '100%', textAlign: 'left' }}>
        {first && <UiV2ArcRing variant="card" />}
        <div className="u2-row"><span className="u2-chip">{inReview ? REPORT_IN_REVIEW_BADGE : unread ? '안 읽음' : r.sent_at ? '읽음' : '대기'}</span><small>{shortDate(r.scheduled_at ?? r.created_at)}</small></div>
        <h2 style={{ marginTop: 12, fontSize: 21 }}>{title(r)}</h2>
        {narrative(r) && sessionTitle(r) !== narrative(r) && <p className="u2-muted" style={{ fontSize: 13, marginTop: 4 }}>{sessionTitle(r)}</p>}
        {inReview ? <p className="u2-muted" style={{ fontSize: 14 }}>코치가 리포트를 확인하고 있어요.</p> : summary(r) && <p className="u2-muted" style={{ fontSize: 14, lineHeight: 1.75 }}>{summary(r)}</p>}
        {isReportDelayed(r) && <p className="u2-muted" style={{ fontSize: 12 }}>{REPORT_IN_REVIEW_DELAYED_NOTICE}</p>}
        {!inReview && <div className="u2-textlink" aria-hidden="true">{unread ? '리포트 읽기 ↗' : '다시 읽기 ↗'}</div>}
      </button>
    );
  };

  return (
    <UiV2ClientShell title="나의 리포트" subtitle="함께한 시간, 차곡차곡 남은 기록.">
      <label className="u2-search">
        <svg className="u2-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M16 16l5 5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0" /></svg>
        <input type="search" aria-label="제목·요약 검색" placeholder="제목이나 내용 검색" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </label>
      <div className="u2-tools">
        <button type="button" aria-label={`정렬: ${SORT_LABEL[sort]}`} onClick={() => { setSort(nextSort()); setPage(1); }}>{SORT_LABEL[sort]} ↓</button>
        <button type="button" role="switch" aria-checked={group} onClick={() => setGroup((v) => !v)}>코치별 묶기 {group ? '✓' : ''}</button>
        {reports.some((r) => !r.is_read && !isReportInReview(r)) && <button type="button" onClick={() => void handleMarkAll()} disabled={marking}>{marking ? '처리 중...' : '전체 읽음'}</button>}
        {!loading && !error && <small style={{ alignSelf: 'center', marginLeft: 'auto' }}>{filtered.length} / {total}건</small>}
      </div>
      {loading ? <p className="u2-empty" role="status">불러오는 중...</p>
        : error ? <div className="u2-alert" role="alert"><p>{error}</p><button type="button" className="u2-secondary u2-gap" onClick={() => setReloadKey((k) => k + 1)}>다시 시도</button></div>
        : total === 0 ? <div className="u2-empty"><p>아직 리포트가 없어요</p><p className="u2-footnote">클래스를 마치면 리포트를 확인할 수 있어요</p></div>
        : filtered.length === 0 ? <div className="u2-empty"><p>조건에 맞는 리포트가 없어요.</p><button type="button" className="u2-textlink" onClick={() => { setSearch(''); setPage(1); }}>필터 초기화</button></div>
        : grouped ? grouped.map(([name, items], gi) => (
          <section key={name} aria-label={name}>
            <div className="u2-section-head u2-row"><h2>지도사 {name}</h2><small>{items.length}개</small></div>
            {items.map((r, i) => card(r, gi === 0 && i === 0))}
          </section>
        )) : filtered.map((r, i) => card(r, i === 0))}
      {totalPages > 1 && (
        <nav aria-label="리포트 페이지" className="u2-pager">
          <button type="button" aria-label="이전" disabled={page <= 1 || loading} onClick={() => setPage((v) => Math.max(1, v - 1))}>이전</button>
          <span className="u2-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>{page} / {totalPages}</span>
          <button type="button" aria-label="다음" disabled={page >= totalPages || loading} onClick={() => setPage((v) => Math.min(totalPages, v + 1))}>다음</button>
        </nav>
      )}
      {selectedId && (
        <UiV2ReportSheet reportId={selectedId} onClose={() => setSelectedId(null)} onReportChange={(next) => {
          setReports((prev) => prev.map((r) => (r.id !== next.id || isReportInReview(next) ? r : { ...r, is_read: true, in_review: false, sent_at: next.sent_at ?? r.sent_at })));
          void refreshReports();
        }} />
      )}
    </UiV2ClientShell>
  );
}
