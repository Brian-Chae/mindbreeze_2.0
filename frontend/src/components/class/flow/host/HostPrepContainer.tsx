// SDD-209 H9 — 상담사 시작 전·종료 구간 컨테이너. ClassPlayerPage 의 상태·핸들러를 props 로 받아
// 세팅(FH05) → 로비(FH06/06a) → 시작 확인(FH07) → 나가기·닫기(FH08) → 종료(FH09) → 닫힘·오류(FH10) 를 잇는다.
// 이 파일은 ClassPlayerPage 를 수정하지 않는다(교체는 통합 Task I2). 화면 상태는 phase 로만 정한다.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LeadOffStatus } from '../../../../lib/eeg/types/eeg';
import { resolveOpenPrefs, type OpenPrefs } from '../../../../lib/class/flow/host-open';
import { deriveEnding, type EndingInput } from '../../../../lib/class/flow/host-ending-model';
import { buildAwayRows } from '../../../../lib/class/flow/host-invite-remind';
import { deriveLobby, type LobbyContext, type LobbyPresenceEntry, type LobbyRosterEntry, type LobbySheetKind } from '../../../../lib/class/flow/host-lobby-model';
import { resolveStartAudio, type StartAudioPlan } from '../../../../lib/class/flow/host-start-model';
import type { HostStateAction, HostStateKind } from '../../../../lib/class/flow/host-state-model';
import { ChevronLeft, Home } from 'lucide-react';
import { EndConfirmScreen, EndingScene } from './EndingScreen';
import { HostStateScreen } from './HostStateScreen';
import { LeaveCloseSheet, type LeaveStage } from './LeaveCloseSheet';
import { LobbyScreen } from './LobbyScreen';
import { LobbySheets, type BgmTrack, type LobbyChatMessage, type SpeakPerson } from './LobbySheets';
import { SetupScreen, type SetupMedia } from './SetupScreen';


export type HostPrepPhase = 'setup' | 'lobby' | 'ending-confirm' | 'ending' | 'closed' | 'error';

export interface HostPrepContainerProps {
  phase: HostPrepPhase;
  /** closed/error 일 때 화면 종류 */
  stateKind?: HostStateKind;
  title: string;
  startText: string;
  address: string | null;
  ctx: LobbyContext;
  /** 입장 코드(4자리). 없으면 초대 시트의 코드 행을 숨긴다 */
  accessCode: string | null;
  backdropSrc?: string;
  capacity?: number;
  joinUrl?: string;
  aiEnabled?: boolean;
  startError?: string | null;
  connectionStale?: boolean;

  // 세팅
  media: SetupMedia;
  opening?: boolean;
  onOpen: (prefs: OpenPrefs) => void;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onRecheck: () => void;
  onPlayTone: () => void;

  // 로비
  roster: readonly LobbyRosterEntry[];
  presence: readonly LobbyPresenceEntry[];
  /** 재발송 결과(participant_id → status) */
  remindResults: ReadonlyMap<string, string>;
  reminding?: boolean;
  starting?: boolean;
  /** 익명 집계 */
  excluded: number | null;
  research: number | null;
  retentionDays: number | null;
  onRemind: (participantIds: string[]) => void;
  canInvite?: boolean;
  onInviteAdd: () => void;
  onCopyCode: () => void;
  codeCopied?: boolean;
  sheets: {
    bgm: { tracks: readonly BgmTrack[]; selectedId: string | null; playing: boolean; progress: number; timeText: string; volume: number; onSelect: (id: string) => void; onTogglePlay: () => void; onVolume: (v: number) => void };
    band: { connected: boolean; leadOff: LeadOffStatus | null; connecting?: boolean; onConnect: () => void; onDisconnect: () => void };
    speak: { raised: readonly SpeakPerson[]; speaking: readonly SpeakPerson[]; busyId?: string | null; onAllow: (id: string) => void; onStop: (id: string) => void };
    chat: { enabled: boolean; messages: readonly LobbyChatMessage[]; busy?: boolean; node?: ReactNode; onToggle: () => void; onSend: (text: string) => void };
  };
  /** 시작: 녹음 선언(record|manual)과 함께 페이지가 transition → LiveKit → audio/start 순서를 수행한다 */
  onStart: (audio: StartAudioPlan) => void | Promise<void>;
  onLeave: () => void;
  onCloseClass: () => void;

