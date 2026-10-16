// SDD-208 — 회원 클래스 진행 화면(뷰). props 만 받는 순수 컴포넌트 — 훅·서버 호출은 MemberClassContainer 가 맡는다.
// 평상시 화면 = "시간 + 핵심 지표 1개(정적 링)". 채팅·6지표·소리·기기·신호는 도크에서 시트로 연다.
import { useMemo, type ReactNode } from 'react';
import { Activity, Bluetooth, MessageCircle, Volume2, Waves } from 'lucide-react';
import { deriveMemberCase, type DockKey, type SlotAction } from '../../../../lib/class/member-player-case';
import { PlayerBackdrop } from '../shared/PlayerBackdrop';
import { PlayerDock, type DockItem } from '../shared/PlayerDock';
import { PlayerShell } from '../shared/PlayerShell';
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
  const { input, header, hero, snapshot, series, chat, sheet, backdropSrc, actions } = props;
  const c = useMemo(() => deriveMemberCase(input), [input]);

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
      sheetOpen={false}
      backdrop={<PlayerBackdrop imageSrc={backdropSrc} />}
      top={<MemberTopBar header={header} conn={c.conn} onLeave={actions.onLeave} />}
      dock={
        <PlayerDock
          items={dockItems}
          active={sheet}
          onSelect={(key) => actions.onSheetChange(isSheetKey(key) ? key : null)}
        />
      }
      sheet={null}
    >
      <MemberStage
        c={c}
        hero={hero}
        snapshot={snapshot}
        series={series}
        slotTop={null}
        sheetOpen={false}
        onSlotAction={handleSlotAction}
        netDownCard={null}
      />
    </PlayerShell>
  );
}
