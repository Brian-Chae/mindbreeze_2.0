// 세션 진행 중 라이브 페이지 — 호스트 콘솔(코드 배너·모니터링) + 녹음/마커/LiveKit

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getSession,
  getSessionLiveMetrics,
  transitionSession,
  type SessionDto,
  type SessionLiveMetric,
} from '../../lib/api/session';
import { startAudio, stopAudio } from '../../lib/api/audio';
import { useAudioRecorder } from '../../hooks/useAudioRecorder';
import { useLiveKit } from '../../hooks/useLiveKit';
import { VideoConference } from '../../components/session/VideoConference';
import { ConsentModal } from '../../components/session/ConsentModal';
import { RecordingControls } from '../../components/session/RecordingControls';
import { MarkerButton } from '../../components/session/MarkerButton';
import { StatusBadge } from '../../components/session/StatusBadge';
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
    connectionFailed: rows.filter(
      (r) => !r.band_connected || r.device_status === 'disconnected',
    ).length,
    lowBattery: rows.filter((r) => r.band_battery !== null && r.band_battery < 20).length,
  };
}

export default function SessionLivePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionDto | null>(null);
  const [metrics, setMetrics] = useState<SessionLiveMetric[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<keyof MonitorSummaryCounts | null>(null);

  const liveKit = useLiveKit(id);

  const recorder = useAudioRecorder({
    sessionId: id ?? '',
    onError: (err) => setError(err.message),
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
      setMetrics(res.participants ?? []);
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

  const isOnline = session?.location_type === 'online';
  const isPreStart = session?.status === 'ready' || session?.status === 'scheduled';
  const isRunning = session?.status === 'in_progress' || session?.status === 'paused';

  const displayMetrics = useMemo(() => {
    if (metrics.length > 0) return metrics;
    if (session) return participantsToMetrics(session);
    return [];
  }, [metrics, session]);

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

  const rightSlot = isPreStart ? (
    <button
      type="button"
      onClick={() => void startSession()}
      disabled={!canStart}
      title={!canStart ? '참가자 1명 이상 입장 후 시작할 수 있습니다' : undefined}
      className="mb-btn disabled:cursor-not-allowed disabled:opacity-50"
    >
      {transitioning ? '시작 중...' : '클래스 시작'}
    </button>
  ) : isRunning ? (
    <button
      type="button"
      onClick={() => void finishSession()}
      disabled={transitioning}
      className="mb-btn"
    >
      {transitioning ? '종료 중...' : '클래스 종료'}
    </button>
  ) : null;

  return (
    <AppShell title={session.title ?? '세션'} sub="LIVE" rightSlot={rightSlot}>
      <div className="mx-auto max-w-7xl space-y-5">
        {/* 세션 정보 카드 */}
        <div className="flex flex-col gap-3 rounded-[20px] border border-[#EFEFEF] bg-white p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <div className="mb-1 text-[12px] font-mono uppercase tracking-wider text-[#6F6F6F]">
              세션 정보
            </div>
            <h2 className="text-[18px] font-bold text-[#1F1F1F]">{session.title ?? '세션'}</h2>
            <div className="mt-1 text-[13px] text-[#6F6F6F]">
              {session.duration_min}분 · 참여자 {activeCount}/{session.max_participants}
              {isOnline && (
                <span className="ml-2 inline-flex items-center gap-1 text-[#2563EB]">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#2563EB]" />
                  온라인
                </span>
              )}
            </div>
          </div>
          <StatusBadge status={session.status} />
        </div>

        {/* 시작 전: 클래스 코드 안내 */}
        {isPreStart && session.access_code && (
          <SessionCodeBanner accessCode={session.access_code} waitingCount={activeCount} />
        )}

        {/* 시작 후: Dashboard + 모니터링 테이블 */}
        {isRunning && (
          <>
            <SessionMonitorSummary
              counts={summary}
              activeFilter={activeFilter}
              onFilterToggle={handleFilterToggle}
            />
            <div>
              <div className="mb-3 text-[12px] font-mono uppercase tracking-wider text-[#6F6F6F]">
                참가자 모니터링
              </div>
              <SessionMonitorTable participants={displayMetrics} filter={activeFilter} />
            </div>
          </>
        )}

        {/* 시작 전에도 입장 참가자 미리보기 */}
        {isPreStart && (
          <div>
            <div className="mb-3 text-[12px] font-mono uppercase tracking-wider text-[#6F6F6F]">
              입장한 참가자
            </div>
            <SessionMonitorTable participants={displayMetrics} filter={null} />
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
        <div className="rounded-[20px] border border-[#EFEFEF] bg-white">
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
