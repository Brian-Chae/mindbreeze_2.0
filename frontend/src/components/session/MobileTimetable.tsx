// 모바일 타임테이블 — 일간/주간 (UI Kit)

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

const typeDotColor = (type: string): string => {
  switch (type) {
    case 'clinical':   return 'bg-[#5F0080]';
    case 'hypnosis':   return 'bg-[#1F6FEB]';
    case 'meditation': return 'bg-[#1F8A5B]';
    default:           return 'bg-[#6F6F6F]';
  }
};

interface Props {
  sessions: SessionDto[];
  currentDate: Date;
  mode: 'daily' | 'weekly';
}

export function MobileTimetable({ sessions, currentDate, mode }: Props) {
  if (mode === 'daily') {
    return <DailyTimetable sessions={sessions} currentDate={currentDate} />;
  }
  return <WeeklyTimetable sessions={sessions} currentDate={currentDate} />;
}

function DailyTimetable({ sessions, currentDate }: { sessions: SessionDto[]; currentDate: Date }) {
  const day = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());

  const cellSessions = (hour: number): SessionDto[] =>
    sessions.filter((s) => {
      const at = new Date(s.scheduled_at);
      return sameDay(at, day) && at.getHours() === hour;
    });

  return (
    <div className="bg-white rounded-[20px] border border-[#EFEFEF] overflow-hidden">
      <div className="grid grid-cols-[56px_1fr]">
        {HOURS.map((h) => {
          const items = cellSessions(h);
          return (
            <div key={h} className="contents">
              <div className="border-t border-[#EFEFEF] px-2 py-3 text-[11px] font-mono text-[#6F6F6F] text-right">
                {String(h).padStart(2, '0')}:00
              </div>
              <div className="border-t border-l border-[#EFEFEF] min-h-[44px] p-1 space-y-1">
                {items.map((s) => (
                  <Link
                    key={s.id}
                    to={`/sessions/${s.id}`}
                    className={`block px-2 py-1 rounded-lg text-[11px] truncate hover:opacity-80 transition ${statusColor(s.status)}`}
                    title={`${s.title || typeLabel(s.type)} (${s.duration_min}분)`}
                  >
                    <span className="font-bold">{typeLabel(s.type)}</span> {s.title || ''}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeeklyTimetable({ sessions, currentDate }: { sessions: SessionDto[]; currentDate: Date }) {
  const weekStart = startOfWeek(currentDate);
  const today = new Date();
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
    <div className="overflow-x-auto bg-white rounded-[20px] border border-[#EFEFEF]">
      <div className="min-w-[480px] grid grid-cols-[44px_repeat(7,1fr)]">
        <div className="bg-[#FAFAFA] border-b border-[#EFEFEF]" />
        {days.map((d) => {
          const isToday = sameDay(d, today);
          return (
            <div
              key={d.toISOString()}
              className="border-b border-l border-[#EFEFEF] py-2 text-center text-[12px] font-medium bg-[#FAFAFA]"
            >
              <div className="font-bold text-[#1F1F1F]">{DAY_LABELS[d.getDay()]}</div>
              <div
                className={`text-[10px] font-mono mt-0.5 mx-auto w-6 h-5 leading-5 rounded-full ${
                  isToday ? 'bg-[#5F0080] text-white' : 'text-[#6F6F6F]'
                }`}
              >
                {d.getDate()}
              </div>
            </div>
          );
        })}

        {HOURS.map((h) => (
          <div key={h} className="contents">
            <div className="border-t border-[#EFEFEF] px-1 py-2 text-[10px] font-mono text-[#6F6F6F] text-right">
              {String(h).padStart(2, '0')}
            </div>
            {days.map((d) => {
              const items = cellSessions(d, h);
              const first = items[0];
              return (
                <div
                  key={`${d.toISOString()}-${h}`}
                  className="border-t border-l border-[#EFEFEF] min-h-[36px] p-0.5"
                >
                  {first && (
                    <Link
                      to={`/sessions/${first.id}`}
                      className="flex items-center gap-1 px-1 py-0.5 rounded hover:bg-[#F2F3F8] transition"
                      title={`${first.title || typeLabel(first.type)} (${first.duration_min}분)`}
                    >
                      <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${typeDotColor(first.type)}`} />
                      <span className="text-[10px] text-[#1F1F1F] truncate">
                        {(first.title || typeLabel(first.type)).slice(0, 2)}
                      </span>
                    </Link>
                  )}
                  {items.length > 1 && (
                    <div className="text-[9px] text-[#6F6F6F] text-right pr-1">+{items.length - 1}</div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
