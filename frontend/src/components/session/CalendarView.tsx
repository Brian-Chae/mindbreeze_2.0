// 주간 캘린더 뷰 (Tailwind grid, UTC→로컬타임 변환)

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

export function CalendarView({ sessions, currentDate }: Props) {
  const weekStart = startOfWeek(currentDate);
  const days: Date[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  const cellSessions = (day: Date, hour: number): SessionDto[] =>
    sessions.filter((s) => {
      const at = new Date(s.scheduled_at);       // UTC→로컬 Date
      const localHour = at.getHours();           // 브라우저 로컬 시간
      return sameDay(at, day) && localHour === hour;
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
      case 'scheduled':   return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200';
      case 'in_progress': return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200';
      case 'paused':      return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-200';
      case 'completed':   return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
      case 'cancelled':   return 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300';
      default:             return 'bg-gray-100 text-gray-600';
    }
  };

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[800px] grid grid-cols-[60px_repeat(7,1fr)] border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        {/* 요일 헤더 */}
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

        {/* 시간대 행 */}
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
                  className="border-t border-l border-gray-200 dark:border-gray-700 min-h-[56px] p-1 space-y-1"
                >
                  {items.map((s) => (
                    <Link
                      key={s.id}
                      to={`/sessions/${s.id}`}
                      className={`block px-2 py-1 rounded text-xs truncate hover:opacity-80 transition ${statusColor(s.status)}`}
                      title={`${s.title || typeLabel(s.type)} (${s.duration_min}분)`}
                    >
                      <span className="font-medium">{typeLabel(s.type)}</span>
                      {' '}{s.title || ''}
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
