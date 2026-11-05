import { userErrorMessage } from '../../lib/api/user-error';
import { BiosignalRecordingStatus } from '../../lib/biosignal/recording-status';
import type { RenderedMetrics } from '../../lib/biosignal/display-snapshot';
import { toHostParticipant } from '../../components/class/player/host/host-live-model';
// SDD-088: 독립형 클래스 플레이어 — 클래스 = 가상의 방, 상태에 따라 씬이 전개된다.
// 풀스크린(AppShell 밖) 단일 페이지. 상담사(host) 씬:
//   ① 세팅(ready/scheduled): 내 영상·소리 점검 + [클래스 열기]   — SDD-209 HostPrepContainer
//   ② 대기실(open): 4자리 입장 코드·초대/대기실 현황·도구 + [시작하기](시작 확인 시트) + 나가기/닫기 — HostPrepContainer
//   ③ 라이브(in_progress): 모니터링·녹음·마커 + [종료](2단계 확인) — SDD-208 HostLiveContainer
//   ④ 종료(completed): [기록 보기]
//   ⑤ 닫힘(cancelled)·로딩 오류: FH10 상태 화면(서버 문구 비노출)
// 상태 전이 버튼은 이 플레이어 안에만 존재한다(목록·상세는 [입장] 단일 버튼).
// 기존 SessionLivePage 의 모니터링·녹음·마커·밴드 로직을 씬으로 분해 이전했다 (SDD-024/026/028/083~085 유지).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { getClass, type ClassDetailDto } from '../../lib/api/class-structure';
import { asClassId } from '../../lib/class-structure/read-model';
import { MemberInviteSheet } from '../../components/class/flow/host/MemberInviteSheet';
import {
  getSession,
  getSessionLiveMetrics,
  duplicateSession,
  setParticipantSpeaking,
  transitionSession,
  scheduleConflictFingerprint,
  type SessionDto,
  type SessionLiveMetric,
  type SessionStatus,
} from '../../lib/api/session';
import { startAudio, stopAudio } from '../../lib/api/audio';
import { startVideo, stopVideo } from '../../lib/api/video';
import { setSessionChatEnabled } from '../../lib/api/chat';
import { useAudioRecorder } from '../../hooks/useAudioRecorder';
import { useVideoRecorder } from '../../hooks/useVideoRecorder';
import { useBand } from '../../hooks/useBand';
import { useLiveKit } from '../../hooks/useLiveKit';
import { useParticipationSnapshot } from '../../hooks/useParticipationSnapshot';
import { useSessionLiveSocket } from '../../hooks/useSessionLiveSocket';
import { useLiveV2 } from '../../lib/session-live/use-live-v2';
import { participantsToMetrics } from './participants-to-metrics';
import { isLiveProtocolV2Enabled } from '../../lib/session-live/live-flag';
import { activeSignals, sessionStatusOf, toSessionLiveMetrics, toWaitingEntries } from '../../lib/session-live/live-legacy-adapter';
import { useWakeLock } from '../../hooks/useWakeLock';
import { useHostBackgroundSession } from '../../hooks/useHostBackgroundSession';
import { useAppResume } from '../../hooks/useAppResume';
import { useLeaveGuard } from '../../hooks/useLeaveGuard';
import { useAuthStore } from '../../stores/authStore';
import { applyEegFeatureToMetricsDetailed } from '../../lib/session-live/apply-eeg-feature';
import { scoreIndices } from '../../lib/eeg/eegPersonalScore';
import {
  isEegStale,
  isLowBattery,
  normalizeSignalQuality01,
  resolveBandLinkState,
  signalQualityLevel,
} from '../../lib/session-live/signal-status';
import type {
  ClassSignalEvent,
  DeviceStatusChangedEvent,
  ParticipantChangedEvent,
  SessionLiveEegFeatureEvent,
  SessionLiveJoinSnapshot,
  SessionStateChangedEvent,
  SpeakingChangedEvent,
} from '../../lib/socket';
import { ConsentModal } from '../../components/session/ConsentModal';
import {
  SessionMonitorSummary,
  type MonitorSummaryCounts,
} from '../../components/session/SessionMonitorSummary';
import { SessionMonitorTable } from '../../components/session/SessionMonitorTable';
import { SpeakingRightsPanel } from '../../components/session/SpeakingRightsPanel';
import { SessionParticipantCardGrid } from '../../components/session/SessionParticipantCardGrid';
// 개선 5: 무음 시그널 — 상단 집계 카운트(조용한 표시)
import { QuietSignalSummary } from '../../components/session/QuietSignalSummary';
import '../../components/class/host-class-player.css';
import {
  countSignals,
  isClassSignalType,
  pruneSignals,
  receiveSignal,
  SIGNAL_ACTIVE_MS,
  type ActiveSignal,
} from '../../lib/class/quiet-signal';
// SDD-209 H9: 시작 전(세팅·로비)·닫힘·오류 구간 컨테이너
import { HostPrepContainer } from '../../components/class/flow/host/HostPrepContainer';
import { HostStateScreen } from '../../components/class/flow/host/HostStateScreen';
import { useMediaCheck } from '../../hooks/useMediaCheck';
import { leadOffFromBand } from '../../lib/class/flow/member-presence';
import { completedClassDestination, endedDurationMin } from '../../lib/class/flow/host-ending-model';
import { deriveHostStateKind, type HostStateAction, type HostStateKind } from '../../lib/class/flow/host-state-model';
import type { OpenPrefs } from '../../lib/class/flow/host-open';
import type { StartAudioPlan } from '../../lib/class/flow/host-start-model';
import type { LobbyContext, LobbyPresenceEntry, LobbyRosterEntry } from '../../lib/class/flow/host-lobby-model';
import { formatWhen } from '../../lib/class/flow/member-format';
import { RAW_RETENTION_DAYS } from '../../lib/privacy-policy';
import { getReportChoiceSummary, getResearchConsentSummary, remindInvitees } from '../../lib/api/class-flow-host';
import { useWaitingRoomCount, type WaitingRoomEntry } from '../../hooks/useWaitingRoomCount';
import { useClassAudioPlayer } from '../../hooks/useClassAudioPlayer';
import { SessionParticipantDetailPanel } from '../../components/session/SessionParticipantDetailPanel';
import { StatusBadge } from '../../components/session/StatusBadge';
import { ClassChatPanel } from '../../components/chat/ClassChatPanel';
import { HostLiveContainer } from '../../components/class/player/host/HostLiveContainer';
import { getActiveSessionLiveSocket } from '../../lib/socket';
import { LeaveGuardModal } from '../../components/player/LeaveGuardModal';
import { ReportProgressStepper } from '../../components/session/ReportProgressStepper';
import { useReportProgress } from '../../hooks/useReportProgress';
import {
  isConnectionFailed,
  isStreamingLive,
  type ParticipantHistoryPoint,
} from '../../lib/session-live/metric-display';

const LIVE_METRICS_POLL_MS = 4000;
const SESSION_POLL_MS = 5000;

/** 업로드 실패를 브라우저 원문("Failed to fetch")이 아닌 안내 문구로 바꾼다 — 청크는 로컬에 보관해 종료 시 재전송한다 */
function uploadErrorMessage(err: Error, label: string): string {
  return err instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(err.message)
    ? `${label} 업로드가 지연되고 있어요. 녹음은 계속되며 연결이 복구되면 다시 전송해요.`
    : err.message;
}
/** SDD-083: 상태 변화 시계열 누적 최소 간격 — 3초 평균 표시와 동일 리듬 */
const HISTORY_MIN_INTERVAL_MS = 3000;
/** 시작 확인 시트에 보여 주는 기록 보관 기간(서버 설정값, 모르면 null) */
/** 방침(/privacy)과 같은 보관 기간 */
const RETENTION_DAYS = RAW_RETENTION_DAYS;
/** SDD-083: participant당 시계열 최대 포인트 (3초 간격 ≈ 1시간) */
const HISTORY_MAX_POINTS = 1200;

/** 이탈 보수 처리 대상 상태 — 오픈/진행중/일시정지 */
const GUARDED_STATUSES: SessionStatus[] = ['open', 'in_progress'];

/** 서버 raw 두뇌휴식도(α/(α+β), 0~1 비율) → 표시용 정규화 점수(0~100).
 * 서버·DB 계약은 raw 유지 — % 표시 직전에만 표준모델(없으면 코호트)로 점수화한다.
 * raw를 그대로 %로 반올림하면 0~1%로 보이는 버그의 수정 지점. */
function scoreEfficiency(raw: number | null | undefined): number | null {
  if (raw == null || Number.isNaN(raw)) return null;
  return scoreIndices({ relaxationIndex: raw }).relaxationIndex;
}

/** 서버가 내려준 참가자 지표 행의 efficiency 필드를 표시용 점수로 정규화한다 */
function scoreServerRows(rows: SessionLiveMetric[]): SessionLiveMetric[] {
  return rows.map((r) => ({
    ...r,
    current_efficiency: scoreEfficiency(r.current_efficiency),
    avg_efficiency: scoreEfficiency(r.avg_efficiency),
  }));
}

/** SDD-094: 참여자별 발언권 상태 — WS 이벤트/API 응답으로 갱신되는 오버레이 */
interface SpeakingPatch {
  raise_hand: boolean;
  speaking: boolean;
}

/**
 * SDD-094: 발언권 상태 오버레이.
 * live-metrics 행에는 발언권 필드가 없을 수 있고 4초 폴링마다 행이 통째로 교체되므로,
 * 이벤트/응답으로 받은 발언권 상태를 행 위에 덮어써 폴링에 지워지지 않게 한다.
 */
function applySpeakingOverlay(
  rows: SessionLiveMetric[],
  patch: Record<string, SpeakingPatch>,
): SessionLiveMetric[] {
  if (rows.length === 0) return rows;
  let changed = false;
  const next = rows.map((row) => {
    const state = patch[row.participant_id];
    if (!state) return row;
    if (row.raise_hand === state.raise_hand && row.speaking === state.speaking) return row;
    changed = true;
    return { ...row, raise_hand: state.raise_hand, speaking: state.speaking };
  });
  return changed ? next : rows;
}

/** DashboardBox 집계 — EEG null이면 접촉/연결/배터리는 0 */
function summarizeMetrics(rows: SessionLiveMetric[]): MonitorSummaryCounts {
  const hasAnyEegSignal = rows.some(
    (r) =>
      r.device_status !== null ||
      r.band_battery !== null ||
      r.avg_efficiency !== null ||
      r.current_efficiency !== null,
  );

  if (!hasAnyEegSignal) {
    return {
      participants: rows.length,
      leadOff: 0,
      connectionFailed: 0,
      lowBattery: 0,
    };
  }

  return {
    participants: rows.length,
    leadOff: rows.filter((r) => r.device_status === 'lead_off').length,
    connectionFailed: rows.filter((r) => {
      if (r.device_status === 'disconnected') return true;
      // 밴드 미사용(EEG 이력 없음)은 연결실패로 치지 않음
      if (r.last_eeg_at == null && !r.band_connected) return false;
      if (!r.band_connected) return true;
      return isEegStale(r.last_eeg_at);
    }).length,
    lowBattery: rows.filter((r) => isLowBattery(r.band_battery)).length,
  };
}

