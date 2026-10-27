// SDD-208 M5 — 회원 진행 화면 컨테이너. GuestMeditationPanel 의 데이터 로직을 이식해 훅을 조립하고 MemberClassView 에 뷰 모델을 넘긴다.
// 이식 범위: useBand(+everConnected) · useSessionLiveSocket(평균 수신 구독 없음) · 1Hz 링버퍼 · useGuestAudioSync · 채팅 폴링 · 접촉 불량 상태.
// useWakeLock 은 호출부(class-join-page: step waiting|meditation)가 이미 걸고 있어 여기서 다시 걸지 않는다(센티널 중복 방지).
// 이 파일만 useBand 를 호출한다(plan R4: BLE 연결·업로드 인스턴스는 화면당 1개).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { freshnessOf } from '../../../../lib/session-live/live-view';
import { liveMetricSnapshot } from '../../../../lib/session-live/live-metric-snapshot';
import { ConnectionState } from 'livekit-client';
import { useBand, type UseBandResult } from '../../../../hooks/useBand';
import { BiosignalRecordingStatus } from '../../../../lib/biosignal/recording-status';
import type { RenderedMetrics } from '../../../../lib/biosignal/display-snapshot';
import { AnalysisMetricsService } from '../../../../lib/eeg/AnalysisMetricsService';
import { useGuestAudioSync } from '../../../../hooks/useGuestAudioSync';
import { useMemberLiveKit } from '../../../../hooks/useMemberLiveKit';
import { useSessionLiveSocket } from '../../../../hooks/useSessionLiveSocket';
import { scoreIndices } from '../../../../lib/eeg/eegPersonalScore';
import { getEntryState } from '../../../../lib/api/class-flow';
import { getSession, type LinkbandMode } from '../../../../lib/api/session';
import type { AudioSyncEvent } from '../../../../lib/class/audio-sync';
import { PLAYER_METRICS, deriveBandUi, deriveNetUi, type PlayerMetricKey } from '../../../../lib/class/player-case';
import { deriveMemberCase, type MemberCaseInput } from '../../../../lib/class/member-player-case';
import { getActiveSessionLiveSocket, type SessionLiveEegFeatureEvent } from '../../../../lib/socket';
import { contactStatusLabel, resolveBandLinkState, signalQualityLevelLabel } from '../../../../lib/session-live/signal-status';
import { useAuthStore } from '../../../../stores/authStore';
import { isLiveProtocolV2Enabled } from '../../../../lib/session-live/live-flag';
import type { UseLiveV2Result } from '../../../../lib/session-live/use-live-v2';
import type { LiveClient } from '../../../../lib/session-live/live-client';
import { useMetricBars } from '../../../../lib/session-live/metric-bars';
import { useWebMeasurementV2 } from '../../../../lib/measurement-web/use-web-measurement';
import { useNativeMeasurementV2 } from '../../../../lib/measurement-web/use-native-measurement';
import { decideMeasurementPath } from '../../../../lib/measurement-web/measurement-path';
import { getNativeMeasurement, isNativeMeasurementAvailable } from '../../../../lib/native-measurement';
import { Capacitor } from '@capacitor/core';
import { isNativeBandOwned } from '../../../../lib/native-measurement/device-status';
import { isBleSupported } from '../../../../lib/ble';
import { toBandReport } from '../../../../lib/measurement-web/band-report';
import { ClassChatPanel } from '../../../chat/ClassChatPanel';
import { LeaveConfirmModal } from '../../../player/LeaveConfirmModal';
import { ClassOnboardingCoachmarks } from '../../ClassOnboardingCoachmarks';
import { MemberClassView } from './MemberClassView';
import { MemberMediaControls, type MemberMediaBinding } from './MemberMediaControls';
import { filterEegPreview, filterPpgPreview, minMaxDecimate, smoothAutoScale } from '../../../../lib/eeg/raw-preview-filter';
import { emptySeries, formatClock, pushRingPoint, type MetricSeries, type MetricSnapshot } from './member-metrics';
import type { MemberClassViewProps, MemberDeviceModel, MemberHostVideoIssue, MemberSheetKey } from './member-view-types';
import './member-player.css';

interface MemberClassContainerProps {
  title: string | null;
  startedAt: string | null;
  durationMin: number;
  onLeave: () => void;
  sessionId: string;
  participantId: string | null;
  /** SDD-209: 입장 자격 — 이 자격으로 상태·미디어·업로드 소유를 증명한다(6자리 코드·참여자 토큰 경로 없음) */
  entryCredential: string | null;
  /** SDD-209: 상담사 이름(클래스 요약에서 받은 값) — 별도 조회를 하지 않는다 */
  hostName?: string | null;
  locationType?: 'online' | 'offline';
  participantMode?: 'one_on_one' | 'group';
  maxParticipants?: number;
  linkbandMode?: LinkbandMode;
  /** 정원이 차서 대기열에 들어간 참가자 — 대기 화면만 보이고 밴드·소켓·영상 연결을 하지 않는다(M20) */
  waitlisted?: boolean;
  /** SDD-246: v2 on 이면 EntryPage 가 만든 LiveClient/LiveState 하나를 받는다(없으면 v1 훅) */
  liveV2?: UseLiveV2Result | null;
  /** SDD-246 T06c: 회차 EEG 수집 동의(true 일 때만 v2 웹 측정을 시작한다) */
  eegConsent?: boolean;
}

