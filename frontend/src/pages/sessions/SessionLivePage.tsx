// 세션 진행 중 라이브 페이지 — 호스트 콘솔(코드 배너·모니터링) + 녹음/마커/LiveKit + LINK BAND
// SDD-024: live-metrics는 WS eeg_feature 우선, 미연결 시 REST 폴링 폴백
// SDD-026: join snapshot 적용 후에만 폴백 중단. LeadOff/SQI 분리.
// SDD-028: eeg_feature는 참가자 행 증분 패치(전체 재계산·불필요 재렌더 회피)

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
import { useAudioRecorder } from '../../hooks/useAudioRecorder';
import { useBand } from '../../hooks/useBand';
import { useLiveKit } from '../../hooks/useLiveKit';
import { useSessionLiveSocket } from '../../hooks/useSessionLiveSocket';
import { useAuthStore } from '../../stores/authStore';
import { applyEegFeatureToMetricsDetailed } from '../../lib/session-live/apply-eeg-feature';
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
import { SessionCodeBanner } from '../../components/session/SessionCodeBanner';
import {
  SessionMonitorSummary,
  type MonitorSummaryCounts,
} from '../../components/session/SessionMonitorSummary';
import { SessionMonitorTable } from '../../components/session/SessionMonitorTable';
import AppShell from '../../components/layout/AppShell';

const LIVE_METRICS_POLL_MS = 4000;
const SESSION_POLL_MS = 5000;

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

