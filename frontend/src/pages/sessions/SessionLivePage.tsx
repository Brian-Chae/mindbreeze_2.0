// 세션 진행 중 라이브 페이지 (UI Kit) — 녹음 + 마커 + 화상 회의
// location_type='online' → LiveKit WebRTC 화상 컴포넌트 표시
// location_type='offline' → 기존 녹음 + 마커 UI 그대로

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getSession, transitionSession, type SessionDto } from '../../lib/api/session';
import { startAudio, stopAudio } from '../../lib/api/audio';
import { useAudioRecorder } from '../../hooks/useAudioRecorder';
import { useLiveKit } from '../../hooks/useLiveKit';
import { VideoConference } from '../../components/session/VideoConference';
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

  // LiveKit 화상 회의 훅 (온라인 세션 전용)
  const liveKit = useLiveKit(id);

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

  /** "세션 시작" 버튼 클릭 — 오프라인이면 바로 녹음, 온라인이면 LiveKit 연결도 함께 */
  const handleStartClick = () => {
    setError(null);
    // 온라인 세션이면 LiveKit 연결 먼저 — 녹음은 동의 모달 이후
    if (session?.location_type === 'online') {
      liveKit.connect();
    }
    setConsentOpen(true);
  };

  /** 동의 모달 확인 — 녹음 시작 (오디오만, LiveKit은 이미 연결됨) */
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
      // LiveKit 연결 해제
      liveKit.disconnect();
      await transitionSession(id, 'end');
      navigate(`/sessions/${id}/record`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const startedAtMs = useMemo(() => recordingStartedAt ?? Date.now(), [recordingStartedAt]);

  const isOnline = session?.location_type === 'online';

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
        {/* 세션 정보 카드 */}
        <div className="bg-white rounded-[20px] border border-[#EFEFEF] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="text-[12px] font-mono text-[#6F6F6F] uppercase tracking-wider mb-1">
              세션 정보
            </div>
            <h2 className="text-[18px] font-bold text-[#1F1F1F]">{session.title ?? '세션'}</h2>
            <div className="text-[13px] text-[#6F6F6F] mt-1">
              {session.duration_min}분 · 참여자 {session.participants.length}/{session.max_participants}
              {isOnline && (
                <span className="ml-2 inline-flex items-center gap-1 text-[#2563EB]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB] inline-block" />
                  온라인
                </span>
              )}
            </div>
          </div>
          <StatusBadge status={session.status} />
        </div>

        {/* 오류 표시 */}
        {error && (
          <div className="rounded-xl bg-[#FDECEC] p-3.5 text-sm text-[#B3261E] border border-[#F5C2C0]">
            {error}
          </div>
        )}

        {/* LiveKit 오류 */}
        {liveKit.error && (
          <div className="rounded-xl bg-[#FDECEC] p-3.5 text-sm text-[#B3261E] border border-[#F5C2C0]">
            화상 연결 오류: {liveKit.error}
          </div>
        )}

        {/* 온라인 세션 — LiveKit 화상 회의 영역 */}
        {isOnline && (
          <div className="bg-white rounded-[20px] border border-[#EFEFEF] p-5 sm:p-6">
            <div className="text-[12px] font-mono text-[#6F6F6F] uppercase tracking-wider mb-3">
              화상 회의
            </div>
            {liveKit.loading && (
              <div className="rounded-2xl bg-[#111] min-h-[400px] flex items-center justify-center">
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
              <div className="rounded-2xl bg-[#F9F9F9] min-h-[200px] flex flex-col items-center justify-center gap-3 border border-dashed border-[#E5E5E5]">
                <p className="text-sm text-[#6F6F6F]">
                  "세션 시작" 버튼을 누르면 화상 회의가 연결됩니다
                </p>
              </div>
            )}
          </div>
        )}

        {/* 녹음 영역 */}
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

        {/* 마커 영역 */}
        <section className="bg-white rounded-[20px] border border-[#EFEFEF] p-6">
          <div className="text-[12px] font-mono text-[#6F6F6F] uppercase tracking-wider mb-3">
            마커
          </div>
          <MarkerButton sessionId={id ?? ''} startedAt={startedAtMs} />
        </section>

        <ConsentModal
          open={consentOpen}
          onConfirm={handleConsentConfirm}
          onCancel={() => {
            setConsentOpen(false);
            // 동의 취소 시 LiveKit도 연결 해제
            if (isOnline) liveKit.disconnect();
          }}
        />
      </div>
    </AppShell>
  );
}
