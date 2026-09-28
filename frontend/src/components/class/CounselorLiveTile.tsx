// 상담사 라이브 영상 타일 — 회원/게스트 LiveKitRoom
// canPublish(온라인 양방향)면 회원 카메라/마이크를 송출하고, 아니면 수신 전용.
// 자연 배경 위에 올라가는 반투명 카드. 토큰이 없거나 원격 트랙이 없으면 준비 중 표시.
// speakerOn=false면 상담사 오디오 볼륨 0 (하울링 방지 뮤트) — 오프라인 수업 기본 뮤트용.
import { useEffect } from 'react';
import { LiveKitRoom, RoomAudioRenderer, useTracks, VideoTrack } from '@livekit/components-react';
import '@livekit/components-styles';
import { Track } from 'livekit-client';
import { useMemberLiveKit } from '../../hooks/useMemberLiveKit';

interface CounselorLiveTileProps {
  code: string | null;
  participantId: string | null;
  participantToken?: string | null;
  /** 스피커 on/off — false면 상담사 음성 음소거 (하울링 방지) */
  speakerOn?: boolean;
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
  speakerOn = true,
  className = '',
}: CounselorLiveTileProps) {
  const { token, canPublish, error, notReady, connect, serverUrl } = useMemberLiveKit({
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
        // 온라인 양방향(canPublish)일 때만 로컬 카메라/마이크 캡처·발행
        video={canPublish}
        audio={canPublish}
        className="h-full w-full"
      >
        <HostCamera />
        {/* speakerOn=false → 볼륨 0 (클라이언트측 즉시 뮤트, 재구독 지연 없음) */}
        <RoomAudioRenderer volume={speakerOn ? 1 : 0} />
      </LiveKitRoom>
    </div>
  );
}
