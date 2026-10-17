// SDD-209 H1 — 상담사 몰입형 화면 공용 틀: 배경 / 상단 바(제목 + 보조 줄) / 본문 컬럼 / 하단 고정 영역 / 시트.
// PlayerShell(flow) 위에 얹고, 시트는 호출부가 FlowSheet 로 만들어 넘긴다.
import type { ReactNode } from 'react';
import type { FlowPlace } from '../../../../lib/class/flow/types';
import { IconCircleButton } from '../../player/shared/IconCircleButton';
import { PlayerBackdrop } from '../../player/shared/PlayerBackdrop';
import { PlayerShell } from '../../player/shared/PlayerShell';
import { PlayerTopBar } from '../../player/shared/PlayerTopBar';
import { FlowBody, FlowCol, FlowFoot } from '../shared/flow-primitives';
import './host-flow-base.css';
import './host-flow-create.css';
import './host-flow-live.css';

export interface HostFrameLeft {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
}

interface HostFlowFrameProps {
  place?: FlowPlace;
  /** 루트에 덧붙일 클래스(예: fh-wiz) */
  className?: string;
  backdropSrc?: string;
  left?: HostFrameLeft;
  title: string;
  /** 제목 아래 보조 줄(로비 등) */
  sub?: string;
  /** 본문을 상단 바와 푸터 사이에 꽉 채울지(목록 선택 단계) */
  fill?: boolean;
  children: ReactNode;
  /** 하단 고정 영역(FlowFoot 안에 들어간다). 없으면 푸터를 만들지 않는다 */
  foot?: ReactNode;
  sheet?: ReactNode;
  sheetOpen?: boolean;
  /** 본문 위에 겹치는 배너(자리를 밀지 않는다) */
  banner?: ReactNode;
}

export function HostFlowFrame({
  place = 'online', className, backdropSrc, left, title, sub, fill = false, children, foot, sheet = null, sheetOpen = false, banner,
}: HostFlowFrameProps) {
  const center = sub ? (
    <span className="fhb-ttl">
      <b>{title}</b>
      <span>{sub}</span>
    </span>
  ) : (
    title
  );
  return (
    <PlayerShell
      place={place}
      flow
      className={`fl-root fh-ovsheet${className ? ` ${className}` : ''}`}
      sheetOpen={sheetOpen}
      backdrop={<PlayerBackdrop imageSrc={backdropSrc} />}
      top={
        <PlayerTopBar
          variant="flow"
          slotWidth={96}
          left={left ? <IconCircleButton label={left.label} icon={left.icon} onClick={left.onClick} pz="flow-back" /> : undefined}
          center={center}
        />
      }
      dock={foot === undefined ? undefined : <FlowFoot>{foot}</FlowFoot>}
      sheet={sheet}
    >
      {banner}
      <FlowBody>
        {fill ? (
          <div className="fl-col fh-fillcol" data-pz="flow-col">{children}</div>
        ) : (
          <FlowCol>{children}</FlowCol>
        )}
      </FlowBody>
    </PlayerShell>
  );
}
