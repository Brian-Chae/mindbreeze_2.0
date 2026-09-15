// AI 리포트 목록 페이지 — 테이블 + 검색/필터/정렬/세션 그룹핑 (SDD-053)

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ReportSampleModal } from './ReportSamplePage';
import AppShell from '../../components/layout/AppShell';
import {
  getAutoApprove,
  listReports,
  setAutoApprove,
  type ReportDto,
} from '../../lib/api/reports';

type StatusFilter = 'all' | 'pending' | 'approved';
type SortKey = 'newest' | 'oldest' | 'title';

const SESSION_TYPE_LABELS: Record<string, string> = {
  clinical: '임상심리상담',
  hypnosis: '최면심리상담',
  meditation: '명상수업',
  custom: '기타',
};

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function reportTitle(r: ReportDto): string {
  const headline = (r.content?.headline as string) ?? '리포트';
  return r.session_title || headline;
}

function reportDateIso(r: ReportDto): string | null {
  return r.scheduled_at ?? r.created_at;
}

function sessionTypeLabel(type: string | null): string {
  if (!type) return '-';
  return SESSION_TYPE_LABELS[type] ?? type;
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
        승인됨
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#FEF3C7] text-[#92400E]">
      검토중
    </span>
  );
}

function filterAndSortReports(
  reports: ReportDto[],
  search: string,
  statusFilter: StatusFilter,
  sortKey: SortKey,
  sessionFilter: string,
): ReportDto[] {
  const q = search.trim().toLowerCase();

  let filtered = reports.filter((r) => {
    if (statusFilter === 'pending' && r.sent_at) return false;
    if (statusFilter === 'approved' && !r.sent_at) return false;
    if (sessionFilter && r.session_id !== sessionFilter) return false;
    if (!q) return true;
    const title = reportTitle(r).toLowerCase();
    const sessionName = (r.session_title ?? '').toLowerCase();
    return title.includes(q) || sessionName.includes(q);
  });

  filtered = [...filtered].sort((a, b) => {
    if (sortKey === 'title') {
      return reportTitle(a).localeCompare(reportTitle(b), 'ko');
    }
    const aTime = new Date(reportDateIso(a) ?? 0).getTime();
    const bTime = new Date(reportDateIso(b) ?? 0).getTime();
    return sortKey === 'newest' ? bTime - aTime : aTime - bTime;
  });

  return filtered;
}

function groupBySession(reports: ReportDto[]): { sessionId: string; label: string; items: ReportDto[] }[] {
  const map = new Map<string, { sessionId: string; label: string; items: ReportDto[] }>();
  for (const r of reports) {
    const key = r.session_id || 'unknown';
    const existing = map.get(key);
    if (existing) {
      existing.items.push(r);
    } else {
      map.set(key, {
        sessionId: key,
        label: r.session_title || reportTitle(r),
        items: [r],
      });
    }
  }
  return Array.from(map.values());
}

