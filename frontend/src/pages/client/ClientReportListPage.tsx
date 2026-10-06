// 내담자용 리포트 목록 페이지
// AppShell 없이 ClientShell 내에서 동작

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ClientReportDetailModal } from './ClientReportDetailModal';
import { listReports, markAllReportsRead, type ReportDto } from '../../lib/api/reports';
import { useReportStore } from '../../stores/reportStore';

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function TypeBadge({ type }: { type: string }) {
  const isCounselor = type === 'counselor';
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold font-mono ${
        isCounselor ? 'bg-[#F5EDFC] text-[#5F0080]' : 'bg-[#E6F4EA] text-[#2E7D32]'
      }`}
    >
      {isCounselor ? '상담사용' : '내담자용'}
    </span>
  );
}

function StatusBadge({ sentAt }: { sentAt: string | null }) {
  if (sentAt) {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#E0F2FE] text-[#075985]">
        확인 가능
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#FEF3C7] text-[#92400E]">
      대기
    </span>
  );
}

/** 빈 상태 컴포넌트 */
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <svg
        width="48"
        height="48"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#9B9B9B"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mb-3"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
      <p className="text-sm font-medium text-[#1F1F1F] mb-1">아직 리포트가 없어요</p>
      <p className="text-xs text-[#6F6F6F]">세션을 마치면 리포트를 확인할 수 있습니다</p>
    </div>
  );
}

type SortKey = 'newest' | 'oldest' | 'title';
const PAGE_LIMIT = 20;
const SESSION_TYPE_LABELS: Record<string, string> = {
  clinical: '임상심리상담', hypnosis: '최면심리상담', meditation: '명상수업', custom: '기타',
};

function reportTitle(report: ReportDto): string {
  return report.session_title || (typeof report.content?.headline === 'string' ? report.content.headline : '리포트');
}

function reportSummary(report: ReportDto): string {
  const summary = report.content?.summary;
  if (typeof summary === 'string' && summary.trim()) return summary;
  return typeof report.content?.headline === 'string' ? report.content.headline : '';
}

function counselorName(report: ReportDto): string {
  return report.counselor_name || '상담사';
}

function reportKey(report: ReportDto): string {
  return report.id ?? `${report.session_id}-${report.type}-${report.participant_id ?? report.user_id ?? 'unknown'}`;
}

/** 상담사용 목록과 동일하게 현재 조회 페이지를 검색·정렬한다. */
function filterAndSortReports(reports: ReportDto[], search: string, sortKey: SortKey): ReportDto[] {
  const query = search.trim().toLowerCase();
  return reports.filter((report) => {
    const headline = typeof report.content?.headline === 'string' ? report.content.headline : '';
    return !query || [reportTitle(report), report.session_title ?? '', headline, reportSummary(report)]
      .some((text) => text.toLowerCase().includes(query));
  }).sort((a, b) => {
    if (sortKey === 'title') return reportTitle(a).localeCompare(reportTitle(b), 'ko');
    const aTime = new Date(a.scheduled_at ?? a.created_at ?? 0).getTime();
    const bTime = new Date(b.scheduled_at ?? b.created_at ?? 0).getTime();
    return sortKey === 'newest' ? bTime - aTime : aTime - bTime;
  });
}

function groupReportsByCounselor(reports: ReportDto[]) {
  const groups = new Map<string, { counselorName: string; label: string; items: ReportDto[] }>();
  for (const report of reports) {
    const key = counselorName(report);
    const existing = groups.get(key);
    groups.set(key, {
      counselorName: key,
      label: key,
      items: [...(existing?.items ?? []), report],
    });
  }
  return Array.from(groups.values());
}

export default function ClientReportListPage() {
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [reports, setReports] = useState<ReportDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('newest');
  const [groupByCounselor, setGroupByCounselor] = useState(true);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const setReportUnread = useReportStore((s) => s.setUnread);
  const refreshReports = useReportStore((s) => s.refresh);

  // 내담자 리포트 전체 읽음 — 서버 전체 마킹 후 목록 로컬 상태도 즉시 갱신.
  const handleMarkAllRead = async () => {
    if (markingAllRead) return;
    setMarkingAllRead(true);
    setError(null);
    try {
      await markAllReportsRead();
      setReports((prev) => prev.map((r) => ({ ...r, is_read: true })));
      setReportUnread(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : '전체 읽음 처리 실패');
    } finally {
      setMarkingAllRead(false);
    }
  };

  // 리포트 알림 딥링크(?report=ID) → 목록 위에 팝업으로 열기 (전면 페이지 대신).
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const reportId = searchParams.get('report');
    if (!reportId) return;
    setSelectedReportId(reportId);
    // URL을 정리해 뒤로가기·새로고침 시 팝업이 다시 열리지 않게 한다.
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete('report');
      return next;
    }, { replace: true });
  }, [searchParams, setSearchParams]);

  // FUNC-06: 검색어는 서버 쿼리로 내려갈 수 없다(백엔드는 page/limit만 지원).
  // 검색 활성 시 무페이지네이션 전체 로드를 함께 조회해 전 페이지를 대상으로 필터한다.
  const searchActive = search.trim() !== '';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        // 검색 활성 시 전체 로드(전 페이지 검색 보장).
        const full = searchActive ? await listReports() : null;
        // 페이지네이션 계약 유지 — 현재 페이지도 항상 조회한다.
        const result = await listReports({ page, limit: PAGE_LIMIT });
        if (cancelled) return;
        if (full) {
          // 현재 페이지 결과를 우선하고 전체 로드 결과를 뒤에 병합·중복 제거한다.
          // (같은 id 는 현재 페이지 값이 최신이므로 먼저 둔다)
          const seen = new Set<string>();
          const merged = [...result.reports, ...full.reports].filter((report) => {
            const key = reportKey(report);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          setReports(merged);
          setTotal(Math.max(full.total, result.total, merged.length));
        } else {
          setTotal(result.total);
          // 상담사용 화면과 동일하게 페이지네이션 미적용 서버도 지원한다.
          const start = (page - 1) * PAGE_LIMIT;
          setReports(result.reports.length > PAGE_LIMIT
            ? result.reports.slice(start, start + PAGE_LIMIT) : result.reports);
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : '리포트 조회 실패');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [page, reloadKey, searchActive]);

  const filtered = useMemo(() => filterAndSortReports(reports, search, sortKey), [reports, search, sortKey]);
  const grouped = useMemo(() => groupByCounselor ? groupReportsByCounselor(filtered) : null, [groupByCounselor, filtered]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));
  const controlClass = 'h-10 px-4 rounded-xl text-[13px] border border-[#EFEFEF] bg-white text-[#6F6F6F] focus:outline-none focus:ring-2 focus:ring-[#5F0080]/20';
  const pageButtonClass = 'h-11 px-4 rounded-xl text-[13px] font-semibold border border-[#EFEFEF] bg-white text-[#5F0080] hover:bg-[#F5EDFC] disabled:opacity-40 disabled:cursor-not-allowed transition-colors';

  const renderMobileCard = (report: ReportDto) => (
    <button
      key={reportKey(report)} type="button" aria-haspopup="dialog" disabled={!report.id}
      onClick={() => setSelectedReportId(report.id)}
      className="block w-full text-left bg-white border border-[#EFEFEF] rounded-2xl p-4 hover:shadow-md hover:border-[#5F0080]/30 transition-all disabled:cursor-default"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] font-semibold text-[#5F0080]">{counselorName(report)}</span>
        <span className="flex gap-2"><TypeBadge type={report.type} /><StatusBadge sentAt={report.sent_at} /></span>
      </div>
      <div className="flex items-center gap-1.5 mb-1">
        {!report.is_read && (
          <span className="shrink-0 rounded-full bg-[#5F0080] px-2 py-0.5 text-[11px] font-bold text-white">NEW</span>
        )}
        <span className="font-bold text-[15px] text-[#1F1F1F] truncate">{reportTitle(report)}</span>
      </div>
      <div className="text-[13px] font-bold text-[#1F1F1F] font-mono">
        {formatDateTime(report.scheduled_at)}
      </div>
      <p className="mt-2 text-[13px] text-[#6F6F6F] line-clamp-2">{reportSummary(report)}</p>
      <div className="mt-2 text-[11px] text-[#6F6F6F]">
        {SESSION_TYPE_LABELS[report.session_type ?? ''] ?? report.session_type ?? '-'}
      </div>
    </button>
  );

  const renderTable = (items: ReportDto[]) => (
    <table className="w-full text-[14px] min-w-[640px] table-fixed">
      <thead>
        <tr className="bg-[#F8FAFC] border-b border-[#EFEFEF]">
          {['제목', '세션유형', '날짜·시간', '상태', '액션'].map((label, index) => (
            <th key={label} scope="col" className={`text-left px-5 py-3 text-[12px] text-[#6F6F6F] font-mono tracking-wider ${index === 0 ? 'w-[34%]' : index === 2 ? 'w-[25%]' : index === 4 ? 'w-[10%]' : ''}`}>{label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.map((report) => (
          <tr
            key={reportKey(report)} tabIndex={report.id ? 0 : undefined}
            aria-label={report.id ? `${reportTitle(report)} 리포트 보기` : undefined}
            aria-haspopup={report.id ? 'dialog' : undefined}
            onClick={() => { if (report.id) setSelectedReportId(report.id); }}
            onKeyDown={(event) => {
              if (event.target === event.currentTarget && report.id && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                setSelectedReportId(report.id);
              }
            }}
            className={`border-b border-[#EFEFEF] last:border-0 transition-colors ${report.id ? 'hover:bg-[#F8FAFC] cursor-pointer' : ''}`}
          >
            <td className="px-5 py-3.5"><div className="flex items-center gap-1.5">
              {!report.is_read && (
                <span className="shrink-0 rounded-full bg-[#5F0080] px-2 py-0.5 text-[11px] font-bold text-white">NEW</span>
              )}
              <span className="font-bold text-[#1F1F1F] truncate" title={reportTitle(report)}>{reportTitle(report)}</span>
            </div>
              <p className="mt-1 text-[13px] text-[#6F6F6F] line-clamp-2">{reportSummary(report)}</p>
            </td>
            <td className="px-5 py-3.5 text-[13px] text-[#6F6F6F]">{SESSION_TYPE_LABELS[report.session_type ?? ''] ?? report.session_type ?? '-'}</td>
            <td className="px-5 py-3.5 text-[12px] font-bold text-[#1F1F1F] font-mono whitespace-nowrap">{formatDateTime(report.scheduled_at)}</td>
            <td className="px-5 py-3.5"><StatusBadge sentAt={report.sent_at} /></td>
            <td className="px-5 py-3.5">
              <button type="button" aria-haspopup="dialog" disabled={!report.id}
                onClick={(event) => { event.stopPropagation(); setSelectedReportId(report.id); }}
                className="text-[13px] font-semibold text-[#5F0080] hover:underline disabled:text-[#BDBDBD] disabled:no-underline"
              >보기</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="px-4 md:px-8 py-4 md:py-6">
      <div className="pt-4 pb-2 md:flex md:justify-between md:items-center">
        <h2 className="text-lg font-bold text-[#1F1F1F]">리포트</h2>
        <p className="text-xs text-[#6F6F6F] font-mono uppercase tracking-wider">AI REPORTS</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 py-4">
        <input type="search" aria-label="제목·요약 검색" placeholder="제목·요약 검색"
          value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }}
          className={`${controlClass} w-full md:w-64`} />
        <select aria-label="정렬" value={sortKey}
          onChange={(event) => { setSortKey(event.target.value as SortKey); setPage(1); }} className={controlClass}>
          <option value="newest">최신순</option><option value="oldest">오래된순</option><option value="title">제목순</option>
        </select>
        <button type="button" role="switch" aria-checked={groupByCounselor}
          onClick={() => setGroupByCounselor((value) => !value)}
          className={`h-10 px-4 rounded-xl text-[13px] font-semibold border transition-colors ${groupByCounselor ? 'bg-[#F5EDFC] text-[#5F0080] border-[#E8D9F5]' : 'bg-white text-[#6F6F6F] border-[#EFEFEF] hover:bg-[#F8FAFC]'}`}
        >상담사별 그룹핑 {groupByCounselor ? 'ON' : 'OFF'}</button>
        {reports.some((r) => !r.is_read) && (
          <button type="button" onClick={() => void handleMarkAllRead()} disabled={markingAllRead}
            className="h-10 px-4 rounded-xl text-[13px] font-semibold border border-[#E8D9F5] bg-white text-[#5F0080] hover:bg-[#F5EDFC] disabled:opacity-50 transition-colors"
          >{markingAllRead ? '처리 중...' : '전체 읽음'}</button>
        )}
        {!loading && !error && <span className="text-[13px] text-[#6F6F6F] md:ml-auto">{filtered.length} / {total}건</span>}
      </div>
      {loading ? (
        <div role="status" className="text-[#6F6F6F] text-sm text-center py-12">불러오는 중...</div>
      ) : error ? (
        <div className="mx-4 my-6 p-6 rounded-2xl bg-red-50 text-center" role="alert">
          <p className="text-sm text-red-700 mb-4">{error}</p>
          <button type="button" onClick={() => setReloadKey((key) => key + 1)}
            className="rounded-xl px-5 py-2.5 text-sm font-semibold bg-white text-[#1F1F1F] border border-[#EFEFEF] hover:bg-[#F5F5F5] transition-colors"
          >다시 시도</button>
        </div>
      ) : total === 0 ? <EmptyState /> : filtered.length === 0 ? (
        <div className="border border-dashed border-[#DDDEE7] rounded-2xl p-10 text-center">
          <p className="text-[#6F6F6F] text-sm">조건에 맞는 리포트가 없습니다.</p>
          <button type="button" onClick={() => { setSearch(''); setPage(1); }}
            className="mt-3 text-[13px] font-semibold text-[#5F0080] hover:underline">필터 초기화</button>
        </div>
      ) : (
        <>
          <div className="block md:hidden space-y-3">
            {grouped ? grouped.map((group) => (
              <div key={group.counselorName} className="space-y-2">
                <div className="px-1 pt-2 text-[12px] font-bold text-[#5F0080]">
                  {group.label}<span className="ml-2 text-[#9B9B9B] font-normal">{group.items.length}건</span>
                </div>
                {group.items.map(renderMobileCard)}
              </div>
            )) : filtered.map(renderMobileCard)}
          </div>
          <div className="hidden md:block bg-white border border-[#EFEFEF] rounded-2xl overflow-hidden overflow-x-auto">
            {grouped ? grouped.map((group) => (
              <div key={group.counselorName}>
                <div className="px-5 py-2.5 bg-[#F5EDFC]/60 border-b border-[#EFEFEF] text-[12px] font-bold text-[#5F0080]">
                  {group.label}<span className="ml-2 font-normal text-[#6F6F6F]">{group.items.length}건</span>
                </div>
                {renderTable(group.items)}
              </div>
            )) : renderTable(filtered)}
          </div>
        </>
      )}
      {/* 검색 결과가 없어도 다른 페이지로 이동할 수 있다. */}
      {totalPages > 1 && (
        <nav aria-label="리포트 페이지" className="flex items-center justify-center gap-3 pt-4">
          <button type="button" aria-label="이전" disabled={page <= 1 || loading}
            onClick={() => setPage((value) => Math.max(1, value - 1))} className={pageButtonClass}>이전</button>
          <span className="text-[13px] text-[#6F6F6F] font-mono tabular-nums">{page} / {totalPages}</span>
          <button type="button" aria-label="다음" disabled={page >= totalPages || loading}
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))} className={pageButtonClass}>다음</button>
        </nav>
      )}
      {selectedReportId && (
        <ClientReportDetailModal
          reportId={selectedReportId}
          onClose={() => setSelectedReportId(null)}
          onReportChange={(next) => {
            // 열람 시 서버가 is_read를 마킹 — 목록의 NEW 배지와 하단 탭 배지를 즉시 갱신.
            setReports((prev) => prev.map((r) => (r.id === next.id ? { ...r, is_read: true } : r)));
            void refreshReports();
          }}
        />
      )}
    </div>
  );
}
