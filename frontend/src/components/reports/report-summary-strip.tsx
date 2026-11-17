// SDD-324 — 리포트 상단 요약 카드. 값 + 단위 + 기준 문구 + 클릭 동작.
// 서버 응답에 없는 신규 집계는 0 으로 그리지 않고 카드를 숨긴다.
// 11/9: 회원 화면과 같은 공용 카드(UiV2SummaryCards)로 그려 화면 너비에 맞게 채운다(고정 6열 → auto-fit).
import type { HierarchyTab } from '../../lib/api/report-hierarchy';
import { buildReportSummaryCards, type ReportSummary } from '../../lib/report-summary-cards';
import { UiV2SummaryCards } from '../ui-v2/ui-v2-summary-cards';
import '../../styles/ui-v2-coach-pc.css';

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
    <div data-testid="report-summary" className="ui-v2 u2f-report-summary">
      <UiV2SummaryCards
        label="리포트 요약"
        items={cards.map((c) => {
          const tab = c.tab;
          return {
            key: c.key, label: c.label, value: c.value, unit: c.unit, basis: c.basis,
            active: tab ? activeTab === tab : undefined,
            onClick: tab ? () => onSelectTab(tab) : undefined,
          };
        })}
      />
    </div>
  );
}
