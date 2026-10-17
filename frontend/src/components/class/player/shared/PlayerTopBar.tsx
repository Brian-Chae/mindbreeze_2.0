// SDD-208 — 상단 바. 좌·우 슬롯이 같은 크기라 한쪽이 비어도 제목이 가운데에 남는다(균형.md S3).
import type { CSSProperties, ReactNode } from 'react';
import './player-shared.css';

interface PlayerTopBarProps {
  /** member = 투명 한 줄, host = 카드형, flow(SDD-209) = 사전 흐름 투명 한 줄. 측정 훅 이름도 variant 로 정해진다(member 는 topbar·title, host 는 top·ttl, flow 는 flow-top·flow-title) */
  variant: 'member' | 'host' | 'flow';
  /** SDD-209: 좌·우 슬롯을 이 폭(px)으로 고정한다(S3). 생략하면 현행 */
  slotWidth?: number;
  left?: ReactNode;
  center: ReactNode;
  right?: ReactNode;
}

export function PlayerTopBar({ variant, slotWidth, left, center, right }: PlayerTopBarProps) {
  const pzTop = variant === 'host' ? 'top' : variant === 'flow' ? 'flow-top' : 'topbar';
  const pzTitle = variant === 'host' ? 'ttl' : variant === 'flow' ? 'flow-title' : 'title';
  const style = slotWidth === undefined ? undefined : ({ '--pz-top-slot': `${slotWidth}px` } as CSSProperties);
  return (
    <header
      className="pz-topbar"
      data-variant={variant}
      data-slot-fixed={slotWidth === undefined ? undefined : 'true'}
      data-pz={pzTop}
      style={style}
    >
      <div className="pz-topbar__slot pz-topbar__slot--start">{left}</div>
      <div className="pz-topbar__center" data-pz={pzTitle}>{center}</div>
      <div className="pz-topbar__slot pz-topbar__slot--end">{right}</div>
    </header>
  );
}