export default function ReportListPage() {
  const [sampleOpen, setSampleOpen] = useState(false);
  const [reports, setReports] = useState<ReportDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('newest');
  const [groupByClass, setGroupByClass] = useState(false);
  const [sessionFilter, setSessionFilter] = useState('');

  // SDD-049 — 자동 승인 토글
  const [autoApprove, setAutoApproveState] = useState(false);
  const [autoApproveLoading, setAutoApproveLoading] = useState(true);
  const [autoApproveSaving, setAutoApproveSaving] = useState(false);
  const [autoApproveError, setAutoApproveError] = useState<string | null>(null);

  useEffect(() => {
    listReports()
      .then((r) => setReports(r.reports))
      .catch((e) => setError(e instanceof Error ? e.message : '리포트 조회 실패'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    getAutoApprove()
      .then((r) => setAutoApproveState(r.enabled))
      .catch((e) =>
        setAutoApproveError(e instanceof Error ? e.message : '자동 승인 설정 조회 실패'),
      )
      .finally(() => setAutoApproveLoading(false));
  }, []);

  const handleToggleAutoApprove = async () => {
    if (autoApproveLoading || autoApproveSaving) return;
    const prev = autoApprove;
    const next = !prev;
    setAutoApproveState(next);
    setAutoApproveError(null);
    setAutoApproveSaving(true);
    try {
      const res = await setAutoApprove(next);
      setAutoApproveState(res.enabled);
    } catch (e) {
      setAutoApproveState(prev);
      setAutoApproveError(e instanceof Error ? e.message : '자동 승인 설정 변경 실패');
    } finally {
      setAutoApproveSaving(false);
    }
  };

  const sessionOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of reports) {
      if (!r.session_id) continue;
      if (!map.has(r.session_id)) {
        map.set(r.session_id, r.session_title || reportTitle(r));
      }
    }
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [reports]);

  const filtered = useMemo(
    () => filterAndSortReports(reports, search, statusFilter, sortKey, sessionFilter),
    [reports, search, statusFilter, sortKey, sessionFilter],
  );

  const grouped = useMemo(
    () => (groupByClass ? groupBySession(filtered) : null),
    [groupByClass, filtered],
  );

  const toggleDisabled = autoApproveLoading || autoApproveSaving;

  const autoApproveToggle = (
    <div className="inline-flex items-center gap-2">
      <span
        className={`text-[13px] font-semibold ${
          autoApprove ? 'text-[#5F0080]' : 'text-[#6F6F6F]'
        }`}
      >
        {autoApproveLoading ? '설정 로딩…' : autoApprove ? '자동 승인' : '수동 승인'}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={autoApprove}
        aria-label={autoApprove ? '자동 승인' : '수동 승인'}
        disabled={toggleDisabled}
        onClick={() => void handleToggleAutoApprove()}
        className={`relative w-11 h-6 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          autoApprove ? 'bg-[#5F0080]' : 'bg-[#D4D4D4]'
        }`}
      >
        <span
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
            autoApprove ? 'translate-x-[22px]' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );

  const sampleLink = (
    <button
      type="button"
      onClick={() => setSampleOpen(true)}
      className="inline-flex items-center h-9 px-4 rounded-full text-[13px] font-semibold text-[#5F0080] bg-[#F5EDFC] border border-[#E8D9F5] hover:bg-[#EFE3FA] transition-colors"
    >
      샘플 보기
    </button>
  );

  const rightSlot = (
    <div className="inline-flex items-center gap-3">
      {autoApproveToggle}
      {sampleLink}
    </div>
  );

  const selectClass =
    'h-10 rounded-xl border border-[#EFEFEF] px-3 text-[13px] text-[#1F1F1F] bg-white focus:outline-none focus:ring-2 focus:ring-[#5F0080]/20';

  const renderRow = (r: ReportDto) => (
    <tr key={r.id} className="border-b border-[#EFEFEF] last:border-0 hover:bg-[#F8FAFC] transition-colors">
      <td className="px-5 py-3.5">
        <div className="font-medium text-[#1F1F1F] truncate max-w-[280px]">{reportTitle(r)}</div>
      </td>
      <td className="px-5 py-3.5">
        <TypeBadge type={r.type} />
      </td>
      <td className="px-5 py-3.5 text-[13px] text-[#6F6F6F]">{sessionTypeLabel(r.session_type)}</td>
      <td className="px-5 py-3.5 text-[12px] text-[#9B9B9B] font-mono">{formatDate(reportDateIso(r))}</td>
      <td className="px-5 py-3.5">
        <StatusBadge sentAt={r.sent_at} />
      </td>
      <td className="px-5 py-3.5">
        <Link
          to={`/reports/${r.id}`}
          className="text-[13px] font-semibold text-[#5F0080] hover:underline"
        >
          보기
        </Link>
      </td>
    </tr>
  );

  const renderMobileCard = (r: ReportDto) => (
    <Link
      key={r.id}
      to={`/reports/${r.id}`}
      className="block bg-white border border-[#EFEFEF] rounded-2xl p-4 hover:border-[#5F0080]/30 hover:shadow-sm transition-all"
    >
      <div className="flex items-center justify-between mb-2 gap-2">
        <TypeBadge type={r.type} />
        <StatusBadge sentAt={r.sent_at} />
      </div>
      <div className="font-bold text-[15px] text-[#1F1F1F] truncate mb-1">{reportTitle(r)}</div>
      <div className="text-[12px] text-[#6F6F6F]">
        {sessionTypeLabel(r.session_type)} · {formatDate(reportDateIso(r))}
      </div>
    </Link>
  );

  const tableHead = (
    <thead>
      <tr className="bg-[#F8FAFC] border-b border-[#EFEFEF]">
        <th className="text-left px-5 py-3 text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider">제목</th>
        <th className="text-left px-5 py-3 text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider">타입</th>
        <th className="text-left px-5 py-3 text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider">세션유형</th>
        <th className="text-left px-5 py-3 text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider">날짜</th>
        <th className="text-left px-5 py-3 text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider">상태</th>
        <th className="text-left px-5 py-3 text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider">액션</th>
      </tr>
    </thead>
  );

  return (
    <AppShell title="리포트" sub="AI REPORTS" rightSlot={!loading ? rightSlot : undefined}>
      {!loading && (
        <div className="mb-4 md:hidden flex items-center gap-3 flex-wrap">
          {autoApproveToggle}
          {sampleLink}
        </div>
      )}
      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 text-red-700 text-sm">{error}</div>
      )}
      {autoApproveError && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 text-red-700 text-sm">{autoApproveError}</div>
      )}
      {loading ? (
        <div className="text-[#6F6F6F]">불러오는 중...</div>
      ) : reports.length === 0 ? (
        <div className="border border-dashed border-[#DDDEE7] rounded-2xl p-12 text-center">
          <div className="text-[#6F6F6F] text-sm">아직 생성된 리포트가 없습니다.</div>
          <div className="text-[#9B9B9B] text-xs mt-1">세션을 마치면 리포트를 생성할 수 있습니다.</div>
          <button
            type="button"
            onClick={() => setSampleOpen(true)}
            className="inline-flex items-center mt-5 h-10 px-5 rounded-full text-[13px] font-bold text-white bg-[#5F0080] hover:bg-[#4A0066] transition-colors"
          >
            샘플 리포트 보기
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* 툴바: 검색 / 상태 / 정렬 / 세션 / 그룹핑 */}
          <div className="flex flex-col lg:flex-row lg:items-center gap-3 flex-wrap">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="제목·세션명 검색"
              aria-label="리포트 검색"
              className="h-10 rounded-xl border border-[#EFEFEF] px-4 text-[13px] w-full lg:w-64 focus:outline-none focus:ring-2 focus:ring-[#5F0080]/20"
            />
            <div className="inline-flex rounded-xl border border-[#EFEFEF] overflow-hidden bg-white">
              {(
                [
                  ['all', '전체'],
                  ['pending', '검토중'],
                  ['approved', '승인됨'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStatusFilter(value)}
                  className={`h-10 px-3.5 text-[13px] font-semibold transition-colors ${
                    statusFilter === value
                      ? 'bg-[#5F0080] text-white'
                      : 'text-[#6F6F6F] hover:bg-[#F8FAFC]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              aria-label="정렬"
              className={selectClass}
            >
              <option value="newest">최신순</option>
              <option value="oldest">오래된순</option>
              <option value="title">제목순</option>
            </select>
            <select
              value={sessionFilter}
              onChange={(e) => setSessionFilter(e.target.value)}
              aria-label="세션 필터"
              className={`${selectClass} max-w-[220px]`}
            >
              <option value="">전체 세션</option>
              {sessionOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              role="switch"
              aria-checked={groupByClass}
              onClick={() => setGroupByClass((v) => !v)}
              className={`h-10 px-4 rounded-xl text-[13px] font-semibold border transition-colors ${
                groupByClass
                  ? 'bg-[#F5EDFC] text-[#5F0080] border-[#E8D9F5]'
                  : 'bg-white text-[#6F6F6F] border-[#EFEFEF] hover:bg-[#F8FAFC]'
              }`}
            >
              세션별 그룹핑 {groupByClass ? 'ON' : 'OFF'}
            </button>
            <span className="text-[13px] text-[#6F6F6F] lg:ml-auto">
              {filtered.length} / {reports.length}건
            </span>
          </div>

          {filtered.length === 0 ? (
            <div className="border border-dashed border-[#DDDEE7] rounded-2xl p-10 text-center">
              <div className="text-[#6F6F6F] text-sm">조건에 맞는 리포트가 없습니다.</div>
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setStatusFilter('all');
                  setSessionFilter('');
                }}
                className="mt-3 text-[13px] font-semibold text-[#5F0080] hover:underline"
              >
                필터 초기화
              </button>
            </div>
          ) : (
            <>
              {/* 모바일 카드 */}
              <div className="block md:hidden space-y-3">
                {grouped
                  ? grouped.map((g) => (
                      <div key={g.sessionId} className="space-y-2">
                        <div className="px-1 pt-2 text-[12px] font-bold text-[#5F0080] font-mono uppercase tracking-wider">
                          {g.label}
                          <span className="ml-2 text-[#9B9B9B] font-normal normal-case tracking-normal">
                            {g.items.length}건
                          </span>
                        </div>
                        {g.items.map(renderMobileCard)}
                      </div>
                    ))
                  : filtered.map(renderMobileCard)}
              </div>

              {/* 데스크톱 테이블 */}
              <div className="hidden md:block bg-white border border-[#EFEFEF] rounded-2xl overflow-hidden overflow-x-auto">
                {grouped ? (
                  grouped.map((g) => (
                    <div key={g.sessionId}>
                      <div className="px-5 py-2.5 bg-[#F5EDFC]/60 border-b border-[#EFEFEF] text-[12px] font-bold text-[#5F0080]">
                        {g.label}
                        <span className="ml-2 font-normal text-[#6F6F6F]">{g.items.length}건</span>
                      </div>
                      <table className="w-full text-[14px] min-w-[720px]">
                        {tableHead}
                        <tbody>{g.items.map(renderRow)}</tbody>
                      </table>
                    </div>
                  ))
                ) : (
                  <table className="w-full text-[14px] min-w-[720px]">
                    {tableHead}
                    <tbody>{filtered.map(renderRow)}</tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      )}
      {sampleOpen && <ReportSampleModal onClose={() => setSampleOpen(false)} />}
    </AppShell>
  );
}
