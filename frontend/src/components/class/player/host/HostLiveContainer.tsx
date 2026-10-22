import type { LocalVideoTrack } from 'livekit-client';
// SDD-208 H5 — 상담사 진행 중 화면 컨테이너. ClassPlayerPage 가 들고 있는 진행 중 상태·핸들러를 props 로 받아 뷰 모델을 조립한다.
// 훅(useBand·소켓·녹음기·LiveKit 토큰)은 페이지가 한 번만 호출하고 여기서는 값만 받는다(useBand 인스턴스 중복 금지, X4).
// 서버·소켓 판정은 하지 않는다 — 데이터 규칙은 host-live-model·host-player-case, 마이크/카메라 규칙은 host-media-control 에 있다.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { RecorderState } from '../../../../hooks/useAudioRecorder';
import type { BandConnectionState } from '../../../../hooks/useBand';
import type { FacingMode, VideoRecorderState } from '../../../../hooks/useVideoRecorder';
import type { WaitingRoomEntry } from '../../../../hooks/useWaitingRoomCount';
import type { DeviceStatus, SessionDto, SessionLiveMetric } from '../../../../lib/api/session';
import {
  HOST_SELF_BAND_NONE,
  deriveHostCase,
  type HostMetricValues,
  type HostPreCheckin,
  type HostQueueEntry,
  type HostSelfBand,
} from '../../../../lib/class/host-player-case';
import { deriveNetUi, type PlayerMetricKey } from '../../../../lib/class/player-case';
import { countSignals, type ActiveSignal } from '../../../../lib/class/quiet-signal';
import {
  contactStatusLabel,
  signalQualityLevelLabel,
  type SignalQualityLevel,
} from '../../../../lib/session-live/signal-status';
import { ClassChatPanel } from '../../../chat/ClassChatPanel';
import { MarkerButton } from '../../../session/MarkerButton';
import { SpeakingRightsPanel } from '../../../session/SpeakingRightsPanel';
import { EndSessionModal } from '../../../player/EndSessionModal';
import type { HostErrorBannerModel } from './HostBanner';
import { HostLiveKitBridge } from './HostLiveKitBridge';
import { HostLiveView, type HostLiveActions } from './HostLiveView';
import type { HostMediaProps } from './HostMediaSheet';
import { toHostParticipant, toHostQueue, type HostMetricExtra } from './host-live-model';
import {
  resolveCamUi,
  resolveMicUi,
  useHostMediaControl,
  type MediaFailureReason,
} from './host-media-control';
import { useHostUi } from './useHostUi';
import { lowerEntryHand } from '../../../../lib/api/class-flow';
import { HostSignalToast } from './HostSignalToast';
import { HostSignalToastPolicy, type SignalToast } from './host-signal-toast';
import './host-player.css';

export interface ContainerRecorder {
  state: RecorderState;
  pause: () => void;
  resume: () => void;
}

export interface ContainerVideoRecorder {
  state: VideoRecorderState;
  stream: MediaStream | null;
  facingMode: FacingMode;
  pause: () => void;
  resume: () => void;
  switchCamera: () => Promise<void> | void;
}

export interface ContainerBand {
  connectionState: BandConnectionState;
  battery: number | null;
  deviceStatus: DeviceStatus | null;
  signalQualityLevel: SignalQualityLevel;
  error: string | null;
  isSupported: boolean;
  connect: () => Promise<void> | void;
  disconnect: () => Promise<void> | void;
}

