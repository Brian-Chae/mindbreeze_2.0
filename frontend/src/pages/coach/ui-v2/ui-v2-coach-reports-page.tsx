// SDD-320 F-1 — 코치 리포트 목록. 11/9: 상태 칩 제거 — 검토 대기(있을 때) 상단, 그 아래 승인된 리포트 나열. 상태 매핑은 lib/coach-lists-v2.ts.
// 발송 실패는 '승인' 탭의 필터·배지로 유지한다. 운영 설정(자동 승인·일괄 승인·샘플)은 기존 API 함수를 그대로 호출한다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AppShell from '../../../components/layout/AppShell';
import BulkApproveModal from '../../../components/reports/BulkApproveModal';
import { SettingsSwitch } from '../../../components/settings/settings-switch';
import { ReportSampleModal } from '../../../pages/reports/ReportSamplePage';
import { approveAllReports, getAutoApprove, setAutoApprove } from '../../../lib/api/reports';
import { getReportHierarchy, type HierarchyResponse, type HierarchyTab } from '../../../lib/api/report-hierarchy';
import { filterReportRows, flattenReportRows, groupRowsByTitle, type DeliveryFilterV2, type ReportRowV2 } from '../../../lib/coach-lists-v2';
import { useReportStore } from '../../../stores/reportStore';
import { useAuthStore } from '../../../stores/authStore';
import '../../../styles/ui-v2.css';
import '../../../styles/ui-v2-brand.css';
import '../../../styles/ui-v2-coach-pc.css';

const PAGE_LIMIT = 30;

function RowBadges({ row }: { row: ReportRowV2 }) {
  return <>
    <span className={`u2f-badge${row.stateLabel === '발송 실패' || row.stateLabel === '생성 실패' ? ' u2f-badge--warn' : ''}`}>{row.stateLabel}</span>
    {row.deliveryFailed && row.stateLabel !== '발송 실패' && <span className="u2f-badge u2f-badge--warn" style={{ marginLeft: 6 }}>발송 실패</span>}
  </>;
}

