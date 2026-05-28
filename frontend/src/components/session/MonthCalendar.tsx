// 월간 캘린더 (모바일/데스크톱 반응형)

import type { SessionDto, SessionType } from '../../lib/api/session';

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const startOfWeek = (date: Date): Date => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
};

const inSameWeek = (cell: Date, reference: Date): boolean => {
  const start = startOfWeek(reference);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return cell.getTime() >= start.getTime() && cell.getTime() <= end.getTime();
};

const typeDotColor = (type: SessionType): string => {
  switch (type) {
    case 'clinical': return 'bg-[#5F0080]';
    case 'hypnosis': return 'bg-[#8A6B1F]';
    case 'meditation': return 'bg-[#1F8A5B]';
    default: return 'bg-[#6F6F6F]';
  }
};

interface Props {
  sessions: SessionDto[];
  currentDate: Date;
  selectedDate?: Date;
  weekHighlight?: Date;
  onSelectDate: (date: Date) => void;
  onShiftMonth: (direction: 1 | -1) => void;
  onToday?: () => void;
  className?: string;
}

export function MonthCalendar({ sessions, currentDate, selectedDate, weekHighlight, onSelectDate, onShiftMonth, onToday, className }: Props) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(1 - firstOfMonth.getDay());

  const cells: Date[] = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });

  const today = new Date();

  const sessionsOn = (day: Date): SessionDto[] =>
    sessions
      .filter((s) => sameDay(new Date(s.scheduled_at), day))
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());

  return (
    <div className={`bg-white rounded-[20px] border border-[#EFEFEF] overflow-hidden ${className ?? ''}`}>
      <div className="flex items-center justify-between px-4 py-3.5">
        <div className="font-bold text-[17px] tracking-tight text-[#1F1F1F]">
          {year}년 {month + 1}월
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => onShiftMonth(-1)}
            className="min-w-[32px] h-8 px-2.5 rounded-[10px] font-semibold text-[13px] bg-[#F5EDFC] text-[#5F0080] hover:bg-[#EDE0F8] transition-colors"
            aria-label="이전 월"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => {
              if (onToday) { onToday(); } else {
                const now = new Date();
                onSelectDate(now);
              }
            }}
            className="min-w-[32px] h-8 px-2.5 rounded-[10px] font-semibold text-[13px] bg-[#5F0080] text-white hover:bg-[#4B0066] transition-colors"
          >
            오늘
          </button>
          <button
            type="button"
            onClick={() => onShiftMonth(1)}
            className="min-w-[32px] h-8 px-2.5 rounded-[10px] font-semibold text-[13px] bg-[#F5EDFC] text-[#5F0080] hover:bg-[#EDE0F8] transition-colors"
            aria-label="다음 월"
          >
            ›
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 px-2">
        {DAY_LABELS.map((label, i) => (
          <div
            key={label}
            className={`text-center py-2 text-[10px] font-mono uppercase tracking-wider ${
              i === 0 ? 'text-[#B3261E]' : i === 6 ? 'text-[#1F4FB3]' : 'text-[#6F6F6F]'
            }`}
          >
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1 px-2 pb-3">
        {cells.map((d) => {
          const inMonth = d.getMonth() === month;
          const isToday = sameDay(d, today);
          const isSelected = selectedDate ? sameDay(d, selectedDate) : false;
          const isWeekHighlight = weekHighlight ? inSameWeek(d, weekHighlight) : false;
          const items = sessionsOn(d);

          let cellBg = '';
          if (isSelected) cellBg = 'bg-[#5F0080] text-white font-bold';
          else if (isToday) cellBg = 'bg-[#F5EDFC] text-[#5F0080] font-bold';
          else if (isWeekHighlight && inMonth) cellBg = 'bg-[#F5EDFC]/40 text-[#1F1F1F]';
          else if (inMonth) cellBg = 'text-[#1F1F1F] hover:bg-[#F8F4FC]';
          else cellBg = 'text-[#C2C3CE]';

          const hasDot = items.length > 0;
          const dotColor = hasDot ? typeDotColor(items[0]!.type) : '';

          return (
            <button
              key={d.toISOString()}
              type="button"
              onClick={() => inMonth && onSelectDate(d)}
              disabled={!inMonth}
              className={`aspect-square flex flex-col items-center justify-center rounded-[10px] text-sm relative transition-colors ${cellBg}`}
            >
              <span>{d.getDate()}</span>
              {hasDot && (
                <span className={`absolute bottom-[5px] left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${isSelected ? 'bg-white/70' : dotColor}`} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
