// 선택한 날짜의 세션 목록 (모바일 최적화)

import { Link } from 'react-router-dom';
import type { SessionDto, SessionType, SessionStatus } from '../../lib/api/session';

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const typeLabel = (type: SessionType): string => {
  switch (type) {
    case 'clinical': return '임상';
    case 'hypnosis': return '최면';
    case 'meditation': return '명상';
    default: return type;
  }
};

const typeBadge = (type: SessionType): string => {
  switch (type) {
    case 'clinical': return 'bg-[#F5EDFC] text-[#5F0080]';
    case 'hypnosis': return 'bg-[#FFF4DC] text-[#8A6B1F]';
    case 'meditation': return 'bg-[#E6F8F3] text-[#1F8A5B]';
    default: return 'bg-[#F2F3F8] text-[#6F6F6F]';
  }
};

const statusLabel = (status: SessionStatus): string => {
  switch (status) {
    case 'scheduled': return '예정';
    case 'in_progress': return '진행중';
    case 'paused': return '일시정지';
    case 'completed': return '완료';
    case 'cancelled': return '취소';
    default: return status;
  }
};

const statusBadge = (status: SessionStatus): string => {
  switch (status) {
    case 'scheduled':   return 'bg-[#F5EDFC] text-[#5F0080]';
    case 'in_progress': return 'bg-[#E6F8F3] text-[#1F8A5B]';
    case 'paused':      return 'bg-[#FFF4DC] text-[#8A6B1F]';
    case 'completed':   return 'bg-[#F2F3F8] text-[#6F6F6F]';
    case 'cancelled':   return 'bg-[#FDECEC] text-[#B3261E]';
    default:            return 'bg-[#F2F3F8] text-[#6F6F6F]';
  }
};

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

const formatHeader = (d: Date): string =>
  `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAY[d.getDay()]})`;

const formatTime = (iso: string): string => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

interface Props {
  sessions: SessionDto[];
  selectedDate: Date;
}

export function DaySchedule({ sessions, selectedDate }: Props) {
  const items = sessions
    .filter((s) => sameDay(new Date(s.scheduled_at), selectedDate))
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());

  return (
    <div className="bg-white rounded-[20px] border border-[#EFEFEF] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#EFEFEF]">
        <h3 className="text-sm font-bold text-[#1F1F1F]">{formatHeader(selectedDate)}</h3>
      </div>

      {items.length === 0 ? (
        <p className="text-[#6F6F6F] text-center py-10 text-sm">등록된 세션이 없습니다</p>
      ) : (
        <ul className="overflow-auto max-h-[calc(100vh-400px)] divide-y divide-[#EFEFEF]">
          {items.map((s) => (
            <li key={s.id}>
              <Link
                to={`/sessions/${s.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-[#FAFAFA] transition-colors"
              >
                <span className="text-sm font-mono text-[#1F1F1F] min-w-[44px]">
                  {formatTime(s.scheduled_at)}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold shrink-0 ${typeBadge(s.type)}`}>
                  {typeLabel(s.type)}
                </span>
                <span className="flex-1 truncate text-sm text-[#1F1F1F]">
                  {s.title || `${typeLabel(s.type)} 세션`}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0 ${statusBadge(s.status)}`}>
                  {statusLabel(s.status)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
