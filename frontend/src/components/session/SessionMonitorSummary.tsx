// 호스트 라이브 DashboardBox 4종 (참여자 / 접촉불량 / 기기연결실패 / 배터리부족)

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
}

const BOXES: { key: keyof MonitorSummaryCounts; label: string; accent: string }[] = [
  { key: 'participants', label: '참여자', accent: 'text-[#5F0080]' },
  { key: 'leadOff', label: '접촉불량', accent: 'text-[#B3261E]' },
  { key: 'connectionFailed', label: '기기연결실패', accent: 'text-[#B45309]' },
  { key: 'lowBattery', label: '배터리부족', accent: 'text-[#B3261E]' },
];

export function SessionMonitorSummary({
  counts,
  activeFilter,
  onFilterToggle,
}: SessionMonitorSummaryProps) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {BOXES.map((box) => {
        const selected = activeFilter === box.key;
        return (
          <button
            key={box.key}
            type="button"
            onClick={() => onFilterToggle(box.key)}
            className={`rounded-[16px] border bg-white p-4 text-left transition ${
              selected
                ? 'border-[#5F0080] ring-2 ring-[#5F0080]/20'
                : 'border-[#EFEFEF] hover:border-[#DDD0EA]'
            }`}
          >
            <div className="text-[12px] font-medium text-[#6F6F6F]">{box.label}</div>
            <div className={`mt-1 text-2xl font-bold tabular-nums ${box.accent}`}>
              {counts[box.key]}
            </div>
          </button>
        );
      })}
    </div>
  );
}
