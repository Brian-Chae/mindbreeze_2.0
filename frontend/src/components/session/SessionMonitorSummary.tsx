// 호스트 라이브 DashboardBox 4종 — 1.0 수평 16px 카드 패리티 (SDD-029)
// 경고 1명 이상이면 카드 전체 빨강(#F2212133 / #F22121B2)

export interface MonitorSummaryCounts {
  participants: number;
  leadOff: number;
  connectionFailed: number;
  lowBattery: number;
}

interface SessionMonitorSummaryProps {
  counts: MonitorSummaryCounts;
  activeFilter: keyof MonitorSummaryCounts | null;
  onFilterToggle: (key: keyof MonitorSummaryCounts) => void;
  /** 로딩 중이면 수치를 '—'로 표시 */
  loading?: boolean;
}

const BOXES: {
  key: keyof MonitorSummaryCounts;
  label: string;
  /** 참여자 카드는 인원이 많아도 경고색 미적용 */
  warnOnPositive: boolean;
}[] = [
  { key: 'participants', label: '참여자', warnOnPositive: false },
  { key: 'leadOff', label: '접촉불량', warnOnPositive: true },
  { key: 'connectionFailed', label: '기기연결 실패', warnOnPositive: true },
  { key: 'lowBattery', label: '밴드 배터리 부족', warnOnPositive: true },
];

export function SessionMonitorSummary({
  counts,
  activeFilter,
  onFilterToggle,
  loading = false,
}: SessionMonitorSummaryProps) {
  return (
    <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 lg:grid-cols-4">
      {BOXES.map((box) => {
        const selected = activeFilter === box.key;
        const value = counts[box.key];
        const warn = box.warnOnPositive && value >= 1;
        return (
          <button
            key={box.key}
            type="button"
            aria-pressed={selected}
            onClick={() => onFilterToggle(box.key)}
            className={`flex items-center justify-between gap-3 rounded-xl px-4 py-4 text-left transition ${
              warn
                ? 'bg-[#F2212133] text-[#F22121B2]'
                : 'bg-[#F2F3F8] text-[#1F1F1F]'
            } ${
              selected
                ? 'outline outline-2 outline-[#5F0080] outline-offset-0'
                : ''
            }`}
          >
            <span className="text-base font-semibold leading-6">{box.label}</span>
            <span className="shrink-0 text-base font-semibold leading-6 tabular-nums whitespace-nowrap">
              {loading ? '—' : `${value}명`}
            </span>
          </button>
        );
      })}
    </div>
  );
}
