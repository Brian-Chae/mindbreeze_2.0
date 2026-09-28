// 상담사 라이브 영상 타일 — 회원/게스트 구독 전용 LiveKitRoom (video/audio 미발신)
// 자연 배경 위에 올라가는 반투명 카드. 토큰이 없거나 원격 트랙이 없으면 준비 중 표시.
import { useEffect } from 'react';
import { LiveKitRoom, RoomAudioRenderer, useTracks, VideoTrack } from '@livekit/components-react';
import '@livekit/components-styles';
import { Track } from 'livekit-client';
import { useMemberLiveKit } from '../../hooks/useMemberLiveKit';

interface CounselorLiveTileProps {
  code: string | null;
  participantId: string | null;
  participantToken?: string | null;
  className?: string;
}

/** 구독한 원격(상담사) 카메라 트랙만 렌더 */
function HostCamera() {
  const tracks = useTracks([Track.Source.Camera]);
  const remoteCameras = tracks.filter((t) => !t.participant.isLocal);
  if (remoteCameras.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-white/70">
        상담사 영상 연결 중…
      </div>
    );
  }
  return (
    <>
      {remoteCameras.map((trackRef) => (
        <VideoTrack
          key={trackRef.publication.trackSid}
          trackRef={trackRef}
          className="h-full w-full object-cover"
        />
      ))}
    </>
  );
}

export function CounselorLiveTile({
  code,
  participantId,
  participantToken,
  className = '',
}: CounselorLiveTileProps) {
  const { token, error, notReady, connect, serverUrl } = useMemberLiveKit({
    code,
    participantId,
    participantToken,
  });

  // 진입 시 연결 + 상담사 화상 미시작이면 5초 간격 재시도
  useEffect(() => {
    void connect();
  }, [connect]);

  useEffect(() => {
    if (!notReady) return;
    const id = window.setInterval(() => void connect(), 5000);
    return () => window.clearInterval(id);
  }, [notReady, connect]);

  if (error && !token) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <p className="text-sm text-white/60">상담사 영상을 불러오지 못했습니다</p>
      </div>
    );
  }

  if (!token) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <p className="text-sm text-white/60">상담사 영상 준비 중…</p>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden rounded-2xl bg-black/40 ${className}`}>
      <LiveKitRoom
        token={token}
        serverUrl={serverUrl}
        connect={true}
        video={false}
        audio={false}
        className="h-full w-full"
      >
        <HostCamera />
        <RoomAudioRenderer />
      </LiveKitRoom>
    </div>
  );
}
