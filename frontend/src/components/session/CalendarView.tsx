// 주간 캘린더 뷰 (UI Kit)

import { Link } from 'react-router-dom';
import type { SessionDto } from '../../lib/api/session';

const HOURS = Array.from({ length: 13 }, (_, i) => i + 8); // 08:00 ~ 20:00
const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

const startOfWeek = (date: Date): Date => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
};

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

interface Props {
  sessions: SessionDto[];
  currentDate: Date;
  mode?: 'weekly' | 'daily';
}

export function CalendarView({ sessions, currentDate, mode = 'weekly' }: Props) {
  const weekStart = startOfWeek(currentDate);
  const today = new Date();
  const days: Date[] =
    mode === 'daily'
      ? [new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate())]
      : Array.from({ length: 7 }, (_, i) => {
          const d = new Date(weekStart);
          d.setDate(weekStart.getDate() + i);
          return d;
        });
  const gridCols = mode === 'daily' ? 'grid-cols-[60px_1fr]' : 'grid-cols-[60px_repeat(7,1fr)]';
  const minWidth = mode === 'daily' ? 'min-w-[320px]' : 'min-w-[800px]';

  const cellSessions = (day: Date, hour: number): SessionDto[] =>
    sessions.filter((s) => {
      const at = new Date(s.scheduled_at);
      return sameDay(at, day) && at.getHours() === hour;
    });

  const typeLabel = (type: string): string => {
    switch (type) {
      case 'clinical': return '임상';
      case 'hypnosis': return '최면';
      case 'meditation': return '명상';
      default: return type;
    }
  };

  const statusColor = (status: string): string => {
    switch (status) {
      case 'scheduled':   return 'bg-[#F5EDFC] text-[#5F0080]';
      case 'in_progress': return 'bg-[#E6F8F3] text-[#1F8A5B]';
      case 'paused':      return 'bg-[#FFF4DC] text-[#8A6B1F]';
      case 'completed':   return 'bg-[#F2F3F8] text-[#6F6F6F]';
      case 'cancelled':   return 'bg-[#FDECEC] text-[#B3261E]';
      default:            return 'bg-[#F2F3F8] text-[#6F6F6F]';
    }
  };

  return (
    <div className="hidden md:block overflow-x-auto bg-white rounded-[20px] border border-[#EFEFEF]">
      <div className={`${minWidth} grid ${gridCols}`}>
        <div className="bg-[#FAFAFA] border-b border-[#EFEFEF]" />
        {days.map((d) => {
          const isToday = sameDay(d, today);
          return (
            <div
              key={d.toISOString()}
              className={`border-b border-l border-[#EFEFEF] py-3 text-center text-[13px] font-medium ${
                isToday ? 'bg-[#5F0080] text-white' : 'bg-[#FAFAFA] text-[#1F1F1F]'
              }`}
            >
              <div className="font-bold">{DAY_LABELS[d.getDay()]}</div>
              <div className={`text-[11px] font-mono mt-0.5 ${isToday ? 'text-white/80' : 'text-[#6F6F6F]'}`}>
                {d.getMonth() + 1}/{d.getDate()}
              </div>
            </div>
          );
        })}

        {HOURS.map((h) => (
          <div key={h} className="contents">
            <div className="border-t border-[#EFEFEF] px-2 py-3 text-[11px] font-mono text-[#6F6F6F] text-right">
              {String(h).padStart(2, '0')}:00
            </div>
            {days.map((d) => {
              const items = cellSessions(d, h);
              return (
                <div
                  key={`${d.toISOString()}-${h}`}
                  className="border-t border-l border-[#EFEFEF] min-h-[56px] p-1 space-y-1"
                >
                  {items.map((s) => (
                    <Link
                      key={s.id}
                      to={`/sessions/${s.id}`}
                      className={`block px-2 py-1 rounded-lg text-[11px] truncate hover:opacity-80 transition ${statusColor(s.status)}`}
                      title={`${s.title || typeLabel(s.type)} (${s.duration_min}분)`}
                    >
                      <span className="font-bold">{typeLabel(s.type)}</span>{' '}
                      {s.title || ''}
                    </Link>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
