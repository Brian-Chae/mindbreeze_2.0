// SDD-209 SH1 — 클래스 카드(목록·초대·지난 클래스 공용). 본문 전체가 하나의 버튼이고, 입장 가능이면 아래 액션 버튼이 붙는다.
import { Clock, User } from 'lucide-react';
import type { LinkbandMode, LocationType, ParticipantMode } from '../../../../lib/api/session';
import type { ClassChipKey } from '../../../../lib/class/class-labels';
import { MethodChips } from './MethodChips';
import { StatusChip } from './StatusChip';
import './shell-kit.css';

export interface ClassCardData {
  id: string;
  typeLabel: string;
  title: string;
  whenLabel: string;
  place: LocationType;
  mode: ParticipantMode;
  band: LinkbandMode;
  /** 초대한 상담사 등 보조 한 줄 */
  subLine?: string;
}

export interface ClassCardAction {
  label: string;
  onClick: (id: string) => void;
  disabled?: boolean;
}

interface ClassCardProps {
  data: ClassCardData;
  chip: ClassChipKey;
  highlight?: boolean;
  onOpen: (id: string) => void;
  action?: ClassCardAction;
}

export function ClassCard({ data, chip, highlight = false, onOpen, action }: ClassCardProps) {
  return (
    <article className="sh-card sh-ccard" data-testid="class-card" data-highlight={highlight ? 'true' : undefined}>
      <button type="button" className="sh-ccard__main" onClick={() => onOpen(data.id)}>
        <span className="sh-ccard__row">
          <span className="sh-ccard__type">{data.typeLabel}</span>
          <StatusChip chip={chip} />
        </span>
        <span className="sh-ccard__title" role="heading" aria-level={3}>{data.title}</span>
        {data.subLine ? <span className="sh-ccard__meta"><User size={16} aria-hidden="true" />{data.subLine}</span> : null}
        <span className="sh-ccard__meta"><Clock size={16} aria-hidden="true" />{data.whenLabel}</span>
        <span className="sh-chips"><MethodChips place={data.place} mode={data.mode} band={data.band} /></span>
      </button>
      {action ? (
        <div className="sh-ccard__act">
          <button
            type="button"
            className={`sh-btn${action.disabled ? ' mute' : ''}`}
            data-testid="class-card-action"
            disabled={action.disabled}
            onClick={() => action.onClick(data.id)}
          >
            {action.label}
          </button>
        </div>
      ) : null}
    </article>
  );
}
