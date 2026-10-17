// SDD-209 SH4 — FM03 회원 클래스 상세 뷰(순수 props). 히어로(유형·상태·방식·안내) + 준비물 3줄 + 하단 주 버튼 1개.
import { Clock, User } from 'lucide-react';
import type { LinkbandMode, LocationType, ParticipantMode } from '../../../../lib/api/session';
import type { ClassChipKey } from '../../../../lib/class/class-labels';
import type { EnterAction, HeroCopy, PrepRow } from '../../../../lib/class/enter-action';
import { MethodChips } from './MethodChips';
import { BOX_ICONS, PREP_ICONS } from './shell-icons';
import { StatusChip } from './StatusChip';
import './shell-kit.css';

export interface ClassDetailData {
  typeLabel: string;
  chip: ClassChipKey;
  title: string;
  /** `오늘 오후 3:00 · 50분` */
  meta: string;
  hostName: string | null;
  place: LocationType;
  mode: ParticipantMode;
  band: LinkbandMode;
  box: HeroCopy;
  backdropSrc: string;
  prep: { title: string; rows: PrepRow[] };
}

export function ClassDetailBody({ data }: { data: ClassDetailData }) {
  const BoxIcon = BOX_ICONS[data.box.icon];
  return (
    <>
      <section className="sh-hero" data-testid="class-detail-hero" aria-label="클래스 정보" data-off={data.chip === 'cancelled' ? 'true' : undefined}>
        <div className="sh-hero__bg" style={{ backgroundImage: `url(${data.backdropSrc})` }} aria-hidden="true" />
        <div className="sh-hero__in">
          <div className="sh-hero__row">
            <span className="sh-hchip">{data.typeLabel}</span>
            <StatusChip chip={data.chip} dark />
          </div>
          <h2 className="sh-hero__title">{data.title}</h2>
          <div className="sh-hero__meta">
            <span><Clock size={16} aria-hidden="true" />{data.meta}</span>
            {data.hostName ? <span><User size={16} aria-hidden="true" />{data.hostName}</span> : null}
          </div>
          <div className="sh-hero__row"><MethodChips place={data.place} mode={data.mode} band={data.band} dark /></div>
          <div className="sh-hbox">
            <BoxIcon size={20} aria-hidden="true" />
            <div className="sh-hbox__tx"><b>{data.box.title}</b><span>{data.box.sub}</span></div>
          </div>
        </div>
      </section>
      <section className="sh-card sh-prep" aria-label={data.prep.title}>
        <h2>{data.prep.title}</h2>
        <ul>
          {data.prep.rows.map((row) => {
            const Icon = PREP_ICONS[row.icon];
            return (
              <li key={row.title}>
                <i><Icon size={20} aria-hidden="true" /></i>
                <span><b>{row.title}</b><span className="s">{row.sub}</span></span>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

interface ClassDetailFootProps {
  note: string;
  action: EnterAction;
  onAction: () => void;
  busy?: boolean;
  /** 입장 실패 안내(한 줄) */
  error?: { message: string; needsCode: boolean } | null;
  onEnterWithCode?: () => void;
  /** 페이지 본문 안에 그릴 때(고정 푸터가 아닐 때) 바깥 여백 제거 */
  inline?: boolean;
}

export function ClassDetailFoot({ note, action, onAction, busy = false, error = null, onEnterWithCode, inline = false }: ClassDetailFootProps) {
  return (
    <div className={`sh-foot${inline ? ' inline' : ''}`} data-pz="flow-foot">
      <div className="sh-foot__in">
        <div className="sh-fnote">{note}</div>
        {error ? (
          <div role="alert" className="sh-fnote">
            <span className="sh-err">{error.message}</span>
          </div>
        ) : null}
        <button
          type="button"
          className={`sh-btn${action.disabled ? ' mute' : ''}${action.line ? ' line' : ''}`}
          data-pz="flow-cta"
          disabled={action.disabled || busy}
          onClick={onAction}
        >
          {busy ? '입장하는 중' : action.label}
        </button>
        {error?.needsCode && onEnterWithCode ? (
          <button type="button" className="sh-link" data-testid="detail-enter-with-code" onClick={onEnterWithCode}>코드로 입장하기</button>
        ) : null}
      </div>
    </div>
  );
}
