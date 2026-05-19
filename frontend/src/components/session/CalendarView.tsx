// 주간 캘린더 뷰 (Tailwind grid)

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
}

export function CalendarView({ sessions, currentDate }: Props){
  const weekStart = startOfWeek(currentDate);
  const days: Date[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  const cellSessions = (day: Date, hour: number): SessionDto[] =>
    sessions.filter((s) => {
      const at = new Date(s.scheduled_at);
      return sameDay(at, day) && at.getHours() === hour;
    });

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[800px] grid grid-cols-[60px_repeat(7,1fr)] border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <div className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700" />
        {days.map((d) => (
          <div
            key={d.toISOString()}
            className="bg-gray-50 dark:bg-gray-800 border-b border-l border-gray-200 dark:border-gray-700 py-2 text-center text-sm font-medium text-gray-700 dark:text-gray-200"
          >
            <div>{DAY_LABELS[d.getDay()]}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {d.getMonth() + 1}/{d.getDate()}
            </div>
          </div>
        ))}
        {HOURS.map((h) => (
          <div key={h} className="contents">
            <div className="border-t border-gray-200 dark:border-gray-700 px-2 py-3 text-xs text-gray-500 dark:text-gray-400 text-right">
              {String(h).padStart(2, '0')}:00
            </div>
            {days.map((d) => {
              const items = cellSessions(d, h);
              return (
                <div
                  key={`${d.toISOString()}-${h}`}
                  className="border-t border-l border-gray-200 dark:border-gray-700 min-h-[48px] p-1 space-y-1"
                >
                  {items.map((s) => (
                    <Link
                      key={s.id}
                      to={`/sessions/${s.id}`}
                      className="block px-2 py-1 rounded text-xs bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200 truncate hover:bg-indigo-200 dark:hover:bg-indigo-900/60"
                    >
                      {s.title || s.type}
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
