// 세션 상태 뱃지 (UI Kit)

import type { SessionStatus } from '../../lib/api/session';
import { sessionStatusLabel } from '../../lib/session-status';

const STATUS_CLASSES: Record<SessionStatus, string> = {
  ready: 'bg-[#EAF2FF] text-[#1F4FB3]',
  scheduled: 'bg-[#F5EDFC] text-[#5F0080]',
  open: 'bg-[#E0F5F1] text-[#0F766E]',
  in_progress: 'bg-[#E6F8F3] text-[#1F8A5B]',
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
      {sessionStatusLabel(status)}
    </span>
  );
}