export interface HostLiveContainerProps {
  session: Pick<SessionDto, 'id' | 'title' | 'location_type' | 'participant_mode' | 'duration_min' | 'access_code' | 'participants'>
    & Partial<Pick<SessionDto, 'chat_room_id' | 'max_participants' | 'record_video'>>;
  hostUserId: string | null;
  hostParticipantId: string | null;
  /** 폴링·소켓·밴드 병합이 끝난 라이브 지표 행(호스트 본인 행 포함) */
  rows: readonly SessionLiveMetric[];
  extras: Readonly<Record<string, HostMetricExtra>>;
  /** 함께한 시간(초) */
  elapsedSec: number;
  /** 대기실에서 받아 둔 입장 전 체크인 */
  checkins: readonly WaitingRoomEntry[];
  /** 대기실 준비 현황 — 진행 중에는 보통 빈 배열이다 */
  waitingEntries: readonly WaitingRoomEntry[];
  quietSignals: Readonly<Record<string, ActiveSignal>>;
  live: { socketConnected: boolean; metricsPollFailing: boolean; onRetry: () => void };
  speaking: { busyId: string | null; onSet: (participantId: string, granted: boolean) => void };
  chat: { enabled: boolean; busy: boolean; onToggleEnabled: () => void };
  recorder: ContainerRecorder;
  videoRecorder: ContainerVideoRecorder;
  recording: { elapsedSec: number; onStart: () => void; onStop: () => void };
  videoOnly: { onStart: () => void; onStop: () => void };
  mediaPrefs: { micOn: boolean; cameraOn: boolean };
  liveKit: { token: string | null; loading: boolean; error: string | null; serverUrl: string; onDisconnected: () => void };
  band: ContainerBand;
  status: { error: string | null; endFailed: boolean; ending: boolean; onRetryEnd: () => void };
  end: { open: boolean; onRequest: () => void; onConfirm: () => void; onCancel: () => void };
  onInvite?: () => void;
  onHandLowered?: (participantId: string) => void;
  codeCopy: { copied: boolean; onCopy: () => void };
  onClose: () => void;
  /** 대기실 준비 현황 패널(WaitingRoomReadinessPanel) — 구독이 켜져 있을 때만 페이지가 만든다 */
  readinessPanel?: ReactNode;
}

const HISTORY_MIN_INTERVAL_MS = 3_000;
/** 상세 시트의 추이 구간(D10 — 시안 기준 5분) */
const HISTORY_WINDOW_MS = 300_000;
const MAX_POINTS = 120;
const DEFAULT_MEDIA_FAILURE: MediaFailureReason | null = null;

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}
const useBrowserOnline = (): boolean => useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

interface HistoryPoint {
  at: number;
  values: HostMetricValues;
}

