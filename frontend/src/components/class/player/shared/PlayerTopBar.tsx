// SDD-208 — 상단 바. 좌·우 슬롯이 같은 크기라 한쪽이 비어도 제목이 가운데에 남는다(균형.md S3).
import type { ReactNode } from 'react';
import './player-shared.css';

interface PlayerTopBarProps {
  /** member = 투명 한 줄, host = 카드형. 측정 훅 이름도 variant 로 정해진다(member 는 topbar·title, host 는 top·ttl) */
  variant: 'member' | 'host';
  left?: ReactNode;
  center: ReactNode;
  right?: ReactNode;
}

export function PlayerTopBar({ variant, left, center, right }: PlayerTopBarProps) {
  const host = variant === 'host';
  return (
    <header className="pz-topbar" data-variant={variant} data-pz={host ? 'top' : 'topbar'}>
      <div className="pz-topbar__slot pz-topbar__slot--start">{left}</div>
      <div className="pz-topbar__center" data-pz={host ? 'ttl' : 'title'}>{center}</div>
      <div className="pz-topbar__slot pz-topbar__slot--end">{right}</div>
    </header>
  );
}
