// 세션 카드 (UI Kit)

import { Link } from 'react-router-dom';
import type { SessionDto } from '../../lib/api/session';
import { StatusBadge } from './StatusBadge';

const TYPE_LABELS: Record<SessionDto['type'], string> = {
  clinical: '임상심리상담',
  hypnosis: '최면심리상담',
  meditation: '명상수업',
};

const TYPE_CLASSES: Record<SessionDto['type'], string> = {
  clinical: 'bg-[#F5EDFC] text-[#5F0080]',
  hypnosis: 'bg-[#EFE3FA] text-[#6E1A8C]',
  meditation: 'bg-[#E6F8F3] text-[#1F8A5B]',
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
  /** 클릭 핸들러 (제공 시 Link 대신 button 으로 렌더링) */
  onClick?: () => void;
  /** 내담자 뷰에서 표시할 상담사 이름 */
  counselorName?: string;
}

const cardCls = 'block w-full text-left bg-white rounded-2xl border border-[#DDDEE7] p-[22px] hover:shadow-md transition-shadow';

export function SessionCard({ session, onClick, counselorName }: Props) {
  const inner = (
    <>
      <div className="flex items-center justify-between mb-3">
        <span
          className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wide ${TYPE_CLASSES[session.type]}`}
        >
          {TYPE_LABELS[session.type]}
        </span>
        <StatusBadge status={session.status} />
      </div>
      <h3 className="text-[17px] font-bold text-[#1F1F1F] mb-2 truncate">
        {session.title || '제목 없음'}
      </h3>
      <div className="text-[13px] text-[#6F6F6F] space-y-1">
        <div className="font-mono">{formatDateTime(session.scheduled_at)}</div>
        <div className="flex items-center gap-3">
          <span>{session.duration_min}분</span>
          <span>
            참여자 {session.participants.length}/{session.max_participants}
          </span>
        </div>
        {counselorName && (
          <div className="text-[#5F0080] font-medium">{counselorName}</div>
        )}
      </div>
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cardCls}>
        {inner}
      </button>
    );
  }

  return (
    <Link to={`/sessions/${session.id}`} className={cardCls}>
      {inner}
    </Link>
  );
}
