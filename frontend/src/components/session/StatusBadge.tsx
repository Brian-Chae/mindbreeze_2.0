// 세션 상태 뱃지 (UI Kit)

import type { SessionStatus } from '../../lib/api/session';

const STATUS_LABELS: Record<SessionStatus, string> = {
  scheduled: '예정',
  in_progress: '진행중',
  paused: '일시정지',
  completed: '완료',
  cancelled: '취소됨',
};

const STATUS_CLASSES: Record<SessionStatus, string> = {
  scheduled: 'bg-[#F5EDFC] text-[#5F0080]',
  in_progress: 'bg-[#E6F8F3] text-[#1F8A5B]',
  paused: 'bg-[#FFF4DC] text-[#8A6B1F]',
  completed: 'bg-[#F2F3F8] text-[#6F6F6F]',
  cancelled: 'bg-[#FDECEC] text-[#B3261E]',
};

interface Props {
  status: SessionStatus;
}

export function StatusBadge({ status }: Props) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wide ${STATUS_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
