// SDD-208 H1·H2 — 상담사 진행 중 화면(뷰). props 만 받는 순수 컴포넌트라 서버·BLE·LiveKit 없이 픽스처로 렌더·측정할 수 있다.
// 구성: 상단 바 → (배너) → 헤드 행(지표 띠 + 셀프뷰/요약 패널) → 칩 줄 → 세로 스크롤 그리드 → 도크, 시트는 도크·칩·타일에서 연다.
import { useState, type ReactNode } from 'react';
import { Activity, ClipboardCheck, MessageCircle, Mic, SlidersHorizontal, Video } from 'lucide-react';
import {
  filterHostParticipants,
  groupAverage,
  metricByKey,
  sortHostParticipants,
  summarizeCheckins,
  type HostCase,
  type HostParticipant,
  type HostPreCheckin,
  type HostQueueEntry,
  type HostSelfBand,
  type HostSheetKey,
} from '../../../../lib/class/host-player-case';
import { PlayerBackdrop } from '../shared/PlayerBackdrop';
import { PlayerDock, type DockItem } from '../shared/PlayerDock';
import { PlayerShell } from '../shared/PlayerShell';
import { PlayerSheet } from '../shared/PlayerSheet';
import { useSheetMode } from '../shared/sheet-mode';
import { HostBanner } from './HostBanner';
import { HostChipLine } from './HostChipLine';
import { HostSelfView, HostSummaryPanel } from './HostHeadSlot';
import { HostMetricStrip } from './HostMetricStrip';
import { HostParticipantGrid } from './HostParticipantGrid';
import { HostTopBar } from './HostTopBar';
import { ActionsSheet } from './sheets/ActionsSheet';
import { AlertsSheet } from './sheets/AlertsSheet';
import { ChatSheet } from './sheets/ChatSheet';
import { CheckinSheet, type HostQuietSignalCounts } from './sheets/CheckinSheet';
import { HandsSheet } from './sheets/HandsSheet';
import { MetricSheet } from './sheets/MetricSheet';
import { MybandSheet } from './sheets/MybandSheet';
import { QueueSheet } from './sheets/QueueSheet';
import { ToolsSheet } from './sheets/ToolsSheet';
import type { HostUiActions, HostUiState } from './useHostUi';
import './host-player.css';

export interface HostLiveActions {
  close: () => void;
  end: () => void;
  /** 네트워크 끊김 배너의 "다시 연결" */
  retryNetwork: () => void;
  /** 말하는 회원의 발언권 회수(칩의 회수 버튼) */
  revoke: (participantId: string) => void;
  /** 마이크 켜기/끄기(배너의 "마이크 켜기") */
  toggleMic: () => void;
  copyCode: () => void;
  connectSelfBand: () => void;
  disconnectSelfBand: () => void;
}

export interface HostChatProps {
  unread: number;
  enabled: boolean;
  busy: boolean;
  onToggleEnabled: () => void;
  /** 채팅창. collapsed=true 이면 아무것도 그리지 않고 안읽음 집계만 한다(ClassChatPanel embedded 계약) */
  render: (collapsed: boolean) => ReactNode;
}

export interface HostLiveViewProps {
  hostCase: HostCase;
  /** 입장순 원본 — 정렬·필터는 뷰가 ui 상태로 한다 */
  participants: readonly HostParticipant[];
  ui: HostUiState;
  uiActions: HostUiActions;
  meta: { title: string; elapsedSec: number; durationMin: number; accessCode: string };
  /** 정원 초과 대기 회원(읽기 전용) */
  queue: readonly HostQueueEntry[];
  /** 컨테이너가 만든 SpeakingRightsPanel(발언권 관리) — 발언권을 관리하지 않는 수업이면 null */
  speakingPanel: ReactNode | null;
  /** 대기실 준비 현황(WaitingRoomReadinessPanel) — 구독이 켜져 있을 때만 */
  readinessPanel?: ReactNode;
  preCheckins: readonly HostPreCheckin[];
  quietSignals: HostQuietSignalCounts;
  selfBand: HostSelfBand;
  chat: HostChatProps;
  codeCopied: boolean;
  /** 내 카메라 영상(없으면 실루엣) */
  selfStream: MediaStream | null;
  actions: HostLiveActions;
  /** 하니스가 배경을 고정할 때만 지정 */
  backdropSrc?: string;
}

const icon = (Icon: typeof Activity): ReactNode => <Icon size={24} strokeWidth={2} />;

function selfBandText(band: HostSelfBand): string {
  switch (band.state) {
    case 'connected': return band.relaxation !== null ? `연결됨 · 내 이완도 ${band.relaxation}` : '연결됨';
    case 'connecting': return '연결 중';
    case 'unsupported': return '이 브라우저는 지원하지 않아요 · 선택 사항';
    default: return '미착용 · 선택 사항';
  }
}

