// SDD-209 M — 참가자 사전·사후 흐름 화면 틀.
// MemberFlowFrame = 몰입형 틀(상단 바 + 가운데 본문 컬럼 + 하단 고정 CTA). MemberFullFrame = 상단 바·CTA 없이 카드 하나(대기열·종료·상태).
import type { ReactNode } from 'react';
import { ChevronLeft, X } from 'lucide-react';
import { IconCircleButton } from '../../player/shared/IconCircleButton';
import { PlayerBackdrop } from '../../player/shared/PlayerBackdrop';
import { PlayerShell } from '../../player/shared/PlayerShell';
import { PlayerTopBar } from '../../player/shared/PlayerTopBar';
import { FlowBody, FlowCol, FlowFoot, FlowSteps } from '../shared/flow-primitives';
import './member-flow.css';

const TOP_SLOT = 96;

export interface MemberFlowSteps {
  total: number;
  /** 0부터 */
  current: number;
}

interface MemberFlowFrameProps {
  place?: 'online' | 'offline';
  backdropSrc?: string;
  /** 가운데 제목(진행 점이 있으면 점이 우선) */
  title?: string;
  steps?: MemberFlowSteps;
  onBack?: () => void;
  backLabel?: string;
  onExit?: () => void;
  exitLabel?: string;
  /** 준비 마법사(FM06) 단계 — 모든 단계가 같은 바깥 여백을 쓴다 */
  wizard?: boolean;
  /** 본문 컬럼 클래스(예: fm-wide) */
  colClassName?: string;
  /** 하단 고정 영역(주 버튼 1개 + 보조) */
  foot?: ReactNode;
  sheet?: ReactNode;
  sheetOpen?: boolean;
  children: ReactNode;
}

export function MemberFlowFrame({
  place = 'online', backdropSrc, title, steps, onBack, backLabel = '이전', onExit, exitLabel = '나가기',
  wizard = false, colClassName, foot, sheet = null, sheetOpen = false, children,
}: MemberFlowFrameProps) {
  const center = steps ? <FlowSteps total={steps.total} current={steps.current} /> : <span className="fm-title">{title ?? ''}</span>;
  return (
    <PlayerShell
      place={place}
      flow
      className={wizard ? 'fl-root fm-wizard' : 'fl-root'}
      sheetOpen={sheetOpen}
      backdrop={<PlayerBackdrop imageSrc={backdropSrc} />}
      top={
        <PlayerTopBar
          variant="flow"
          slotWidth={TOP_SLOT}
          left={onBack ? <IconCircleButton label={backLabel} icon={<ChevronLeft size={24} />} onClick={onBack} /> : <span className="fm-ph" aria-hidden="true" />}
          center={center}
          right={onExit ? <IconCircleButton label={exitLabel} icon={<X size={24} />} onClick={onExit} /> : <span className="fm-ph" aria-hidden="true" />}
        />
      }
      dock={foot ? <FlowFoot>{foot}</FlowFoot> : undefined}
      sheet={sheet}
    >
      <FlowBody>
        {colClassName ? (
          <div className={colClassName} style={{ display: 'contents' }}>
            <FlowCol>{children}</FlowCol>
          </div>
        ) : (
          <FlowCol>{children}</FlowCol>
        )}
      </FlowBody>
    </PlayerShell>
  );
}

interface MemberFullFrameProps {
  place?: 'online' | 'offline';
  backdropSrc?: string;
  sheet?: ReactNode;
  sheetOpen?: boolean;
  children: ReactNode;
}

/** 상단 바·도크 없이 카드 하나를 가운데에 둔다(균형.md MS3) */
export function MemberFullFrame({ place = 'online', backdropSrc, sheet = null, sheetOpen = false, children }: MemberFullFrameProps) {
  return (
    <PlayerShell
      place={place}
      flow
      className="fl-root"
      sheetOpen={sheetOpen}
      backdrop={<PlayerBackdrop imageSrc={backdropSrc} />}
      top={null}
      sheet={sheet}
    >
      <div className="fm-full">{children}</div>
    </PlayerShell>
  );
}
