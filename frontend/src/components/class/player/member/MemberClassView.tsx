// SDD-208 — 회원 클래스 진행 화면(뷰). props 만 받는 순수 컴포넌트 — 훅·서버 호출은 MemberClassContainer 가 맡는다.
// 평상시 화면 = "시간 + 핵심 지표 1개(정적 링)". 채팅·6지표·소리·기기·신호는 도크에서 시트로 연다.
import { useMemo, type ReactNode } from 'react';
import { Activity, Bluetooth, MessageCircle, Volume2, Waves } from 'lucide-react';
import { deriveMemberCase, type DockKey, type SlotAction } from '../../../../lib/class/member-player-case';
import { PlayerBackdrop } from '../shared/PlayerBackdrop';
import { PlayerDock, type DockItem } from '../shared/PlayerDock';
import { PlayerSheet } from '../shared/PlayerSheet';
import { useSheetMode } from '../shared/sheet-mode';
import { PlayerShell } from '../shared/PlayerShell';
import { MemberHostPip, MemberMediaRow, MemberMyPip } from './MemberPips';
import { MemberSheetBody } from './MemberSheets';
import { memberSheetTitle } from './member-sheet-title';
import { MemberSideCard } from './MemberSideCard';
import { MemberStage } from './MemberStage';
import { MemberTopBar } from './MemberTopBar';
import type { MemberClassViewProps, MemberSheetKey } from './member-view-types';
import './member-player.css';

export type { MemberClassViewProps } from './member-view-types';

const DOCK_ICONS: Record<DockKey, ReactNode> = {
  status: <Activity size={24} strokeWidth={2} />,
  chat: <MessageCircle size={24} strokeWidth={2} />,
  signal: <Waves size={24} strokeWidth={2} />,
  sound: <Volume2 size={24} strokeWidth={2} />,
  device: <Bluetooth size={24} strokeWidth={2} />,
};

const SHEET_KEYS: readonly string[] = ['status', 'chat', 'signal', 'sound', 'device'];
const isSheetKey = (key: string | null): key is MemberSheetKey => key !== null && SHEET_KEYS.includes(key);

export function MemberClassView(props: MemberClassViewProps) {
  const { input, header, hero, snapshot, series, chat, sound, checkin, sheet, backdropSrc, hostVideo, myVideo, actions } = props;
  const c = useMemo(() => deriveMemberCase(input), [input]);
  // 도크에 없는 시트(오프라인의 조용한 신호 등)는 열지 않는다
  const activeSheet = sheet !== null && c.dock.some((item) => item.key === sheet) ? sheet : null;
  const sheetOpen = activeSheet !== null;
  const sheetMode = useSheetMode();

  const dockItems: DockItem[] = c.dock.map((item) => ({
    key: item.key,
    label: item.label,
    icon: DOCK_ICONS[item.key],
    badge: item.key === 'chat' && chat.enabled ? chat.unread : undefined,
  }));

  const handleSlotAction = (act: SlotAction): void => {
    if (act === 'openDevice') actions.onSheetChange('device');
    else if (act === 'cancel') actions.onBandCancel();
    else if (act === 'retry') actions.onBandRetry();
    else actions.onBandContinue();
  };

  return (
    <PlayerShell
      place={c.place}
      sheetOpen={sheetOpen}
      backdrop={<PlayerBackdrop imageSrc={backdropSrc} />}
      top={<MemberTopBar header={header} conn={c.conn} onLeave={actions.onLeave} />}
      dock={
        <>
          <MemberMediaRow c={c} sheetOpen={sheetOpen} actions={actions} />
          <PlayerDock
            items={dockItems}
            active={activeSheet}
            onSelect={(key) => actions.onSheetChange(isSheetKey(key) ? key : null)}
          />
        </>
      }
      sheet={
        <PlayerSheet
          open={sheetOpen}
          title={activeSheet ? memberSheetTitle(activeSheet, input.band) : ''}
          tall={activeSheet === 'chat' && chat.enabled && chat.authenticated && sheetMode === 'side'}
          onClose={() => actions.onSheetChange(null)}
        >
          {activeSheet ? <MemberSheetBody sheetKey={activeSheet} props={props} c={c} /> : null}
        </PlayerSheet>
      }
    >
      <MemberStage
        c={c}
        hero={hero}
        snapshot={snapshot}
        series={series}
        slotTop={
          <div className="mp-pips">
            {c.showHostPip ? <MemberHostPip name={header.counselorName} frozen={c.pipFrozen} video={hostVideo} /> : null}
            {c.showMyPip ? <MemberMyPip cam={c.myCam} initial={header.myInitial} video={myVideo} /> : null}
          </div>
        }
        sideCard={
          c.showSideCard ? (
            <MemberSideCard sound={sound} checkin={checkin} onOpenSound={() => actions.onSheetChange('sound')} onCheckin={actions.onCheckin} />
          ) : null
        }
        sheetOpen={sheetOpen}
        onSlotAction={handleSlotAction}
        netDownCard={null}
      />
      {/* 채팅 시트가 닫혀 있어도 안읽음 집계가 이어지도록 채팅 노드는 계속 마운트해 둔다 */}
      {activeSheet !== 'chat' && chat.enabled && chat.authenticated ? <div hidden>{chat.node}</div> : null}
    </PlayerShell>
  );
}