export function HostLiveView(props: HostLiveViewProps) {
  const { hostCase, participants, ui, uiActions, meta, queue, speakingPanel, readinessPanel, preCheckins, quietSignals, selfBand, chat, codeCopied, selfStream, actions, backdropSrc } = props;
  const sheetMode = useSheetMode();
  const [range, setRange] = useState<string | null>(null);
  const metric = metricByKey(ui.metric);
  const visible = filterHostParticipants(participants, ui.filter);
  const sorted = sortHostParticipants(visible, { metric: ui.metric, sort: ui.sort, handsFirst: ui.handsFirst });
  const netBad = hostCase.net !== 'ok';
  const online = hostCase.loc === 'online';
  const bottomSheetOpen = ui.sheet !== null && sheetMode === 'bottom';
  const camBig = ui.camBig && hostCase.headSlot === 'selfview' && !bottomSheetOpen;
  const handCount = participants.filter((p) => p.hand).length;

  const dockItems: DockItem[] = [
    { key: 'metric', label: '지표 기준', icon: icon(Activity) },
    { key: 'chat', label: '채팅', icon: icon(MessageCircle), badge: ui.sheet === 'chat' ? 0 : chat.unread },
    { key: 'media', label: hostCase.mediaDockLabel, icon: icon(online ? Video : Mic) },
    { key: 'checkin', label: '체크인', icon: icon(ClipboardCheck) },
    { key: 'tools', label: '도구', icon: icon(SlidersHorizontal) },
  ];

  const sheetSpec = ((): { title: string; body: ReactNode; tall?: boolean } | null => {
    switch (ui.sheet) {
      case 'metric':
        return { title: '지표 기준', body: <MetricSheet metric={ui.metric} rotate={ui.rotate} onMetric={uiActions.setMetric} onRotate={uiActions.setRotate} /> };
      case 'chat':
        return { title: '채팅', tall: true, body: <ChatSheet enabled={chat.enabled} busy={chat.busy} onToggleEnabled={chat.onToggleEnabled} room={chat.render(false)} /> };
      case 'checkin':
        return { title: '체크인 요약', body: <CheckinSheet summary={summarizeCheckins(participants)} preCheckins={preCheckins} quietSignals={quietSignals} onDetail={uiActions.openDetail} /> };
      case 'tools':
        return {
          title: '도구',
          body: (
            <ToolsSheet
              sort={ui.sort} onSort={uiActions.setSort}
              showHandsFirst={online && !hostCase.solo} handsFirst={ui.handsFirst} onHandsFirst={uiActions.setHandsFirst}
              table={ui.table} onTable={uiActions.setTable}
              accessCode={meta.accessCode} codeCopied={codeCopied} onCopyCode={actions.copyCode}
              selfBandText={selfBandText(selfBand)} onOpenMyband={() => uiActions.openSheet('myband')}
            />
          ),
        };
      case 'hands':
        return { title: `손든 회원 ${handCount}`, body: <HandsSheet panel={speakingPanel} /> };
      case 'actions':
        return { title: '필요 조치', body: <ActionsSheet participants={participants} filter={ui.filter} onFilterToggle={uiActions.toggleFilter} /> };
      case 'queue':
        return { title: `입장 대기 ${queue.length}`, body: <QueueSheet queue={queue} readinessPanel={readinessPanel} /> };
      case 'alerts':
        return { title: '알림 전체', body: <AlertsSheet chips={hostCase.chips} onSheet={uiActions.openSheet} onToggleHandsFirst={() => uiActions.setHandsFirst(!ui.handsFirst)} /> };
      case 'myband':
        return { title: '내 밴드', body: <MybandSheet band={selfBand} onConnect={actions.connectSelfBand} onDisconnect={actions.disconnectSelfBand} /> };
      default:
        return null;
    }
  })();

  const sheet = sheetSpec ? (
    <PlayerSheet open title={sheetSpec.title} tall={sheetSpec.tall} onClose={uiActions.closeSheet}>
      {sheetSpec.body}
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
      big={camBig}
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
      <div className="hp-main" data-net-bad={netBad ? 'true' : undefined} data-sheet-bottom={bottomSheetOpen ? 'true' : undefined}>
        {hostCase.banner ? (
          <HostBanner banner={hostCase.banner} onSheet={uiActions.openSheet} onToggleMic={actions.toggleMic} onRetry={actions.retryNetwork} />
        ) : null}
        <div className="hp-head" data-pz="head" data-big={camBig ? 'true' : undefined}>
          {strip}
          {hostCase.headSlot === 'selfview' ? (
            <HostSelfView cam={hostCase.cam} mic={hostCase.mic} big={camBig} stream={selfStream} netBad={netBad} onPress={uiActions.toggleCamBig} />
          ) : hostCase.summary ? (
            <HostSummaryPanel summary={hostCase.summary} />
          ) : null}
        </div>
        <HostChipLine
          chips={hostCase.chips}
          range={range}
          handlers={{
            onSheet: uiActions.openSheet,
            onRevoke: actions.revoke,
            onToggleHandsFirst: () => uiActions.setHandsFirst(!ui.handsFirst),
            onClearFilter: uiActions.clearFilter,
          }}
          onMore={() => uiActions.openSheet('alerts')}
        />
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
        {ui.sheet === 'chat' ? null : <div hidden>{chat.render(true)}</div>}
      </div>
    </PlayerShell>
  );
}
