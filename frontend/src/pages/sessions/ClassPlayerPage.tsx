// SDD-088: 독립형 클래스 플레이어 — 클래스 = 가상의 방, 상태에 따라 씬이 전개된다.
// 풀스크린(AppShell 밖) 단일 페이지. 상담사(host) 씬:
//   ① 세팅(ready/scheduled): 미디어 프리뷰 + [클래스 오픈]
//   ② 대기실(open): 코드 대형 표시 + 참가자 실시간 그리드 + [시작하기] + [클래스 닫기]
//   ③ 라이브(in_progress/paused): 모니터링·녹음·마커 + [종료](2단계 확인)
//   ④ 종료(completed): [기록 보기]
// 상태 전이 버튼은 이 플레이어 안에만 존재한다(목록·상세는 [입장] 단일 버튼).
// 기존 SessionLivePage 의 모니터링·녹음·마커·밴드 로직을 씬으로 분해 이전했다 (SDD-024/026/028/083~085 유지).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getSession,
  getSessionLiveMetrics,
  transitionSession,
  type SessionDto,
  type SessionLiveMetric,
  type SessionStatus,
} from '../../lib/api/session';
import { startAudio, stopAudio } from '../../lib/api/audio';
import { startVideo, stopVideo } from '../../lib/api/video';
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
  DeviceStatusChangedEvent,
  ParticipantChangedEvent,
  SessionLiveEegFeatureEvent,
  SessionLiveJoinSnapshot,
  SessionStateChangedEvent,
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
import {
  SessionPreJoinPreview,
  type PreJoinMediaPrefs,
} from '../../components/session/SessionPreJoinPreview';
import { SessionHostVideoView } from '../../components/session/SessionHostVideoView';
import { SessionParticipantCardGrid } from '../../components/session/SessionParticipantCardGrid';
import { SessionParticipantDetailPanel } from '../../components/session/SessionParticipantDetailPanel';
import { StatusBadge } from '../../components/session/StatusBadge';
import { EndSessionModal } from '../../components/player/EndSessionModal';
import { LeaveGuardModal } from '../../components/player/LeaveGuardModal';
import {
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
const GUARDED_STATUSES: SessionStatus[] = ['open', 'in_progress', 'paused'];

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
    }));
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

