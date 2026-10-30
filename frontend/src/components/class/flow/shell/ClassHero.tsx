// SDD-209 SH2 — 회원 홈 히어로(FM01). 자연 사진 + 다크 면 위에 상태 배지·시작까지·방식·안내·CTA 한 개.
// 입장 코드는 상담사가 전달하므로 회원 화면에는 코드 값·복사 UI 를 두지 않는다(R4).
import { Bell, Clock, Plus, Send, User } from 'lucide-react';
import type { LinkbandMode, LocationType, ParticipantMode } from '../../../../lib/api/session';
import type { ClassChipKey } from '../../../../lib/class/class-labels';
import type { EnterAction, HeroBoxIcon } from '../../../../lib/class/enter-action';
import { MethodChips } from './MethodChips';
import { BOX_ICONS } from './shell-icons';
import { StatusChip } from './StatusChip';
import './shell-kit.css';

export interface ClassHeroData {
  chip: ClassChipKey;
  /** 배지 옆 칩(`D-3`·`30분 뒤`·`12분째`·시각) */
  countdown: string;
  title: string;
  /** `오늘 오후 3:00 · 50분` */
  meta: string;
  hostName: string | null;
  place: LocationType;
  mode: ParticipantMode;
  band: LinkbandMode;
  box: { icon: HeroBoxIcon; title: string; sub: string };
  backdropSrc: string;
}

interface ClassHeroProps {
  data: ClassHeroData;
  action: EnterAction;
  onAction: () => void;
  busy?: boolean;
}

export function ClassHero({ data, action, onAction, busy = false }: ClassHeroProps) {
  const BoxIcon = BOX_ICONS[data.box.icon];
  return (
    <section className="sh-hero" data-testid="class-hero" aria-label="다음 클래스" data-off={data.chip === 'cancelled' ? 'true' : undefined}>
      <div className="sh-hero__bg" style={{ backgroundImage: `url(${data.backdropSrc})` }} aria-hidden="true" />
      <div className="sh-hero__in">
        <div className="sh-hero__row">
          <StatusChip chip={data.chip} dark />
          {data.countdown ? <span className="sh-hchip"><Clock size={16} aria-hidden="true" />{data.countdown}</span> : null}
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
        <button
          type="button"
          className={`sh-hcta${action.line ? ' line' : ''}`}
          data-testid="class-hero-cta"
          disabled={action.disabled || busy}
          onClick={onAction}
        >
          {action.label}
        </button>
      </div>
    </section>
  );
}

interface ClassHeroEmptyProps {
  backdropSrc: string;
  onApply: () => void;
}

/** 예정된 클래스가 없을 때: 상담사에게 신청하는 진입 */
export function ClassHeroEmpty({ backdropSrc, onApply }: ClassHeroEmptyProps) {
  return (
    <section className="sh-hero" data-testid="class-hero" aria-label="다음 클래스">
      <div className="sh-hero__bg" style={{ backgroundImage: `url(${backdropSrc})` }} aria-hidden="true" />
      <div className="sh-hero__in">
        <div className="sh-hero__row"><span className="sh-hchip"><Clock size={16} aria-hidden="true" />예정 없음</span></div>
        <h2 className="sh-hero__title">예정된 클래스가 없어요</h2>
        <div className="sh-hero__meta"><span><Bell size={16} aria-hidden="true" />코치가 클래스를 만들면 알려드려요</span></div>
        <div className="sh-hbox">
          <Send size={20} aria-hidden="true" />
          <div className="sh-hbox__tx"><b>하고 싶은 클래스가 있나요?</b><span>코치에게 신청 메시지를 보내 보세요</span></div>
        </div>
        <button type="button" className="sh-hcta" data-testid="class-hero-cta" onClick={onApply}>
          <Plus size={20} aria-hidden="true" />클래스 신청하기
        </button>
      </div>
    </section>
  );
}
