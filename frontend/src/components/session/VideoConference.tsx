// LiveKit WebRTC 화상 회의 컴포넌트
// location_type='online' 세션에서 사용 — 그룹/1:1 모두 지원 (sfu_enabled 자동 처리)

import {
  LiveKitRoom,
  VideoConference as LKVideoConference,
  RoomAudioRenderer,
} from '@livekit/components-react';
import '@livekit/components-styles';

interface VideoConferenceProps {
  token: string;
  serverUrl: string;
  onDisconnected?: () => void;
}

export function VideoConference({ token, serverUrl, onDisconnected }: VideoConferenceProps) {
  return (
    <LiveKitRoom
      token={token}
      serverUrl={serverUrl}
      connect={true}
      audio={true}
      video={true}
      onDisconnected={onDisconnected}
      className="rounded-2xl overflow-hidden bg-[#111] min-h-[400px]"
    >
      <div className="relative h-full">
        <LKVideoConference />
        <RoomAudioRenderer />
      </div>
    </LiveKitRoom>
  );
}