export function UiV2CoachReportsPage() {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const [searchParams] = useSearchParams();
  // 11/9 대표 지시: 상태 칩(검토 대기/승인됨) 없이 한 목록. 검토 대기가 있으면 상단에 따로, 그 아래 승인된 리포트를 나열한다.
  const [delivery, setDelivery] = useState<DeliveryFilterV2>('all');
  const serverTab: HierarchyTab = delivery === 'failed' ? 'failed' : 'all';
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [group, setGroup] = useState(true);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<HierarchyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [opsOpen, setOpsOpen] = useState(() => searchParams.get('settings') === 'operations');
  const [sampleOpen, setSampleOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [autoApprove, setAutoApproveState] = useState(false);
  const [autoLoaded, setAutoLoaded] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const setPendingReview = useReportStore((s) => s.setPendingReview);

  // 알림 딥링크(?report=ID) → 상세로 이동
  useEffect(() => {
    const id = searchParams.get('report');
    if (id) navigate(`/reports/${encodeURIComponent(id)}`, { replace: true });
  }, [searchParams, navigate]);
  useEffect(() => { const id = window.setTimeout(() => setDebouncedQ(q), 250); return () => window.clearTimeout(id); }, [q]);
  useEffect(() => setPage(1), [debouncedQ, delivery]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    getReportHierarchy({ q: debouncedQ, tab: serverTab, page, limit: PAGE_LIMIT })
      .then((r) => { if (!cancelled) setData(r); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : '리포트 목록을 불러오지 못했습니다.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [debouncedQ, serverTab, page, reload]);
  useEffect(() => {
    if (role !== 'counselor') return;
    getAutoApprove().then((r) => setAutoApproveState(r.enabled)).catch((e) => setNotice(e instanceof Error ? e.message : '자동 승인 설정 조회 실패')).finally(() => setAutoLoaded(true));
  }, [role]);

  const toggleAuto = useCallback(async () => {
    if (autoSaving || !autoLoaded) return;
    const prev = autoApprove;
    setAutoApproveState(!prev); setAutoSaving(true); setNotice(null);
    try { setAutoApproveState((await setAutoApprove(!prev)).enabled); }
    catch (e) { setAutoApproveState(prev); setNotice(e instanceof Error ? e.message : '자동 승인 설정 변경 실패'); }
    finally { setAutoSaving(false); }
  }, [autoApprove, autoLoaded, autoSaving]);
  const bulkApprove = async (): Promise<void> => { await approveAllReports(); setPendingReview(0); setReload((k) => k + 1); };

  const allRows = useMemo(() => flattenReportRows(data?.groups ?? []), [data]);
  // 건수는 서버 요약(전체 기준)을 쓴다. 계층 목록은 회차 단위로 페이지가 나뉘어 현재 페이지 행만 세면 실제와 달라진다.
  const counts = { review: data?.summary.needs_review ?? 0, deliveryFailed: data?.summary.failed_delivery ?? 0 };
  const reviewRows = useMemo(() => (delivery === 'failed' ? [] : filterReportRows(allRows, 'review', 'all')), [allRows, delivery]);
  const rows = useMemo(() => filterReportRows(allRows, 'approved', delivery), [allRows, delivery]);
  const empty = !loading && !error && rows.length === 0 && reviewRows.length === 0;
  const groups = useMemo(() => (group ? groupRowsByTitle(rows) : [{ title: '', rows }]), [group, rows]);
  const totalPages = Math.max(1, Math.ceil((data?.total_sessions ?? 0) / PAGE_LIMIT));
  const open = (row: ReportRowV2): string => (row.reportId ? `/reports/${encodeURIComponent(row.reportId)}` : '/reports');

  return (
    <AppShell title="기록에 마음을 더해요">
      <div className="ui-v2 u2f u2f-reports">
        <p className="u2f-lead">회원에게 닿기 전에 기록을 읽고 마음을 더해요.</p>
        {notice && <div className="u2-alert" role="alert"><p>{notice}</p></div>}
        <div className="u2f-filters">
          <label className="u2-search"><span className="sr-only">리포트 검색</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="회원 또는 리포트 검색" aria-label="리포트 검색" /></label>
          <select aria-label="그룹 기준" value={group ? 'class' : 'none'} onChange={(e) => setGroup(e.target.value === 'class')}><option value="class">클래스별 그룹</option><option value="none">그룹 없음</option></select>
          {<select aria-label="발송 상태" value={delivery} onChange={(e) => setDelivery(e.target.value === 'failed' ? 'failed' : 'all')}><option value="all">전체 상태</option><option value="failed">발송 실패 {counts.deliveryFailed}</option></select>}
          <button type="button" className="u2-secondary" style={{ width: 'auto' }} aria-expanded={opsOpen} aria-controls="u2f-report-ops" onClick={() => setOpsOpen((v) => !v)}>운영 설정</button>
        </div>
        {opsOpen && <section id="u2f-report-ops" aria-label="리포트 운영 설정" className="u2-card">
          {role === 'counselor' && <div className="u2-row"><strong>{autoApprove ? '자동 승인 켜짐' : '수동 승인'}</strong><SettingsSwitch checked={autoApprove} label="자동 승인" disabled={!autoLoaded || autoSaving} onChange={() => void toggleAuto()} /></div>}
          <div className="u2f-actions">
            <button type="button" className="u2-secondary" onClick={() => setBulkOpen(true)} disabled={counts.review === 0}>검토 대기 일괄 승인</button>
            <button type="button" className="u2-secondary" onClick={() => setSampleOpen(true)}>샘플 리포트 보기</button>
          </div>
        </section>}
        {!error && reviewRows.length > 0 && <section aria-label="검토 대기" className="u2f-review-first">
          <h2 className="u2f-group">검토 대기 · {counts.review}</h2>
          <div className="u2f-table"><div className="u2f-table-box">
            <div className="u2f-tr u2f-th" aria-hidden="true"><span>회원 · 회차</span><span>상태</span><span>기록 안내</span><span>다음 행동</span></div>
            {reviewRows.map((r) => (
              <div className="u2f-tr" key={r.key}>
                <span><b>{r.who}</b><small>{r.path}</small></span>
                <span><RowBadges row={r} /></span>
                <span>{r.hint || '검토를 기다려요'}</span>
                <Link className="u2-primary" to={open(r)} aria-label={`${r.who} ${r.action ?? '열기'}`}>{r.action ?? '열기'}</Link>
              </div>
            ))}
          </div></div>
          <div className="u2f-cards">
            {reviewRows.map((r) => (
              <article className="u2-card" key={r.key}>
                <h3>{r.who}</h3>
                <p className="u2-muted">{r.path}</p>
                <p><RowBadges row={r} /></p>
                {r.hint && <p className="u2-muted">{r.hint}</p>}
                <Link className="u2-primary u2f-btn" to={open(r)} aria-label={`${r.who} ${r.action ?? '열기'}`}>{r.action ?? '열기'}</Link>
              </article>
            ))}
          </div>
        </section>}
        {error ? <div className="u2-alert" role="alert"><p>{error}</p><button type="button" className="u2-secondary u2-gap" onClick={() => setReload((k) => k + 1)}>다시 불러오기</button></div>
          : loading && !data ? <p className="u2-empty" role="status">불러오는 중...</p>
          : rows.length === 0 ? (reviewRows.length === 0 ? <p className="u2-empty">{delivery === 'failed' ? '발송 실패한 기록이 없어요.' : '아직 리포트가 없어요.'}</p> : null)
          : groups.map((g) => (
            <section key={g.title || 'all'} aria-label={g.title || '리포트 목록'} aria-busy={loading}>
              {g.title && <h2 className="u2f-group">{g.title}</h2>}
              <div className="u2f-table"><div className="u2f-table-box">
                <div className="u2f-tr u2f-th" aria-hidden="true"><span>회원 · 회차</span><span>상태</span><span>공개 · 발송</span><span>다음 행동</span></div>
                {g.rows.map((r) => (
                  <div className="u2f-tr" key={r.key}>
                    <span><b>{r.who}</b><small>{r.path}</small></span>
                    <span><RowBadges row={r} /></span>
                    <span>{r.hint || '별도 상태 확인'}</span>
                    <Link className="u2-secondary" to={open(r)} aria-label={`${r.who} ${r.action ?? '열기'}`}>{r.action ?? '열기'}</Link>
                  </div>
                ))}
              </div></div>
              <div className="u2f-cards">
                {g.rows.map((r) => (
                  <article className="u2-card" key={r.key}>
                    <h3>{r.who}</h3>
                    <p className="u2-muted">{r.path}</p>
                    <p><RowBadges row={r} /></p>
                    {r.hint && <p className="u2-muted">{r.hint}</p>}
                    <Link className="u2-primary u2f-btn" to={open(r)} aria-label={`${r.who} ${r.action ?? '열기'}`}>{r.action ?? '열기'}</Link>
                  </article>
                ))}
              </div>
            </section>
          ))}
        {data && totalPages > 1 && !empty && <div className="u2-pager">
          <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading}>이전</button>
          <span>{page} / {totalPages}</span>
          <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading}>다음</button>
        </div>}
      </div>
      {sampleOpen && <ReportSampleModal onClose={() => setSampleOpen(false)} />}
      {bulkOpen && <BulkApproveModal pendingCount={counts.review} onConfirm={bulkApprove} onClose={() => setBulkOpen(false)} />}
    </AppShell>
  );
}