export default function ClassPlayerPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionDto | null>(null);
  const [metrics, setMetrics] = useState<SessionLiveMetric[]>([]);
  const lastFeaturePatchAtRef = useRef(0);
  const featureBufferRef = useRef<
    Map<string, { efficiency: number[]; heartRate: number[]; respiratoryRate: number[] }>
  >(new Map());
  const [error, setError] = useState<string | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
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
  /** SDD-085: 프리뷰에서 확정한 카메라/마이크 사용 여부 — 세션 전체(녹음·녹화)에 적용 */
  const [mediaPrefs, setMediaPrefs] = useState<PreJoinMediaPrefs>({
    cameraOn: true,
    micOn: true,
  });
  const [codeCopied, setCodeCopied] = useState(false);

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
      const now = Date.now();
      const rawEfficiency =
        event.current_efficiency ??
        event.relaxation_index ??
        event.feature?.relaxation_index ??
        null;
      // feature 계약은 raw 비율 — 표시 버퍼에는 정규화 점수(0~100)로 적재
      const efficiency = scoreEfficiency(rawEfficiency);
      const heartRate = event.feature?.heart_rate ?? null;
      const respiratoryRate = event.feature?.respiratory_rate ?? null;
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
      setMetrics((prev) => {
        let next = prev;
        let changed = false;
        for (const [pid, values] of featureBufferRef.current) {
          const hasAny =
            values.efficiency.length > 0 ||
            values.heartRate.length > 0 ||
            values.respiratoryRate.length > 0;
          if (!hasAny) continue;
          const avgOf = (arr: number[]): number | null =>
            arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
          const avgEff = avgOf(values.efficiency);
          const avgHr = avgOf(values.heartRate);
          const avgRr = avgOf(values.respiratoryRate);
          const averaged: SessionLiveEegFeatureEvent = {
            ...event,
            participant_id: pid,
            current_efficiency: avgEff,
            relaxation_index: avgEff,
            feature: {
              ...event.feature,
              second_offset: event.feature?.second_offset ?? 0,
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
        featureBufferRef.current = new Map();
        return changed ? next : prev;
      });
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

  const liveSocket = useSessionLiveSocket({
    sessionId: id,
    participantId: hostParticipantId,
    enabled: Boolean(id && session),
    onEegFeature: handleLiveFeature,
    onSnapshot: handleSnapshot,
    onSessionStateChanged: handleSessionState,
    onParticipantChanged: handleParticipantChanged,
    onDeviceStatusChanged: handleDeviceStatus,
  });

  const refreshSession = useCallback(async (): Promise<void> => {
    if (!id) return;
    try {
      const next = await getSession(id);
      setSession(next);
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
      setSession((prev) => {
        if (prev) setMetrics(participantsToMetrics(prev));
        return prev;
      });
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
  const isRunning = status === 'in_progress' || status === 'paused';
  const isEnded = status === 'completed';
  const isCancelled = status === 'cancelled';

  // 대기·진행 중 화면 꺼짐 방지 (회원 immersive 와 동일 정책)
  useWakeLock(isLobby || isRunning);

  // SDD-088: 이탈 보수 처리 — 호스트 + open/in_progress/paused 에서만
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
      // SDD-085: 마이크 오프 결정을 서버에 선언 — consent_audio=false → status='manual'
      if (!mediaPrefs.micOn) {
        try {
          await startAudio(id, false);
        } catch (e) {
          setError(`수동 기록 모드 선언 실패: ${(e as Error).message}`);
        }
      }
      await refreshMetrics();
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

  /** 녹음 시작 버튼 — 온라인 세션이면 화상 연결 후 동의 확인 */
  const handleStartClick = () => {
    if (!mediaPrefs.micOn) return;
    setError(null);
    if (session?.location_type === 'online') {
      liveKit.connect();
    }
    setConsentOpen(true);
  };

  /** 동의 모달 확인 — 오디오 녹음 + 상담사 영상 녹화 시작 */
  const handleConsentConfirm = async () => {
    setConsentOpen(false);
    if (!id) return;
    try {
      await startAudio(id, true);
      await recorder.start();
      setRecordingStartedAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    }
    if (mediaPrefs.cameraOn) {
      try {
        await startVideo(id, true);
        await videoRecorder.start();
      } catch (e) {
        setError(`영상 녹화 시작 실패: ${(e as Error).message}`);
      }
    }
  };

  /** SDD-085 조합 C(카메라 ON + 마이크 OFF): 무음 영상만 단독 녹화 시작/종료 */
  const handleVideoOnlyStart = async () => {
    if (!id) return;
    setError(null);
    try {
      await startVideo(id, true);
      await videoRecorder.start();
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
    recorder.stop();
    try {
      await stopAudio(id);
    } catch (e) {
      setError((e as Error).message);
    }
    if (videoRecorder.state === 'recording' || videoRecorder.state === 'paused') {
      try {
        await videoRecorder.stop();
        await stopVideo(id);
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
      setError((e as Error).message);
    } finally {
      setTransitioning(false);
    }
  };

  const pauseOrResume = async (action: 'pause' | 'resume'): Promise<void> => {
    if (!id) return;
    setTransitioning(true);
    try {
      const updated = await transitionSession(id, action);
      setSession(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : '상태 변경에 실패했습니다');
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

  const isOnline = session?.location_type === 'online';

  const displayMetrics = useMemo(() => {
    const base =
      metrics.length > 0 ? metrics : session ? participantsToMetrics(session) : [];

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
    metrics,
    session,
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
    }
  };

  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#12081C]">
        <p className="text-sm text-white/70">클래스에 입장하는 중...</p>
      </main>
    );
  }

  const accessCode = session.access_code ?? '';

  /* ─── 씬별 상단 컨트롤 (상태 전이 버튼은 플레이어 안에만 존재) ─── */
  const headerControls = isHost ? (
    <div className="flex flex-wrap items-center gap-2">
      {isLobby && (
        <>
          <button
            type="button"
            onClick={() => void closeClass(false)}
            disabled={transitioning}
            className="mb-btn mb-btn--ghost !text-white/80 hover:!text-white"
          >
            클래스 닫기
          </button>
          <button
            type="button"
            onClick={() => void startClass()}
            disabled={!canStart}
            title={
              !canStart && !transitioning
                ? '참가자 1명 이상 입장 후 시작할 수 있습니다'
                : undefined
            }
            className="mb-btn disabled:cursor-not-allowed"
          >
            {transitioning ? '시작 중...' : '시작하기'}
          </button>
        </>
      )}
      {isRunning && (
        <>
          <button
            type="button"
            onClick={() => void pauseOrResume(session.status === 'paused' ? 'resume' : 'pause')}
            disabled={transitioning}
            className="mb-btn mb-btn--ghost !text-white/80 hover:!text-white"
          >
            {session.status === 'paused' ? '재개' : '일시정지'}
          </button>
          <button
            type="button"
            onClick={() => setEndModalOpen(true)}
            disabled={transitioning}
            className="mb-btn mb-btn--soft disabled:cursor-not-allowed"
          >
            클래스 종료
          </button>
        </>
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
    </div>
  );

  /* ─── 참여자 상태 피드백 패널 — 대기실(전체 폭)·라이브(우측 컬럼) 공용 ─── */
  const monitorPanel = (isLobby || isRunning) && (
    <div className="space-y-3 rounded-2xl bg-white p-4">
      {liveStatusBar}
      <SessionMonitorSummary
        counts={summary}
        activeFilter={activeFilter}
        onFilterToggle={handleFilterToggle}
      />

      <div className="space-y-2">
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
              className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition ${
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
          />
        ) : (
          <SessionMonitorTable participants={displayMetrics} filter={activeFilter} />
        )}
      </div>

      {/* 호스트 LINK BAND — 보조 영역 */}
      {isHost && (
        <div className="flex flex-col gap-3 rounded-xl bg-[#F2F3F8] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#1F1F1F]">LINK BAND (호스트)</p>
            <p className="mt-1 text-sm text-[#6F6F6F]">
              {band.connectionState === 'connected'
                ? `연결됨 · 배터리 ${band.battery !== null ? `${Math.round(band.battery)}%` : '—'} · 접촉 ${contactStatusLabel(band.deviceStatus)} · 신호 ${signalQualityLevelLabel(band.signalQualityLevel)}`
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
    </div>
  );

  /* ─── 라이브 좌측 — 호스트 상태 패널: 타이머 · 마이크/카메라 · AI 분석 ─── */
  const isAnalyzing =
    mediaPrefs.micOn && (recorder.state === 'recording' || recorder.state === 'paused');
  const hostStatusPanel = (
    <div className="rounded-2xl bg-white/5 p-4">
      <p className="text-xs text-white/50">
        {status === 'paused' ? '일시정지됨' : '진행 시간'}
      </p>
      <p className="mt-1 font-mono text-4xl font-bold tabular-nums text-white">
        {elapsedLabel(classElapsedSec)}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${
            mediaPrefs.micOn ? 'bg-white/10 text-white' : 'bg-white/5 text-white/50'
          }`}
        >
          {mediaPrefs.micOn ? '🎙️ 마이크 ON' : '🔇 마이크 OFF'}
        </span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${
            mediaPrefs.cameraOn ? 'bg-white/10 text-white' : 'bg-white/5 text-white/50'
          }`}
        >
          🎥 카메라 {mediaPrefs.cameraOn ? 'ON' : 'OFF'}
        </span>
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
    <main className="min-h-screen bg-[#12081C] pb-10">
      {/* 플레이어 헤더 — 풀스크린 셸 (AppShell 밖) */}
      <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-white/10 bg-[#12081C]/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/sessions')}
            className="shrink-0 rounded-xl bg-white/10 px-3 py-2 text-sm font-medium text-white/80 transition hover:bg-white/20 hover:text-white"
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

      <div className="mx-auto mt-4 max-w-7xl space-y-3 px-4 sm:px-6">
        {/* ① 세팅 씬 — ready/scheduled: 미디어 프리뷰 + [클래스 오픈] */}
        {isSetup && isHost && (
          <>
            <div className="rounded-2xl bg-white/5 p-4 text-sm text-white/80">
              카메라·마이크를 확인한 뒤 <b className="text-white">클래스를 오픈</b>하면 회원들이
              코드로 입장해 대기실에서 밴드를 착용할 수 있습니다.
            </div>
            <SessionPreJoinPreview
              onStart={(prefs) => void openClass(prefs)}
              starting={transitioning}
              canStart={!transitioning}
              startLabel="클래스 오픈"
            />
          </>
        )}

        {/* ② 대기실 씬 — open: 코드 대형 표시 + 참가자 실시간 그리드 */}
        {isLobby && (
          <div className="rounded-2xl bg-white/5 p-6 text-center">
            <p className="text-sm text-white/60">클래스 코드</p>
            <p className="mt-1 font-mono text-5xl font-black tracking-[0.2em] text-white">
              {accessCode || '——————'}
            </p>
            <p className="mt-2 text-sm text-white/60">
              회원에게 코드를 안내하세요. 입장한 회원의 밴드 착용·신호 상태가 아래에 실시간으로
              표시됩니다.
            </p>
            {accessCode && (
              <button
                type="button"
                onClick={() => void handleCopyCode()}
                className="mt-3 rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/20"
              >
                {codeCopied ? '복사 완료' : '코드 복사'}
              </button>
            )}
            {session.opened_at && (
              <div className="mt-5 border-t border-white/10 pt-4">
                <p className="text-xs text-white/50">대기 시간</p>
                <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-white">
                  {elapsedLabel(lobbyElapsedSec)}
                </p>
              </div>
            )}
          </div>
        )}

        {/* ③ 라이브 씬 — 좌: 카메라+호스트 상태 / 우: 참여자 피드백 (lg 미만은 세로 스택) */}
        {isRunning && isHost && (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className="flex min-w-0 flex-col gap-3">
              {/* 셀프뷰 — 프리뷰 → 셀프뷰 자연 전환 (SDD-084/085) */}
              {mediaPrefs.cameraOn ? (
                <SessionHostVideoView
                  stream={videoRecorder.stream}
                  facingMode={videoRecorder.facingMode}
                  recording={videoRecorder.state === 'recording'}
                />
              ) : (
                <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-2xl bg-[#111] p-6 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-xl">
                    🎥
                  </span>
                  <p className="text-sm text-[#9CA3AF]">카메라 꺼짐 · 녹화 안 함</p>
                </div>
              )}
              {hostStatusPanel}
            </div>
            <div className="min-w-0">{monitorPanel}</div>
          </div>
        )}

        {/* 모니터링 — 대기실(핵심 목적: 착용·신호 확인)·비호스트 진행 화면은 전체 폭 */}
        {(isLobby || (isRunning && !isHost)) && monitorPanel}

        {/* 오류 표시 */}
        {error && (
          <div className="rounded-xl border border-[#F5C2C0] bg-[#FDECEC] p-3.5 text-sm text-[#B3261E]">
            {error}
          </div>
        )}

        {liveKit.error && (
          <div className="rounded-xl border border-[#F5C2C0] bg-[#FDECEC] p-3.5 text-sm text-[#B3261E]">
            화상 연결 오류: {liveKit.error}
          </div>
        )}

        {/* ③ 라이브 씬 보조 — 녹음 / 화상 / 마커 (접기) */}
        {isRunning && isHost && (
          <div className="rounded-xl bg-white">
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

            {mediaOpen && (
              <div className="space-y-5 border-t border-[#EFEFEF] px-5 pb-6 pt-5 sm:px-6">
                {isOnline && (
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
                          녹음을 시작하면 화상 회의가 연결됩니다
                        </p>
                      </div>
                    )}
                  </div>
                )}

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
                                업로드된 청크 {videoRecorder.uploadedChunks}개
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
                        uploadedChunks={recorder.uploadedChunks}
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
                            업로드된 청크 {videoRecorder.uploadedChunks}개 ·{' '}
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
            )}
          </div>
        )}

        {/* ④ 종료 씬 — completed */}
        {isEnded && (
          <div className="flex flex-col items-center gap-4 rounded-2xl bg-white/5 px-6 py-16 text-center">
            <p className="text-2xl font-bold text-white">클래스가 종료되었습니다</p>
            <p className="text-sm text-white/60">
              녹음·녹화가 저장되었고 리포트가 자동 생성됩니다. 기록 페이지에서 확인하세요.
            </p>
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
        {selectedRow && (
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
          if (isOnline) liveKit.disconnect();
        }}
      />

      {/* SDD-088: 종료 2단계 확인 */}
      <EndSessionModal
        open={endModalOpen}
        ending={transitioning}
        onConfirm={() => void finishSession()}
        onCancel={() => setEndModalOpen(false)}
      />

      {/* SDD-088: SPA 라우팅 이탈 확인 — open/in_progress/paused */}
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
    </main>
  );
}