export default function SessionLivePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionDto | null>(null);
  const [metrics, setMetrics] = useState<SessionLiveMetric[]>([]);
  // WS 1초 feature 즉시 갱신 스로틀 — 1초마다 재렌더되어 "밀려서" 보이는 것을 막는다.
  const lastFeaturePatchAtRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<keyof MonitorSummaryCounts | null>(null);
  /** 수업 진행시간(초) — session.started_at 기준 (녹음 시각과 분리) */
  const [classElapsedSec, setClassElapsedSec] = useState(0);

  const liveKit = useLiveKit(id);
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  const recorder = useAudioRecorder({
    sessionId: id ?? '',
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
      const now = Date.now();
      // 1초마다 feature가 들어와 화면이 연속 갱신("밀려서")되는 것을 막기 위해
      // 3초 간격으로만 증분 패치한다. 그 사이 최신값은 폴링(live-metrics)이 반영.
      if (now - lastFeaturePatchAtRef.current < 3000) return;
      lastFeaturePatchAtRef.current = now;
      // 해당 participant 행만 증분 패치 — 무변경이면 prev 참조 유지
      setMetrics((prev) => {
        const { rows, unchanged } = applyEegFeatureToMetricsDetailed(prev, event);
        return unchanged ? prev : rows;
      });
    },
    [id],
  );

  const handleSnapshot = useCallback((snap: SessionLiveJoinSnapshot) => {
    if (snap.participants?.length) {
      setMetrics(snap.participants);
    }
    if (snap.status) {
      setSession((prev) =>
        prev ? { ...prev, status: snap.status as SessionStatus } : prev,
      );
    }
  }, []);

  const handleSessionState = useCallback((event: SessionStateChangedEvent) => {
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
  }, [id]);

  const handleParticipantChanged = useCallback(
    (event: ParticipantChangedEvent) => {
      if (!id || event.session_id !== id) return;
      // SDD-021 버그수정: 백엔드 participant_changed는 참가자 목록이 아니라 count만 보내므로
      // 목록이 오면 반영하고, 없으면 폴링(refreshSession/refreshMetrics)이 안전망으로 갱신한다.
      if (event.participants && event.participants.length > 0) {
        setMetrics(event.participants);
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

  useSessionLiveSocket({
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
      setMetrics(res.metrics ?? res.participants ?? []);
    } catch {
      // live-metrics API 미준비 시 세션 참가자로 fallback
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

  // SDD-021 버그수정: WS snapshot/이벤트가 어떤 이유로든 누락돼도 참가자가 보이도록,
  // 폴링을 항상 유지한다(hasSnapshot 으로 중단하지 않음). WS 실시간은 handleParticipantChanged
  // 등이 트리거로 즉시 갱신하되, 폴링은 안전망으로 병행한다.
  useEffect(() => {
    if (!id || !session) return undefined;
    void refreshMetrics();
    const timer = window.setInterval(() => {
      void refreshMetrics();
    }, LIVE_METRICS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [id, session?.status, refreshMetrics]);

  /** 녹음 시작 버튼 클릭 — 온라인 세션이면 화상 연결 후 동의를 확인한다. */
  const handleStartClick = () => {
    setError(null);
    if (session?.location_type === 'online') {
      liveKit.connect();
    }
    setConsentOpen(true);
  };

  const startSession = async (): Promise<void> => {
    if (!id) return;
    setTransitioning(true);
    setError(null);
    try {
      const updated = await transitionSession(id, 'start');
      setSession(updated);
      await refreshMetrics();
    } catch (e) {
      setError(e instanceof Error ? e.message : '클래스 시작에 실패했습니다');
    } finally {
      setTransitioning(false);
    }
  };

  /** 동의 모달 확인 — 기존 오디오 녹음을 시작한다. */
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
  };

  const handleStop = async () => {
    if (!id) return;
    recorder.stop();
    try {
      await stopAudio(id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const finishSession = async () => {
    if (!id) return;
    if (!window.confirm('정말 종료할까요?\n클래스가 종료되면 사용자들도 모두 종료됩니다.')) {
      return;
    }
    setTransitioning(true);
    setError(null);
    try {
      if (recorder.state === 'recording' || recorder.state === 'paused') {
        await handleStop();
      }
      liveKit.disconnect();
      await transitionSession(id, 'end');
      navigate(`/sessions/${id}/record`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTransitioning(false);
    }
  };

  const startedAtMs = useMemo(() => recordingStartedAt ?? Date.now(), [recordingStartedAt]);

  // 수업 경과 타이머 — started_at 기준 (녹음 startedAtMs와 별개)
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

  /** 1.0 Timer 형식: 00분 00초 */
  const classElapsedLabel = useMemo(() => {
    const mm = String(Math.floor(classElapsedSec / 60)).padStart(2, '0');
    const ss = String(classElapsedSec % 60).padStart(2, '0');
    return `${mm}분 ${ss}초`;
  }, [classElapsedSec]);

  const isOnline = session?.location_type === 'online';
  const isPreStart = session?.status === 'ready' || session?.status === 'scheduled';
  const isRunning = session?.status === 'in_progress' || session?.status === 'paused';
  const bannerMode: 'waiting' | 'running' | 'paused' =
    session?.status === 'paused'
      ? 'paused'
      : session?.status === 'in_progress'
        ? 'running'
        : 'waiting';

  const displayMetrics = useMemo(() => {
    const base =
      metrics.length > 0 ? metrics : session ? participantsToMetrics(session) : [];

    // 호스트 본인 useBand 실데이터로 해당 행만 즉시 보강 (나머지 행 참조 유지)
    if (!hostParticipantId || band.connectionState !== 'connected') return base;

    const linkState = resolveBandLinkState({
      bleConnected: true,
      lastEegAt: band.lastEegAt,
    });

    let changed = false;
    const next = base.map((row) => {
      if (row.participant_id !== hostParticipantId) return row;
      const sq01 =
        band.signalQuality == null ? null : band.signalQuality / 100;
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
      // 필드 동일하면 기존 행 유지 → SessionMonitorRow memo 히트
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

  const canStart = isPreStart && activeCount >= 1 && !transitioning;
  const summary = useMemo(() => summarizeMetrics(displayMetrics), [displayMetrics]);

  const handleFilterToggle = (key: keyof MonitorSummaryCounts): void => {
    setActiveFilter((prev) => (prev === key ? null : key));
  };

  if (!session) {
    return (
      <AppShell title="세션" sub="LIVE">
        <p className="text-sm text-[#6F6F6F]">세션 로딩 중...</p>
      </AppShell>
    );
  }

  const rightSlot = (
    <div className="flex flex-wrap items-center gap-2">
      {isPreStart ? (
        <button
          type="button"
          onClick={() => void startSession()}
          disabled={!canStart}
          title={!canStart ? '참가자 1명 이상 입장 후 시작할 수 있습니다' : undefined}
          className="mb-btn disabled:cursor-not-allowed"
        >
          {transitioning ? '시작 중...' : '클래스 시작'}
        </button>
      ) : isRunning ? (
        <button
          type="button"
          onClick={() => void finishSession()}
          disabled={transitioning}
          className="mb-btn mb-btn--soft disabled:cursor-not-allowed"
        >
          {transitioning ? '종료 중...' : '클래스 종료'}
        </button>
      ) : null}
    </div>
  );

  const accessCode = session.access_code ?? '';

  return (
    <AppShell
      title={accessCode ? `세션코드: ${accessCode}` : '세션코드 확인 중'}
      sub="LIVE"
      rightSlot={rightSlot}
    >
      <div className="mx-auto max-w-7xl space-y-3 bg-white px-0 py-1 md:space-y-3">
        {/* 안내 배너 + Timer — 대기/진행 공통 */}
        {accessCode ? (
          <SessionCodeBanner
            accessCode={accessCode}
            mode={bannerMode}
            elapsedText={
              session.started_at
                ? classElapsedLabel
                : isRunning
                  ? '진행시간 확인 중'
                  : undefined
            }
            onRefresh={() => {
              void refreshSession();
              void refreshMetrics();
            }}
          />
        ) : (
          <div className="rounded-xl bg-[#F2F3F8] p-4 text-base font-semibold text-[#5E4FFF]">
            세션코드 확인 중
          </div>
        )}

        {/* DashboardBox 4종 — 시작 전에도 표시 */}
        <SessionMonitorSummary
          counts={summary}
          activeFilter={activeFilter}
          onFilterToggle={handleFilterToggle}
        />

        {/* 평평한 모니터링 테이블 */}
        <div>
          <SessionMonitorTable participants={displayMetrics} filter={activeFilter} />
        </div>

        {/* 호스트 LINK BAND — 보조 영역 */}
        {isRunning && (
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
              {band.error && (
                <p className="mt-1 text-xs text-[#B3261E]">{band.error}</p>
              )}
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

        {/* 녹음 / 화상 — 접기 (온라인·진행 중 기본 활용) */}
        <div className="rounded-xl border border-[#EFEFEF] bg-white">
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
                {isRunning ? (
                  <RecordingControls
                    state={recorder.state}
                    uploadedChunks={recorder.uploadedChunks}
                    onStart={handleStartClick}
                    onPause={recorder.pause}
                    onResume={recorder.resume}
                    onStop={handleStop}
                  />
                ) : (
                  <p className="text-sm text-[#6F6F6F]">클래스를 시작하면 녹음을 사용할 수 있습니다.</p>
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

        <ConsentModal
          open={consentOpen}
          onConfirm={() => void handleConsentConfirm()}
          onCancel={() => {
            setConsentOpen(false);
            if (isOnline) liveKit.disconnect();
          }}
        />
      </div>
    </AppShell>
  );
}
