// SDD-088: 독립형 클래스 플레이어 — 클래스 = 가상의 방, 상태에 따라 씬이 전개된다.
// 풀스크린(AppShell 밖) 단일 페이지. 상담사(host) 씬:
//   ① 세팅(ready/scheduled): 미디어 프리뷰 + [클래스 오픈]
//   ② 대기실(open): 코드 대형 표시 + 참가자 실시간 그리드 + [시작하기] + [클래스 닫기]
//   ③ 라이브(in_progress): 모니터링·녹음·마커 + [종료](2단계 확인)
//   ④ 종료(completed): [기록 보기]
// 상태 전이 버튼은 이 플레이어 안에만 존재한다(목록·상세는 [입장] 단일 버튼).
// 기존 SessionLivePage 의 모니터링·녹음·마커·밴드 로직을 씬으로 분해 이전했다 (SDD-024/026/028/083~085 유지).

import { useCallback, useId, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getSession,
  getSessionLiveMetrics,
  setParticipantSpeaking,
  transitionSession,
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
import { useSessionLiveSocket } from '../../hooks/useSessionLiveSocket';
import { useWakeLock } from '../../hooks/useWakeLock';
import { useLeaveGuard } from '../../hooks/useLeaveGuard';
import { useAuthStore } from '../../stores/authStore';
import { applyEegFeatureToMetricsDetailed } from '../../lib/session-live/apply-eeg-feature';
import { scoreIndices } from '../../lib/eeg/eegPersonalScore';
import {
  contactStatusLabel,
  isEegStale,
  isLowBattery,
  normalizeSignalQuality01,
  resolveBandLinkState,
  signalQualityLevel,
  signalQualityLevelLabel,
} from '../../lib/session-live/signal-status';
import type {
  ClassAggregateEventHandler,
  ClassSignalEvent,
  DeviceStatusChangedEvent,
  ParticipantChangedEvent,
  SessionLiveEegFeatureEvent,
  SessionLiveJoinSnapshot,
  SessionStateChangedEvent,
  SpeakingChangedEvent,
} from '../../lib/socket';
import { VideoConference } from '../../components/session/VideoConference';
import { ConsentModal } from '../../components/session/ConsentModal';
import { RecordingControls } from '../../components/session/RecordingControls';
import { MarkerButton } from '../../components/session/MarkerButton';
import {
  SessionMonitorSummary,
  type MonitorSummaryCounts,
} from '../../components/session/SessionMonitorSummary';
import { SessionMonitorTable } from '../../components/session/SessionMonitorTable';
import { SpeakingRightsPanel } from '../../components/session/SpeakingRightsPanel';
import {
  SessionPreJoinPreview,
  type PreJoinMediaPrefs,
} from '../../components/session/SessionPreJoinPreview';
import { SessionHostVideoView } from '../../components/session/SessionHostVideoView';
import { SessionParticipantCardGrid } from '../../components/session/SessionParticipantCardGrid';
// 개선 5: 무음 시그널 — 상단 집계 카운트(조용한 표시)
import { QuietSignalSummary } from '../../components/session/QuietSignalSummary';
// 개선 8: 그룹 익명 집계 상태 지표(적응형 페이싱) — 상담사 상단 단일 게이지
import '../../components/class/host-class-player.css';
import { type ClassAggregateEvent } from '../../lib/class/group-aggregate';
import {
  countSignals,
  isClassSignalType,
  pruneSignals,
  recordSignal,
  SIGNAL_ACTIVE_MS,
  type ActiveSignal,
} from '../../lib/class/quiet-signal';
// 개선 10: 명상 가이드·BGM 동기 재생 — 상담사 재생 패널(트랙 선택 + 재생 컨트롤 → class:audio_sync)
import { ClassAudioPanel } from '../../components/class/ClassAudioPanel';
// 개선 3 재설계: 입장 전 체크인 — 대기실 실시간 목록 + 세션 시작 카드
import { WaitingRoomReadinessPanel } from '../../components/class/waiting-room-readiness-panel';
import { CheckinSummary } from '../../components/class/CheckinSummary';
import { useWaitingRoomCount, type WaitingRoomEntry } from '../../hooks/useWaitingRoomCount';
import { useClassAudioPlayer } from '../../hooks/useClassAudioPlayer';
import { SessionParticipantDetailPanel } from '../../components/session/SessionParticipantDetailPanel';
import { StatusBadge } from '../../components/session/StatusBadge';
import { ClassChatPanel } from '../../components/chat/ClassChatPanel';
import { EndSessionModal } from '../../components/player/EndSessionModal';
import { LeaveGuardModal } from '../../components/player/LeaveGuardModal';
import { ReportProgressStepper } from '../../components/session/ReportProgressStepper';
import { useReportProgress } from '../../hooks/useReportProgress';
import {
  bandCardState,
  bandCardStateLabel,
  canShowCurrentMetrics,
  matchesMonitorFilter,
  isConnectionFailed,
  isStreamingLive,
  type ParticipantHistoryPoint,
} from '../../lib/session-live/metric-display';

const LIVE_METRICS_POLL_MS = 4000;
const SESSION_POLL_MS = 5000;
/** SDD-083: 상태 변화 시계열 누적 최소 간격 — 3초 평균 표시와 동일 리듬 */
const HISTORY_MIN_INTERVAL_MS = 3000;
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

/** live-metrics가 없을 때 세션 참가자로 테이블 행을 만든다 (시작 전 대기 표시) */
function participantsToMetrics(session: SessionDto): SessionLiveMetric[] {
  return session.participants
    .filter((p) => !p.is_waitlisted)
    .map((p, index) => ({
      participant_id: p.user_id ?? `guest-${index}-${p.guest_name ?? 'unknown'}`,
      display_name:
        p.user_name || p.guest_name || p.user_email || (p.is_guest ? '게스트' : '참가자'),
      is_guest: p.is_guest,
      band_connected: p.band_connected,
      device_status: null,
      band_battery: null,
      avg_efficiency: null,
      current_efficiency: null,
      upload_status: null,
      last_eeg_at: null,
      // SDD-094: 세션 상세에 실린 발언권 상태를 그대로 승계
      // (게스트 id 는 실제 participant_id 가 아니므로 부여/해제 버튼은 패널에서 막힌다)
      raise_hand: p.raise_hand ?? false,
      speaking: p.speaking ?? false,
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

type HostMetricKey = 'focus' | 'relaxation' | 'emotionalStability' | 'heartRate' | 'respiratoryRate' | 'hrv';
type HostValues = Record<HostMetricKey, number | null>;
interface HostExtra { at: number; focus: number | null; emotionalStability: number | null; hrv: number | null; heartRate: number | null; respiratoryRate: number | null }
interface HostPoint { at: number; values: HostValues }
const HOST_METRICS: { key: HostMetricKey; label: string; unit: string }[] = [
  { key: 'focus', label: '집중도', unit: '%' },
  { key: 'relaxation', label: '이완도', unit: '%' },
  { key: 'emotionalStability', label: '정서안정도', unit: '%' },
  { key: 'heartRate', label: 'BPM', unit: 'bpm' },
  { key: 'respiratoryRate', label: '호흡수', unit: '회/분' },
  { key: 'hrv', label: 'HRV(SDNN)', unit: 'ms' },
];
const finiteValue = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const hostValueLabel = (value: number | null): string => value === null ? '—' : String(Math.round(value));
function hostValues(row: SessionLiveMetric, extra?: HostExtra): HostValues {
  const valid = row.band_connected && canShowCurrentMetrics(row);
  const extraValid = valid && extra && Date.now() - extra.at < 10000;
  return {
    relaxation: valid ? finiteValue(row.current_efficiency) : null,
    // BPM·호흡수·HRV는 행(4초 폴링) 우선, extras(WS·마지막 유효값 hold) 폴백 —
    // 폴링이 WS 패치를 덮어도 깜빡이지 않는다.
    heartRate: valid ? finiteValue(row.heart_rate) ?? (extraValid ? extra.heartRate : null) : null,
    respiratoryRate: valid ? finiteValue(row.respiratory_rate) ?? (extraValid ? extra.respiratoryRate : null) : null,
    focus: extraValid ? extra.focus : null,
    emotionalStability: extraValid ? extra.emotionalStability : null,
    // MB2-09: HRV는 회원 화면과 동일한 SDNN 기준으로 통일한다(rmssd 혼용 금지).
    hrv: valid ? finiteValue(row.sdnn) ?? (extraValid ? extra.hrv : null) : null,
  };
}
interface HostParticipantProfile { demographics: string; concerns: string }
function hostParticipantProfile(row: SessionLiveMetric): HostParticipantProfile {
  const gender = row.gender === 'male' ? '남' : row.gender === 'female' ? '여' : row.gender === 'other' ? '기타' : '';
  let age = '';
  if (row.birth_date && /^\d{4}-\d{2}-\d{2}$/.test(row.birth_date)) {
    const [year, month, day] = row.birth_date.split('-').map(Number);
    // ISO 날짜의 UTC 해석으로 생일이 하루 이동하지 않도록 날짜 부분을 직접 비교한다.
    const birth = new Date(year, month - 1, day);
    const today = new Date();
    if (birth.getFullYear() === year && birth.getMonth() === month - 1 && birth.getDate() === day && birth <= today) {
      const beforeBirthday = today.getMonth() < month - 1 || (today.getMonth() === month - 1 && today.getDate() < day);
      age = `${today.getFullYear() - year - (beforeBirthday ? 1 : 0)}세`;
    }
  }
  return {
    demographics: [gender, age].filter(Boolean).join(' · '),
    concerns: row.is_guest ? '' : (row.concerns ?? []).join(' · '),
  };
}
function HostDemographics({ row }: { row: SessionLiveMetric }) {
  const { demographics } = hostParticipantProfile(row);
  return demographics ? <small className="hcp-demographics">{demographics}</small> : null;
}
function hostMean(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null);
  return valid.length ? valid.reduce((sum, v) => sum + v, 0) / valid.length : null;
}
function hostMissingLabel(row: SessionLiveMetric): string {
  const state = bandCardState(row);
  if (state === 'none') return '밴드 미사용';
  if (state === 'disconnected') return '수신 끊김';
  return row.device_status === 'lead_off' ? '접촉 확인' : '측정 대기';
}
function HostMetricDisplay({ metric, value, previous, series = [], average = null, detail = false, missingLabel = '표본 대기' }: {
  metric: typeof HOST_METRICS[number]; value: number | null; previous: number | null; series?: (number | null)[];
  average?: number | null; detail?: boolean; missingLabel?: string;
}) {
  const uid = useId();
  const dialGradientId = `${uid}-dial`;
  const barsGradientId = `${uid}-bars`;
  const mind = metric.unit === '%';
  const delta = value !== null && previous !== null ? Math.round(value - previous) : null;
  const change = value === null ? missingLabel : delta === null ? '추이 대기' : `${delta > 0 ? '+' : ''}${delta} · 3분대비`;
  const samples = series.slice(-20);
  const valid = samples.filter((v): v is number => v !== null);
  const domain = [...valid, ...(average === null ? [] : [average]), ...(value === null ? [] : [value])];
  const min = domain.length ? Math.min(...domain) : 0;
  const max = domain.length ? Math.max(...domain) : 1;
  const padding = Math.max((max - min) * .12, .5);
  const y = (v: number) => 58 - (v - min + padding) / (max - min + 2 * padding) * 52;
  // 게이지 0~100 정규화: 마음=백분율 그대로, 몸=최근 표본 범위 내 상대 위치(추이 그래프와 동일 스케일)
  const normalize = (v: number) => mind ? Math.max(0, Math.min(100, v)) : Math.max(0, Math.min(100, (v - min + padding) / (max - min + 2 * padding) * 100));
  const gauge = value === null ? null : normalize(value);
  const tickAngle = average === null ? null : (normalize(average) / 100 * 360 - 90) * Math.PI / 180;
  return <article className="hcp-metric">
    <p>{metric.label}</p>
    <div className="hcp-dial">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <defs><linearGradient id={dialGradientId} x1="0%" y1="100%" x2="100%" y2="0%"><stop stopColor="#5F0080" /><stop offset=".45" stopColor="#A16BBC" /><stop offset="1" stopColor="#D4B5E3" /></linearGradient></defs>
        <circle cx="60" cy="60" r="51" className="hcp-track" />
        {gauge !== null && <circle cx="60" cy="60" r="51" className="hcp-arc" style={{ stroke: `url(#${dialGradientId})` }} pathLength="100" strokeDasharray={`${gauge} 100`} transform="rotate(-90 60 60)" />}
        {detail && tickAngle !== null && <line className="hcp-tick" x1={60 + 47 * Math.cos(tickAngle)} y1={60 + 47 * Math.sin(tickAngle)} x2={60 + 55 * Math.cos(tickAngle)} y2={60 + 55 * Math.sin(tickAngle)} />}
      </svg>
      <span className="hcp-dial-num"><b>{hostValueLabel(value)}</b><small>{metric.unit}</small></span>
    </div>
    <svg className="hcp-bars" viewBox="0 0 240 64" preserveAspectRatio="none" aria-label={`${metric.label} 최근 수신 추이${average === null ? '' : `, 그룹 평균 ${hostValueLabel(average)}`}`}>
      <defs><linearGradient id={barsGradientId} gradientUnits="userSpaceOnUse" x1="0" y1="58" x2="0" y2="6"><stop stopColor="#5F0080" stopOpacity=".55" /><stop offset=".5" stopColor="#A16BBC" stopOpacity=".8" /><stop offset="1" stopColor="#D4B5E3" /></linearGradient></defs>
      {valid.length > 1 && <rect className="hcp-range-band" x="4" y={y(Math.max(...valid))} width="232" height={Math.max(1, y(Math.min(...valid)) - y(Math.max(...valid)))} rx="3" />}
      {average !== null && <path className="hcp-average-line" d={`M4 ${y(average)}H236`} />}
      <g style={{ fill: `url(#${barsGradientId})` }}>{samples.map((v, i) => v !== null && <rect key={i} x={4 + (20 - samples.length + i) * 11.6} y={y(v)} width={7.5} height={58 - y(v)} rx="3.75" />)}</g>
    </svg>
    {detail && average !== null && <small className="hcp-average-label">그룹 평균 {hostValueLabel(average)}</small>}
    <span className="hcp-delta">{change}</span>
  </article>;
}
export function HostClassWorkspace({ rows, extras, signals, aggregate, elapsed, running, left, tools, statusBar, filter, status = 'in_progress', audio, readinessPanel }: {
  rows: SessionLiveMetric[]; extras: Record<string, HostExtra>; signals: Record<string, ActiveSignal>;
  aggregate: ClassAggregateEvent | null; elapsed: number; running: boolean;
  status?: SessionStatus; audio?: ReactNode; readinessPanel?: ReactNode; left: ReactNode; tools: ReactNode; statusBar: ReactNode; filter: keyof MonitorSummaryCounts | null;
}) {
  const [metricKey, setMetricKey] = useState<HostMetricKey>('relaxation');
  const [sortKey, setSortKey] = useState<HostMetricKey>('relaxation');
  const [table, setTable] = useState(false);
  const [rotating, setRotating] = useState(true);
  const [manualSort, setManualSort] = useState<{ key: HostMetricKey; descending: boolean } | null>(null);
  const [phase, setPhase] = useState<'auto' | 'early' | 'late'>('auto');
  const [selected, setSelected] = useState<string | null>(null);
  const [ackAt, setAckAt] = useState(0);
  const [immersed, setImmersed] = useState(false);
  const [help, setHelp] = useState(false);
  const [history, setHistory] = useState<Record<string, HostPoint[]>>({});
  const sheetRef = useRef<HTMLElement>(null);
  const detailTriggerRef = useRef<HTMLElement | null>(null);
  const rosterRef = useRef<HTMLElement>(null);
  const rosterListRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number | null>(null);
  useEffect(() => {
    const list = rosterListRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (!window.matchMedia('(min-width: 761px)').matches) { setPageSize(null); return; }
      const { width, height } = entry.contentRect;
      const columns = Math.max(1, Math.floor((width + 8) / 182));
      const cardHeight = Number.parseFloat(getComputedStyle(list).getPropertyValue('--hcp-card-height')) || 152;
      setPageSize(table ? Math.max(1, Math.floor((height - 40) / 52)) : columns * Math.max(1, Math.floor((height + 8) / (cardHeight + 8))));
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [table]);
  const openDetail = (id: string, trigger: HTMLElement) => {
    detailTriggerRef.current = trigger;
    setSelected(id);
  };
  const counts = countSignals(signals, Date.now());
  const unread = Object.values(signals).filter(signal => signal.at > ackAt && Date.now() - signal.at < SIGNAL_ACTIVE_MS).length;
  useEffect(() => {
    if (selected && !rows.some(row => row.participant_id === selected)) setSelected(null);
  }, [rows, selected]);
  const late = phase === 'late' || (phase === 'auto' && elapsed >= 180);
  useEffect(() => {
    if (!rotating || table || selected) return;
    const timer = window.setInterval(() => setMetricKey(key => HOST_METRICS[(HOST_METRICS.findIndex(m => m.key === key) + 1) % HOST_METRICS.length].key), 10000);
    return () => window.clearInterval(timer);
  }, [rotating, table, selected]);
  useEffect(() => {
    if (!running) return;
    const now = Date.now();
    setHistory(previous => {
      const next = { ...previous };
      for (const row of rows) {
        const points = previous[row.participant_id] ?? [];
        const last = points.at(-1);
        if (last && now - last.at < HISTORY_MIN_INTERVAL_MS) continue;
        next[row.participant_id] = [...points.filter(p => now - p.at <= 190000), { at: now, values: hostValues(row, extras[row.participant_id]) }];
      }
      return next;
    });
  }, [rows, extras, running]);
  useEffect(() => {
    if (!selected) return;
    const previousFocus = detailTriggerRef.current;
    const sheet = sheetRef.current;
    sheet?.querySelector<HTMLButtonElement>('button')?.focus();
    // aria-modal에 맞게 플레이어 배경 전체를 비활성화하되 백드롭 닫기는 유지한다.
    const boundary = sheet?.closest('.host-class-player') ?? sheet?.closest('.hcp-workspace');
    const disabled: HTMLElement[] = [];
    let branch: HTMLElement | null = sheet;
    while (branch && branch !== boundary) {
      const parent: HTMLElement | null = branch.parentElement;
      for (const sibling of parent?.children ?? []) {
        if (sibling instanceof HTMLElement && sibling !== branch && !sibling.classList.contains('hcp-backdrop') && !sibling.hasAttribute('inert')) {
          sibling.setAttribute('inert', '');
          disabled.push(sibling);
        }
      }
      branch = parent;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null);
      if (event.key === 'Tab') {
        const elements = sheetRef.current?.querySelectorAll<HTMLElement>('button, [href], [tabindex="0"]');
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (!sheet?.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); disabled.forEach(element => element.removeAttribute('inert')); (previousFocus?.isConnected ? previousFocus : rosterRef.current?.querySelector<HTMLElement>('.hcp-toolbar button'))?.focus({ preventScroll: true }); };
  }, [selected]);
  const valuesFor = (row: SessionLiveMetric) => hostValues(row, extras[row.participant_id]);
  const previousFor = (row: SessionLiveMetric, key: HostMetricKey): number | null => {
    const points = history[row.participant_id] ?? [];
    const now = Date.now();
    if (!points.length || now - points[0].at < 180000) return null;
    const windowPoints = points.filter(p => now - p.at <= 180000 && now - p.at >= 3000);
    const valid = windowPoints.filter(p => p.values[key] !== null);
    // 일시적인 단절 이후의 짧은 표본을 3분 평균으로 표시하지 않는다.
    if (valid.length < 45) return null;
    return hostMean(valid.map(p => p.values[key]));
  };
  const ordered = rows.filter(row => matchesMonitorFilter(row, filter)).sort((a, b) => {
    if (table && !manualSort) return 0;
    const key = table && manualSort ? manualSort.key : sortKey;
    const sortValue = (row: SessionLiveMetric) => {
      const current = valuesFor(row)[key];
      if (table || !late || current === null) return current;
      const previous = previousFor(row, key);
      return previous === null ? null : current - previous;
    };
    const av = sortValue(a), bv = sortValue(b);
    if (av === null) return bv === null ? 0 : 1;
    if (bv === null) return -1;
    return (av - bv) * (table && manualSort?.descending ? -1 : 1);
  });
  const pageCount = pageSize === null ? 1 : Math.max(1, Math.ceil(ordered.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleRows = pageSize === null ? ordered : ordered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const selectedRow = rows.find(row => row.participant_id === selected);
  const validRows = rows.filter(row => row.band_connected && canShowCurrentMetrics(row));
  // 1명만 밴드를 착용해도 그룹 흐름에 현재값을 표시한다(소규모 1:1·그룹 대응).
  const minSample = 1;
  const groupAvailable = validRows.length >= minSample;
  const selectedMetric = HOST_METRICS.find(m => m.key === metricKey)!;
  const metricSections = (row?: SessionLiveMetric) => <div className="hcp-metric-sections">
    {[{ label: '마음', english: 'MIND', items: HOST_METRICS.slice(0, 3) }, { label: '몸', english: 'BODY', items: HOST_METRICS.slice(3) }].map(({ label, english, items }) => <section key={english}>
      <h3>{label} <small>{english}</small></h3><div className="hcp-metric-items">
        {items.map(metric => {
          const usable = groupAvailable ? validRows.filter(r => valuesFor(r)[metric.key] !== null) : [];
          const value = row ? valuesFor(row)[metric.key] : usable.length >= minSample ? hostMean(usable.map(r => valuesFor(r)[metric.key])) : null;
          const previous = row ? previousFor(row, metric.key) : usable.length >= minSample && usable.every(r => previousFor(r, metric.key) !== null) ? hostMean(usable.map(r => previousFor(r, metric.key))) : null;
          const series = row ? (history[row.participant_id] ?? []).map(p => p.values[metric.key]) : Array.from({ length: 20 }, (_, i) => usable.length >= minSample ? hostMean(usable.map(r => history[r.participant_id]?.at(i - 20)?.values[metric.key] ?? null)) : null);
          const average = usable.length >= minSample ? hostMean(usable.map(r => valuesFor(r)[metric.key])) : null;
          return <HostMetricDisplay key={metric.key} metric={metric} value={value} previous={previous} series={series} average={average} detail={Boolean(row)} missingLabel={row ? hostMissingLabel(row) : '표본 대기'} />;
        })}
      </div></section>)}
  </div>;
  return <section data-status={status} className={`hcp-workspace ${immersed ? 'hcp-immersed' : ''}`}>
    <div className="hcp-signals"><div className="hcp-heading"><h2>조용한 신호</h2><small>응답 {counts.total}·{rows.length}명</small></div><p className="hcp-muted">익명 · 최근 10초</p>
      {(['following', 'difficult', 'resting'] as const).map((key, i) => <div className="hcp-signal-row" key={key}><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="10" />{i === 0 ? <path d="m7 12 3 3 6-6" /> : i === 1 ? <path d="M9 9a3 3 0 1 1 4 3c-1 1-1 1-1 2m0 3h.01" /> : <path d="M9 8v8m6-8v8" />}</svg>{['잘 따라가요', '조금 어려워요', '잠시 쉴게요'][i]}</span><b className={counts[key] ? '' : 'hcp-zero'}>{counts[key]}</b></div>)}
    </div>
    <div className="hcp-notice">{unread > 0 && <button className="hcp-unread" onClick={() => setAckAt(Date.now())}><i />미확인 새 신호 {unread}건 ›</button>}<button onClick={() => setImmersed(v => !v)} aria-pressed={immersed}>{immersed ? '몰입 해제' : '몰입'}</button><button onClick={() => setHelp(v => !v)} aria-expanded={help}>사용 안내</button></div>
    {status === 'open' ? <div className="hcp-lobby-audio">{audio}</div> : <section className="hcp-group"><div className="hcp-heading"><div><h2>그룹 흐름</h2><p className="hcp-muted">지난 3분 평균 대비</p></div><small>유효 표본 {validRows.length}명{!groupAvailable && (validRows.length ? ' · 표본 적음' : ' · 표본 없음')}</small></div>{validRows.length ? metricSections() : <p className="hcp-group-empty" role="status">표본 없음<small>밴드 측정 데이터가 수신되면 그룹 흐름을 표시합니다.</small></p>}<p className="hcp-muted">{groupAvailable ? null : aggregate?.pace_hint}</p></section>}
    <aside className="hcp-host">{left}</aside>
    <section ref={rosterRef} className={`hcp-roster${status === 'open' && readinessPanel ? ' hcp-roster-with-readiness' : ''}`}>{status === 'open' && readinessPanel}<div className="hcp-heading"><h2>참가자 <small>{rows.length}</small></h2><small>발언 요청 {rows.filter(r => r.raise_hand).length} · 발언 중 {rows.filter(r => r.speaking).length}</small></div>
      {help && <div className="hcp-coach" role="status">지표는 10초마다 순환합니다. 칩을 선택하면 해당 지표로 정렬하며, 순환은 정렬 기준을 바꾸지 않습니다. 3분 미만은 현재값, 이후는 실제 3분 평균 대비 변화량 오름차순입니다. 카드나 참가자 이름을 누르면 상세를 볼 수 있습니다.<button onClick={() => setHelp(false)}>확인</button></div>}
      <div className="hcp-toolbar"><button aria-pressed={table} onClick={() => { setTable(true); setManualSort(null); }}>모두</button>{HOST_METRICS.map(m => <button key={m.key} aria-pressed={!table && metricKey === m.key} onClick={() => { setTable(false); setMetricKey(m.key); setSortKey(m.key); }}>{m.label}</button>)}</div>
      <div className="hcp-sort"><span>{table ? '헤더를 눌러 수동 정렬' : `${HOST_METRICS.find(m => m.key === sortKey)?.label} · ${late ? '3분 변화량' : '현재값'} 자동 정렬`}</span><button aria-pressed={rotating} onClick={() => setRotating(v => !v)} disabled={table}>10초 순환 {rotating ? '켜짐' : '꺼짐'}</button><select aria-label="정렬 시점" value={phase} onChange={e => setPhase(e.target.value as typeof phase)}><option value="auto">시간에 따라 자동</option><option value="early">3분 미만</option><option value="late">3분 이후</option></select></div>
      <div ref={rosterListRef} className="hcp-roster-list"><div className="hcp-roster-content" inert={Boolean(selectedRow)}>
        {!ordered.length && <p className="hcp-empty" role="status">{rows.length ? '선택한 상태의 참가자가 없습니다.' : (status === 'ready' || status === 'scheduled') ? '아직 클래스를 오픈하지 않았습니다. 오픈하면 회원이 입장할 수 있습니다.' : '아직 참가자가 없습니다. 입장하면 이곳에 표시됩니다.'}</p>}
        {!ordered.length ? null : table ? <div className="hcp-table-wrap"><table><thead><tr><th><button onClick={() => setManualSort(null)}>참가자 · 입장순</button></th>{HOST_METRICS.map(m => <th key={m.key} aria-sort={manualSort?.key === m.key ? manualSort.descending ? 'descending' : 'ascending' : 'none'}><button onClick={() => setManualSort(v => ({ key: m.key, descending: v?.key === m.key ? !v.descending : false }))}>{m.label}{manualSort?.key === m.key ? manualSort.descending ? ' ↓' : ' ↑' : ''}</button></th>)}</tr></thead><tbody>{visibleRows.map(row => <tr key={row.participant_id} onClick={event => openDetail(row.participant_id, event.currentTarget.querySelector<HTMLButtonElement>('button')!)}><th scope="row"><button className="hcp-table-person">{row.display_name}<HostDemographics row={row} /></button></th>{HOST_METRICS.map(m => <td key={m.key}>{valuesFor(row)[m.key] === null ? <small>{hostMissingLabel(row)}</small> : <>{hostValueLabel(valuesFor(row)[m.key])}<small>{m.unit}</small></>}</td>)}</tr>)}</tbody></table></div> : <div className="hcp-people">{visibleRows.map(row => {
          const value = valuesFor(row)[metricKey], previous = previousFor(row, metricKey);
          const delta = value !== null && previous !== null ? Math.round(value - previous) : null;
          const bandLabel = row.device_status === 'lead_off' ? '접촉 확인 · 리드오프' : bandCardState(row) === 'disconnected' ? '수신 끊김' : bandCardStateLabel(bandCardState(row));
          return <button className={`hcp-person${value === null ? ' hcp-unmeasured' : ''}`} key={row.participant_id} aria-pressed={selected === row.participant_id} aria-label={`${row.display_name} ${selectedMetric.label} 상세 보기`} onClick={event => openDetail(row.participant_id, event.currentTarget)}>
            <span className="hcp-person-top"><span className="hcp-person-name">{row.display_name}</span><HostDemographics row={row} /><i className={`hcp-dot ${bandCardState(row)}`} role="img" aria-label={bandLabel} title={bandLabel} /></span>
            <span className="hcp-person-label">{selectedMetric.label}<span>{row.speaking ? '발언 중' : row.raise_hand ? '발언 요청' : ''}</span></span>
            <span className="hcp-value-row"><span className="hcp-person-value">{hostValueLabel(value)}<small>{selectedMetric.unit}</small></span><span className="hcp-person-change">{value === null ? hostMissingLabel(row) : delta === null ? '추이 대기' : `${delta > 0 ? '+' : ''}${delta}`}<small>{delta !== null && ' 3분대비'}</small></span></span>
            <span className="hcp-band">{bandLabel}{isLowBattery(row.band_battery) && ' · 배터리 부족'}</span>
          </button>;
        })}</div>}
      </div>
      {selectedRow && <><button className="hcp-backdrop" aria-label="참가자 상세 닫기" tabIndex={-1} onClick={() => setSelected(null)} /><aside ref={sheetRef} className="hcp-sheet" role="dialog" aria-modal="true" aria-labelledby="hcp-detail-title"><header className="hcp-heading"><div><h2 id="hcp-detail-title">{selectedRow.display_name}<HostDemographics row={selectedRow} /></h2><p className="hcp-muted">{bandCardState(selectedRow) === 'connected' ? '밴드 연결됨' : hostMissingLabel(selectedRow)} · 접촉 {contactStatusLabel(selectedRow.device_status)} · 신호 {signalQualityLevelLabel(selectedRow.signal_quality_level ?? signalQualityLevel(selectedRow.signal_quality))}</p></div><button onClick={() => setSelected(null)}>닫기</button></header><div className="hcp-sheet-content">{hostParticipantProfile(selectedRow).concerns && <section className="hcp-survey"><h3>사전 설문</h3><p>{hostParticipantProfile(selectedRow).concerns}</p></section>}{metricSections(selectedRow)}<div className="hcp-body-legend" aria-label="몸 추이 범례"><span><svg viewBox="0 0 20 8" aria-hidden="true"><path className="hcp-average-line" d="M0 4H20" /></svg>그룹 평균</span><span><svg viewBox="0 0 20 8" aria-hidden="true"><rect className="hcp-range-band" width="20" height="8" /></svg>최근 수신 범위</span></div></div><footer className="hcp-legend" aria-label="지표 범례">링: 현재값 · 막대: 최근 수신값 · 증감: 3분 대비</footer></aside></>}
      </div><div className="hcp-roster-foot">{table ? '모두 · 테이블 보기' : `${selectedMetric.label} · ${rotating ? '10초 순환' : '순환 정지'}`}<nav className="hcp-pagination" aria-label="참가자 페이지"><button aria-label="이전 참가자 페이지" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>‹</button><span>{currentPage + 1} / {pageCount}</span><button aria-label="다음 참가자 페이지" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>›</button></nav><span>개인 순위 없음</span></div>
      <details className="hcp-tools"><summary>연결 상태 · 발언권 · 호스트 밴드</summary>{statusBar}{tools}</details>
    </section>
  </section>;
}

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
  const [session, setSession] = useState<SessionDto | null>(null);
  // FE-PERF-002: setSession 업데이터 내부에서 setMetrics 를 호출하면 updater 가 부수효과를
  // 갖게 된다(StrictMode 이중 호출 위험). 최신 세션은 ref 로 읽어 updater 밖에서 갱신한다.
  const sessionRef = useRef<SessionDto | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  const [metrics, setMetrics] = useState<SessionLiveMetric[]>([]);
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
  const [mediaOpen, setMediaOpen] = useState(false);
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
  const [mediaPrefs, setMediaPrefs] = useState<PreJoinMediaPrefs>({
    cameraOn: true,
    micOn: true,
  });
  const [codeCopied, setCodeCopied] = useState(false);
  /** SDD-094: 발언권 부여/해제 요청 진행 중인 participant_id */
  const [speakingBusyId, setSpeakingBusyId] = useState<string | null>(null);
  /** SDD-095: 상담사 채팅 토글 요청 진행 중 */
  const [chatBusy, setChatBusy] = useState(false);
  /** SDD-095: 채팅 패널 접힘 여부 — 켜면 펼치고 사용자가 접을 수 있다 */
  const [chatExpanded, setChatExpanded] = useState(false);
  /** (B) 세션 시작 카드 — 대기실에서 받은 입장 전 체크인을 라이브 전환 후에도 유지 */
  const retainedCheckinsRef = useRef<Map<string, WaitingRoomEntry>>(new Map());
  const [sessionCheckins, setSessionCheckins] = useState<WaitingRoomEntry[]>([]);
  const [checkinCardDismissed, setCheckinCardDismissed] = useState(false);

  const liveKit = useLiveKit(id);
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);
  const isHost = Boolean(session && currentUserId && session.host_id === currentUserId);

  const recorder = useAudioRecorder({
    sessionId: id ?? '',
    onError: (err) => setError(err.message),
  });

  // SDD-084/085: 상담사 본인 카메라 영상 녹화 — 마이크 오프 세션은 무음 영상
  const videoRecorder = useVideoRecorder({
    sessionId: id ?? '',
    withAudio: mediaPrefs.micOn,
    onError: (err) => setError(err.message),
  });

  /** 호스트 본인 참가자 id — live-metrics 행의 user_id 매칭 */
  const hostParticipantId = useMemo(() => {
    if (!currentUserId) return null;
    const fromMetrics = metrics.find((m) => m.user_id === currentUserId);
    if (fromMetrics) return fromMetrics.participant_id;
    return null;
  }, [currentUserId, metrics]);

  const band = useBand({
    sessionId: id ?? '',
    participantId: hostParticipantId,
    enabled: Boolean(id && hostParticipantId),
  });

  const handleLiveFeature = useCallback(
    (event: SessionLiveEegFeatureEvent) => {
      if (!id || event.session_id !== id) return;
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
      const at = event.last_eeg_at ? Date.parse(event.last_eeg_at) : event.feature?.timestamp ?? now;
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
    [id],
  );

  const handleSnapshot = useCallback((snap: SessionLiveJoinSnapshot) => {
    if (snap.participants?.length) {
      setMetrics(scoreServerRows(snap.participants));
    }
    if (snap.status) {
      setSession((prev) =>
        prev ? { ...prev, status: snap.status as SessionStatus } : prev,
      );
    }
  }, []);

  const handleSessionState = useCallback(
    (event: SessionStateChangedEvent) => {
      if (!id || event.session_id !== id) return;
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
    [id],
  );

  const handleParticipantChanged = useCallback(
    (event: ParticipantChangedEvent) => {
      if (!id || event.session_id !== id) return;
      if (event.participants && event.participants.length > 0) {
        setMetrics(scoreServerRows(event.participants));
      }
    },
    [id],
  );

  const handleDeviceStatus = useCallback(
    (event: DeviceStatusChangedEvent) => {
      if (!id || event.session_id !== id) return;
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
    [id],
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
        const res = await setParticipantSpeaking(id, participantId, granted);
        recordSpeaking(res.participant_id ?? participantId, res.speaking, res.raise_hand);
      } catch (e) {
        setError(e instanceof Error ? e.message : '발언권 변경에 실패했습니다');
      } finally {
        setSpeakingBusyId(null);
      }
    },
    [id, recordSpeaking],
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
      setError(e instanceof Error ? e.message : '채팅 설정 변경에 실패했습니다');
    } finally {
      setChatBusy(false);
    }
  }, [id, chatEnabled]);

  // ── 개선 5: 무음 시그널 ──────────────────────────────────────────
  // 회원이 발언권 없이 보낸 상태 신호(휘발성)를 참여자별 최신 1건으로 보관한다.
  // 카드 배지는 CSS 페이드(수 초)로 사라지고, 상단에는 유형별 집계만 남는다.
  const [quietSignals, setQuietSignals] = useState<Record<string, ActiveSignal>>({});

  const handleQuietSignal = useCallback(
    (event: ClassSignalEvent) => {
      if (!id || (event.session_id && event.session_id !== id)) return;
      if (!event.participant_id || !isClassSignalType(event.signal_type)) return;
      const at = Date.now();
      setQuietSignals((prev) => recordSignal(prev, event.participant_id, event.signal_type, at));
    },
    [id],
  );

  // TTL(10초)이 지난 신호는 카드·집계에서 제거한다 — 변화가 없으면 상태 참조가 유지되어 리렌더가 없다.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setQuietSignals((prev) => pruneSignals(prev, Date.now(), SIGNAL_ACTIVE_MS));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  /** 상단 집계 — 활성(TTL 이내) 신호만 유형별로 센다 */
  const quietSignalCounts = useMemo(
    () => countSignals(quietSignals, Date.now(), SIGNAL_ACTIVE_MS),
    [quietSignals],
  );

  // ── 개선 8: 그룹 익명 집계(적응형 페이싱) ─────────────────────────
  // 상담사에게만 오는 집계(개인 점수 없음)를 그대로 게이지에 반영한다 — 가공·재계산하지 않는다.
  // 세션 id 를 함께 보관해, 세션이 바뀌면 이전 세션의 집계를 렌더하지 않는다
  // (효과에서 상태를 되돌리는 대신 파생값으로 처리 — 불필요한 리렌더·연쇄 렌더 회피).
  const [aggregatePayload, setAggregatePayload] = useState<{
    sessionId: string;
    event: ClassAggregateEvent;
  } | null>(null);

  const handleClassAggregate = useCallback<ClassAggregateEventHandler>(
    (event) => {
      if (!id) return;
      if (event.session_id && event.session_id !== id) return;
      setAggregatePayload({ sessionId: id, event });
    },
    [id],
  );

  const groupAggregate =
    aggregatePayload && aggregatePayload.sessionId === id ? aggregatePayload.event : null;

  const liveSocket = useSessionLiveSocket({
    sessionId: id,
    participantId: hostParticipantId,
    enabled: Boolean(id && session),
    onEegFeature: handleLiveFeature,
    onSnapshot: handleSnapshot,
    onSessionStateChanged: handleSessionState,
    onParticipantChanged: handleParticipantChanged,
    onDeviceStatusChanged: handleDeviceStatus,
    onSpeakingChanged: handleSpeakingChanged,
    onClassSignal: handleQuietSignal,
    onClassAggregate: handleClassAggregate,
  });

  const refreshSession = useCallback(async (): Promise<void> => {
    if (!id) return;
    try {
      const next = await getSession(id);
      setSession(next);
      // 폴링 재시도 성공 시 이전 오류 문구를 지운다(에러 복구)
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '세션을 불러오지 못했습니다');
    }
  }, [id]);

  const refreshMetrics = useCallback(async (): Promise<void> => {
    if (!id) return;
    try {
      const res = await getSessionLiveMetrics(id);
      setMetrics(scoreServerRows(res.metrics ?? res.participants ?? []));
    } catch {
      // FE-PERF-002: sessionRef 에서 최신 세션을 읽어 setMetrics 를 직접 호출한다.
      const current = sessionRef.current;
      if (current) setMetrics(participantsToMetrics(current));
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    void refreshSession();
    const timer = window.setInterval(() => {
      void refreshSession();
    }, SESSION_POLL_MS);
    return () => window.clearInterval(timer);
  }, [id, refreshSession]);

  // SDD-021: 폴링은 항상 유지(안전망) — WS 실시간은 트리거로 즉시 갱신
  useEffect(() => {
    if (!id || !session) return undefined;
    void refreshMetrics();
    const timer = window.setInterval(() => {
      void refreshMetrics();
    }, LIVE_METRICS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [id, session?.status, refreshMetrics]);

  const status: SessionStatus | null = session?.status ?? null;
  const isSetup = status === 'ready' || status === 'scheduled';
  const isLobby = status === 'open';
  const isRunning = status === 'in_progress';
  const isEnded = status === 'completed';
  const isCancelled = status === 'cancelled';

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
    enabled: Boolean(id && isHost && isLobby),
    publish: liveSocket.sendAudioSync,
  });

  // 대기·진행 중 화면 꺼짐 방지 (회원 immersive 와 동일 정책)
  useWakeLock(isLobby || isRunning);

  // 개선 3: 회원 대기실(입장 전 준비) 인원 — 대기실 씬에서만 구독한다
  const waitingRoom = useWaitingRoomCount({ sessionId: id, enabled: Boolean(id && isLobby) });

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

  /** 클래스 오픈 — 세팅 씬 확정: 미디어 조합 보관 + open 전이 */
  const openClass = async (prefs: PreJoinMediaPrefs): Promise<void> => {
    if (!id) return;
    setMediaPrefs(prefs);
    setTransitioning(true);
    setError(null);
    try {
      const updated = await transitionSession(id, 'open');
      setSession(updated);
      await refreshMetrics();
    } catch (e) {
      setError(e instanceof Error ? e.message : '클래스 오픈에 실패했습니다');
    } finally {
      setTransitioning(false);
    }
  };

  /** 시작하기 — 대기실 씬 확정: start 전이 (+마이크 오프 선언) */
  const startClass = async (): Promise<void> => {
    if (!id) return;
    setTransitioning(true);
    setError(null);
    try {
      const updated = await transitionSession(id, 'start');
      setSession(updated);
      // 클래스 시작 즉시 화상 연결 — 상담사 영상·음성 라이브 송출 (녹화·장소유형과 무관)
      liveKit.connect();
      // SDD-085: 마이크 오프 결정을 서버에 선언 — consent_audio=false → status='manual'
      if (!mediaPrefs.micOn) {
        try {
          await startAudio(id, false);
        } catch (e) {
          setError(`수동 기록 모드 선언 실패: ${(e as Error).message}`);
        }
      }
      await refreshMetrics();
      const recordAudio = updated.record_audio !== false;
      const recordVideo = updated.record_video !== false;
      // 클래스 시작 직후 자동 녹음/녹화 (record_audio/record_video 기본 On)
      if (recordAudio && mediaPrefs.micOn) {
        setConsentOpen(true);
      } else if (recordVideo && mediaPrefs.cameraOn) {
        // 음성 녹화 Off + 영상 On → 영상만 즉시 시작
        await handleVideoOnlyStart();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '클래스 시작에 실패했습니다');
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
      const updated = await transitionSession(id, 'cancel');
      setSession(updated);
      if (leaveAfter) {
        bypassGuardRef.current = true;
        navigate('/sessions');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '클래스 닫기에 실패했습니다');
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
      await transitionSession(id, 'end');
      setEndModalOpen(false);
      bypassGuardRef.current = true;
      navigate(leaveTo ?? `/sessions/${id}/record`);
    } catch (e) {
      // SDD-101 D3: 종료 확정 실패 — 에러 + 재시도 CTA(미디어는 이미 stop 되어 있어 재시도 시 handleStop 생략됨)
      setError((e as Error).message);
      setEndFailed(true);
    } finally {
      setTransitioning(false);
    }
  };

  const startedAtMs = useMemo(() => recordingStartedAt ?? Date.now(), [recordingStartedAt]);

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
  }, [session?.started_at]);

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
  }, [recordingStartedAt]);

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
  }, [isLobby, session?.opened_at]);

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
    const base = speakingMetrics;

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
        current_efficiency: band.currentEfficiency ?? row.current_efficiency,
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
    speakingMetrics,
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

  const activeCount = useMemo(
    () => (session?.participants ?? []).filter((p) => !p.is_waitlisted).length,
    [session],
  );

  // 그룹 수업은 참가자 ≥1 시 시작 가능. 1:1은 오픈→시작 연타 허용(강제 대기 없음, SDD-088).
  const canStart =
    isLobby &&
    !transitioning &&
    (session?.participant_mode !== 'group' || activeCount >= 1);
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

  if (!session && error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#12081C] p-6">
        <div
          role="alert"
          className="w-full max-w-md space-y-4 rounded-2xl border border-[#F5C2C0] bg-[#FDECEC] p-5 text-sm text-[#B3261E]"
        >
          <p className="font-semibold">클래스에 입장하지 못했습니다</p>
          <p className="break-words">{error}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void refreshSession()} className="mb-btn text-sm">
              다시 시도
            </button>
            <button
              type="button"
              onClick={() => navigate('/sessions')}
              className="mb-btn mb-btn--ghost text-sm"
            >
              목록으로
            </button>
          </div>
        </div>
      </main>
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

  /* ─── 씬별 상단 컨트롤 (상태 전이 버튼은 플레이어 안에만 존재) ───
     모바일에서는 버튼이 3줄로 접히며 헤더를 잠식하므로, 좁은 화면에서는
     한 줄 가로 스크롤(flex-nowrap + overflow-x-auto)로 유지하고 라벨은 감춘다(아이콘만). */
  const headerControls = isHost ? (
    <div className="flex w-full flex-nowrap items-center gap-2 overflow-x-auto pb-0.5 sm:w-auto sm:flex-wrap sm:overflow-visible sm:pb-0">
      {isSetup && (
        <button
          type="button"
          onClick={() => void openClass(mediaPrefs)}
          disabled={transitioning}
          aria-label={transitioning ? '오픈 중' : '클래스 오픈'}
          className="mb-btn shrink-0 whitespace-nowrap gap-1.5 disabled:cursor-not-allowed"
        >
          <span aria-hidden="true">🔓</span>
          <span className="hidden sm:inline">{transitioning ? '오픈 중...' : '클래스 오픈'}</span>
        </button>
      )}
      {isLobby && (
        <>
          <button
            type="button"
            onClick={() => void closeClass(false)}
            disabled={transitioning}
            aria-label="클래스 닫기"
            className="mb-btn mb-btn--ghost shrink-0 whitespace-nowrap gap-1.5 !text-white/80 hover:!text-white"
          >
            <span aria-hidden="true">✕</span>
            <span className="hidden sm:inline">클래스 닫기</span>
          </button>
          <button
            type="button"
            onClick={() => void startClass()}
            disabled={!canStart}
            aria-label={transitioning ? '시작 중' : '클래스 시작하기'}
            title={
              !canStart && !transitioning
                ? '참가자 1명 이상 입장 후 시작할 수 있습니다'
                : undefined
            }
            className="mb-btn shrink-0 whitespace-nowrap gap-1.5 disabled:cursor-not-allowed"
          >
            <span aria-hidden="true">▶</span>
            <span className="hidden sm:inline">{transitioning ? '시작 중...' : '시작하기'}</span>
          </button>
        </>
      )}
      {isRunning && (
        <>
          <button
            type="button"
            onClick={() => setEndModalOpen(true)}
            disabled={transitioning}
            aria-label="클래스 종료"
            className="mb-btn mb-btn--soft shrink-0 whitespace-nowrap gap-1.5 disabled:cursor-not-allowed"
          >
            <span aria-hidden="true">■</span>
            <span className="hidden sm:inline">클래스 종료</span>
          </button>
        </>
      )}
      {/* SDD-095: 클래스 채팅 토글 — 대기실·진행 중에만 노출(상담사 전용) */}
      {(isLobby || isRunning) && (
        <button
          type="button"
          onClick={() => void handleToggleChatEnabled()}
          disabled={chatBusy || transitioning}
          aria-pressed={chatEnabled}
          aria-label={chatBusy ? '채팅 상태 변경 중' : chatEnabled ? '채팅 끄기' : '채팅 켜기'}
          className={`mb-btn shrink-0 whitespace-nowrap gap-1.5 disabled:cursor-not-allowed ${
            chatEnabled ? '' : 'mb-btn--ghost !text-white/80 hover:!text-white'
          }`}
        >
          <span aria-hidden="true">{chatEnabled ? '💬' : '🚫'}</span>
          <span className="hidden sm:inline">
            {chatBusy ? '변경 중...' : chatEnabled ? '채팅 끄기' : '채팅 켜기'}
          </span>
        </button>
      )}
    </div>
  ) : null;

  /* ─── 서버 연결 + 스트리밍 상태 바 — 참여자 요약 상단 상시 표시 ─── */
  const liveStatusBar = (
    <div className="flex flex-wrap items-center gap-2">
      {/* 서버(WebSocket) 연결 상태 — 끊겨도 4초 폴링 안전망은 유지된다 */}
      {liveSocket.isConnected ? (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold ${
            liveSocket.isReady
              ? 'bg-[#59CE9026] text-[#2F9E68]'
              : 'bg-amber-100 text-amber-700'
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              liveSocket.isReady ? 'bg-[#2F9E68]' : 'animate-pulse bg-amber-500'
            }`}
          />
          {liveSocket.isReady ? '서버 실시간 연결됨' : '서버 연결 중 · 동기화 대기'}
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
            signals={quietSignals}
          />
        ) : (
          <SessionMonitorTable participants={displayMetrics} filter={activeFilter} />
        )}
      </div>


    </div>
  );

  /* ─── 라이브 좌측 — 호스트 상태 패널: 타이머 · 마이크/카메라 · AI 분석 ─── */
  const isAnalyzing =
    mediaPrefs.micOn && (recorder.state === 'recording' || recorder.state === 'paused');
  const hostStatusPanel = (
    <div className="rounded-2xl bg-white/5 p-4">
      <p className="text-xs text-white/50">
        진행 시간
      </p>
      <p className="mt-1 font-mono text-4xl font-bold tabular-nums text-white">
        {elapsedLabel(classElapsedSec)}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {/* 음성 녹음 상태 — 실시간 */}
        {!mediaPrefs.micOn ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-xs font-medium text-white/50">
            🔇 마이크 OFF · 녹음 없음
          </span>
        ) : recorder.state === 'recording' ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#B3261E]/40 px-3 py-1.5 text-xs font-semibold text-[#FFB3B0]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#F22121]" />
            녹음 중 · {elapsedLabel(recordingElapsedSec)}
          </span>
        ) : recorder.state === 'paused' ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100/20 px-3 py-1.5 text-xs font-semibold text-amber-300">
            ⏸️ 녹음 일시정지
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white">
            🎙️ 녹음 대기
          </span>
        )}
        {/* 카메라/영상 녹화 상태 — 실시간 */}
        {!mediaPrefs.cameraOn ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-xs font-medium text-white/50">
            🎥 카메라 OFF
          </span>
        ) : videoRecorder.state === 'recording' ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#B3261E]/40 px-3 py-1.5 text-xs font-semibold text-[#FFB3B0]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#F22121]" />
            영상 녹화 중 · {elapsedLabel(recordingElapsedSec)}
          </span>
        ) : videoRecorder.state === 'paused' ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100/20 px-3 py-1.5 text-xs font-semibold text-amber-300">
            ⏸️ 영상 일시정지
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white">
            🎥 카메라 ON
          </span>
        )}
        {!mediaPrefs.micOn ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-xs font-medium text-white/50">
            AI 분석 없음 (마이크 꺼짐)
          </span>
        ) : isAnalyzing ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#5F0080]/60 px-3 py-1.5 text-xs font-semibold text-[#E9D5FF]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#C084FC]" />
            AI 분석중
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#5F0080]/25 px-3 py-1.5 text-xs font-medium text-[#D8B4FE]">
            AI 분석 대기 · 녹음 시작 시 분석
          </span>
        )}
      </div>
    </div>
  );

  return (
    <main className={`min-h-screen bg-[#12081C] pb-10 ${isHost ? `host-class-player${isLobby || isRunning ? ' hcp-active' : ''}` : ''}`}>
      {/* 플레이어 헤더 — 풀스크린 셸 (AppShell 밖) */}
      <header className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-white/10 bg-[#12081C]/95 px-4 py-3 backdrop-blur sm:flex-nowrap sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/sessions')}
            className="shrink-0 rounded-xl bg-white/10 h-11 px-4 text-sm font-medium text-white/80 transition hover:bg-white/20 hover:text-white"
          >
            ← 나가기
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
        {headerControls}
      </header>

      <div className="hcp-page-content mx-auto mt-4 max-w-7xl space-y-3 px-4 sm:px-6">
        {/* (B) 세션 시작 — 입장 전 체크인 요약 카드(닫기 가능) */}
        {isRunning && isHost && sessionCheckins.length > 0 && !checkinCardDismissed && (
          <div className="hcp-checkin-card rounded-2xl border border-[#5F0080]/30 bg-[#5F0080]/10 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-white">
                  입장 전 체크인 · {sessionCheckins.length}명
                </h3>
                <p className="mt-1 text-xs text-white/60">
                  회원이 입장 전에 남긴 기분·전달 말입니다. 세션 진행에 참고해 주세요.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCheckinCardDismissed(true)}
                aria-label="체크인 카드 닫기"
                className="shrink-0 rounded-lg px-2 py-1 text-xs text-white/60 hover:bg-white/10"
              >
                닫기
              </button>
            </div>
            <ul className="mt-3 space-y-2">
              {sessionCheckins.map((entry) => (
                <li key={entry.participantId} className="rounded-xl bg-black/20 p-3">
                  <p className="text-sm font-semibold text-white">
                    {entry.nickname ?? '참가자'}
                  </p>
                  {entry.checkin && (
                    <div className="mt-1.5">
                      <CheckinSummary
                        arousal={entry.checkin.arousal}
                        valence={entry.checkin.valence}
                        emotion={entry.checkin.emotion}
                        note={entry.checkin.note}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {isHost && (isSetup || isLobby || isRunning) && <HostClassWorkspace
          rows={displayMetrics} extras={hostExtras} signals={quietSignals} aggregate={groupAggregate}
          elapsed={classElapsedSec} running={isRunning} statusBar={liveStatusBar} filter={activeFilter}
          tools={<><SessionMonitorSummary counts={summary} activeFilter={activeFilter} onFilterToggle={handleFilterToggle} />
            {speakingManaged && <SpeakingRightsPanel participants={displayMetrics} busyId={speakingBusyId} onGrant={pid => void handleSetSpeaking(pid, true)} onRevoke={pid => void handleSetSpeaking(pid, false)} />}
      {/* 호스트 LINK BAND — 보조 영역 */}
      {isHost && (
        <div className="flex flex-col gap-3 rounded-xl bg-[#F2F3F8] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#1F1F1F]">LINK BAND (호스트)</p>
            <p className="mt-1 text-sm text-[#6F6F6F]">
              {band.connectionState === 'connected'
                ? `연결됨 · 배터리 ${band.battery !== null ? `${Math.round(band.battery)}%` : '—'} · 접촉 ${contactStatusLabel(band.deviceStatus)} · 신호 ${signalQualityLevelLabel(band.signalQualityLevel)}`
                : band.connectionState === 'disconnected'
                  ? '연결이 끊어졌습니다 · 재연결하세요'
                  : band.connectionState === 'unsupported'
                    ? '이 브라우저는 Web Bluetooth를 지원하지 않습니다 (Chrome/Edge 권장)'
                    : '호스트 밴드를 연결하면 본인 행에 실시간 지표가 표시됩니다'}
            </p>
            {band.error && <p className="mt-1 text-xs text-[#B3261E]">{band.error}</p>}
          </div>
          <div className="flex gap-2">
            {band.connectionState !== 'connected' ? (
              <button
                type="button"
                onClick={() => void band.connect()}
                disabled={
                  !band.isSupported ||
                  !hostParticipantId ||
                  band.connectionState === 'connecting'
                }
                className="mb-btn disabled:cursor-not-allowed"
              >
                {band.connectionState === 'connecting'
                  ? '연결 중...'
                  : band.connectionState === 'disconnected'
                    ? '재연결'
                    : band.isMock
                      ? '시뮬레이션 시작'
                      : '밴드 연결'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void band.disconnect()}
                className="mb-btn mb-btn--ghost"
              >
                연결 해제
              </button>
            )}
          </div>
        </div>
      )}
          </>}
          status={session.status}
          readinessPanel={isLobby && id ? <WaitingRoomReadinessPanel sessionId={id} entries={waitingRoom.entries} isConnected={liveSocket.isConnected} /> : undefined}
          audio={isLobby ? <ClassAudioPanel state={audioPlayer.state} actions={audioPlayer.actions} enabled={isLobby} connected={liveSocket.isConnected} /> : undefined}
          left={isSetup ? (
            <SessionPreJoinPreview
              dark
              onStart={(prefs) => void openClass(prefs)}
              starting={transitioning}
              canStart={!transitioning}
              startLabel="클래스 오픈"
              compact
              onPrefsChange={setMediaPrefs}
            />
          ) : (<>
            <div className="hcp-media-controls" role="group" aria-label="호스트 미디어 제어">
              <button disabled={!isRunning || !mediaPrefs.micOn} onClick={() => {
                if (recorder.state === 'recording') { recorder.pause(); videoRecorder.pause(); }
                else if (recorder.state === 'paused') { recorder.resume(); videoRecorder.resume(); }
                else handleStartClick();
              }} aria-pressed={recorder.state === 'recording'}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" /></svg><span>{recorder.state === 'recording' ? '녹음 일시정지' : recorder.state === 'paused' ? '녹음 재개' : '녹음 시작'}</span></button>
              <button disabled={!isRunning || !mediaPrefs.cameraOn || mediaPrefs.micOn} onClick={() => void (videoRecorder.state === 'recording' || videoRecorder.state === 'paused' ? handleVideoOnlyStop() : handleVideoOnlyStart())} aria-pressed={videoRecorder.state === 'recording'} title={mediaPrefs.micOn ? '영상은 음성 녹음과 함께 제어됩니다' : '무음 영상 녹화 제어'}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="13" height="14" rx="2" /><path d="m15 9 7-4v14l-7-4" /></svg><span>영상 녹화 {videoRecorder.state === 'recording' ? '중' : '대기'}</span></button>
              <span>마이크 {mediaPrefs.micOn ? 'ON' : 'OFF'} · 카메라 {mediaPrefs.cameraOn ? 'ON' : 'OFF'}</span>
            </div>
            {isRunning && <button className="hcp-media-link" onClick={() => setMediaOpen(v => !v)} aria-expanded={mediaOpen}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 22V3h14l-3 5 3 5H5" /></svg><span>녹음 · 화상 · 마커</span><span>{mediaOpen ? '접기' : '설정'}</span></button>}
            <div className="hcp-selfview"><p>나의 화면 · 호스트</p>{mediaPrefs.cameraOn ? <SessionHostVideoView stream={videoRecorder.stream} facingMode={videoRecorder.facingMode} recording={videoRecorder.state === 'recording'} /> : <div className="hcp-camera-off">카메라 꺼짐 · 녹화 안 함</div>}</div>
            {isLobby && <div className="hcp-code"><small>클래스 코드 · 대기 {elapsedLabel(lobbyElapsedSec)}</small><strong>{accessCode || '——————'}</strong><button onClick={() => void handleCopyCode()}>{codeCopied ? '복사 완료' : '코드 복사'}</button></div>}
            <div className="hcp-timer"><p>함께한 시간</p><strong>{elapsedLabel(classElapsedSec)}</strong><small> / {session.duration_min}분</small><progress aria-label="클래스 진행" value={classElapsedSec} max={Math.max(1, session.duration_min * 60)} /></div>
            <details><summary>녹화 · AI 상태</summary>{hostStatusPanel}</details>
          </>)}
        />}
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

        {/* ③ 라이브 씬 보조 — 녹음 / 화상 / 마커 (접기) */}
        {isRunning && isHost && (
          <div className={`hcp-media-panel rounded-xl bg-white ${mediaOpen ? 'is-open' : ''}`}>
            <button
              type="button"
              onClick={() => setMediaOpen((v) => !v)}
              className="flex w-full items-center justify-between px-5 py-4 text-left sm:px-6"
            >
              <span className="text-[12px] font-mono uppercase tracking-wider text-[#6F6F6F]">
                녹음 / 화상 / 마커
              </span>
              <span className="text-sm text-[#5F0080]">{mediaOpen ? '접기' : '펼치기'}</span>
            </button>

            <div className={`space-y-5 border-t border-[#EFEFEF] px-5 pb-6 pt-5 sm:px-6 ${mediaOpen ? '' : 'hidden'}`}>
                <div>
                  <div className="mb-3 text-[12px] font-mono uppercase tracking-wider text-[#6F6F6F]">
                    화상 회의
                  </div>
                  {liveKit.loading && (
                    <div className="flex min-h-[400px] items-center justify-center rounded-2xl bg-[#111]">
                      <p className="text-sm text-[#9CA3AF]">화상 회의 연결 중...</p>
                    </div>
                  )}
                  {liveKit.token && !liveKit.loading && (
                    <VideoConference
                      token={liveKit.token}
                      serverUrl={liveKit.serverUrl}
                      onDisconnected={() => setError('화상 회의 연결이 끊어졌습니다')}
                    />
                  )}
                  {!liveKit.token && !liveKit.loading && (
                    <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[#E5E5E5] bg-[#F9F9F9]">
                      <p className="text-sm text-[#6F6F6F]">
                        클래스 시작 시 화상이 연결됩니다
                      </p>
                    </div>
                  )}
                </div>

                <div>
                  <div className="mb-3 text-[12px] font-mono uppercase tracking-wider text-[#6F6F6F]">
                    녹음
                  </div>
                  {!mediaPrefs.micOn ? (
                    <div className="space-y-3">
                      <div className="rounded-xl border border-[#F5E2B8] bg-amber-50 p-4 text-sm text-[#8A6B1F]">
                        이 세션은 마이크 꺼짐으로 시작되어 수동 기록 모드로 진행 중입니다.
                        마커와 상담사 노트로 기록을 남길 수 있습니다.
                      </div>
                      {mediaPrefs.cameraOn && (
                        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-[#F2F3F8] px-4 py-3">
                          {videoRecorder.state === 'recording' ||
                          videoRecorder.state === 'paused' ? (
                            <>
                              <span className="flex items-center gap-2 text-sm font-medium text-[#1F1F1F]">
                                <span
                                  className={`h-2 w-2 rounded-full ${
                                    videoRecorder.state === 'recording'
                                      ? 'animate-pulse bg-[#B3261E]'
                                      : 'bg-[#9B9B9B]'
                                  }`}
                                />
                                무음 영상 녹화 중 (상담사 본인 · 음성 미포함)
                              </span>
                              <span className="text-xs text-[#6F6F6F]">
                                녹화 시간 {elapsedLabel(recordingElapsedSec)}
                              </span>
                              <button
                                type="button"
                                onClick={() => void handleVideoOnlyStop()}
                                className="mb-btn mb-btn--soft !px-3 !py-1.5 text-xs"
                              >
                                영상 녹화 종료
                              </button>
                            </>
                          ) : (
                            <>
                              <span className="text-sm text-[#6F6F6F]">
                                영상은 무음으로 녹화됩니다 (음성 녹음·AI 분석 없음)
                              </span>
                              <button
                                type="button"
                                onClick={() => void handleVideoOnlyStart()}
                                className="mb-btn !px-3 !py-1.5 text-xs"
                              >
                                영상 녹화 시작
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <RecordingControls
                        state={recorder.state}
                        elapsedSec={recordingElapsedSec}
                        onStart={handleStartClick}
                        onPause={() => {
                          recorder.pause();
                          videoRecorder.pause();
                        }}
                        onResume={() => {
                          recorder.resume();
                          videoRecorder.resume();
                        }}
                        onStop={handleStop}
                      />
                      {(videoRecorder.state === 'recording' ||
                        videoRecorder.state === 'paused') && (
                        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-[#F2F3F8] px-4 py-3">
                          <span className="flex items-center gap-2 text-sm font-medium text-[#1F1F1F]">
                            <span
                              className={`h-2 w-2 rounded-full ${
                                videoRecorder.state === 'recording'
                                  ? 'animate-pulse bg-[#B3261E]'
                                  : 'bg-[#9B9B9B]'
                              }`}
                            />
                            {videoRecorder.state === 'recording'
                              ? '영상 녹화 중 (상담사 본인)'
                              : '영상 녹화 일시정지'}
                          </span>
                          <span className="text-xs text-[#6F6F6F]">
                            녹화 시간 {elapsedLabel(recordingElapsedSec)} ·{' '}
                            {videoRecorder.facingMode === 'user' ? '전면 카메라' : '후면 카메라'}
                          </span>
                          <button
                            type="button"
                            onClick={() => void videoRecorder.switchCamera()}
                            className="mb-btn mb-btn--ghost !px-3 !py-1.5 text-xs"
                          >
                            {videoRecorder.facingMode === 'user'
                              ? '후면 카메라로 전환'
                              : '전면 카메라로 전환'}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>

                <section>
                  <div className="mb-3 text-[12px] font-mono uppercase tracking-wider text-[#6F6F6F]">
                    마커
                  </div>
                  <MarkerButton sessionId={id ?? ''} startedAt={startedAtMs} />
                </section>
              </div>
          </div>
        )}

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

      {/* SDD-085: 마이크 오프 세션은 녹음 자체가 없어 음성 동의 절차 불필요 */}
      <ConsentModal
        open={consentOpen && mediaPrefs.micOn}
        onConfirm={() => void handleConsentConfirm()}
        onCancel={() => {
          setConsentOpen(false);
        }}
      />

      {/* SDD-088: 종료 2단계 확인 */}
      <EndSessionModal
        open={endModalOpen}
        ending={transitioning}
        onConfirm={() => void finishSession()}
        onCancel={() => setEndModalOpen(false)}
      />

      {/* SDD-088: SPA 라우팅 이탈 확인 — open/in_progress */}
      {blocker.state === 'blocked' && (
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
              // 종료(end)는 finishSession 이 bypass 후 기록 페이지로 직접 이동한다
              void finishSession();
            }
          }}
          onLeaveKeepOpen={() => blocker.proceed?.()}
        />
      )}
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
