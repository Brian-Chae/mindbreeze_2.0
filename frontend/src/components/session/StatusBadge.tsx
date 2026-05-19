// 세션 상태 뱃지

import type { SessionStatus } from '../../lib/api/session';

const STATUS_LABELS: Record<SessionStatus, string> = {
  scheduled: '예정',
  in_progress: '진행중',
  paused: '일시정지',
  completed: '완료',
  cancelled: '취소됨',
};

const STATUS_CLASSES: Record<SessionStatus, string> = {
  scheduled: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  in_progress: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  paused: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  completed: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

interface Props {
  status: SessionStatus;
}

export function StatusBadge({ status }: Props){
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
