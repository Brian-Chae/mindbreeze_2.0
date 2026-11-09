// SDD-324 — 리포트 상단 요약 카드. 값 + 단위 + 기준 문구 + 클릭 동작.
// 서버 응답에 없는 신규 집계는 0 으로 그리지 않고 카드를 숨긴다.
import type { HierarchyTab } from '../../lib/api/report-hierarchy';
import { buildReportSummaryCards, type ReportSummary } from '../../lib/report-summary-cards';

interface Props {
  summary: ReportSummary | null | undefined;
  /** 요청 실패 등으로 요약을 받지 못함 — 0 이 아니라 '집계 준비 중' 으로 표시 */
  unavailable?: boolean;
  activeTab: HierarchyTab;
  onSelectTab: (tab: HierarchyTab) => void;
}

export default function ReportSummaryStrip({ summary, unavailable = false, activeTab, onSelectTab }: Props) {
  const cards = buildReportSummaryCards(summary);
  if (unavailable) return <p data-testid="report-summary-pending" className="m-0 rounded-xl bg-[#F6F2F8] px-4 py-3 text-[13px] text-[#786780]">요약 집계 준비 중이에요.</p>;
  if (cards.length === 0) return null;
  return (
    <div data-testid="report-summary" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {cards.map((c) => {
        const body = (
          <>
            <span className="text-[13px] font-semibold text-[#7A6F82]">{c.label}</span>
            <span className="text-[26px] font-bold leading-tight text-[#29272D]">{c.value.toLocaleString('ko-KR')}<span className="ml-1 text-[14px] font-semibold text-[#7A6F82]">{c.unit}</span></span>
            <span className="text-[12px] leading-snug text-[#8B8191]">{c.basis}</span>
          </>
        );
        const base = 'flex min-h-[44px] flex-col gap-1 rounded-2xl border p-4 text-left';
        if (!c.tab) return <div key={c.key} data-card={c.key} className={`${base} border-[#EEE9F1] bg-white`}>{body}</div>;
        const tab = c.tab;
        const active = activeTab === tab;
        return (
          <button key={c.key} type="button" data-card={c.key} aria-pressed={active} onClick={() => onSelectTab(tab)} className={`${base} ${active ? 'border-[#5F0080] bg-[#F5EDFC]' : 'border-[#EEE9F1] bg-white hover:border-[#C9B2D6]'}`}>{body}</button>
        );
      })}
    </div>
  );
}