/** 경과 라벨 — 1.0 Timer 형식: 00분 00초 */
function elapsedLabel(sec: number): string {
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return `${mm}분 ${ss}초`;
}

interface HostExtra { at: number; focus: number | null; emotionalStability: number | null; hrv: number | null; heartRate: number | null; respiratoryRate: number | null }
const finiteValue = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** MB2-02: 3초 평균 표시 버퍼 — pid별 efficiency/BPM/호흡수 원시 샘플 */
type FeatureSampleBuffer = { efficiency: number[]; heartRate: number[]; respiratoryRate: number[] };

/**
 * MB2-02: 3초 평균 flush 계산 — 버퍼/엔벨로프 스냅샷만으로 다음 metrics 행을 만드는 순수 함수.
 * setMetrics 업데이터가 순수해야 하므로(StrictMode 이중 호출·렌더 폐기 시 안전) 부수효과 없이
 * 입력만으로 결과를 계산한다. 버퍼 비우기(ref 초기화)는 호출측이 커밋 밖에서 수행한다.
 * 변경이 없으면 입력 배열 참조를 그대로 돌려 불필요 재렌더를 막는다.
 */
function mergeFeatureBufferAverages(
  prev: SessionLiveMetric[],
  buffer: Map<string, FeatureSampleBuffer>,
  envelopes: Map<string, SessionLiveEegFeatureEvent>,
): SessionLiveMetric[] {
  let next = prev;
  let changed = false;
  for (const [pid, values] of buffer) {
    const hasAny =
      values.efficiency.length > 0 ||
      values.heartRate.length > 0 ||
      values.respiratoryRate.length > 0;
    if (!hasAny) continue;
    // MB2-01: 다른 참가자의 엔벨로프를 재사용하지 않는다 — 해당 pid 의 마지막 엔벨로프로 구성한다.
    const envelope = envelopes.get(pid);
    if (!envelope) continue;
    const avgOf = (arr: number[]): number | null =>
      arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
    const avgEff = avgOf(values.efficiency);
    const avgHr = avgOf(values.heartRate);
    const avgRr = avgOf(values.respiratoryRate);
    const averaged: SessionLiveEegFeatureEvent = {
      ...envelope,
      participant_id: pid,
      current_efficiency: avgEff,
      relaxation_index: avgEff,
      feature: {
        ...envelope.feature,
        second_offset: envelope.feature?.second_offset ?? 0,
        relaxation_index: avgEff,
        heart_rate: avgHr,
        respiratory_rate: avgRr,
      },
    };
    const { rows, unchanged } = applyEegFeatureToMetricsDetailed(next, averaged);
    if (!unchanged) {
      next = rows;
      changed = true;
    }
  }
  return changed ? next : prev;
}