const AI_ANALYZING_MS = 15_000;
/** SDD-095: 클래스 채팅 상태(chat_enabled) 폴링 주기 */
const CHAT_STATE_POLL_MS = 5_000;
/** 기기 시트의 원시 파형 갱신 주기·표시 점 수 */
const RAW_REFRESH_MS = 1_000;
const RAW_POINTS = 120;
// 필터는 원 샘플레이트가 필요하므로 다운샘플 전 EEG 4초(250Hz)=1000, PPG 4초(50Hz)=200점을 받는다
const RAW_EEG_SAMPLES = 1000;
const RAW_PPG_SAMPLES = 200;
/** 상담사 영상 토큰 재시도 상한(지수 백오프 5s→10s→20s→30s) */
const LIVEKIT_RETRY_MAX = 5;

type BandSnapshotSource = Pick<UseBandResult, 'connectionState' | 'scoredIndices' | 'heartRate' | 'respiratoryRate' | 'sdnn'>;

const NO_METRICS: MetricSnapshot = { focus: null, relaxation: null, emotional: null, bpm: null, respiration: null, hrv: null };

/** 현재 시점 6지표(null 보존). 접촉 불량·링크 끊김이면 전 지표를 미측정으로 일관되게 둔다(SDD-128) */
function buildSnapshot(band: BandSnapshotSource, metricsBlocked: boolean, remoteEfficiency: number | null): MetricSnapshot {
  if (metricsBlocked) return NO_METRICS;
  const live = band.connectionState === 'connected';
  return {
    focus: live ? (band.scoredIndices?.focusIndex ?? null) : null,
    relaxation: live ? (band.scoredIndices?.relaxationIndex ?? remoteEfficiency) : remoteEfficiency,
    emotional: live ? (band.scoredIndices?.emotionalStability ?? null) : null,
    bpm: live ? band.heartRate : null,
    respiration: live ? band.respiratoryRate : null,
    hrv: live ? band.sdnn : null,
  };
}

/** SDD-244: 이번 렌더에서 화면이 받은 6지표와 그 근거(저장용 DisplaySnapshot의 입력). 값을 다시 계산하지 않는다. */
function describeRender(band: UseBandResult, snapshot: MetricSnapshot, blocked: boolean, stale: boolean, remoteEfficiency: number | null): RenderedMetrics {
  const live = band.connectionState === 'connected';
  const scoredRelax = band.scoredIndices?.relaxationIndex ?? null;
  return {
    values: snapshot,
    normalizationModel: band.normalizationModel,
    rawMind: {
      focus: live ? (band.rawIndices?.focusIndex ?? null) : null,
      relaxation: live ? (band.rawIndices?.relaxationIndex ?? null) : null,
      emotional: live ? (band.rawIndices?.emotionalStability ?? null) : null,
    },
    live, blocked, stale, leadOff: band.deviceStatus === 'lead_off',
    remoteRelaxation: !blocked && remoteEfficiency !== null && snapshot.relaxation === remoteEfficiency && !(live && scoredRelax !== null),
    lastEegAtMs: band.lastEegAt ? Date.parse(band.lastEegAt) : null,
    quality: band.signalQualityLevel,
    respirationNullReason: AnalysisMetricsService.getInstance().getRespiratoryNullReason(),
  };
}

/** 무음 신호 — v2 는 signal.send 명령(command_id 포함). 결과는 ACK 가 아니라 즉시 'sent'/'failed' 로 UI 에 알린다. */
function sendSignalV2(client: LiveClient): MemberClassViewProps['actions']['onSignal'] {
  return (type) => {
    client.sendCommand('signal.send', { signal_type: type, target_scope: 'host' });
    return 'sent';
  };
}

