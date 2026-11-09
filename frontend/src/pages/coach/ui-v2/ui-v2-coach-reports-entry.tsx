// SDD-324 — 새 디자인 리포트 진입. PC 는 요약 카드가 붙은 분할 화면(ReportsDesktopPage 가 플래그로 처리),
// 모바일은 기존 카드 목록 위에 요약 카드를 붙이고 카드 클릭이 상태 필터(검토중/실패)를 바꾼다. 운영 파일은 수정하지 않는다.
import { useEffect, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import ReportListPage, { LegacyReportListPage } from '../../reports/ReportListPage';
import ReportSummaryStrip from '../../../components/reports/report-summary-strip';
import { getReportHierarchy, type HierarchyResponse, type HierarchyTab } from '../../../lib/api/report-hierarchy';
import { useIsDesktop } from '../../../hooks/use-is-desktop';
import '../../../styles/ui-v2.css';
import '../../../styles/ui-v2-coach-pc.css';

const STATUS_OF: Record<HierarchyTab, string | null> = { all: null, needs_review: 'pending', failed: 'failed' };

function MobileReports(): ReactElement {
  const [params, setParams] = useSearchParams();
  const [summary, setSummary] = useState<HierarchyResponse['summary'] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getReportHierarchy({ page: 1, limit: 1 }).then((r) => { if (!cancelled) setSummary(r.summary); }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);
  const status = params.get('status');
  const tab: HierarchyTab = status === 'pending' ? 'needs_review' : status === 'failed' ? 'failed' : 'all';
  const select = (t: HierarchyTab): void => {
    const next = new URLSearchParams(params);
    const v = STATUS_OF[t];
    if (v) next.set('status', v); else next.delete('status');
    setParams(next, { replace: true });
  };
  return (
    <>
      <div className="ui-v2 u2f" style={{ padding: '12px 16px 0' }}>
        <ReportSummaryStrip summary={summary} unavailable={failed} activeTab={tab} onSelectTab={select} />
      </div>
      {/* 목록은 시작 상태만 URL 에서 읽으므로 카드를 누를 때마다 새로 그린다 */}
      <LegacyReportListPage key={status ?? 'all'} />
    </>
  );
}

export function UiV2CoachReportsEntry(): ReactElement {
  const isDesktop = useIsDesktop();
  return isDesktop ? <ReportListPage /> : <MobileReports />;
}