export default function ClassPlayerPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const routeRef = useRef({id, generation:0});
  if (routeRef.current.id !== id) routeRef.current = {id, generation:routeRef.current.generation + 1};
  const routeGeneration = routeRef.current.generation;
  const isCurrentRoute = useCallback((requestedId: string | undefined): boolean =>
    routeRef.current.id === requestedId && routeRef.current.generation === routeGeneration, [routeGeneration]);
  const [loadedSession, setSession] = useState<SessionDto | null>(null);
  const session = loadedSession?.id === id ? loadedSession : null;
  // FE-PERF-002: setSession 업데이터 내부에서 setMetrics 를 호출하면 updater 가 부수효과를
  // 갖게 된다(StrictMode 이중 호출 위험). 최신 세션은 ref 로 읽어 updater 밖에서 갱신한다.
  const sessionRef = useRef<SessionDto | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  const [metrics, setMetrics] = useState<SessionLiveMetric[]>([]);
  /** SDD-208: 라이브 지표 폴링이 실패 중인가 — 새 진행 화면이 "연결이 끊겼어요" 판정에 쓴다 */
  const [metricsPollFailing, setMetricsPollFailing] = useState(false);
  const [metricsLastOkAt, setMetricsLastOkAt] = useState<number | null>(null);
  const [hostExtras, setHostExtras] = useState<Record<string, HostExtra>>({});
  const lastFeaturePatchAtRef = useRef(0);
  const featureBufferRef = useRef<Map<string, FeatureSampleBuffer>>(new Map());
  /**
   * MB2-01: 참가자별 마지막 eeg_feature 엔벨로프.
   * 3초 평균 flush 시 다른 참가자의 signal_quality/device_status/last_eeg_at/band_* 등을
   * 재사용하지 않고 각 pid 의 자기 엔벨로프로 averaged 를 구성하기 위해 보관한다.
   */
  const lastFeatureEnvelopeRef = useRef<Map<string, SessionLiveEegFeatureEvent>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const [recordingElapsedSec, setRecordingElapsedSec] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const [activeFilter, setActiveFilter] = useState<keyof MonitorSummaryCounts | null>(null);
  const [monitorView, setMonitorView] = useState<'cards' | 'table'>('cards');
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | null>(null);
  const [selectedHistory, setSelectedHistory] = useState<ParticipantHistoryPoint[]>([]);
  const historyRef = useRef<Map<string, ParticipantHistoryPoint[]>>(new Map());
  const [classElapsedSec, setClassElapsedSec] = useState(0);
  const [lobbyElapsedSec, setLobbyElapsedSec] = useState(0);
  /** SDD-088: 종료 2단계 확인 모달 */
  const [endModalOpen, setEndModalOpen] = useState(false);
  /** SDD-101 D3: 종료(end) 확정 실패 — 재시도 CTA 노출 */
  const [endFailed, setEndFailed] = useState(false);
  /** SDD-085: 프리뷰에서 확정한 카메라/마이크 사용 여부 — 세션 전체(녹음·녹화)에 적용 */
  const [mediaPrefs, setMediaPrefs] = useState<OpenPrefs>({
    cameraOn: true,
    micOn: true,
  });
  const [codeCopied, setCodeCopied] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteDetail, setInviteDetail] = useState<ClassDetailDto | null>(null);
  /** SDD-094: 발언권 부여/해제 요청 진행 중인 participant_id */
  const [speakingBusyId, setSpeakingBusyId] = useState<string | null>(null);
  /** SDD-095: 상담사 채팅 토글 요청 진행 중 */
  const [chatBusy, setChatBusy] = useState(false);
  /** SDD-095: 채팅 패널 접힘 여부 — 켜면 펼치고 사용자가 접을 수 있다 */
  const [chatExpanded, setChatExpanded] = useState(false);
  /** (B) 세션 시작 카드 — 대기실에서 받은 입장 전 체크인을 라이브 전환 후에도 유지 */
  const retainedCheckinsRef = useRef<Map<string, WaitingRoomEntry>>(new Map());
  const [sessionCheckins, setSessionCheckins] = useState<WaitingRoomEntry[]>([]);
  /** 세션을 아직 못 받았을 때의 로딩 실패 분류(404/403/네트워크) — FH10 오류 화면용. 서버 문구는 쓰지 않는다 */
  const [loadErrorKind, setLoadErrorKind] = useState<Extract<HostStateKind, `error${string}`> | null>(null);
  /** 방금 클래스를 닫은 경우의 안내(대기 인원·닫은 시각) — 재진입에는 없다 */
  const [closedInfo, setClosedInfo] = useState<{ waiting: number; atText: string } | null>(null);
  /** 로비 `다시 알림` 결과(participant_id → status)와 진행 상태 */
  const [remindResults, setRemindResults] = useState<ReadonlyMap<string, string>>(new Map());
  const [reminding, setReminding] = useState(false);
  /** 시작 확인 시트의 익명 집계 */
  const [choiceCounts, setChoiceCounts] = useState({ excluded: 0, research: 0 });
  const mediaCheck = useMediaCheck();
  const mediaCheckRef = useRef(mediaCheck);
  mediaCheckRef.current = mediaCheck;

  const liveKit = useLiveKit(id);
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);
  const isHost = Boolean(session && currentUserId && session.host_id === currentUserId);

  const inviteClassId = isHost && (session?.status === 'open' || session?.status === 'in_progress') ? session.class_id : null;
  useEffect(() => {
    const controller = new AbortController();
    setInviteDetail(null); setInviteOpen(false);
    if (inviteClassId) void getClass(asClassId(inviteClassId), controller.signal)
      .then(detail => { if (!controller.signal.aborted) setInviteDetail(detail); })
      .catch(() => { /* 권한을 확인하지 못하면 초대 진입점을 숨긴다. */ });
    return () => controller.abort();
  }, [inviteClassId, id, currentUserId]);
  const canInvite = Boolean(inviteClassId && inviteDetail?.id === inviteClassId && inviteDetail.status === 'active' && inviteDetail.capabilities?.invite === true);

  // 마이크·카메라 없음/거부는 전용 안내 배너가 이미 보여 준다 — 브라우저 원문(Requested device not found)을 오류 띠로 띄우지 않는다.
  const onRecorderError = useCallback((err: Error) => {
    if (err.name === 'NotFoundError' || err.name === 'NotAllowedError' || err.name === 'OverconstrainedError') return;
    setError(uploadErrorMessage(err, '녹음'));
  }, []);
  const recorder = useAudioRecorder({
    sessionId: id ?? '',
    onError: onRecorderError,
  });

  // SDD-084/085: 상담사 본인 카메라 영상 녹화 — 마이크 오프 세션은 무음 영상
  const videoRecorder = useVideoRecorder({
    sessionId: id ?? '',
    withAudio: mediaPrefs.micOn,
    onError: onRecorderError,
  });

  /** 호스트 본인 참가자 id — live-metrics 행의 user_id 매칭 */
  const hostParticipantId = useMemo(() => {
    if (!currentUserId || !session) return null;
    const fromMetrics = metrics.find((m) => m.user_id === currentUserId);
    if (fromMetrics) return fromMetrics.participant_id;
    return null;
  }, [currentUserId, metrics, session]);

  // SDD-246 T06: v2 on 이면 LiveClient/LiveState 하나만 쓴다 — v1 소켓 훅·REST 폴링은 구동하지 않는다.
  const v2Flag = isLiveProtocolV2Enabled();
  const liveV2 = useLiveV2({ sessionId: id, selfParticipantId: hostParticipantId, enabled: Boolean(id && session) });
  const v2Ready = liveV2.ready;
  const participationState = useParticipationSnapshot({classId: v2Flag ? undefined : session?.class_id, sessionId: id});
  const participation = participationState.sessionId === id ? participationState : {sessionId:id, participants:{}, version:-1, revoked:false};
  const participationVersionRef = useRef({sessionId: id, version: -1});
  if (participationVersionRef.current.sessionId !== id) participationVersionRef.current = {sessionId: id, version: -1};
  participationVersionRef.current.version = Math.max(participationVersionRef.current.version, participation.version);

  const band = useBand({
    displayViewKind: 'session_player',
    sessionId: participation.revoked || !session ? '' : id ?? '',
    participantId: participation.revoked ? null : hostParticipantId,
    enabled: Boolean(id && hostParticipantId && !participation.revoked),
  });

  const handleLiveFeature = useCallback(
    (event: SessionLiveEegFeatureEvent) => {
      if (!id || event.session_id !== id || !isCurrentRoute(id)) return;
      // saved=0 은 이미 저장된 window의 재전송 중복(멱등 skip) — 과거 timestamp가
      // last_eeg_at을 되돌리고(→ false "수신끊김") 구간 평균을 오염시키므로 무시한다.
      if (event.saved === 0) return;
      // MB2-01: 참가자별 마지막 엔벨로프 보관 — 평균 flush 는 이 값으로 재구성한다.
      if (event.participant_id) {
        lastFeatureEnvelopeRef.current.set(event.participant_id, event);
      }
      const now = Date.now();
      const focus = finiteValue(event.focus_index ?? event.feature?.focus_index);
      const emotional = finiteValue(event.feature?.emotional_stability);
      const heartRate = event.feature?.heart_rate ?? null;
      const respiratoryRate = event.feature?.respiratory_rate ?? null;
      // 서버 eeg_feature 브로드캐스트에는 last_eeg_at 이 없다. 회원 기기 시계(feature.timestamp)는 상담사 시계와 어긋나면
      // EXTRA_FRESH_MS(10초) 판정에서 집중·정서가 '-' 가 되므로 수신 시각을 쓴다.
      const at = event.last_eeg_at ? Date.parse(event.last_eeg_at) : now;
      setHostExtras(previous => {
        if (previous[event.participant_id]?.at > at) return previous;
        const prev = previous[event.participant_id];
        return { ...previous, [event.participant_id]: {
          at: Number.isFinite(at) ? at : now,
          focus: focus === null ? null : scoreIndices({ focusIndex: focus }).focusIndex,
          emotionalStability: emotional === null ? null : scoreIndices({ emotionalStability: emotional }).emotionalStability,
          // MB2-09: 상담사 관제도 회원 기준 SDNN 을 쓴다(같은 세션·참가자 동일 지표).
          hrv: finiteValue(event.feature?.sdnn),
          // BPM·호흡수는 밴드가 1초 윈도우에서 산출 실패 시 null 을 보내므로
          // 마지막 유효값을 유지(hold)해 몸 지표가 깜빡이지 않게 한다.
          heartRate: finiteValue(heartRate) ?? prev?.heartRate ?? null,
          respiratoryRate: finiteValue(respiratoryRate) ?? prev?.respiratoryRate ?? null,
        } };
      });
      const rawEfficiency =
        event.current_efficiency ??
        event.relaxation_index ??
        event.feature?.relaxation_index ??
        null;
      // feature 계약은 raw 비율 — 표시 버퍼에는 정규화 점수(0~100)로 적재
      const efficiency = scoreEfficiency(rawEfficiency);
      if (event.participant_id) {
        const buf = featureBufferRef.current.get(event.participant_id) ?? {
          efficiency: [],
          heartRate: [],
          respiratoryRate: [],
        };
        if (typeof efficiency === 'number') buf.efficiency.push(efficiency);
        if (typeof heartRate === 'number') buf.heartRate.push(heartRate);
        if (typeof respiratoryRate === 'number') buf.respiratoryRate.push(respiratoryRate);
        featureBufferRef.current.set(event.participant_id, buf);
      }
      // 3초 간격으로 버퍼의 평균값을 반영 — 매 초 튀는 최신값 대신 구간 평균 표시
      if (now - lastFeaturePatchAtRef.current < 3000) return;
      lastFeaturePatchAtRef.current = now;
      // MB2-02: setMetrics 업데이터는 순수해야 한다(StrictMode 이중 호출·렌더 폐기 시 안전).
      // 버퍼·엔벨로프 스냅샷을 커밋 전에 확보하고 ref를 비운 뒤(부수효과는 updater 밖),
      // 다음 행 계산은 순수 함수 mergeFeatureBufferAverages 에 위임한다.
      const bufferSnapshot = featureBufferRef.current;
      featureBufferRef.current = new Map();
      const envelopeSnapshot = new Map<string, SessionLiveEegFeatureEvent>();
      for (const pid of bufferSnapshot.keys()) {
        const envelope = lastFeatureEnvelopeRef.current.get(pid);
        if (envelope) envelopeSnapshot.set(pid, envelope);
      }
      setMetrics((prev) => mergeFeatureBufferAverages(prev, bufferSnapshot, envelopeSnapshot));
    },
    [id, isCurrentRoute],
  );

  const handleSnapshot = useCallback((snap: SessionLiveJoinSnapshot) => {
    if (snap.session_id !== id || !isCurrentRoute(id)) return;
    const participationVersion = snap.participation_version;
    const stale = typeof participationVersion === 'number' && participationVersion <= participationVersionRef.current.version;
    if (!stale && snap.participants) {
      if (typeof participationVersion === 'number') participationVersionRef.current.version = participationVersion;
      setMetrics(scoreServerRows(snap.participants));
    }
    if (snap.status) {
      setSession((prev) =>
        prev ? { ...prev, status: snap.status as SessionStatus } : prev,
      );
    }
  }, [id, isCurrentRoute]);

  const handleSessionState = useCallback(
    (event: SessionStateChangedEvent) => {
      if (!id || event.session_id !== id || !isCurrentRoute(id)) return;
      setSession((prev) =>
        prev
          ? {
              ...prev,
              status: event.status as SessionStatus,
              started_at: event.started_at ?? prev.started_at,
            }
          : prev,
      );
    },
    [id, isCurrentRoute],
  );

  const handleParticipantChanged = useCallback(
    (event: ParticipantChangedEvent) => {
      if (!id || event.session_id !== id || !isCurrentRoute(id)) return;
      if (typeof event.participation_version === 'number') {
        if (event.participation_version <= participationVersionRef.current.version) return;
        participationVersionRef.current.version = event.participation_version;
        if (event.participants) {
          // 참여 이벤트의 NULL 측정 placeholder는 최신 EEG를 덮지 않는다.
          const incoming = event.participants;
          setMetrics(previous => {
            const known = new Set(previous.map(row => row.participant_id));
            return [
              ...previous.map(row => {
                const update = incoming.find(p => p.participant_id === row.participant_id);
                return update ? {...row, display_name:update.display_name, user_id:update.user_id, is_guest:update.is_guest,
                  raise_hand:update.raise_hand, speaking:update.speaking} : row;
              }),
              ...scoreServerRows(incoming.filter(row => !known.has(row.participant_id))),
            ];
          });
        }
      } else if (event.participants) {
        setMetrics(scoreServerRows(event.participants));
      }
    },
    [id, isCurrentRoute],
  );

  const handleDeviceStatus = useCallback(
    (event: DeviceStatusChangedEvent) => {
      if (!id || event.session_id !== id || !isCurrentRoute(id)) return;
      setMetrics((prev) => {
        let changed = false;
        const next = prev.map((row) => {
          if (row.participant_id !== event.participant_id) return row;
          const lastAt = event.last_eeg_at ?? row.last_eeg_at;
          const sq01 = normalizeSignalQuality01(event.signal_quality);
          const patched: SessionLiveMetric = {
            ...row,
            device_status: event.device_status ?? row.device_status,
            band_connected:
              event.band_connected ??
              (lastAt ? !isEegStale(lastAt) : row.band_connected),
            band_battery: event.band_battery ?? row.band_battery,
            last_eeg_at: lastAt,
            signal_quality: sq01 ?? row.signal_quality ?? null,
            signal_quality_level:
              event.signal_quality_level ??
              (sq01 != null ? signalQualityLevel(sq01) : row.signal_quality_level),
          };
          if (
            patched.device_status === row.device_status &&
            patched.band_connected === row.band_connected &&
            patched.band_battery === row.band_battery &&
            patched.last_eeg_at === row.last_eeg_at &&
            patched.signal_quality === row.signal_quality &&
            patched.signal_quality_level === row.signal_quality_level
          ) {
            return row;
          }
          changed = true;
          return patched;
        });
        return changed ? next : prev;
      });
    },
    [id, isCurrentRoute],
  );

  /** SDD-094: 참여자별 발언권 상태 오버레이 — WS 이벤트/API 응답에서만 갱신 */
  const [speakingPatch, setSpeakingPatch] = useState<Record<string, SpeakingPatch>>({});

  /**
   * SDD-094: 발언권 상태 반영 — BE는 부여 시 손들기를 자동 해제하고
   * 이벤트/응답에 raise_hand 를 함께 내린다(누락 시 손들기 표시를 지운다).
   */
  const recordSpeaking = useCallback(
    (participantId: string, speaking: boolean, raiseHand?: boolean | null): void => {
      setSpeakingPatch((prev) => {
        const before = prev[participantId];
        // BE는 부여 시 손들기를 자동 해제하고 이벤트/응답에 raise_hand 를 함께 내린다
        const nextRaiseHand = raiseHand ?? false;
        if (before && before.speaking === speaking && before.raise_hand === nextRaiseHand) {
          return prev;
        }
        return { ...prev, [participantId]: { speaking, raise_hand: nextRaiseHand } };
      });
    },
    [],
  );

  /** SDD-094: 발언권 변경(호스트 룸 수신) → 목록의 손들기/발언 상태 갱신 */
  const handleSpeakingChanged = useCallback(
    (event: SpeakingChangedEvent) => {
      if (!id || (event.session_id && event.session_id !== id)) return;
      recordSpeaking(event.participant_id, event.speaking, event.raise_hand);
    },
    [id, recordSpeaking],
  );

  /** SDD-094: 발언권 부여/해제 — 응답 즉시 반영(WS speaking_changed 가 뒤따라 확정) */
  const handleSetSpeaking = useCallback(
    async (participantId: string, granted: boolean): Promise<void> => {
      if (!id) return;
      setSpeakingBusyId(participantId);
      setError(null);
      try {
        if (v2Flag && liveV2.client && v2Ready) {
          const ack = await liveV2.client.request('speaking.set', { target_id: participantId, can_publish: granted, expected_grant_version: null }, { targetId: participantId });
          if (ack.status !== 'applied' && ack.status !== 'duplicate') throw new Error(ack.code ?? '발언권 변경에 실패했습니다');
          return; // 표시는 LiveState(speaking 도메인)가 출처 — 로컬 patch 를 만들지 않는다
        }
        const res = await setParticipantSpeaking(id, participantId, granted);
        recordSpeaking(res.participant_id ?? participantId, res.speaking, res.raise_hand);
      } catch (e) {
        { const text = userErrorMessage(e, '발언권 변경에 실패했습니다'); if (text) setError(text); }
      } finally {
        setSpeakingBusyId(null);
      }
    },
    [id, recordSpeaking, v2Flag, v2Ready, liveV2.client],
  );

  /** SDD-095: 클래스 채팅 활성 여부(상담사 토글) — 세션 폴링·토글 응답으로 갱신된다 */
  const chatEnabled = session?.chat_enabled === true;

  /**
   * SDD-095: 클래스 채팅 켜기/끄기 — 호스트만 노출되며 서버 권한 검증을 통과해야 한다.
   * 응답의 chat_enabled를 즉시 반영해 회원 화면(폴링)보다 먼저 패널 상태를 확정한다.
   */
  const handleToggleChatEnabled = useCallback(async (): Promise<void> => {
    if (!id) return;
    setChatBusy(true);
    setError(null);
    try {
      const next = !chatEnabled;
      const res = await setSessionChatEnabled(id, next);
      const value = res.chat_enabled ?? next;
      setSession((prev) => (prev ? { ...prev, chat_enabled: value } : prev));
      // 켜면 바로 펼쳐서 대화를 확인할 수 있게 한다
      if (value) setChatExpanded(true);
    } catch (e) {
      { const text = userErrorMessage(e, '채팅 설정 변경에 실패했습니다'); if (text) setError(text); }
    } finally {
      setChatBusy(false);
    }
  }, [id, chatEnabled]);

  // ── 개선 5: 무음 시그널 ──────────────────────────────────────────
  // 회원이 발언권 없이 보낸 상태 신호(휘발성)를 참여자별 최신 1건으로 보관한다.
  // 상담사에게만 이름·최신 선택을 표시하며 TTL 만료 시 함께 제거한다.
  const [quietSignals, setQuietSignals] = useState<Record<string, ActiveSignal>>({});

  const handleQuietSignal = useCallback(
    (event: ClassSignalEvent) => {
      if (!id || (event.session_id && event.session_id !== id)) return;
      if (!event.participant_id || !isClassSignalType(event.signal_type)) return;
      const at = Date.now();
      setQuietSignals((prev) => receiveSignal(prev, event.participant_id, event.signal_type, event.at, at, event.display_name));
    },
    [id],
  );

  // TTL(10초)이 지난 신호는 카드·집계에서 제거한다 — 변화가 없으면 상태 참조가 유지되어 리렌더가 없다.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setQuietSignals((prev) => pruneSignals(prev, Date.now(), SIGNAL_ACTIVE_MS));
    }, 200);
    return () => window.clearInterval(timer);
  }, []);

  /** 상단 집계 — 활성(TTL 이내) 신호만 유형별로 센다 */
  const v2Signals = useMemo<Record<string, ActiveSignal>>(() => {
    if (!v2Flag || !liveV2.state) return {};
    const out: Record<string, ActiveSignal> = {};
    for (const sig of activeSignals(liveV2.state, liveV2.nowMs)) {
      out[sig.participantId] = { type: sig.type, at: sig.expiresAtMs - SIGNAL_ACTIVE_MS };
    }
    return out;
  }, [v2Flag, liveV2.state, liveV2.nowMs]);
  const shownSignals = v2Flag ? v2Signals : quietSignals;
  const quietSignalCounts = useMemo(
    () => countSignals(shownSignals, Date.now(), SIGNAL_ACTIVE_MS),
    [shownSignals],
  );

  useEffect(() => {
    // 같은 페이지 인스턴스의 회차 전환에서 이전 EEG·체크인 캐시는 재사용하지 않는다.
    setMetrics([]);
    setMetricsPollFailing(false);
    setMetricsLastOkAt(null);
    setError(null);
    setLoadErrorKind(null);
    setHostExtras({});
    setSpeakingPatch({});
    setQuietSignals({});
    setSessionCheckins([]);
    retainedCheckinsRef.current.clear();
    featureBufferRef.current.clear();
    lastFeatureEnvelopeRef.current.clear();
    historyRef.current.clear();
    lastFeaturePatchAtRef.current = 0;
  }, [id]);

  const liveSocket = useSessionLiveSocket({
    sessionId: id,
    participantId: hostParticipantId,
    enabled: !v2Flag && Boolean(id && session && !participation.revoked),
    onEegFeature: handleLiveFeature,
    onSnapshot: handleSnapshot,
    onSessionStateChanged: handleSessionState,
    onParticipantChanged: handleParticipantChanged,
    onDeviceStatusChanged: handleDeviceStatus,
    onSpeakingChanged: handleSpeakingChanged,
    onClassSignal: handleQuietSignal,
  });

  const refreshSession = useCallback(async (): Promise<void> => {
    if (!id) return;
    try {
      const next = await getSession(id);
      if (!isCurrentRoute(id) || next.id !== id) return;
      setSession(next);
      // 폴링 재시도 성공 시 이전 오류 문구를 지운다(에러 복구)
      setError(null);
      setLoadErrorKind(null);
    } catch (e) {
      if (!isCurrentRoute(id)) return;
      { const text = userErrorMessage(e, '클래스를 불러오지 못했습니다'); if (text) setError(text); }
      setLoadErrorKind(deriveHostStateKind({ error: e, online: typeof navigator === 'undefined' ? undefined : navigator.onLine }));
    }
  }, [id, isCurrentRoute]);

  const refreshMetrics = useCallback(async (): Promise<void> => {
    if (!id) return;
    try {
      const res = await getSessionLiveMetrics(id);
      if (!isCurrentRoute(id)) return;
      setMetrics(scoreServerRows(res.metrics ?? res.participants ?? []));
      setMetricsPollFailing(false);
      setMetricsLastOkAt(Date.now());
    } catch {
      if (!isCurrentRoute(id)) return;
      setMetricsPollFailing(true);
      // FE-PERF-002: sessionRef 에서 최신 세션을 읽어 setMetrics 를 직접 호출한다.
      const current = sessionRef.current;
      if (current) setMetrics(participantsToMetrics(current));
    }
  }, [id, isCurrentRoute]);

  useEffect(() => {
    if (!id) return;
    void refreshSession();
    // v2 READY 에서는 REST 폴링 0 — 상태 변화는 아래 effect 가 LiveState 로 감지해 한 번만 다시 읽는다.
    if (v2Ready) return undefined;
    const timer = window.setInterval(() => {
      void refreshSession();
    }, SESSION_POLL_MS);
    return () => window.clearInterval(timer);
  }, [id, refreshSession, v2Ready]);

  // SDD-021: 폴링은 항상 유지(안전망) — WS 실시간은 트리거로 즉시 갱신
  useEffect(() => {
    if (!id || !session) return undefined;
    if (v2Flag) {
      if (!v2Ready) void refreshMetrics(); // v2 지표는 LiveState 가 출처 — READY 에서는 REST 지표 폴링 0
      return undefined;
    }
    void refreshMetrics();
    const timer = window.setInterval(() => {
      void refreshMetrics();
    }, LIVE_METRICS_POLL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- session 은 폴링마다 새 객체로 setSession 되므로 deps 에 넣으면 effect 가 매 폴링 재실행된다. session?.status 로 상태 변화만 감지한다.
  }, [id, session?.status, refreshMetrics, v2Flag, v2Ready]);

  /**
   * SDD-246 T06: 전이(open/start/end/cancel)는 v2 READY 에서 live:command 로 보낸다.
   * 거절(예: 일정 겹침 409 확인 흐름)은 기존 REST 가 정확한 오류를 주므로 REST 로 한 번 더 요청한다.
   */
  const transition = useCallback(async (
    sid: string,
    action: 'open' | 'start' | 'end' | 'cancel',
    opts?: Parameters<typeof transitionSession>[2],
  ): Promise<SessionDto> => {
    const client = liveV2.client;
    if (v2Flag && v2Ready && client && !opts) {
      // 계약상 session.end/cancel 은 payload.reason 필수 — 없으면 서버가 missing_field 로 거절한다.
      const payload = action === 'end' || action === 'cancel' ? { reason: 'host_request' } : {};
      const ack = await client.request(`session.${action}`, payload);
      if (ack.status === 'applied' || ack.status === 'duplicate') return getSession(sid);
    }
    return opts ? transitionSession(sid, action, opts) : transitionSession(sid, action);
  }, [liveV2.client, v2Flag, v2Ready]);

  // v2: 회차 전이가 LiveState 로 먼저 오면 REST 를 한 번만 다시 읽어 화면 모델(session)을 맞춘다(주기 폴링 아님).
  const v2Status = v2Flag ? sessionStatusOf(liveV2.state) : null;
  useEffect(() => {
    if (!v2Flag || !v2Status || !session || v2Status === session.status) return;
    void refreshSession();
  }, [v2Flag, v2Status, session, refreshSession]);

  const status: SessionStatus | null = session?.status ?? null;
  const isSetup = status === 'ready' || status === 'scheduled';
  const isLobby = status === 'open';
  const isRunning = status === 'in_progress';
  const completedLeaveToRef = useRef<string | null>(null);
  const isEnded = status === 'completed';
  const isCancelled = status === 'cancelled';

  useEffect(() => {
    if (isHost && session?.class_id && session.status === 'completed' && !completedLeaveToRef.current) {
      bypassGuardRef.current = true;
      navigate(`/sessions/${session.id}/summary`, { replace: true });
    }
  }, [isHost, session?.class_id, session?.id, session?.status, navigate]);

  // SDD-094: 온라인 그룹(≤20)에서만 발언권 관리 대상 —
  // 온라인 1:1은 상시 송출, 오프라인/>20은 부여해도 can_publish=false 라 UI 를 띄우지 않는다
  const speakingManaged =
    session?.location_type === 'online' &&
    session?.participant_mode === 'group' &&
    (session?.max_participants ?? 0) <= 20;

  // ── 개선 10: 명상 가이드·BGM 동기 재생 (상담사 = 소스 원본) ────────
  // 상담사가 트는 트랙·위치를 `class:audio_sync` 로 배포해 회원 화면이 같은 위치로 재생한다.
  // 재생 제어는 대기실·진행 중에만 허용한다(서버도 open/in_progress 에서만 수용).
  // 상담사 본인은 자기 명령을 되받지 않는다 — 로컬 엔진이 기준이고 서버는 회원 배포 경로다.
  const audioPlayer = useClassAudioPlayer({
    sessionId: id,
    // BGM·가이드는 온라인 전용 — 오프라인 대면 수업은 재생하지 않는다.
    enabled: Boolean(id && isHost && isLobby && session?.location_type === 'online'),
    publish: v2Flag
      ? (payload) => {
          const client = liveV2.client;
          if (!client || !v2Ready) return false;
          client.sendCommand('audio.set', {
            action: payload.action,
            track_id: payload.track_id,
            position_ms: Math.max(0, Math.round(payload.position_sec * 1000)),
            expected_revision: null,
          });
          return true;
        }
      : liveSocket.sendAudioSync,
  });

  // 대기·진행 중 화면 꺼짐 방지 (회원 immersive 와 동일 정책)
  useWakeLock(isLobby || isRunning);
  // SDD-222 D3: 상담사도 화면이 꺼지거나 앱이 백그라운드여도 BLE·음성 송출·소켓이 유지되도록 Foreground Service 를 켠다.
  useHostBackgroundSession({
    isHost,
    isLobby,
    isRunning,
    online: session?.location_type === 'online',
    recording: recorder.state === 'recording' || recorder.state === 'paused',
  });
  // 앱 복귀 시 경과 시각을 즉시 다시 계산한다 — setInterval 은 백그라운드에서 멈추므로 서버 기준 시각(started_at·opened_at)으로 보정.
  const [resumeTick, setResumeTick] = useState(0);
  useAppResume(() => setResumeTick((n) => n + 1));

  // 개선 3: 회원 대기실(입장 전 준비) 인원 — 대기실 씬에서만 구독한다
  const waitingRoomV1 = useWaitingRoomCount({ sessionId: id, enabled: !v2Flag && Boolean(id && isLobby) });
  const waitingRoom = useMemo(() => {
    if (!v2Flag || !liveV2.state) return waitingRoomV1;
    const entries = toWaitingEntries(liveV2.state, Object.values(participation.participants));
    return { ...waitingRoomV1, entries, count: entries.length, nicknames: entries.map((e) => e.nickname ?? '참가자') };
  }, [v2Flag, liveV2.state, waitingRoomV1, participation.participants]);

  // FH05 세팅: 온라인일 때만 마이크·카메라를 켜서 점검한다(오프라인은 getUserMedia 호출 0회). 세팅을 벗어나면 끈다.
  const setupMediaActive = Boolean(isHost && isSetup && session?.location_type === 'online');
  useEffect(() => {
    if (!setupMediaActive) return undefined;
    const check = mediaCheckRef.current;
    void check.startMic();
    void check.startCamera();
    return () => {
      mediaCheckRef.current.stopMic();
      mediaCheckRef.current.stopCamera();
    };
  }, [setupMediaActive]);

  // FH07 시작 확인 시트: 리포트 제외·연구 동의 익명 집계 — 대기실 인원이 바뀔 때 다시 받는다(실패해도 시작을 막지 않는다)
  const lobbyCount = waitingRoom.count;
  useEffect(() => {
    if (!id || !isHost || !(isLobby || isEnded)) return undefined;
    let cancelled = false;
    void Promise.allSettled([getReportChoiceSummary(id), getResearchConsentSummary(id)]).then(([choice, research]) => {
      if (cancelled) return;
      setChoiceCounts({
        excluded: choice.status === 'fulfilled' ? choice.value.excluded : 0,
        research: research.status === 'fulfilled' ? research.value.consented : 0,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [id, isHost, isLobby, isEnded, lobbyCount]);


  // (B) 대기실에서 받은 체크인을 라이브 전환 후에도 유지한다 — 세션 시작 카드에 쓴다.
  // WS 는 휘발성(입장 시 leave 로 사라짐)이므로 체크인만 별도 ref 로 누적한다.
  useEffect(() => {
    let changed = false;
    for (const entry of waitingRoom.entries) {
      if (!entry.checkin) continue;
      const prev = retainedCheckinsRef.current.get(entry.participantId);
      if (
        !prev ||
        JSON.stringify(prev.checkin) !== JSON.stringify(entry.checkin) ||
        prev.nickname !== entry.nickname
      ) {
        retainedCheckinsRef.current.set(entry.participantId, entry);
        changed = true;
      }
    }
    if (changed) setSessionCheckins([...retainedCheckinsRef.current.values()]);
  }, [waitingRoom.entries]);

  // SDD-095: 종료 씬(리포트 대기) 진행 스텝퍼 — 세션 종료 후에만 구독/REST 폴링한다.
  const reportProgress = useReportProgress(isEnded ? id ?? null : null);

  // SDD-088: 이탈 보수 처리 — 호스트 + open/in_progress 에서만
  const bypassGuardRef = useRef(false);
  const sessionStatusRef = useRef<SessionStatus | null>(null);
  sessionStatusRef.current = status;
  const isHostRef = useRef(false);
  isHostRef.current = isHost;
  const blocker = useLeaveGuard(
    () =>
      !bypassGuardRef.current &&
      isHostRef.current &&
      GUARDED_STATUSES.includes(sessionStatusRef.current ?? 'ready'),
  );

  /** 클래스 열기 — 세팅 화면에서 확정한 장비 사용 값을 보관하고 open 으로 전이 */
  const openClass = async (prefs: OpenPrefs): Promise<void> => {
    if (!id) return;
    setMediaPrefs(prefs);
    setTransitioning(true);
    setError(null);
    try {
      const updated = await transition(id, 'open');
      setSession(updated);
      await refreshMetrics();
    } catch (e) {
      { const text = userErrorMessage(e, '클래스 오픈에 실패했습니다'); if (text) setError(text); }
    } finally {
      setTransitioning(false);
    }
  };

  /**
   * 시작하기 — 시작 확인 시트(FH07)에서 녹음 선언을 받아 수행한다.
   * 순서: start 전이 → (온라인) 화상 연결 → 녹음이면 audio/start(true)+녹음기, 아니면 audio/start(false)(수동 기록 선언) → 영상.
   * 시작 직후 동의 모달은 띄우지 않는다(녹음 동의는 시트의 체크로 받는다).
   */
  const startClass = async (audio: StartAudioPlan): Promise<void> => {
    if (!id) return;
    setTransitioning(true);
    setError(null);
    try {
      let updated: SessionDto;
      try {
        updated = await transition(id, 'start');
      } catch (e) {
        // 같은 시간대 다른 클래스와 겹치면 서버가 확인용 지문과 함께 409 를 준다 → 확인 후 force 로 재요청.
        const fingerprint = scheduleConflictFingerprint(e);
        if (!fingerprint) throw e;
        if (!window.confirm('같은 시간에 진행 중이거나 예정된 다른 클래스가 있어요.\n그래도 이 클래스를 시작할까요?')) {
          setError('겹치는 일정이 있어 시작하지 않았어요.');
          return;
        }
        updated = await transitionSession(id, 'start', { force: true, confirmed_conflict_fingerprint: fingerprint });
      }
      setSession(updated);
      const online = updated.location_type === 'online';
      if (online) liveKit.connect();
      if (audio === 'record') {
        try {
          await startAudio(id, true);
          await recorder.start();
          setRecordingStartedAt(Date.now());
        } catch (e) {
          setError((e as Error).message);
        }
      } else {
        try {
          await startAudio(id, false);
        } catch (e) {
          setError(`수동 기록 모드 선언 실패: ${(e as Error).message}`);
        }
      }
      await refreshMetrics();
      if (online && updated.record_video !== false && mediaPrefs.cameraOn) {
        try {
          await startVideo(id, true);
          await videoRecorder.start();
          setRecordingStartedAt((prev) => prev ?? Date.now());
        } catch (e) {
          setError(`영상 녹화 시작 실패: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      { const text = userErrorMessage(e, '클래스 시작에 실패했습니다'); if (text) setError(text); }
    } finally {
      setTransitioning(false);
    }
  };

  /** 클래스 닫기(cancel) — 오픈된 방의 정상 퇴로 */
  const closeClass = async (leaveAfter: boolean): Promise<void> => {
    if (!id) return;
    setTransitioning(true);
    setError(null);
    try {
      const waitingNow = waitingRoom.count;
      const updated = await transition(id, 'cancel');
      setSession(updated);
      setClosedInfo({ waiting: waitingNow, atText: formatWhen(new Date().toISOString()) ?? '' });
      if (leaveAfter) {
        bypassGuardRef.current = true;
        navigate('/sessions');
      }
    } catch (e) {
      { const text = userErrorMessage(e, '클래스 닫기에 실패했습니다'); if (text) setError(text); }
    } finally {
      setTransitioning(false);
    }
  };

  /** 녹음 시작 버튼 — 화상은 클래스 시작 시 이미 연결됨(온라인). 미연결 시에만 연결 후 동의 확인 */
  const handleStartClick = () => {
    if (!mediaPrefs.micOn) return;
    setError(null);
    if (!liveKit.token) {
      liveKit.connect();
    }
    setConsentOpen(true);
  };

  /** 동의 모달 확인 — 오디오 녹음 + 상담사 영상 녹화 시작 (record_audio/record_video Off 시 생략) */
  const handleConsentConfirm = async () => {
    setConsentOpen(false);
    if (!id) return;
    const recordAudio = session?.record_audio !== false;
    const recordVideo = session?.record_video !== false;
    if (recordAudio) {
      try {
        await startAudio(id, true);
        await recorder.start();
        setRecordingStartedAt(Date.now());
      } catch (e) {
        setError((e as Error).message);
      }
    }
    if (recordVideo && mediaPrefs.cameraOn) {
      try {
        await startVideo(id, true);
        await videoRecorder.start();
        if (!recordAudio) setRecordingStartedAt(Date.now());
      } catch (e) {
        setError(`영상 녹화 시작 실패: ${(e as Error).message}`);
      }
    }
  };

  /** SDD-085 조합 C(카메라 ON + 마이크 OFF): 무음 영상만 단독 녹화 시작/종료 */
  const handleVideoOnlyStart = async () => {
    if (!id) return;
    if (session?.record_video === false) return; // 영상 녹화 Off 세션은 시작하지 않음
    setError(null);
    try {
      await startVideo(id, true);
      await videoRecorder.start();
      setRecordingStartedAt(Date.now());
    } catch (e) {
      setError(`영상 녹화 시작 실패: ${(e as Error).message}`);
    }
  };

  const handleVideoOnlyStop = async () => {
    if (!id) return;
    try {
      await videoRecorder.stop();
      await stopVideo(id);
    } catch (e) {
      setError(`영상 녹화 종료 실패: ${(e as Error).message}`);
    }
  };

  const handleStop = async () => {
    if (!id) return;
    // SDD-137: 오디오 마지막 청크 flush 를 기다린 뒤 서버 stop 호출
    await recorder.stop();
    try {
      await stopAudio(id);
    } catch (e) {
      setError((e as Error).message);
    }
    if (videoRecorder.state === 'recording' || videoRecorder.state === 'paused') {
      try {
        await videoRecorder.stop();
        // SDD-101 C4: 녹화 총 청크 수를 종료 시 선언해 서버가 누락 인덱스를 계산하도록 한다
        await stopVideo(id, videoRecorder.getExpectedCount());
      } catch (e) {
        setError(`영상 녹화 종료 실패: ${(e as Error).message}`);
      }
    }
  };

  /** 종료 확정 — 2단계 모달의 [클래스 종료]에서만 호출된다 */
  const finishSession = async (leaveTo?: string): Promise<void> => {
    if (!id) return;
    setTransitioning(true);
    setError(null);
    setEndFailed(false);
    try {
      if (
        recorder.state === 'recording' ||
        recorder.state === 'paused' ||
        videoRecorder.state === 'recording' ||
        videoRecorder.state === 'paused'
      ) {
        await handleStop();
      }
      liveKit.disconnect();
      // D-5①: 응답(ended_at 포함)을 반영해 같은 화면에서 리포트 진행을 보여준다(/record 로 점프하지 않음)
      const ended = await transition(id, 'end');
      if (ended.class_id && ended.status !== 'completed') throw new Error('클래스 종료를 확인하지 못했어요. 다시 시도해 주세요.');
      completedLeaveToRef.current = leaveTo ?? null;
      setSession(ended);
      setEndModalOpen(false);
      bypassGuardRef.current = true;
      const destination = ended.class_id ? completedClassDestination(ended, leaveTo) : leaveTo ?? null;
      if (destination) navigate(destination, { replace: !leaveTo });
    } catch (e) {
      // SDD-101 D3: 종료 확정 실패 — 에러 + 재시도 CTA(미디어는 이미 stop 되어 있어 재시도 시 handleStop 생략됨)
      const text = userErrorMessage(e, '클래스 종료에 실패했습니다');
      if (text) { setError(text); setEndFailed(true); }
    } finally {
      setTransitioning(false);
    }
  };

  // 수업 경과 타이머 — started_at 기준
  useEffect(() => {
    if (!session?.started_at) {
      setClassElapsedSec(0);
      return undefined;
    }
    const startedMs = new Date(session.started_at).getTime();
    const tick = (): void => {
      setClassElapsedSec(Math.max(0, Math.floor((Date.now() - startedMs) / 1000)));
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [session?.started_at, resumeTick]);

  // 녹음/녹화 경과 타이머 — recordingStartedAt 기준 (일시정지 시에도 누적 경과 표시)
  useEffect(() => {
    if (!recordingStartedAt) {
      setRecordingElapsedSec(0);
      return undefined;
    }
    const tick = (): void => {
      setRecordingElapsedSec(Math.max(0, Math.floor((Date.now() - recordingStartedAt) / 1000)));
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [recordingStartedAt, resumeTick]);

  // 대기실 경과 타이머 — opened_at 기준 (SDD-088)
  useEffect(() => {
    if (!isLobby || !session?.opened_at) {
      setLobbyElapsedSec(0);
      return undefined;
    }
    const openedMs = new Date(session.opened_at).getTime();
    const tick = (): void => {
      setLobbyElapsedSec(Math.max(0, Math.floor((Date.now() - openedMs) / 1000)));
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [isLobby, session?.opened_at, resumeTick]);

  /** 라이브 지표가 있으면 그것을, 없으면 세션 참가자로 만든 대체 행을 쓴다 */
  const baseMetrics = useMemo(
    () => (metrics.length > 0 ? metrics : session ? participantsToMetrics(session) : []),
    [metrics, session],
  );

  /** SDD-094: 발언권 상태 오버레이 — 4초 폴링으로 행이 교체돼도 표시가 유지된다 */
  const speakingMetrics = useMemo(
    () => applySpeakingOverlay(baseMetrics, speakingPatch),
    [baseMetrics, speakingPatch],
  );

  const displayMetrics = useMemo(() => {
    // SDD-246 T06: v2 on 이면 지표·손·장치는 LiveState 단일 reducer 만 출처다(rich participant 의 `...p` 병합 금지).
    if (liveV2.active && liveV2.state && liveV2.state.phase !== 'CONNECTING') {
      // 신원·입장 시각·체크인은 REST 행(speakingMetrics)에서만 가져온다(v2 에서는 participation 스냅샷을 구독하지 않아 비어 있다).
      return toSessionLiveMetrics(liveV2.state, { nowMs: liveV2.nowMs, legacy: [...speakingMetrics, ...Object.values(participation.participants)] });
    }
    const base: SessionLiveMetric[] = participation.version >= 0
      ? Object.values(participation.participants).map(p => ({
          display_name:'참가자', is_guest:false, band_connected:false, device_status:null,
          band_battery:null, avg_efficiency:null, current_efficiency:null, upload_status:null, last_eeg_at:null,
          ...speakingMetrics.find(row => row.participant_id === p.participant_id), ...p,
        }))
      : speakingMetrics;

    if (!hostParticipantId || band.connectionState !== 'connected') return base;

    const linkState = resolveBandLinkState({
      bleConnected: true,
      lastEegAt: band.lastEegAt,
    });

    let changed = false;
    const next = base.map((row) => {
      if (row.participant_id !== hostParticipantId) return row;
      const sq01 = band.signalQuality == null ? null : band.signalQuality / 100;
      const patched: SessionLiveMetric = {
        ...row,
        band_connected: linkState === 'connected',
        band_battery: band.battery ?? row.band_battery,
        device_status: band.deviceStatus ?? row.device_status,
        // 측정 가드: 로컬 값이 null(무효·측정 중)이면 원격/직전 행 값으로 되살리지 않는다
        current_efficiency: band.currentEfficiency,
        upload_status: band.uploadStatus ?? row.upload_status,
        last_eeg_at: band.lastEegAt ?? row.last_eeg_at,
        signal_quality: sq01 ?? row.signal_quality ?? null,
        signal_quality_level: band.signalQualityLevel,
      };
      if (
        patched.band_connected === row.band_connected &&
        patched.band_battery === row.band_battery &&
        patched.device_status === row.device_status &&
        patched.current_efficiency === row.current_efficiency &&
        patched.upload_status === row.upload_status &&
        patched.last_eeg_at === row.last_eeg_at &&
        patched.signal_quality === row.signal_quality &&
        patched.signal_quality_level === row.signal_quality_level
      ) {
        return row;
      }
      changed = true;
      return patched;
    });
    return changed ? next : base;
  }, [
    liveV2.active,
    liveV2.state,
    liveV2.nowMs,
    speakingMetrics,
    participation.participants,
    participation.version,
    hostParticipantId,
    band.connectionState,
    band.lastEegAt,
    band.signalQuality,
    band.battery,
    band.deviceStatus,
    band.currentEfficiency,
    band.uploadStatus,
    band.signalQualityLevel,
  ]);

  // 상담사 화면의 본인 밴드 칩은 이완도만 표시한다. 나머지 지표를 보였다고 주장하지 않는다.
  const displayRef = useRef<{ rendered: RenderedMetrics | null; visible: boolean; record: typeof band.recordDisplay }>({ rendered: null, visible: false, record: band.recordDisplay });
  useEffect(() => {
    const row = displayMetrics.find(item => item.participant_id === hostParticipantId);
    const live = band.connectionState === 'connected';
    const relaxation = live && row ? toHostParticipant(row, { nowMs: Date.now() }).values.relaxation : null;
    displayRef.current = { record: band.recordDisplay, visible: isRunning && isHost && !participation.revoked && !inviteOpen, rendered: {
      values: { focus: null, relaxation, emotional: null, bpm: null, respiration: null, hrv: null }, displayedKeys: live ? ['relaxation'] : [],
      rawMind: { focus: null, relaxation: null, emotional: null }, live, remoteRelaxation: true, blocked: false, leadOff: band.deviceStatus === 'lead_off', stale: false,
      lastEegAtMs: row?.last_eeg_at ? Date.parse(row.last_eeg_at) : null, quality: band.signalQualityLevel, respirationNullReason: null,
    } };
  });
  useEffect(() => {
    const timer = window.setInterval(() => { const view = displayRef.current; view.record(view.rendered, view.visible && document.visibilityState !== 'hidden'); }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const summary = useMemo(() => summarizeMetrics(displayMetrics), [displayMetrics]);

  // 실시간 수신 요약 — 스트리밍 중 / 수신 끊김 인원 (4초 폴링 리렌더 주기로 재평가)
  const streamingCount = useMemo(
    () => displayMetrics.filter(isStreamingLive).length,
    [displayMetrics],
  );
  const droppedCount = useMemo(
    () => displayMetrics.filter(isConnectionFailed).length,
    [displayMetrics],
  );

  // SDD-083: 진행 중 상태 변화 시계열 누적
  useEffect(() => {
    if (!isRunning) return;
    const now = Date.now();
    for (const row of displayMetrics) {
      const hasLive =
        row.current_efficiency != null ||
        row.heart_rate != null ||
        row.respiratory_rate != null;
      if (!hasLive) continue;
      const arr = historyRef.current.get(row.participant_id) ?? [];
      const last = arr[arr.length - 1];
      if (last && now - last.t < HISTORY_MIN_INTERVAL_MS) continue;
      const next = [
        ...arr,
        {
          t: now,
          efficiency: row.current_efficiency ?? null,
          heartRate: row.heart_rate ?? null,
          respiratoryRate: row.respiratory_rate ?? null,
        },
      ];
      historyRef.current.set(
        row.participant_id,
        next.length > HISTORY_MAX_POINTS ? next.slice(-HISTORY_MAX_POINTS) : next,
      );
    }
  }, [displayMetrics, isRunning]);

  const selectedRow = useMemo(
    () =>
      selectedParticipantId
        ? displayMetrics.find((m) => m.participant_id === selectedParticipantId) ?? null
        : null,
    [displayMetrics, selectedParticipantId],
  );

  const handleSelectParticipant = useCallback((participantId: string) => {
    setSelectedParticipantId(participantId);
    setSelectedHistory(historyRef.current.get(participantId) ?? []);
  }, []);

  useEffect(() => {
    if (!selectedParticipantId) return undefined;
    const timer = window.setInterval(() => {
      setSelectedHistory(historyRef.current.get(selectedParticipantId) ?? []);
    }, HISTORY_MIN_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [selectedParticipantId]);

  const handleFilterToggle = (key: keyof MonitorSummaryCounts): void => {
    setActiveFilter((prev) => (prev === key ? null : key));
  };

  const handleCopyCode = async (): Promise<void> => {
    if (!session?.access_code) return;
    try {
      await navigator.clipboard.writeText(session.access_code);
      setCodeCopied(true);
      window.setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      setCodeCopied(false);
      // 클립보드 API 실패(권한·비보안 컨텍스트) 시 사용자가 직접 선택할 수 있게 안내
      setError('클래스 코드를 복사하지 못했습니다. 코드를 직접 선택해 주세요.');
    }
  };

  if (participation.revoked) {
    return <main role="alert" className="flex min-h-screen items-center justify-center"><p>참여 권한이 종료되었습니다. 수업 목록에서 현재 상태를 확인해 주세요.</p></main>;
  }

  if (!session && loadErrorKind) {
    return (
      <HostStateScreen
        kind={loadErrorKind}
        title="클래스"
        onAction={(action) => {
          if (action === 'retry') void refreshSession();
          else navigate(action === 'home' ? '/dashboard' : '/sessions');
        }}
      />
    );
  }

  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#12081C]">
        <p className="text-sm text-white/70">클래스에 입장하는 중...</p>
      </main>
    );
  }

  const accessCode = session.access_code ?? '';

  /* ─── 모든 씬 공용 모달: 녹음 동의 · 이탈 확인 ─── */
  // SDD-085: 마이크 오프 세션은 녹음 자체가 없어 음성 동의 절차 불필요
  const consentModal = (
    <ConsentModal
      open={consentOpen && mediaPrefs.micOn}
      onConfirm={() => void handleConsentConfirm()}
      onCancel={() => {
        setConsentOpen(false);
      }}
    />
  );
  // SDD-088: SPA 라우팅 이탈 확인 — open/in_progress
  const leaveGuardModal =
    blocker.state === 'blocked' ? (
      <LeaveGuardModal
        status={session.status}
        busy={transitioning}
        onStay={() => blocker.reset?.()}
        onCloseAndLeave={() => {
          if (session.status === 'open') {
            // 닫기(cancel) 후 원래 가려던 곳으로 이탈을 재개한다
            void (async () => {
              await closeClass(false);
              blocker.proceed?.();
            })();
          } else {
            // 종료(end)는 finishSession 이 bypass 후 같은 화면에서 리포트 진행을 보여준다
            void finishSession();
          }
        }}
        onLeaveKeepOpen={() => blocker.proceed?.()}
      />
    ) : null;

  const memberInviteSheet = canInvite && inviteDetail ? (
    <MemberInviteSheet key={`${id}:${inviteDetail.id}`} open={inviteOpen} detail={inviteDetail}
      code={session.access_code} codeCopied={codeCopied} onCopyCode={() => void handleCopyCode()}
      onClose={() => setInviteOpen(false)} onSaved={async () => {
        const [detail] = await Promise.all([
          getClass(asClassId(inviteDetail.id)), refreshSession(), refreshMetrics(),
        ]);
        if (id && isCurrentRoute(id)) setInviteDetail(detail);
        return detail;
      }} />
  ) : null;

  /* ─── ③ 라이브 씬(호스트): 새 진행 화면(SDD-208). 훅·핸들러는 이 페이지가 한 번만 만들고 컨테이너는 값만 받는다 ─── */
  if (isRunning && isHost) {
    return (
      <>
        <BiosignalRecordingStatus state={band.recordingStatus} />
        <div inert={canInvite && inviteOpen}><HostLiveContainer
          session={session}
          hostUserId={currentUserId}
          hostParticipantId={hostParticipantId}
          rows={displayMetrics}
          extras={hostExtras}
          elapsedSec={classElapsedSec}
          checkins={sessionCheckins}
          waitingEntries={waitingRoom.entries}
          quietSignals={shownSignals}
          v2LowerHand={v2Flag && v2Ready && liveV2.client ? async (participantId) => {
            const ack = await liveV2.client!.request('hand.lower', { target_id: participantId }, { targetId: participantId });
            return ack.status === 'applied' || ack.status === 'duplicate';
          } : undefined}
          onHandLowered={v2Flag ? undefined : (participantId) => {
            if (!id || !isCurrentRoute(id)) return;
            setMetrics((previous) => previous.map((row) => row.participant_id === participantId ? { ...row, raise_hand: false } : row));
            setSpeakingPatch((previous) => previous[participantId] ? { ...previous, [participantId]: { ...previous[participantId], raise_hand: false } } : previous);
          }}
          onHandLowerFailed={v2Flag ? undefined : (participantId) => {
            if (!id || !isCurrentRoute(id)) return;
            setMetrics((previous) => previous.map((row) => row.participant_id === participantId ? { ...row, raise_hand: true } : row));
            setSpeakingPatch((previous) => previous[participantId] ? { ...previous, [participantId]: { ...previous[participantId], raise_hand: true } } : previous);
          }}
          live={{
            socketConnected: v2Flag ? liveV2.state?.phase === 'READY' : liveSocket.isConnected,
            metricsPollFailing,
            metricsLastOkAt,
            onRetry: () => {
              void refreshMetrics();
              const socket = getActiveSessionLiveSocket();
              if (socket && !socket.connected) socket.connect();
            },
          }}
          speaking={{ busyId: speakingBusyId, onSet: (participantId, granted) => void handleSetSpeaking(participantId, granted) }}
          chat={{ enabled: chatEnabled, busy: chatBusy, onToggleEnabled: () => void handleToggleChatEnabled() }}
          recorder={recorder}
          videoRecorder={videoRecorder}
          recording={{ elapsedSec: recordingElapsedSec, onStart: handleStartClick, onStop: () => void handleStop() }}
          videoOnly={{ onStart: () => void handleVideoOnlyStart(), onStop: () => void handleVideoOnlyStop() }}
          mediaPrefs={mediaPrefs}
          liveKit={{
            token: liveKit.token,
            loading: liveKit.loading,
            error: liveKit.error,
            serverUrl: liveKit.serverUrl,
            onDisconnected: () => setError('화상 회의 연결이 끊어졌습니다'),
          }}
          band={band}
          status={{ error, endFailed, ending: transitioning, onRetryEnd: () => void finishSession() }}
          end={{
            open: endModalOpen,
            onRequest: () => setEndModalOpen(true),
            onConfirm: () => void finishSession(),
            onCancel: () => setEndModalOpen(false),
          }}
          onInvite={canInvite ? () => setInviteOpen(true) : undefined}
          codeCopy={{ copied: codeCopied, onCopy: () => void handleCopyCode() }}
          onClose={() => navigate('/sessions')}
        /></div>
        {memberInviteSheet}
        {consentModal}
        {leaveGuardModal}
      </>
    );
  }

  /* ─── ①②⑤ 호스트 시작 전(세팅·로비)·닫힘: SDD-209 새 흐름. 훅·핸들러는 이 페이지가 한 번만 만들고 컨테이너는 값만 받는다 ─── */
  if (isHost && (isSetup || isLobby || isCancelled || isEnded)) {
    const hostUserId = currentUserId;
    const roster: LobbyRosterEntry[] = displayMetrics
      .filter((row) => row.user_id !== hostUserId)
      .map((row) => ({ participantId: row.participant_id, name: row.display_name }));
    const presence: LobbyPresenceEntry[] = waitingRoom.entries.map((entry) => ({
      participantId: entry.participantId,
      nickname: entry.nickname,
      readiness: entry.readiness ?? null,
      // BE-10: 중계된 전극 접촉(채널별 boolean 일 때만). 모르면 null
      leadOff: leadOffFromBand(entry.readiness?.band),
    }));
    const ctx: LobbyContext = {
      place: session.location_type === 'offline' ? 'offline' : 'online',
      size: session.participant_mode === 'one_on_one' ? 'solo' : 'group',
      band: session.linkband_mode,
    };
    const online = ctx.place === 'online';
    const phase = isSetup ? 'setup' : isLobby ? 'lobby' : isEnded ? 'ending' : 'closed';
    const personOf = (row: SessionLiveMetric) => ({ id: row.participant_id, name: row.display_name });
    const audio = audioPlayer.state;
    const clock = (sec: number): string => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
    const lobbyMedia = {
      mic: mediaPrefs.micOn ? 'on' : 'off',
      cam: mediaPrefs.cameraOn ? 'on' : 'off',
      level: 0, steps: 0, quiet: false, speakerPlaying: false,
    } as const;
    return (
      <>
        <BiosignalRecordingStatus state={band.recordingStatus} />
        <div inert={canInvite && inviteOpen}><HostPrepContainer
          phase={phase}
          stateKind={closedInfo ? (closedInfo.waiting > 0 ? 'closed' : 'closed-0') : 'closed-revisit'}
          title={session.title || '제목 없는 클래스'}
          startText={formatWhen(session.scheduled_at) ?? '지금 바로'}
          address={ctx.place === 'offline' ? session.location_address : null}
          ctx={ctx}
          accessCode={session.access_code}
          media={isSetup
            ? { mic: mediaCheck.mic, cam: mediaCheck.cam, level: mediaCheck.level, steps: mediaCheck.steps, quiet: mediaCheck.quiet, speakerPlaying: mediaCheck.speakerPlaying, videoRef: mediaCheck.videoRef }
            : lobbyMedia}
          opening={transitioning}
          onOpen={(prefs) => void openClass(prefs)}
          onToggleMic={() => {
            if (isSetup) void mediaCheck.toggleMic();
            else setMediaPrefs((prev) => ({ ...prev, micOn: !prev.micOn }));
          }}
          onToggleCamera={() => {
            if (isSetup) void mediaCheck.toggleCamera();
            else setMediaPrefs((prev) => ({ ...prev, cameraOn: !prev.cameraOn }));
          }}
          onRecheck={() => void mediaCheck.recheck()}
          onPlayTone={() => void mediaCheck.playTestTone()}
          roster={roster}
          presence={presence}
          remindResults={remindResults}
          reminding={reminding}
          starting={transitioning}
          excluded={choiceCounts.excluded}
          research={choiceCounts.research}
          retentionDays={RETENTION_DAYS}
          onRemind={(participantIds) => {
            if (!id) return;
            setReminding(true);
            void remindInvitees(id, participantIds)
              .then((res) => setRemindResults((prev) => new Map([...prev, ...res.results.map((r) => [r.participant_id, r.status] as const)])))
              .catch(() => setRemindResults((prev) => new Map([...prev, ...participantIds.map((pid) => [pid, 'failed'] as const)])))
              .finally(() => setReminding(false));
          }}
          canInvite={canInvite}
          onInviteAdd={() => setInviteOpen(true)}
          onCopyCode={() => void handleCopyCode()}
          codeCopied={codeCopied}
          sheets={{
            bgm: {
              tracks: online ? audio.tracks.map((track) => ({ id: track.track_id, title: track.title })) : [],
              selectedId: audio.selectedTrackId,
              playing: audio.playing,
              progress: audio.durationSec ? Math.min(1, audio.positionSec / audio.durationSec) : 0,
              timeText: `${clock(audio.positionSec)} / ${audio.durationSec ? clock(audio.durationSec) : '--:--'}`,
              volume: audio.volume,
              onSelect: audioPlayer.actions.selectTrack,
              onTogglePlay: audioPlayer.actions.toggle,
              onVolume: audioPlayer.actions.setVolume,
            },
            band: {
              connected: band.connectionState === 'connected',
              leadOff: band.leadOff,
              connecting: band.connectionState === 'connecting',
              onConnect: () => void band.connect(),
              onDisconnect: () => void band.disconnect(),
            },
            speak: {
              raised: displayMetrics.filter((row) => row.raise_hand && !row.speaking).map(personOf),
              speaking: displayMetrics.filter((row) => row.speaking).map(personOf),
              busyId: speakingBusyId,
              onAllow: (pid) => void handleSetSpeaking(pid, true),
              onStop: (pid) => void handleSetSpeaking(pid, false),
            },
            chat: {
              enabled: chatEnabled,
              messages: [],
              busy: chatBusy,
              node: (
                <ClassChatPanel
                  sessionId={id ?? ''}
                  enabled={chatEnabled}
                  roomId={session.chat_room_id ?? null}
                  collapsed={false}
                  onCollapsedChange={() => undefined}
                  embedded
                />
              ),
              onToggle: () => void handleToggleChatEnabled(),
              onSend: () => undefined,
            },
          }}
          onStart={(audioPlan) => void startClass(audioPlan)}
          onLeave={() => {
            bypassGuardRef.current = true;
            navigate('/sessions');
          }}
          onCloseClass={() => void closeClass(false)}
          ending={{
            isClassSession: Boolean(session.class_id),
            steps: reportProgress.progress?.steps ?? null,
            generationStatus: reportProgress.generationStatus,
            progress: reportProgress.progress?.progress ?? null,
            reason: reportProgress.progress?.reason ?? null,
            manual: !mediaPrefs.micOn,
            durationMin: endedDurationMin(session.started_at, session.ended_at),
            headcount: roster.length > 0 ? roster.length : null,
            excluded: choiceCounts.excluded,
          }}
          headcount={null}
          onEnd={() => undefined}
          onContinue={() => undefined}
          onOpenRecord={() => navigate(`/sessions/${session.id}/${session.class_id ? 'summary' : 'record'}`)}
          closedWaiting={closedInfo?.waiting}
          closedAtText={closedInfo?.atText ?? null}
          onStateAction={(action: HostStateAction) => {
            if (action === 'retry') void refreshSession();
            else if (action === 'clone') {
              void duplicateSession(session.id)
                .then((copy) => navigate(`/sessions/${copy.id}`))
                .catch(() => setError('같은 설정으로 새 클래스를 만들지 못했어요'));
            } else navigate(action === 'home' ? '/dashboard' : '/sessions');
          }}
        /></div>
        {memberInviteSheet}
        {error ? (
          <div role="alert" className="fixed left-1/2 top-4 z-[70] w-[min(92vw,420px)] -translate-x-1/2 rounded-xl border border-[#F5C2C0] bg-[#FDECEC] p-3.5 text-sm text-[#B3261E]">
            {error}
          </div>
        ) : null}
        {leaveGuardModal}
      </>
    );
  }

  /* ─── 서버 연결 + 스트리밍 상태 바 — 참여자 요약 상단 상시 표시 ─── */
  const liveStatusBar = (
    <div className="flex flex-wrap items-center gap-2">
      {/* 서버(WebSocket) 연결 상태 — 끊겨도 4초 폴링 안전망은 유지된다 */}
      {(v2Flag ? liveV2.state?.phase === 'READY' || liveV2.state?.phase === 'RESYNCING' : liveSocket.isConnected) ? (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold ${
            (v2Flag ? v2Ready : liveSocket.isReady)
              ? 'bg-[#59CE9026] text-[#2F9E68]'
              : 'bg-amber-100 text-amber-700'
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              (v2Flag ? v2Ready : liveSocket.isReady) ? 'bg-[#2F9E68]' : 'animate-pulse bg-amber-500'
            }`}
          />
          {(v2Flag ? v2Ready : liveSocket.isReady) ? '서버 실시간 연결됨' : '서버 연결 중 · 동기화 대기'}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F2212133] px-3 py-1.5 text-[12px] font-semibold text-[#F22121B2]">
          <span className="h-2 w-2 rounded-full bg-[#F22121]" />
          서버 연결 끊김 · 4초 주기로 갱신 중
        </span>
      )}

      {/* 개선 5: 무음 시그널 집계 — 유형별 카운트만 조용히(소리·팝업 없음, 0이면 미표시) */}
      <QuietSignalSummary counts={quietSignalCounts} />

      {/* 밴드 스트리밍 상태 — 실시간 수신 중 인원 요약 */}
      {streamingCount > 0 ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#59CE9026] px-3 py-1.5 text-[12px] font-semibold text-[#2F9E68]">
          <span className="h-2 w-2 animate-pulse rounded-full bg-[#2F9E68]" />
          밴드 {streamingCount}명 스트리밍 중
        </span>
      ) : droppedCount > 0 ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F2212133] px-3 py-1.5 text-[12px] font-semibold text-[#F22121B2]">
          <span className="h-2 w-2 rounded-full bg-[#F22121]" />
          밴드 수신 끊김
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F2F3F8] px-3 py-1.5 text-[12px] font-medium text-[#6F6F6F]">
          <span className="h-2 w-2 rounded-full bg-[#9B9B9B]" />
          밴드 데이터 대기
        </span>
      )}
      {droppedCount > 0 && streamingCount > 0 && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F2212133] px-3 py-1.5 text-[12px] font-semibold text-[#F22121B2]">
          <span className="h-2 w-2 rounded-full bg-[#F22121]" />
          수신 끊김 {droppedCount}명
        </span>
      )}

      {/* 개선 3: 대기실 인원 — 코드로 들어와 입장 전 준비(기기 셀프체크) 중인 회원 수 */}
      {isLobby && (
        <span
          title={waitingRoom.nicknames.join(', ') || undefined}
          className="inline-flex items-center gap-1.5 rounded-full bg-[#F5EDFC] px-3 py-1.5 text-[12px] font-semibold text-[#5F0080]"
        >
          <span
            className={`h-2 w-2 rounded-full bg-[#5F0080] ${
              waitingRoom.count > 0 ? 'animate-pulse' : 'opacity-40'
            }`}
          />
          대기실 {waitingRoom.count}명 준비 중
        </span>
      )}
    </div>
  );

  /* ─── 참여자 상태 피드백 패널 — 대기실·라이브(우측 컬럼) 공용 ─── */
  const monitorPanel = (isLobby || isRunning) && (
    <div className="flex h-full flex-col space-y-3 rounded-2xl bg-white p-4">
      {liveStatusBar}
      <SessionMonitorSummary
        counts={summary}
        activeFilter={activeFilter}
        onFilterToggle={handleFilterToggle}
      />

      {/* SDD-094: 발언권 관리 — 손든 참여자 우선 정렬 + 부여/해제 */}
      {speakingManaged && (
        <SpeakingRightsPanel
          participants={displayMetrics}
          busyId={speakingBusyId}
          onGrant={(participantId) => void handleSetSpeaking(participantId, true)}
          onRevoke={(participantId) => void handleSetSpeaking(participantId, false)}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col space-y-2">
        <div className="flex justify-end gap-1">
          {(
            [
              { key: 'cards', label: '카드' },
              { key: 'table', label: '테이블' },
            ] as const
          ).map((v) => (
            <button
              key={v.key}
              type="button"
              aria-pressed={monitorView === v.key}
              onClick={() => setMonitorView(v.key)}
              className={`rounded-lg min-h-[44px] px-4 py-2.5 text-[12px] font-medium transition ${
                monitorView === v.key
                  ? 'bg-[#5F0080] text-white'
                  : 'bg-[#F2F3F8] text-[#6F6F6F] hover:text-[#1F1F1F]'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        {monitorView === 'cards' ? (
          <SessionParticipantCardGrid
            participants={displayMetrics}
            filter={activeFilter}
            selectedId={selectedParticipantId}
            onSelect={handleSelectParticipant}
            signals={shownSignals}
          />
        ) : (
          <SessionMonitorTable participants={displayMetrics} filter={activeFilter} />
        )}
      </div>


    </div>
  );

  return (
    <main className="min-h-screen bg-[#12081C] pb-[calc(2.5rem+env(safe-area-inset-bottom,0px))]">
      {/* 플레이어 헤더 — 풀스크린 셸 (AppShell 밖) */}
      <header className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-white/10 bg-[#12081C]/95 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] backdrop-blur sm:flex-nowrap sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/sessions')}
            className="hcp-hbtn hcp-hbtn--ghost"
          >
            <ArrowLeft aria-hidden="true" />
            나가기
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-white sm:text-base">
              {session.title || '제목 없는 클래스'}
            </p>
            <p className="mt-0.5 flex items-center gap-2 text-xs text-white/60">
              {accessCode && <span className="font-mono tracking-widest">{accessCode}</span>}
              {isRunning && session.started_at && (
                <span className="font-mono">{elapsedLabel(classElapsedSec)}</span>
              )}
              {isLobby && session.opened_at && (
                <span className="font-mono">대기 {elapsedLabel(lobbyElapsedSec)}</span>
              )}
            </p>
          </div>
          <StatusBadge status={session.status} />
        </div>
      </header>

      <div className="hcp-page-content mx-auto mt-4 max-w-7xl space-y-3 px-4 sm:px-6">
        {isLobby && !isHost && monitorPanel}

        {/* 모니터링 — 비호스트 진행 화면은 전체 폭 (대기실은 위 좌우 그리드 우측에 표시) */}
        {(isRunning && !isHost) && monitorPanel}

        {/* 오류는 한 묶음으로 표시해 종료 재시도와 화상 오류가 서로 가리지 않게 한다. */}
        {(error || liveKit.error) && <div className="hcp-errors">
        {error && (
          <div className="hcp-error rounded-xl border border-[#F5C2C0] bg-[#FDECEC] p-3.5 text-sm text-[#B3261E]">
            <p>{error}</p>
            {/* SDD-101 D3: 종료 확정 실패 시 재시도 CTA */}
            {endFailed && (
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  disabled={transitioning}
                  onClick={() => void finishSession()}
                  className="rounded-lg bg-[#5F0080] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  종료 재시도
                </button>
              </div>
            )}
          </div>
        )}

        {liveKit.error && (
          <div className="hcp-error rounded-xl border border-[#F5C2C0] bg-[#FDECEC] p-3.5 text-sm text-[#B3261E]">
            화상 연결 오류: {liveKit.error}
          </div>
        )}

        </div>}

        {/* ④ 종료 씬 — completed */}
        {isEnded && (
          <div className="flex flex-col items-center gap-4 rounded-2xl bg-white/5 px-6 py-16 text-center">
            <p className="text-2xl font-bold text-white">클래스가 종료되었습니다</p>
            <p className="text-sm text-white/60">
              녹음·녹화가 저장되었고 리포트가 자동 생성됩니다. 기록 페이지에서 확인하세요.
            </p>
            {/* SDD-095: 리포트 생성 진행 스텝퍼 — 처리 중임을 명확히 보여준다 */}
            <div className="w-full max-w-xl text-left">
              <ReportProgressStepper
                progress={reportProgress.progress}
                tone="dark"
                onViewReport={() => navigate(`/sessions/${id}/record`)}
              />
            </div>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => navigate(`/sessions/${id}/record`)}
                className="mb-btn"
              >
                기록 보기
              </button>
              <button
                type="button"
                onClick={() => navigate('/sessions')}
                className="mb-btn mb-btn--ghost !text-white/80 hover:!text-white"
              >
                목록으로
              </button>
            </div>
          </div>
        )}

        {/* 취소(닫힘) 씬 */}
        {isCancelled && (
          <div className="flex flex-col items-center gap-4 rounded-2xl bg-white/5 px-6 py-16 text-center">
            <p className="text-2xl font-bold text-white">닫힌 클래스입니다</p>
            <button
              type="button"
              onClick={() => navigate('/sessions')}
              className="mb-btn mb-btn--ghost !text-white/80 hover:!text-white"
            >
              목록으로
            </button>
          </div>
        )}

        {/* 카드 클릭 → 현재 상태 + 상태 변화 시계열 (SDD-083) */}
        {selectedRow && !isHost && (
          <SessionParticipantDetailPanel
            row={selectedRow}
            history={selectedHistory}
            sessionStartedAt={session.started_at}
            onClose={() => setSelectedParticipantId(null)}
          />
        )}
      </div>

      {consentModal}
      {leaveGuardModal}
      {/* SDD-095: 클래스 채팅 패널 — chat_enabled일 때 우측 오버레이로 노출(대기실·진행 중) */}
      {(isLobby || isRunning) && (
        <ClassChatPanel
          sessionId={id ?? ''}
          enabled={chatEnabled}
          roomId={session.chat_room_id ?? null}
          collapsed={!chatExpanded}
          onCollapsedChange={(next) => setChatExpanded(!next)}
          title="클래스 채팅"
        />
      )}
    </main>
  );
}
