// 세션 카드

import { Link } from 'react-router-dom';
import type { SessionDto } from '../../lib/api/session';
import { StatusBadge } from './StatusBadge';

const TYPE_LABELS: Record<SessionDto['type'], string> = {
  clinical: '임상심리상담',
  hypnosis: '최면심리상담',
  meditation: '명상수업',
};

const TYPE_CLASSES: Record<SessionDto['type'], string> = {
  clinical: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  hypnosis: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  meditation: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
};

const formatDateTime = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

interface Props {
  session: SessionDto;
}

export function SessionCard({ session }: Props){
  return (
    <Link
      to={`/sessions/${session.id}`}
      className="block rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm hover:shadow-md transition-shadow"
    >
      <div className="flex items-center justify-between mb-2">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${TYPE_CLASSES[session.type]}`}
        >
          {TYPE_LABELS[session.type]}
        </span>
        <StatusBadge status={session.status} />
      </div>
      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1 truncate">
        {session.title || '제목 없음'}
      </h3>
      <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
        <div>{formatDateTime(session.scheduled_at)}</div>
        <div className="flex items-center gap-3">
          <span>{session.duration_min}분</span>
          <span>
            참여자 {session.participants.length}/{session.max_participants}
          </span>
        </div>
      </div>
    </Link>
  );
}