  // 종료
  ending: EndingInput;
  endBusy?: boolean;
  headcount: number | null;
  onEnd: () => void;
  onContinue: () => void;
  onOpenRecord: () => void;

  // 닫힘·오류
  closedWaiting?: number;
  closedAtText?: string | null;
  onStateAction: (action: HostStateAction) => void;
}

export function HostPrepContainer(props: HostPrepContainerProps) {
  const { phase, title, ctx, backdropSrc } = props;
  const [sheet, setSheet] = useState<LobbySheetKind | null>(null);
  const [startPending, setStartPending] = useState(false);
  const [startRequesting, setStartRequesting] = useState(false);
  const [localStartError, setLocalStartError] = useState<string | null>(null);
  const startTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startLocked = useRef(false);
  const alive = useRef(true);
  const generation = useRef(0);
  const startLatest = useRef({ onStart: props.onStart, ctx, mic: props.media.mic, recordChecked: true });
  const [leaveStage, setLeaveStage] = useState<LeaveStage | null>(null);

  const [help, setHelp] = useState<'마이크' | '카메라' | null>(null);
  const [recordChecked, setRecordChecked] = useState(true);
  const [draft, setDraft] = useState('');
  startLatest.current = { onStart: props.onStart, ctx, mic: props.media.mic, recordChecked };
  const cancelStart = (): void => {
    if (startTimer.current === null) return;
    clearTimeout(startTimer.current);
    startTimer.current = null;
    startLocked.current = false;
    setStartPending(false);
  };
  useEffect(() => {
    alive.current = true;
    setStartPending(false);
    setStartRequesting(false);
    return () => {
      alive.current = false;
      generation.current += 1;
      if (startTimer.current !== null) clearTimeout(startTimer.current);
      startTimer.current = null;
      startLocked.current = false;
    };
  }, [phase]);
  const queueStart = (): void => {
    if (startLocked.current || props.starting) return;
    startLocked.current = true;
    const requestGeneration = generation.current;
    setLocalStartError(null);
    setStartPending(true);
    startTimer.current = setTimeout(() => {
      startTimer.current = null;
      setStartPending(false);
      setStartRequesting(true);
      const latest = startLatest.current;
      const audio = resolveStartAudio({ ctx: latest.ctx, micOn: latest.mic === 'on', recordChecked: latest.recordChecked });
      void Promise.resolve().then(() => latest.onStart(audio)).catch(() => {
        if (alive.current && generation.current === requestGeneration) setLocalStartError('시작하지 못했어요. 다시 시도해 주세요.');
      }).finally(() => {
        if (generation.current === requestGeneration) {
          startLocked.current = false;
          if (alive.current) setStartRequesting(false);
        }
      });
    }, 2000);
  };

  const model = useMemo(() => deriveLobby(props.roster, props.presence, ctx), [props.roster, props.presence, ctx]);
  const away = useMemo(() => buildAwayRows(model.awayEntries, props.remindResults), [model.awayEntries, props.remindResults]);

  if (phase === 'closed' || phase === 'error') {
    return (
      <HostStateScreen
        kind={props.stateKind ?? (phase === 'closed' ? 'closed-revisit' : 'error')}
        title={title}
        waiting={props.closedWaiting}
        closedAtText={props.closedAtText}
        backdropSrc={backdropSrc}
        onAction={props.onStateAction}
      />
    );
  }

  if (phase === 'ending-confirm') {
    return (
      <EndConfirmScreen
        title={title}
        sub="진행 중"
        headcount={props.headcount}
        busy={props.endBusy}
        left={{ label: '뒤로', icon: <ChevronLeft size={20} aria-hidden="true" />, onClick: props.onContinue }}
        backdropSrc={backdropSrc}
        onEnd={props.onEnd}
        onContinue={props.onContinue}
      />
    );
  }

  if (phase === 'ending') {
    return (
      <EndingScene
        view={deriveEnding(props.ending)}
        title={title}
        left={{ label: '홈으로', icon: <Home size={20} aria-hidden="true" />, onClick: () => props.onStateAction('home') }}
        backdropSrc={backdropSrc}
        onOpenRecord={props.onOpenRecord}
      />
    );
  }

  if (phase === 'setup') {
    const input = { place: ctx.place, mic: props.media.mic, cam: props.media.cam };
    const openNow = (override?: 'mic-on' | 'mic-off'): void => {
      props.onOpen(resolveOpenPrefs(input, override));
    };
    return (
      <SetupScreen
        title={title}
        startText={props.startText}
        place={ctx.place}
        solo={ctx.size === 'solo'}
        address={props.address}
        media={props.media}
        opening={props.opening}
        micOffSheetOpen={false}
        helpDevice={help}
        backdropSrc={backdropSrc}
        onBack={() => props.onStateAction('home')}
        onOpen={() => openNow()}
        onToggleMic={props.onToggleMic}
        onToggleCamera={props.onToggleCamera}
        onRecheck={() => { setHelp(null); props.onRecheck(); }}
        onPlayTone={props.onPlayTone}
        onOpenHelp={setHelp}
        onCloseHelp={() => setHelp(null)}
        onOpenWithMic={() => openNow('mic-on')}
        onOpenManual={() => openNow('mic-off')}
        onDismissMicOff={() => undefined}
      />
    );
  }

  const sheetBody = (
    <>
      <LobbySheets
        kind={sheet}
        onClose={() => setSheet(null)}
        invite={{
          invited: model.stats.invited,
          inRoom: model.stats.inRoom,
          away,
          code: props.accessCode,
          codeCopied: props.codeCopied,
          reminding: props.reminding,
          onCopyCode: props.onCopyCode,
          onRemind: props.onRemind,
          canInvite: props.canInvite,
          onInviteAdd: () => { setSheet(null); props.onInviteAdd(); },
        }}
        bgm={{ ...props.sheets.bgm, tracks: props.sheets.bgm.tracks }}
        band={props.sheets.band}
        speak={props.sheets.speak}
        chat={{
          enabled: props.sheets.chat.enabled,
          node: props.sheets.chat.node,
          messages: props.sheets.chat.messages,
          busy: props.sheets.chat.busy,
          draft,
          onDraft: setDraft,
          onToggle: props.sheets.chat.onToggle,
          onSend: () => { const text = draft.trim(); if (text) { props.sheets.chat.onSend(text); setDraft(''); } },
        }}
      />
      <LeaveCloseSheet
        open={leaveStage !== null}
        stage={leaveStage ?? 'choose'}
        waiting={model.stats.inRoom}
        onLeave={() => { setLeaveStage(null); props.onLeave(); }}
        onAskClose={() => setLeaveStage('confirm')}
        onConfirmClose={() => { setLeaveStage(null); props.onCloseClass(); }}
        onContinue={() => setLeaveStage(null)}
        onBackToChoose={() => setLeaveStage('choose')}
      />
    </>
  );
  return (
    <LobbyScreen
      {...ctx}
      title={title}
      address={props.address}
      startText={props.startText}
      model={model}
      starting={props.starting || startRequesting}
      startPending={startPending}
      onCancelStart={cancelStart}
      startError={props.startError || localStartError}
      connectionStale={props.connectionStale}
      media={props.media}
      onToggleMic={props.onToggleMic}
      onToggleCamera={props.onToggleCamera}
      onRecheck={props.onRecheck}
      accessCode={props.accessCode}
      onCopyCode={props.onCopyCode}
      codeCopied={props.codeCopied}
      capacity={props.capacity}
      joinUrl={props.joinUrl}
      aiEnabled={props.aiEnabled}
      recordChecked={recordChecked}
      onToggleRecord={() => setRecordChecked(v => !v)}
      excluded={props.excluded}
      research={props.research}
      retentionDays={props.retentionDays}
      backdropSrc={backdropSrc}
      sheet={sheetBody}
      sheetOpen={sheet !== null || leaveStage !== null}
      onBack={() => { cancelStart(); setLeaveStage('choose'); }}
      onStart={queueStart}
      canInvite={props.canInvite}
      onInviteAdd={() => { setSheet(null); props.onInviteAdd(); }}
      onInviteSheet={() => setSheet('invite')}
      onDock={(kind) => setSheet(kind)}
    />
  );
}
