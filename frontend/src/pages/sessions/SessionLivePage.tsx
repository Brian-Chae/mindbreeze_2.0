// 세션 진행 중 라이브 페이지 (UI Kit) — 녹음 + 마커

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getSession, transitionSession, type SessionDto } from '../../lib/api/session';
import { startAudio, stopAudio } from '../../lib/api/audio';
import { useAudioRecorder } from '../../hooks/useAudioRecorder';
import { ConsentModal } from '../../components/session/ConsentModal';
import { RecordingControls } from '../../components/session/RecordingControls';
import { MarkerButton } from '../../components/session/MarkerButton';
import { StatusBadge } from '../../components/session/StatusBadge';
import AppShell from '../../components/layout/AppShell';

export default function SessionLivePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);

  const recorder = useAudioRecorder({
    sessionId: id ?? '',
    onError: (err) => setError(err.message),
  });

  useEffect(() => {
    if (!id) return;
    getSession(id)
      .then(setSession)
      .catch((e) => setError((e as Error).message));
  }, [id]);

  const handleStartClick = () => {
    setError(null);
    setConsentOpen(true);
  };

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
    try {
      if (recorder.state === 'recording' || recorder.state === 'paused') {
        await handleStop();
      }
      await transitionSession(id, 'end');
      navigate(`/sessions/${id}/record`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const startedAtMs = useMemo(() => recordingStartedAt ?? Date.now(), [recordingStartedAt]);

  if (!session) {
    return (
      <AppShell title="세션" sub="LIVE">
        <p className="text-sm text-[#6F6F6F]">세션 로딩 중...</p>
      </AppShell>
    );
  }

  const rightSlot = (
    <button type="button" onClick={finishSession} className="mb-btn">
      세션 종료
    </button>
  );

  return (
    <AppShell title={session.title ?? '세션'} sub="LIVE" rightSlot={rightSlot}>
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="bg-white rounded-[20px] border border-[#EFEFEF] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="text-[12px] font-mono text-[#6F6F6F] uppercase tracking-wider mb-1">
              세션 정보
            </div>
            <h2 className="text-[18px] font-bold text-[#1F1F1F]">{session.title ?? '세션'}</h2>
            <div className="text-[13px] text-[#6F6F6F] mt-1">
              {session.duration_min}분 · 참여자 {session.participants.length}/{session.max_participants}
            </div>
          </div>
          <StatusBadge status={session.status} />
        </div>

        {error && (
          <div className="rounded-xl bg-[#FDECEC] p-3.5 text-sm text-[#B3261E] border border-[#F5C2C0]">
            {error}
          </div>
        )}

        <div className="bg-white rounded-[20px] border border-[#EFEFEF] p-6">
          <div className="text-[12px] font-mono text-[#6F6F6F] uppercase tracking-wider mb-3">
            녹음
          </div>
          <RecordingControls
            state={recorder.state}
            uploadedChunks={recorder.uploadedChunks}
            onStart={handleStartClick}
            onPause={recorder.pause}
            onResume={recorder.resume}
            onStop={handleStop}
          />
        </div>

        <section className="bg-white rounded-[20px] border border-[#EFEFEF] p-6">
          <div className="text-[12px] font-mono text-[#6F6F6F] uppercase tracking-wider mb-3">
            마커
          </div>
          <MarkerButton sessionId={id ?? ''} startedAt={startedAtMs} />
        </section>

        <ConsentModal
          open={consentOpen}
          onConfirm={handleConsentConfirm}
          onCancel={() => setConsentOpen(false)}
        />
      </div>
    </AppShell>
  );
}