export function MemberClassContainer({
  title, startedAt, durationMin, onLeave, sessionId, participantId, entryCredential, hostName = null,
  locationType, participantMode, maxParticipants, linkbandMode, waitlisted = false, liveV2 = null, eegConsent = false,
}: MemberClassContainerProps) {
  const v2On = isLiveProtocolV2Enabled() && liveV2 !== null;
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const place: 'online' | 'offline' = locationType === 'offline' ? 'offline' : 'online';
  const mode: '1on1' | 'group' = participantMode === 'group' ? 'group' : '1on1';
  /** 온라인 그룹(≤20)만 발언권(손들기) 대상 — 20명 초과는 서버가 발행 권한을 주지 않는 수신 전용 */
  const speakingManaged = place === 'online' && mode === 'group' && (maxParticipants ?? 0) <= 20;
  const viewerOnly = place === 'online' && mode === 'group' && !speakingManaged;
  const connectionsActive = Boolean(sessionId && participantId) && !waitlisted;

  /* ───────── 시계(1초) ───────── */
  const mountedAtRef = useRef(Date.now());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const startedMs = startedAt ? new Date(startedAt).getTime() : mountedAtRef.current;
  const elapsedSec = Math.max(0, Math.floor((nowMs - startedMs) / 1000));
  const totalSec = Math.max(1, durationMin) * 60;

  /* ───────── 화면 상태 ───────── */
  const [sheet, setSheet] = useState<MemberSheetKey | null>(null);
  const [hero, setHero] = useState<PlayerMetricKey>('relaxation');
  const [screenOff, setScreenOff] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [bandContinued, setBandContinued] = useState(false);
  const [remoteEfficiency, setRemoteEfficiency] = useState<number | null>(null);
  const [series, setSeries] = useState<MetricSeries>(() => emptySeries());
  const [raw, setRaw] = useState<MemberDeviceModel['raw']>(null);
  const [ppg, setPpg] = useState<MemberDeviceModel['ppg']>(null);
  // 채널별 자동 스케일 피크(감쇠 smoothing) — fp1, fp2, red, ir
  const rawPeaksRef = useRef([1, 1, 1, 1]);

  /* ───────── 클래스 정보(상담사 이름): 클래스 요약에서 받은 값을 그대로 쓴다 ───────── */
  const counselorName = hostName;

  /* ───────── 클래스 채팅(SDD-095): 로그인=세션 상세 폴링, 비회원=입장 자격 상태 폴링 ───────── */
  const [chatEnabled, setChatEnabled] = useState(false);
  const [chatRoomId, setChatRoomId] = useState<string | null>(null);
  const [guestChatEnabled, setGuestChatEnabled] = useState(false);
  const [unread, setUnread] = useState(0);

  const v2PolicyChat = v2On && liveV2?.ready ? liveV2.state?.policy?.data.chat_enabled ?? null : null;
  const v2ChatReady = v2PolicyChat !== null;
  useEffect(() => {
    if (!isAuthenticated || !sessionId) return undefined;
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const detail = await getSession(sessionId);
        if (cancelled) return;
        setChatEnabled(Boolean(detail.chat_enabled));
        setChatRoomId(detail.chat_room_id ?? null);
      } catch {
        // 채팅 상태 조회 실패는 클래스 진행에 영향이 없어야 한다
      }
    };
    void load();
    if (v2ChatReady) return () => { cancelled = true; }; // v2 READY: 채팅 on/off 는 policy 도메인 — 주기 폴링 0
    const timer = window.setInterval(() => void load(), CHAT_STATE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isAuthenticated, sessionId, v2ChatReady]);

  useEffect(() => {
    if (isAuthenticated || !participantId || !entryCredential) return undefined;
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const state = await getEntryState(sessionId, entryCredential);
        if (!cancelled) setGuestChatEnabled(Boolean(state.chat_enabled));
      } catch {
        // 상태 조회 실패는 무해
      }
    };
    void load();
    if (v2ChatReady) return () => { cancelled = true; };
    const timer = window.setInterval(() => void load(), CHAT_STATE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isAuthenticated, participantId, entryCredential, sessionId, v2ChatReady]);

  /* ───────── 밴드(useBand 단일 인스턴스) ───────── */
  // SDD-246 T12: v2 수집 경로(web_wasm/native)가 활성이면 v1 feature 업로드를 끈다(이중 집계 방지). 판정은 band 연결 상태가 필요해 ref 로 읽는다.
  const bandConnectedRef = useRef(false);
  const v2Path = decideMeasurementPath({
    v2: v2On && connectionsActive, native: isNativeMeasurementAvailable(), webBluetooth: isBleSupported(),
    bandConnected: bandConnectedRef.current, eegConsent, bandOptIn: linkbandMode !== 'none',
  });
  const band = useBand({ sessionId, participantId, enabled: connectionsActive, skipAuth: !isAuthenticated, entryCredential, v1FeatureUpload: v2Path !== 'web_wasm' && v2Path !== 'native' });
  bandConnectedRef.current = band.connectionState === 'connected';
  const bandRef = useRef(band);
  useEffect(() => {
    bandRef.current = band;
  });

  // SDD-246 T06c: v2 on + 웹 + 밴드 착용 + EEG 동의일 때만 WASM 코어 측정 → live:metric. 그 밖에는 아무 것도 만들지 않는다(현행 경로 유지).
  const bandReport = useMemo(
    () => toBandReport({ connectionState: band.connectionState, leadOff: band.leadOff, signalQuality: band.signalQuality, battery: band.battery }),
    [band.connectionState, band.leadOff?.ch1, band.leadOff?.ch2, band.signalQuality, band.battery], // eslint-disable-line react-hooks/exhaustive-deps -- leadOff 는 값으로 비교
  );
  useWebMeasurementV2({
    liveV2: v2On ? liveV2 : null,
    sessionId,
    selfParticipantId: participantId,
    bandOptIn: linkbandMode !== 'none',
    eegConsent,
    bandConnected: band.connectionState === 'connected',
    band: bandReport,
    enabled: connectionsActive,
  });
  const nativeM = useNativeMeasurementV2({
    v2: v2On, sessionId, participantId, accountId: user?.id ?? null, bandOptIn: linkbandMode !== 'none', eegConsent,
    bandConnected: band.connectionState === 'connected', enabled: connectionsActive,
  });

  // native 소유 동안 JS BLE 는 놓였으므로 신호·접촉·연결은 native snapshot 값을 쓴다(없으면 기존 useBand).
  const nd = nativeM.device;
  const deviceStatus = nd ? nd.deviceStatus : band.deviceStatus;
  const signalLevel = nd ? nd.signalQualityLevel : band.signalQualityLevel;
  const [everConnected, setEverConnected] = useState(false);
  useEffect(() => {
    if (band.connectionState === 'connected' || nd?.connected) setEverConnected(true);
  }, [band.connectionState, nd?.connected]);

  const isLive = band.connectionState === 'connected';
  const linkState = resolveBandLinkState({ bleConnected: isLive, lastEegAt: band.lastEegAt, nowMs });
  const metricsBlocked = deviceStatus === 'lead_off' || linkState === 'stale';
  // native 소유 동안 6지표는 native snapshot.metrics(null 보존)로 표시한다.
  // 상담사 타일과 같은 출처(LiveState)·같은 규칙을 우선한다 — 두 화면 숫자 불일치 방지. LiveState 에 내 지표가 없을 때만 앱/웹 자체값.
  const liveSnap = v2On ? liveMetricSnapshot(liveV2?.state, participantId, liveV2?.nowMs ?? nowMs) : null;
  const snapshot = liveSnap ?? nativeM.metrics ?? buildSnapshot(band, metricsBlocked, remoteEfficiency);

  // 1Hz 링버퍼 — readSnapshot 을 ref 로 안정화해 타이머를 1회만 만든다(서버 신호에 의한 리셋·샘플 누락 방지, SDD-127)
  const nativeMetricsRef = useRef(liveSnap ?? nativeM.metrics);
  nativeMetricsRef.current = liveSnap ?? nativeM.metrics;
  const readSnapshotRef = useRef<() => MetricSnapshot>(() => NO_METRICS);
  useEffect(() => {
    readSnapshotRef.current = () => nativeMetricsRef.current ?? buildSnapshot(bandRef.current, metricsBlocked, remoteEfficiency);
  });
  useEffect(() => {
    const id = window.setInterval(() => {
      setNowMs(Date.now());
      const sample = readSnapshotRef.current();
      setSeries((prev) => {
        const next: Record<PlayerMetricKey, readonly number[]> = { ...prev };
        for (const metric of PLAYER_METRICS) {
          const v = sample[metric.key];
          if (v !== null && Number.isFinite(v)) next[metric.key] = pushRingPoint(prev[metric.key], v);
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  /* ───────── 접촉 불량 해소 → 15초 "AI 분석중" ───────── */
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [leadOffDismissed, setLeadOffDismissed] = useState(false);
  const wasLeadOffRef = useRef(false);
  const analyzingTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (deviceStatus === 'lead_off') {
      wasLeadOffRef.current = true;
      setLeadOffDismissed(false);
      setIsAnalyzing(false);
      if (analyzingTimerRef.current != null) {
        window.clearTimeout(analyzingTimerRef.current);
        analyzingTimerRef.current = null;
      }
      return;
    }
    if (wasLeadOffRef.current) {
      wasLeadOffRef.current = false;
      setIsAnalyzing(true);
      if (analyzingTimerRef.current != null) window.clearTimeout(analyzingTimerRef.current);
      analyzingTimerRef.current = window.setTimeout(() => {
        setIsAnalyzing(false);
        analyzingTimerRef.current = null;
      }, AI_ANALYZING_MS);
    }
  }, [deviceStatus]);
  useEffect(
    () => () => {
      if (analyzingTimerRef.current != null) window.clearTimeout(analyzingTimerRef.current);
    },
    [],
  );
  // 접촉 불량이 새로 감지되면 전체 화면 모달 대신 기기 시트(코랄 안내)를 연다
  const showLeadOffSheet = deviceStatus === 'lead_off' && !leadOffDismissed;
  const leadOffAutoOpenedRef = useRef(false);
  useEffect(() => {
    if (showLeadOffSheet) {
      leadOffAutoOpenedRef.current = true;
      setSheet('device');
    }
  }, [showLeadOffSheet]);
  // 사용자가 직접 접어 둔 뒤에는 자동으로 닫을 시트가 없다
  useEffect(() => {
    if (leadOffDismissed) leadOffAutoOpenedRef.current = false;
  }, [leadOffDismissed]);
  // 자동으로 열린 접촉 확인 시트는 접촉이 복구되면 저절로 닫는다
  useEffect(() => {
    if (deviceStatus === 'lead_off' || !leadOffAutoOpenedRef.current) return;
    leadOffAutoOpenedRef.current = false;
    setSheet((prev) => (prev === 'device' ? null : prev));
  }, [deviceStatus]);

  // 기기 시트가 열려 있고 연결 중일 때만 원시 파형을 1초마다 읽는다(250Hz 렌더 부하 회피).
  // native 소유 중이면 플러그인 getRawPreview(Android), 아니면 useBand 버퍼.
  const nativeOwned = nd !== null;
  useEffect(() => {
    if (sheet !== 'device' || !(isLive || nativeOwned)) return undefined;
    let cancelled = false;
    // 원 샘플 → 필터 → 화면용 min/max 다운샘플 → 채널별 자동 스케일(±1)
    const view = (idx: number, x: readonly number[], filter: (v: readonly number[]) => number[]): number[] => {
      const r = smoothAutoScale(minMaxDecimate(filter(x), RAW_POINTS), rawPeaksRef.current[idx]);
      rawPeaksRef.current[idx] = r.peak;
      return r.values;
    };
    const show = (fp1: readonly number[], fp2: readonly number[], red: readonly number[], ir: readonly number[]): void => {
      setRaw({ fp1: view(0, fp1, filterEegPreview), fp2: view(1, fp2, filterEegPreview) });
      setPpg(red.length > 1 ? { red: view(2, red, filterPpgPreview), ir: view(3, ir, filterPpgPreview) } : null);
    };
    const sample = (): void => {
      if (nativeOwned) {
        void getNativeMeasurement().getRawPreview(Capacitor.getPlatform(), 4, RAW_EEG_SAMPLES).then((p) => {
          if (cancelled || !p) return; // iOS 등 미지원은 null → 파형 영역을 그리지 않는다
          show(p.eegFp1, p.eegFp2, p.ppgRed, p.ppgIr);
        });
        return;
      }
      const wave = bandRef.current.getEegWaveformSamples();
      const pw = bandRef.current.getPpgWaveformSamples?.() ?? { red: [], ir: [] };
      show(wave.fp1.slice(-RAW_EEG_SAMPLES), wave.fp2.slice(-RAW_EEG_SAMPLES), pw.red.slice(-RAW_PPG_SAMPLES), pw.ir.slice(-RAW_PPG_SAMPLES));
    };
    sample();
    const id = window.setInterval(sample, RAW_REFRESH_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [sheet, isLive, nativeOwned]);

  /* ───────── 실시간 소켓 — 다른 참가자와 견주는 평균 수신은 구독하지 않는다(spec 합의 #5) ───────── */
  const handleEegFeature = useCallback(
    (event: SessionLiveEegFeatureEvent) => {
      if (!participantId || event.participant_id !== participantId) return;
      if (event.session_id && event.session_id !== sessionId) return;
      const efficiency = event.current_efficiency ?? event.relaxation_index ?? event.feature?.relaxation_index ?? null;
      if (typeof efficiency === 'number') setRemoteEfficiency(scoreIndices({ relaxationIndex: efficiency }).relaxationIndex);
    },
    [participantId, sessionId],
  );
  const [audioSyncEvent, setAudioSyncEvent] = useState<AudioSyncEvent | null>(null);
  const handleClassAudioSync = useCallback(
    (event: AudioSyncEvent) => {
      if (event.session_id && event.session_id !== sessionId) return;
      setAudioSyncEvent(event);
    },
    [sessionId],
  );
  const liveSocket = useSessionLiveSocket({
    sessionId,
    participantId,
    enabled: connectionsActive && !v2On,
    skipAuth: !isAuthenticated,
    entryCredential,
    onEegFeature: handleEegFeature,
    onClassAudioSync: handleClassAudioSync,
  });

  /* ───────── 상담사 가이드 동기 재생(온라인 전용) + 스피커 ───────── */
  // v2: 음성 동기화는 LiveState.audio(서버 anchor·revision)에서 파생한다 — class:audio_sync 소켓 이벤트는 쓰지 않는다.
  const v2Audio = v2On ? liveV2?.state?.audio?.data ?? null : null;
  const v2AudioEvent = useMemo<AudioSyncEvent | null>(() => {
    if (!v2Audio) return null;
    return {
      session_id: sessionId,
      action: v2Audio.action,
      track_id: v2Audio.track_id,
      position_sec: v2Audio.position_ms / 1000,
      server_ts: new Date(v2Audio.server_anchor_ms).toISOString(),
      server_ts_ms: v2Audio.server_anchor_ms,
      revision: Number(v2Audio.revision),
    };
  }, [v2Audio, sessionId]);
  const guestAudio = useGuestAudioSync({ sessionId, enabled: Boolean(sessionId) && locationType === 'online', event: v2On ? v2AudioEvent : audioSyncEvent });
  const [speakerOn, setSpeakerOn] = useState(locationType !== 'offline');
  const speakerTouchedRef = useRef(false);
  useEffect(() => {
    if (speakerTouchedRef.current) return;
    setSpeakerOn(locationType !== 'offline');
  }, [locationType]);

  /* ───────── 상담사 영상(LiveKit) 토큰: 입장 + 상담사 화상 미시작이면 지수 백오프 재시도 ───────── */
  const v2Binding = useMemo(() => (v2On && liveV2 ? { client: liveV2.client, state: liveV2.state } : null), [v2On, liveV2?.client, liveV2?.state]); // eslint-disable-line react-hooks/exhaustive-deps -- liveV2 객체 대신 client/state 만 본다
  const v2NowMs = liveV2?.nowMs ?? 0;
  const v2Bars = useMetricBars(v2On ? liveV2?.state ?? null : null, participantId, 'relaxation_display', v2NowMs);
  const v2Current = (() => {
    const m = v2On && participantId ? liveV2?.state?.metrics[participantId]?.data : undefined;
    const v = m?.metrics.relaxation_display;
    return m && v && v.validity === 'valid' && freshnessOf(m.observed_at_ms, v2NowMs, m.freshness) === 'fresh' ? v.value : null;
  })();
  const liveKit = useMemberLiveKit({ participantId, entryCredential, sessionId, listenSpeakingChanges: speakingManaged, v2: v2Binding });
  const { connect: connectLiveKit, notReady, attemptCount } = liveKit;
  const videoActive = connectionsActive && place === 'online';
  useEffect(() => {
    if (videoActive) void connectLiveKit();
  }, [videoActive, connectLiveKit]);
  useEffect(() => {
    if (!videoActive || !notReady || attemptCount >= LIVEKIT_RETRY_MAX) return undefined;
    const delay = Math.min(5000 * 2 ** attemptCount, 30000);
    const id = window.setTimeout(() => void connectLiveKit(), delay);
    return () => window.clearTimeout(id);
  }, [videoActive, notReady, connectLiveKit, attemptCount]);

  /* ───────── 뷰 모델 조립 ───────── */
  const bandEnabled = linkbandMode !== 'none';
  // 네이티브가 밴드를 소유한 동안(시작 직후 첫 snapshot 전 포함) JS BLE 상태는 보지 않는다 — 놓인 JS 연결을 '끊김'으로 오판하던 문제.
  const nativeOwnsBand = isNativeBandOwned(nativeM.path, nativeM.status, nd);
  const bandUi = deriveBandUi(
    {
      connectionState: nd ? (nd.connected ? 'connected' : 'connecting') : nativeOwnsBand ? 'connecting' : band.connectionState,
      everConnected: nd ? everConnected : nativeOwnsBand ? false : everConnected,
      deviceStatus,
      signalQualityLevel: signalLevel,
      battery: band.battery,
      lastEegAt: nd ? null : band.lastEegAt,
    },
    nowMs,
  );
  // 미지원 브라우저에서 "밴드 없이 계속"을 고르면 밴드 UI 를 접는다
  const bandVisible = bandEnabled && !(bandContinued && bandUi === 'unsupported');

  // 상담사 영상 연결 문제: 토큰 발급 실패(failed), 상담사 화상 미시작으로 재시도를 모두 쓴 경우(waiting). 그 외 트랙 없음은 문제로 보지 않는다
  const hostVideoIssue: MemberHostVideoIssue | null = !videoActive || liveKit.token
    ? null
    : liveKit.error
      ? 'failed'
      : liveKit.notReady && liveKit.attemptCount >= LIVEKIT_RETRY_MAX
        ? 'waiting'
        : null;

  const retryNetwork = useCallback((): void => {
    void connectLiveKit();
    const socket = getActiveSessionLiveSocket();
    if (socket && !socket.connected) socket.connect();
  }, [connectLiveKit]);

  const shared: SharedScreenProps = {
    place, mode, viewerOnly, bandVisible, bandUi, nativeOwnsBand, waitlisted, nowMs, hostVideoIssue,
    header: { title: title ?? '클래스', elapsedSec, totalSec, counselorName, myInitial: user?.name?.trim().charAt(0) || '나' },
    hero, snapshot, series, sheet, screenOff, confirmLeave,
    v2Bars: v2On ? { label: '이완', current: v2Current, bars: v2Bars } : null,
    device: {
      battery: band.battery,
      signalLabel: signalQualityLevelLabel(signalLevel),
      contactLabel: contactStatusLabel(deviceStatus),
      connectedElapsedSec: band.connectedElapsedSec,
      error: band.error,
      analyzing: isAnalyzing,
      raw,
      ppg,
      isMock: band.isMock,
      pendingCount: band.pendingCount,
    },
    sound: {
      speakerOn,
      trackTitle: guestAudio.state.track?.title ?? null,
      volume: guestAudio.state.volume,
      blocked: guestAudio.state.blocked,
      onsiteLabel: null,
    },
    chat: {
      enabled: v2ChatReady ? Boolean(v2PolicyChat) : isAuthenticated ? chatEnabled : guestChatEnabled,
      authenticated: isAuthenticated,
      unread,
      node: isAuthenticated ? (
        <ClassChatPanel
          sessionId={sessionId}
          enabled={chatEnabled}
          roomId={chatRoomId}
          title="클래스 채팅"
          collapsed={sheet !== 'chat'}
          onCollapsedChange={noop}
          embedded
          onUnreadChange={setUnread}
        />
      ) : null,
    },
    waitlist: { title: title ?? '클래스', counselorName, startLabel: startedAt ? formatStartLabel(startedAt) : null, notifyByPush: isAuthenticated },
    socketConnected: v2On ? liveV2?.state?.phase === 'READY' : liveSocket.isConnected,
    onboarding: { locationType, participantMode, maxParticipants },
  };

  const controls: ScreenControls = {
    onLeave,
    setSheet,
    setHero,
    setScreenOff,
    setConfirmLeave,
    setBandContinued,
    setLeadOffDismissed,
    band,
    retryNetwork,
    retryHostVideo: () => void connectLiveKit(),
    sendSignal: v2On && liveV2?.client ? sendSignalV2(liveV2.client) : liveSocket.sendSignal,
    setSpeakerOn: (on) => {
      speakerTouchedRef.current = true;
      setSpeakerOn(on);
    },
    setVolume: guestAudio.setVolume,
    resumeAudio: guestAudio.resume,
  };

  return (
    <MemberMediaControls
      place={place}
      mode={mode}
      token={videoActive ? liveKit.token : null}
      serverUrl={liveKit.serverUrl}
      canPublish={liveKit.canPublish}
      speaking={liveKit.speaking}
      raisedHand={liveKit.raisedHand}
      raiseHand={liveKit.raiseHand}
      lowerHand={liveKit.lowerHand}
      raiseHandError={liveKit.raiseHandError}
      speakerOn={speakerOn}
    >
      {(media) => <MemberLiveScreen shared={shared} controls={controls} media={media} />}
    </MemberMediaControls>
  );
}

/** "14:00" — 입장 대기 카드의 시작 시각 */
function formatStartLabel(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function noop(): void {
  // ClassChatPanel embedded 변형은 접힘 상태를 시트(sheet)가 정하므로 콜백이 필요 없다
}

/* ───────── 화면 본체: LiveKit 연결 상태가 필요한 파생(네트워크)과 모달·덮개를 담당 ───────── */

interface SharedScreenProps {
  place: 'online' | 'offline';
  mode: '1on1' | 'group';
  viewerOnly: boolean;
  bandVisible: boolean;
  bandUi: MemberCaseInput['band'];
  /** 앱 네이티브가 밴드를 소유 중 — 재연결 버튼은 JS BLE 가 아니라 네이티브로 */
  nativeOwnsBand: boolean;
  waitlisted: boolean;
  nowMs: number;
  hostVideoIssue: MemberHostVideoIssue | null;
  header: MemberClassViewProps['header'];
  hero: PlayerMetricKey;
  snapshot: MetricSnapshot;
  series: MetricSeries;
  sheet: MemberSheetKey | null;
  v2Bars: MemberClassViewProps['v2Bars'];
  screenOff: boolean;
  confirmLeave: boolean;
  device: MemberDeviceModel;
  sound: MemberClassViewProps['sound'];
  chat: MemberClassViewProps['chat'];
  waitlist: NonNullable<MemberClassViewProps['waitlist']>;
  socketConnected: boolean;
  onboarding: { locationType?: 'online' | 'offline'; participantMode?: 'one_on_one' | 'group'; maxParticipants?: number };
}

interface ScreenControls {
  onLeave: () => void;
  setSheet: (key: MemberSheetKey | null) => void;
  setHero: (key: PlayerMetricKey) => void;
  setScreenOff: (off: boolean) => void;
  setConfirmLeave: (open: boolean) => void;
  setBandContinued: (on: boolean) => void;
  setLeadOffDismissed: (dismissed: boolean) => void;
  band: UseBandResult;
  retryNetwork: () => void;
  retryHostVideo: () => void;
  sendSignal: MemberClassViewProps['actions']['onSignal'];
  setSpeakerOn: (on: boolean) => void;
  setVolume: (volume: number) => void;
  resumeAudio: () => void;
}

interface MemberLiveScreenProps {
  shared: SharedScreenProps;
  controls: ScreenControls;
  media: MemberMediaBinding;
}

function MemberLiveScreen({ shared, controls, media }: MemberLiveScreenProps) {
  const { band } = controls;

  /* 네트워크: 소켓·브라우저 온라인·LiveKit 재연결을 합쳐 ok/재연결 중/끊김으로. 처음 연결되기 전의 끊김은 오류로 보지 않는다 */
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = (): void => setOnline(true);
    const off = (): void => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  const [everSocketConnected, setEverSocketConnected] = useState(false);
  useEffect(() => {
    if (shared.socketConnected) setEverSocketConnected(true);
  }, [shared.socketConnected]);
  const rtcBad = media.roomConnection === ConnectionState.Reconnecting || media.roomConnection === ConnectionState.SignalReconnecting;
  const socketBad = everSocketConnected && !shared.socketConnected;
  const bad = !online || socketBad || rtcBad;
  const [downSince, setDownSince] = useState<number | null>(null);
  useEffect(() => {
    setDownSince((prev) => (bad ? (prev ?? Date.now()) : null));
  }, [bad]);
  const net = deriveNetUi({
    socketConnected: !socketBad && !rtcBad,
    browserOnline: online,
    downForMs: downSince === null ? 0 : Math.max(0, shared.nowMs - downSince),
  });

  const input: MemberCaseInput = {
    view: shared.waitlisted ? 'waitlist' : 'live',
    place: shared.place,
    mode: shared.mode,
    hostCamera: media.input.hostCamera,
    cam: media.input.cam,
    mic: media.input.mic,
    hand: media.input.hand,
    band: shared.bandUi,
    net,
    battery: shared.device.battery,
    bandEnabled: shared.bandVisible,
    viewerOnly: shared.viewerOnly,
  };

  const renderedRef = useRef<RenderedMetrics | null>(null);
  const visibleRef = useRef(false);
  const recordRef = useRef(band.recordDisplay);
  useEffect(() => {
    const c = deriveMemberCase(input);
    const allShown = shared.sheet === 'status' && c.dock.some(item => item.key === 'status');
    const shown: PlayerMetricKey[] = allShown ? PLAYER_METRICS.map(metric => metric.key) : !c.netDown && c.ring.showValue ? [shared.hero] : [];
    const live = band.connectionState === 'connected';
    const stale = resolveBandLinkState({ bleConnected: live, lastEegAt: band.lastEegAt, nowMs: shared.nowMs }) === 'stale';
    renderedRef.current = { ...describeRender(band, shared.snapshot, band.deviceStatus === 'lead_off' || stale, stale, shared.snapshot.relaxation), displayedKeys: shown };
    visibleRef.current = !shared.screenOff && !shared.waitlisted;
    recordRef.current = band.recordDisplay;
  });
  useEffect(() => {
    const timer = window.setInterval(() => recordRef.current(renderedRef.current, visibleRef.current && document.visibilityState !== 'hidden'), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const actions: MemberClassViewProps['actions'] = {
    onLeave: () => controls.setConfirmLeave(true),
    onHeroChange: controls.setHero,
    onSheetChange: controls.setSheet,
    ...media.actions,
    // 네이티브 소유 중이면 JS BLE 가 아니라 네이티브 링크를 재연결한다(JS 로 붙으면 같은 밴드를 두 클라이언트가 잡는다).
    onBandConnect: () => void (shared.nativeOwnsBand ? getNativeMeasurement().reconnectBand(Capacitor.getPlatform()) : band.connect()),
    onBandDisconnect: () => void (shared.nativeOwnsBand ? undefined : band.disconnect()),
    onBandCancel: () => void (shared.nativeOwnsBand ? undefined : band.disconnect()),
    onBandRetry: () => void (shared.nativeOwnsBand ? getNativeMeasurement().reconnectBand(Capacitor.getPlatform()) : band.connect()),
    onBandContinue: () => controls.setBandContinued(true),
    onBandRecheck: () => {
      controls.setLeadOffDismissed(true);
      controls.setSheet(null);
    },
    onNetRetry: controls.retryNetwork,
    onHostVideoRetry: controls.retryHostVideo,
    onSignal: controls.sendSignal,
    onSpeakerChange: controls.setSpeakerOn,
    onVolumeChange: controls.setVolume,
    onResumeAudio: controls.resumeAudio,
    onScreenOff: () => controls.setScreenOff(true),
    // 체크인 칩은 서버 저장 API 가 없어 컨테이너에서는 노출하지 않는다(onCheckin 생략)
    onEndAction: noop,
    onWaitlistLeave: controls.onLeave,
  };

  return (
    <>
      <div inert={shared.screenOff}>
        <BiosignalRecordingStatus state={band.recordingStatus} />
        <MemberClassView
          input={input}
          header={shared.header}
          hero={shared.hero}
          snapshot={shared.snapshot}
          series={shared.series}
          device={shared.device}
          sound={shared.sound}
          chat={shared.chat}
          hostVideo={media.hostVideo}
          myVideo={media.myVideo}
          hostVideoIssue={shared.hostVideoIssue}
          sheet={shared.sheet}
          v2Bars={shared.v2Bars}
          waitlist={shared.waitlist}
          actions={actions}
        />
        <LeaveConfirmModal
          open={shared.confirmLeave}
          onConfirm={() => {
            controls.setConfirmLeave(false);
            controls.onLeave();
          }}
          onCancel={() => controls.setConfirmLeave(false)}
        />
        <ClassOnboardingCoachmarks
          locationType={shared.onboarding.locationType}
          participantMode={shared.onboarding.participantMode}
          maxParticipants={shared.onboarding.maxParticipants}
        />
      </div>

      {/* 화면 끄기(몰입) — 검정 + 시계 + [화면 켜기], 1.5초 크로스페이드 */}
      <div
        data-testid="member-screen-off"
        className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-black transition-opacity duration-[1500ms] ${
          shared.screenOff ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        aria-hidden={!shared.screenOff}
        inert={!shared.screenOff}
      >
        <p className="text-[13px] text-white/60 tabular-nums">{formatClock(shared.header.elapsedSec)}</p>
        <button
          type="button"
          onClick={() => controls.setScreenOff(false)}
          className="mt-6 rounded-full border border-white/30 px-8 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-white/10"
        >
          화면 켜기
        </button>
      </div>
    </>
  );
}
