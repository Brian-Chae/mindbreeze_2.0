// SDD-208 — 화면 틀: 배경 / 상단 바 / 본문 / (바텀 시트) / 도크 / (사이드 시트).
// 시트가 열리면 상단 바·본문만 inert 로 만들고 도크는 계속 눌리게 둔다(도크에서 시트를 바꾸거나 닫을 수 있어야 한다).
import type { ReactNode } from 'react';
import { useSheetMode } from './sheet-mode';
import './player-shared.css';

interface PlayerShellProps {
  place: 'online' | 'offline';
  sheetOpen: boolean;
  top: ReactNode;
  /** 도크 위에 미디어 줄을 함께 쌓을 수 있다 */
  dock: ReactNode;
  /** PlayerSheet 요소(닫혀 있으면 null) */
  sheet: ReactNode;
  backdrop?: ReactNode;
  children: ReactNode;
}

export function PlayerShell({ place, sheetOpen, top, dock, sheet, backdrop, children }: PlayerShellProps) {
  const mode = useSheetMode();
  return (
    <div
      className="pz-root pz-shell"
      data-pz="app"
      data-place={place}
      data-sheet-open={sheetOpen ? 'true' : 'false'}
      data-sheet-mode={mode}
    >
      {backdrop}
      <div className="pz-shell__top" inert={sheetOpen}>{top}</div>
      <main className="pz-shell__stage" data-pz="col" inert={sheetOpen}>{children}</main>
      <div className="pz-shell__dock">{dock}</div>
      {sheet}
    </div>
  );
}
