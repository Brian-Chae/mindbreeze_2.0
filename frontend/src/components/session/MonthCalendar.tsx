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

const typeShortLabel = (type: SessionType): string => {
  switch (type) {
    case 'clinical': return '임상';
    case 'hypnosis': return '최면';
    case 'meditation': return '명상';
    default: return type;
  }
};

interface Props {
  sessions: SessionDto[];
  currentDate: Date;
  selectedDate?: Date;
  weekHighlight?: Date;
  onSelectDate: (date: Date) => void;
  onShiftMonth: (direction: 1 | -1) => void;
  className?: string;
}

export function MonthCalendar({ sessions, currentDate, selectedDate, weekHighlight, onSelectDate, onShiftMonth, className }: Props) {
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
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#EFEFEF]">
        <button
          type="button"
          onClick={() => onShiftMonth(-1)}
          className="w-9 h-9 rounded-full bg-[#F2F3F8] hover:bg-[#E6E7EE] text-[#1F1F1F] flex items-center justify-center"
          aria-label="이전 월"
        >
          ‹
        </button>
        <span className="text-sm font-bold text-[#1F1F1F]">
          {year}년 {month + 1}월
        </span>
        <button
          type="button"
          onClick={() => onShiftMonth(1)}
          className="w-9 h-9 rounded-full bg-[#F2F3F8] hover:bg-[#E6E7EE] text-[#1F1F1F] flex items-center justify-center"
          aria-label="다음 월"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 bg-[#FAFAFA] border-b border-[#EFEFEF]">
        {DAY_LABELS.map((label, i) => (
          <div
            key={label}
            className={`text-center py-2 text-[11px] font-bold ${
              i === 0 ? 'text-[#B3261E]' : i === 6 ? 'text-[#1F4FB3]' : 'text-[#1F1F1F]'
            }`}
          >
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((d) => {
          const inMonth = d.getMonth() === month;
          const isToday = sameDay(d, today);
          const isSelected = selectedDate ? sameDay(d, selectedDate) : false;
          const isWeekHighlight = weekHighlight ? inSameWeek(d, weekHighlight) : false;
          const isWeekStart = isWeekHighlight && d.getDay() === 0;
          const items = sessionsOn(d);

          // 배경: 선택날짜 > 주간 하이라이트 > 당월/전월
          let cellBg = '';
          if (isSelected) cellBg = 'bg-[#F5EDFC]';
          else if (isWeekHighlight && inMonth) cellBg = 'bg-[#F5EDFC]';
          else if (isWeekHighlight) cellBg = 'bg-[#F5EDFC]/40';
          else if (inMonth) cellBg = 'bg-white';
          else cellBg = 'bg-[#FAFAFA]';

          return (
            <button
              key={d.toISOString()}
              type="button"
              onClick={() => onSelectDate(d)}
              className={`border-t border-l border-[#EFEFEF] h-[40px] md:h-[80px] p-1 md:p-1.5 flex flex-col items-stretch text-left transition-colors hover:bg-[#FAFAFA] ${cellBg} ${isWeekHighlight && !isWeekStart ? 'border-l-transparent' : ''}`}
            >
              <div className="flex items-center justify-center md:justify-start">
                <span
                  className={`text-[11px] md:text-xs font-mono inline-flex items-center justify-center ${
                    isToday
                      ? 'w-5 h-5 md:w-6 md:h-6 rounded-full bg-[#5F0080] text-white font-bold'
                      : inMonth
                        ? d.getDay() === 0
                          ? 'text-[#B3261E]'
                          : d.getDay() === 6
                            ? 'text-[#1F4FB3]'
                            : 'text-[#1F1F1F]'
                        : 'text-[#C0C0C0]'
                  }`}
                >
                  {d.getDate()}
                </span>
              </div>

              {items.length > 0 && (
                <>
                  <div className="flex md:hidden items-center justify-center gap-0.5 mt-0.5">
                    {items.slice(0, 3).map((s) => (
                      <span key={s.id} className={`w-1 h-1 rounded-full ${typeDotColor(s.type)}`} />
                    ))}
                  </div>
                  <div className="hidden md:flex flex-col gap-0.5 mt-1 overflow-hidden">
                    {items.slice(0, 2).map((s) => (
                      <span
                        key={s.id}
                        className="flex items-center gap-1 text-[10px] text-[#1F1F1F] truncate"
                        title={s.title || typeShortLabel(s.type)}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${typeDotColor(s.type)}`} />
                        <span className="truncate">{s.title || typeShortLabel(s.type)}</span>
                      </span>
                    ))}
                    {items.length > 2 && (
                      <span className="text-[10px] text-[#6F6F6F]">+{items.length - 2}</span>
                    )}
                  </div>
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
