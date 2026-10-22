// SDD-208 — 화면 틀: 배경 / 상단 바 / 본문 / (바텀 시트) / 도크 / (사이드 시트).
// 시트가 열리면 상단 바·본문만 inert 로 만들고 도크는 계속 눌리게 둔다(도크에서 시트를 바꾸거나 닫을 수 있어야 한다).
import type { FocusEventHandler, ReactNode } from 'react';
import { useSheetMode } from './sheet-mode';
import './player-shared.css';

interface PlayerShellProps {
  place: 'online' | 'offline';
  onFocusCapture?: FocusEventHandler<HTMLDivElement>;
  sheetOpen: boolean;
  top: ReactNode;
  /** 도크 위에 미디어 줄을 함께 쌓을 수 있다. SDD-209: 생략하면 도크 영역 자체를 렌더하지 않는다 */
  dock?: ReactNode;
  /** PlayerSheet 요소(닫혀 있으면 null) */
  sheet: ReactNode;
  backdrop?: ReactNode;
  /** SDD-209: 루트에 덧붙일 클래스(기본 없음) */
  className?: string;
  /** SDD-209: 몰입형 사전 흐름 모드(기본 false = 진행 화면 현행). 본문 측정 훅이 flow-stage 가 된다 */
  flow?: boolean;
  children: ReactNode;
}

export function PlayerShell({ place, sheetOpen, top, dock, sheet, backdrop, className, flow = false, onFocusCapture, children }: PlayerShellProps) {
  const mode = useSheetMode();
  return (
    <div
      className={className ? `pz-root pz-shell ${className}` : 'pz-root pz-shell'}
      onFocusCapture={onFocusCapture}
      data-pz="app"
      data-place={place}
      data-sheet-open={sheetOpen ? 'true' : 'false'}
      data-sheet-mode={mode}
      data-flow={flow ? 'true' : undefined}
    >
      {backdrop}
      <div className="pz-shell__top" inert={sheetOpen}>{top}</div>
      <main className="pz-shell__stage" data-pz={flow ? 'flow-stage' : 'col'} inert={sheetOpen}>{children}</main>
      {dock === undefined ? null : (
        // 진행 화면은 시트가 열려도 도크가 계속 눌려야 한다. 사전 흐름(flow)은 주 버튼을 시트가 가리므로 같이 막는다(FR6)
        <div className="pz-shell__dock" inert={flow && sheetOpen}>{dock}</div>
      )}
      {sheet}
    </div>
  );
}
