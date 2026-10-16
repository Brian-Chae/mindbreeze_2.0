// SDD-208 H1 — 상담사 진행 중 화면(뷰). props 만 받는 순수 컴포넌트라 서버·BLE·LiveKit 없이 픽스처로 렌더·측정할 수 있다.
// 구성: 상단 바 → (배너) → 헤드 행(지표 띠 + 셀프뷰/요약 패널) → 칩 줄 → 세로 스크롤 그리드 → 도크, 시트는 도크·칩·타일에서 연다.
import { useState, type ReactNode } from 'react';
import { Activity, ClipboardCheck, MessageCircle, Mic, SlidersHorizontal, Video } from 'lucide-react';
import {
  groupAverage,
  metricByKey,
  sortHostParticipants,
  type HostCase,
  type HostParticipant,
  type HostSheetKey,
} from '../../../../lib/class/host-player-case';
import { PlayerBackdrop } from '../shared/PlayerBackdrop';
import { PlayerDock, type DockItem } from '../shared/PlayerDock';
import { PlayerShell } from '../shared/PlayerShell';
import { PlayerSheet } from '../shared/PlayerSheet';
import { useSheetMode } from '../shared/sheet-mode';
import { HostChipLine } from './HostChipLine';
import { HostSelfView, HostSummaryPanel } from './HostHeadSlot';
import { HostMetricStrip } from './HostMetricStrip';
import { HostParticipantGrid } from './HostParticipantGrid';
import { HostTopBar } from './HostTopBar';
import { MetricSheet } from './sheets/MetricSheet';
import type { HostUiActions, HostUiState } from './useHostUi';
import './host-player.css';

export interface HostLiveActions {
  close: () => void;
  end: () => void;
}

export interface HostLiveViewProps {
  hostCase: HostCase;
  /** 입장순 원본 — 정렬은 뷰가 ui 상태로 한다 */
  participants: readonly HostParticipant[];
  ui: HostUiState;
  uiActions: HostUiActions;
  meta: { title: string; elapsedSec: number; durationMin: number };
  /** 도크 채팅 항목의 안읽음 수 */
  unreadChat: number;
  /** 내 카메라 영상(없으면 실루엣) */
  selfStream: MediaStream | null;
  actions: HostLiveActions;
  /** 하니스가 배경을 고정할 때만 지정 */
  backdropSrc?: string;
}

const icon = (Icon: typeof Activity): ReactNode => <Icon size={24} strokeWidth={2} />;

function sheetTitle(key: HostSheetKey): string {
  switch (key) {
    case 'metric': return '지표 기준';
    default: return '';
  }
}

export function HostLiveView({ hostCase, participants, ui, uiActions, meta, unreadChat, selfStream, actions, backdropSrc }: HostLiveViewProps) {
  const sheetMode = useSheetMode();
  const [range, setRange] = useState<string | null>(null);
  const metric = metricByKey(ui.metric);
  const sorted = sortHostParticipants(participants, { metric: ui.metric, sort: ui.sort, handsFirst: ui.handsFirst });
  const netBad = hostCase.net !== 'ok';
  const online = hostCase.loc === 'online';
  const bottomSheetOpen = ui.sheet !== null && sheetMode === 'bottom';
  const camBig = ui.camBig && hostCase.headSlot === 'selfview' && !bottomSheetOpen;

  const dockItems: DockItem[] = [
    { key: 'metric', label: '지표 기준', icon: icon(Activity) },
    { key: 'chat', label: '채팅', icon: icon(MessageCircle), badge: ui.sheet === 'chat' ? 0 : unreadChat },
    { key: 'media', label: hostCase.mediaDockLabel, icon: icon(online ? Video : Mic) },
    { key: 'checkin', label: '체크인', icon: icon(ClipboardCheck) },
    { key: 'tools', label: '도구', icon: icon(SlidersHorizontal) },
  ];

  const sheetBody = ((): ReactNode => {
    if (ui.sheet === 'metric') {
      return <MetricSheet metric={ui.metric} rotate={ui.rotate} onMetric={uiActions.setMetric} onRotate={uiActions.setRotate} />;
    }
    return null;
  })();

  const sheet = ui.sheet && sheetBody ? (
    <PlayerSheet open title={sheetTitle(ui.sheet)} onClose={uiActions.closeSheet}>
      {sheetBody}
    </PlayerSheet>
  ) : null;

  const strip = (
    <HostMetricStrip
      metric={metric}
      average={groupAverage(participants, ui.metric)}
      showAverage={!hostCase.solo}
      solo={hostCase.solo}
      rotating={ui.rotate && !ui.table && ui.sheet !== 'detail'}
      allOff={hostCase.allOff}
      onOpen={() => uiActions.toggleSheet('metric')}
    />
  );

  return (
    <PlayerShell
      place={hostCase.loc}
      sheetOpen={sheet !== null}
      backdrop={<PlayerBackdrop imageSrc={backdropSrc} />}
      top={
        <HostTopBar
          title={meta.title}
          elapsedSec={meta.elapsedSec}
          durationMin={meta.durationMin}
          stats={hostCase.solo ? null : hostCase.stats}
          onClose={actions.close}
          onEnd={actions.end}
        />
      }
      dock={<PlayerDock items={dockItems} active={ui.sheet} onSelect={(key) => (key ? uiActions.toggleSheet(key as HostSheetKey) : uiActions.closeSheet())} />}
      sheet={sheet}
    >
      <div className="hp-main" data-net-bad={netBad ? 'true' : undefined}>
        <div className="hp-head" data-pz="head" data-big={camBig ? 'true' : undefined}>
          {strip}
          {hostCase.headSlot === 'selfview' ? (
            <HostSelfView cam={hostCase.cam} mic={hostCase.mic} big={camBig} stream={selfStream} netBad={netBad} onPress={uiActions.toggleCamBig} />
          ) : hostCase.summary ? (
            <HostSummaryPanel summary={hostCase.summary} />
          ) : null}
        </div>
        <HostChipLine chips={hostCase.chips} range={range} handlers={{ onSheet: uiActions.openSheet }} onMore={() => uiActions.openSheet('alerts')} />
        <HostParticipantGrid
          participants={sorted}
          metric={metric}
          allOff={hostCase.allOff}
          netBad={netBad}
          selectedId={ui.sheet === 'detail' ? ui.detailId : null}
          onSelect={uiActions.openDetail}
          onRange={setRange}
          table={ui.table}
        />
      </div>
    </PlayerShell>
  );
}