export function HostLiveContainer(props: HostLiveContainerProps) {
  const {
    session, hostUserId, hostParticipantId, rows, extras, elapsedSec, checkins, waitingEntries, quietSignals, live, speaking, chat,
    recorder, videoRecorder, recording, videoOnly, mediaPrefs, liveKit, band, status, end, codeCopy, onClose, readinessPanel,
  } = props;
  const online = session.location_type === 'online';
  const solo = session.participant_mode === 'one_on_one';

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  /* ───── 참가자 모델 ───── */
  const participants = useMemo(() => {
    const entryFor = (row: SessionLiveMetric): WaitingRoomEntry | undefined =>
      checkins.find((e) => e.participantId === row.participant_id || (row.user_id != null && e.participantId === row.user_id));
    return rows
      .filter((row) => row.participant_id !== hostParticipantId && !(hostUserId && row.user_id === hostUserId))
      .map((row) => toHostParticipant(row, { extra: extras[row.participant_id], entry: entryFor(row), nowMs }));
  }, [rows, extras, checkins, hostParticipantId, hostUserId, nowMs]);

  const [history, setHistory] = useState<Readonly<Record<string, readonly HistoryPoint[]>>>({});
  useEffect(() => {
    const now = Date.now();
    setHistory((prev) => {
      let changed = false;
      const next: Record<string, readonly HistoryPoint[]> = { ...prev };
      for (const p of participants) {
        if (p.band !== 'on') continue;
        const points = prev[p.id] ?? [];
        const last = points[points.length - 1];
        if (last && now - last.at < HISTORY_MIN_INTERVAL_MS) continue;
        next[p.id] = [...points.filter((pt) => now - pt.at <= HISTORY_WINDOW_MS), { at: now, values: p.values }].slice(-MAX_POINTS);
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [participants]);
  const trendOf = useCallback(
    (participantId: string, metric: PlayerMetricKey): readonly number[] =>
      (history[participantId] ?? []).map((pt) => pt.values[metric]).filter((v): v is number => v !== null),
    [history],
  );

  const queue = useMemo<readonly HostQueueEntry[]>(() => toHostQueue(session.participants), [session.participants]);

  const preCheckins = useMemo<readonly HostPreCheckin[]>(
    () => checkins.flatMap((e) => (e.checkin ? [{
      id: e.participantId, name: e.nickname ?? '참가자',
      arousal: e.checkin.arousal, valence: e.checkin.valence, emotion: e.checkin.emotion, note: e.checkin.note,
    }] : [])),
    [checkins],
  );

  /* ───── 마이크·카메라(P7) ───── */
  const media = useHostMediaControl({
    initialMicOn: mediaPrefs.micOn,
    initialCamOn: mediaPrefs.cameraOn,
    recorder,
    videoRecorder,
  });
  const [micFailure, setMicFailure] = useState<MediaFailureReason | null>(DEFAULT_MEDIA_FAILURE);
  const [camFailure, setCamFailure] = useState<MediaFailureReason | null>(DEFAULT_MEDIA_FAILURE);
  const [deviceRetry, setDeviceRetry] = useState(0);
  const [selfTrack, setSelfTrack] = useState<LocalVideoTrack | null>(null);
  const [selfStream, setSelfStream] = useState<MediaStream | null>(null);
  const [memberStream, setMemberStream] = useState<MediaStream | null>(null);

  const micUi = resolveMicUi({ micOn: media.micOn, failure: micFailure, recorderState: recorder.state });
  const camUi = resolveCamUi({ camOn: media.camOn, failure: camFailure, videoState: videoRecorder.state, hasLocalTrack: selfTrack !== null });

  const recheckPermission = useCallback((kind: 'camera' | 'microphone'): void => {
    const getUserMedia = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (!getUserMedia) return;
    void getUserMedia(kind === 'camera' ? { video: true } : { audio: true })
      .then((stream) => {
        stream.getTracks().forEach((track) => track.stop());
        if (kind === 'camera') setCamFailure(null);
        else setMicFailure(null);
        setDeviceRetry((n) => n + 1);
      })
      .catch(() => undefined);
  }, []);

  /* ───── 네트워크(C16) ───── */
  const browserOnline = useBrowserOnline();
  const linkDown = !live.socketConnected || !browserOnline;
  const [downSince, setDownSince] = useState<number | null>(null);
  useEffect(() => {
    setDownSince((prev) => (linkDown ? (prev ?? Date.now()) : null));
  }, [linkDown]);
  // 폴링까지 실패 중일 때만 "끊김"으로 본다 — 폴링이 살아 있으면 느리지만 데이터는 오고 있다
  const downForMs = live.metricsPollFailing && downSince !== null ? Math.max(0, nowMs - downSince) : 0;
  const net = deriveNetUi({ socketConnected: live.socketConnected, browserOnline, downForMs });

  /* ───── 내 밴드 ───── */
  const [bandEverUsed, setBandEverUsed] = useState(false);
  useEffect(() => {
    if (band.connectionState === 'connected' || band.connectionState === 'connecting') setBandEverUsed(true);
  }, [band.connectionState]);
  const hostRow = rows.find((r) => r.participant_id === hostParticipantId);
  const hostRelax = hostRow ? toHostParticipant(hostRow, { nowMs }).values.relaxation : null;
  const selfBandSheet = useMemo<HostSelfBand>(() => {
    if (band.connectionState === 'unsupported') return { ...HOST_SELF_BAND_NONE, state: 'unsupported', canConnect: false };
    const state = band.connectionState === 'connected' ? 'connected' : band.connectionState === 'connecting' ? 'connecting' : 'disconnected';
    return {
      state,
      relaxation: state === 'connected' ? hostRelax : null,
      battery: state === 'connected' ? band.battery : null,
      signalLabel: state === 'connected' ? `신호 ${signalQualityLevelLabel(band.signalQualityLevel)}` : null,
      contactLabel: state === 'connected' ? contactStatusLabel(band.deviceStatus) : null,
      error: band.error,
      canConnect: band.isSupported && hostParticipantId !== null,
    };
  }, [band.connectionState, band.battery, band.signalQualityLevel, band.deviceStatus, band.error, band.isSupported, hostParticipantId, hostRelax]);
  const showSelfBandChip = band.connectionState === 'connected' || band.connectionState === 'connecting' || bandEverUsed;

  /* ───── 화면 상태 ───── */
  const { ui, actions: uiActions } = useHostUi({
    metric: 'relaxation', rotate: true, sort: 'join', handsFirst: false, table: false, sheet: null, detailId: null, camBig: false,
  });
  // 재연결·백그라운드 복귀 시 이전 10초 신호를 다시 새 신호로 보이지 않는다.
  const [signalEpoch, setSignalEpoch] = useState(0);
  const wasConnected = useRef(live.socketConnected);
  const toastPolicy = useRef(new HostSignalToastPolicy());
  const [signalToast, setSignalToast] = useState<SignalToast | null>(null);
  useEffect(() => {
    if (live.socketConnected !== wasConnected.current) {
      setSignalEpoch(Date.now());
      wasConnected.current = live.socketConnected;
    }
  }, [live.socketConnected]);
  useEffect(() => {
    const reset = () => {
      toastPolicy.current.reset();
      setSignalToast(null);
      setSignalEpoch(Date.now());
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') reset(); };
    document.addEventListener('visibilitychange', onVisibility);
    reset();
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [session.id]);
  const freshSignals = useMemo(() => Object.fromEntries(Object.entries(quietSignals).filter(([, value]) => value.at >= signalEpoch)), [quietSignals, signalEpoch]);
  const signalCounts = countSignals(freshSignals, nowMs);
  useEffect(() => {
    const update = () => setSignalToast(toastPolicy.current.update({
      sessionId: session.id, connected: live.socketConnected && browserOnline,
      hands: participants.filter((p) => p.hand).map((p) => p.id),
      queue: queue.map((p) => p.id), signals: freshSignals, sheet: ui.sheet,
      blocked: Boolean(status.error || liveKit.error || end.open),
    }, Date.now()));
    update();
    const timer = window.setInterval(update, 200);
    return () => window.clearInterval(timer);
  }, [session.id, live.socketConnected, browserOnline, participants, queue, freshSignals, ui.sheet, status.error, liveKit.error, end.open]);
  const [lowerHandBusyId, setLowerHandBusyId] = useState<string | null>(null);
  const [lowerHandError, setLowerHandError] = useState<{ participantId: string; message: string } | null>(null);
  const lowerHandInFlight = useRef(false);
  const lowerHand = async (id: string) => {
    if (lowerHandInFlight.current) return;
    lowerHandInFlight.current = true;
    setLowerHandBusyId(id);
    setLowerHandError(null);
    try {
      await lowerEntryHand(session.id, id, null);
      props.onHandLowered?.(id);
    } catch {
      setLowerHandError({ participantId: id, message: '손을 내리지 못했어요. 다시 시도해 주세요.' });
    } finally {
      lowerHandInFlight.current = false;
      setLowerHandBusyId(null);
    }
  };
  const [chatUnread, setChatUnread] = useState(0);

  const hostCase = useMemo(
    () => deriveHostCase({
      loc: session.location_type,
      solo,
      participants,
      cam: camUi,
      mic: micUi,
      rec: recorder.state === 'recording' ? 'rec' : recorder.state === 'paused' ? 'paused' : null,
      recElapsedSec: recording.elapsedSec,
      net,
      phase: 'live',
      queue,
      selfBand: showSelfBandChip ? selfBandSheet : null,
      handsFirst: ui.handsFirst,
      quietSignalCount: signalCounts.total,
      filter: ui.filter,
    }),
    [session.location_type, solo, participants, camUi, micUi, recorder.state, recording.elapsedSec, net, queue, showSelfBandChip, selfBandSheet, ui.handsFirst, signalCounts.total, ui.filter],
  );

  const speakingManaged = online && session.participant_mode === 'group' && (session.max_participants ?? 0) <= 20;
  const speakingPanel: ReactNode | null = speakingManaged ? (
    <SpeakingRightsPanel
      participants={rows.filter((r) => r.participant_id !== hostParticipantId && !(hostUserId && r.user_id === hostUserId)) as SessionLiveMetric[]}
      busyId={speaking.busyId}
      onGrant={(id) => speaking.onSet(id, true)}
      onRevoke={(id) => speaking.onSet(id, false)}
      onLowerHand={(id) => void lowerHand(id)}
      lowerHandBusyId={lowerHandBusyId}
      lowerHandError={lowerHandError}
    />
  ) : null;

  const mediaProps: HostMediaProps = {
    recording: {
      state: recorder.state,
      elapsedSec: recording.elapsedSec,
      onStart: recording.onStart,
      onPause: () => {
        recorder.pause();
        videoRecorder.pause();
      },
      onResume: () => {
        recorder.resume();
        videoRecorder.resume();
      },
      onStop: recording.onStop,
    },
    video: session.record_video === false ? null : {
      state: videoRecorder.state,
      facingMode: videoRecorder.facingMode,
      onSwitchCamera: () => void videoRecorder.switchCamera(),
      videoOnly: { available: !mediaPrefs.micOn && mediaPrefs.cameraOn, onStart: videoOnly.onStart, onStop: videoOnly.onStop },
    },
    marker: <MarkerButton sessionId={session.id} startedAt={nowMs - recording.elapsedSec * 1000} />,
  };

  const actions: HostLiveActions = {
    close: onClose,
    end: end.onRequest,
    retryNetwork: live.onRetry,
    revoke: (id) => speaking.onSet(id, false),
    toggleMic: media.toggleMic,
    toggleCam: media.toggleCam,
    recheckPermission,
    copyCode: codeCopy.onCopy,
    invite: props.onInvite,
    connectSelfBand: () => void band.connect(),
    disconnectSelfBand: () => void band.disconnect(),
  };

  const errorBanners: HostErrorBannerModel[] = [
    ...(status.error ? [{
      key: 'error',
      message: status.error,
      action: status.endFailed ? { label: '종료 재시도', onPress: status.onRetryEnd, disabled: status.ending } : null,
    }] : []),
    ...(liveKit.error ? [{ key: 'livekit', message: `화상 연결 오류: ${liveKit.error}`, action: null }] : []),
  ];

  return (
    <>
      <HostLiveView
        hostCase={hostCase}
        participants={participants}
        ui={ui}
        uiActions={uiActions}
        meta={{ title: session.title || '제목 없는 클래스', elapsedSec, durationMin: session.duration_min, accessCode: session.access_code ?? '', ending: status.ending }}
        queue={queue}
        speakingPanel={speakingPanel}
        signalToast={signalToast ? <HostSignalToast toast={signalToast}
          onOpen={(topic) => { uiActions.openSheet(topic); toastPolicy.current.dismiss(); setSignalToast(null); }}
          onDismiss={() => { toastPolicy.current.dismiss(); setSignalToast(null); }}
          onPause={() => toastPolicy.current.pause(Date.now())}
          onResume={() => toastPolicy.current.resume(Date.now())}
        /> : null}
        readinessPanel={waitingEntries.length ? readinessPanel : undefined}
        preCheckins={preCheckins}
        quietSignals={signalCounts}
        selfBand={selfBandSheet}
        chat={{
          unread: chatUnread,
          enabled: chat.enabled,
          busy: chat.busy,
          onToggleEnabled: chat.onToggleEnabled,
          render: (collapsed) => (
            <ClassChatPanel
              sessionId={session.id}
              enabled={chat.enabled}
              roomId={session.chat_room_id ?? null}
              collapsed={collapsed}
              onCollapsedChange={() => undefined}
              embedded
              onUnreadChange={setChatUnread}
              title="클래스 채팅"
            />
          ),
        }}
        media={mediaProps}
        errorBanners={errorBanners}
        codeCopied={codeCopy.copied}
        selfStream={selfStream}
        selfTrack={selfTrack}
        memberStream={solo ? memberStream : null}
        trendOf={trendOf}
        actions={actions}
      />
      {online && liveKit.token ? (
        <HostLiveKitBridge
          token={liveKit.token}
          serverUrl={liveKit.serverUrl}
          micOn={media.micOn}
          camOn={media.camOn}
          retryKey={deviceRetry}
          onDisconnected={liveKit.onDisconnected}
          onMediaFailure={(kind, reason) => (kind === 'mic' ? setMicFailure(reason) : setCamFailure(reason))}
          onSelfStream={setSelfStream}
          onSelfTrack={setSelfTrack}
          onMemberStream={setMemberStream}
        />
      ) : null}
      <EndSessionModal open={end.open} ending={status.ending} onConfirm={end.onConfirm} onCancel={end.onCancel} />
    </>
  );
}
