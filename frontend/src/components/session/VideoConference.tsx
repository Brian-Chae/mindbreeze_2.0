// WebRTC 화상 회의 컴포넌트 — LiveKit 기반
// 1:1 + SFU 그룹 지원

import { useState, useEffect } from 'react';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  GridLayout,
  ParticipantTile,
  ControlBar,
  DisconnectButton,
  TrackToggle,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { Track } from 'livekit-client';
import { joinSession, type JoinSessionResponse } from '../../lib/api/session';

interface Props {
  sessionId: string;
  onError?: (err: Error) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

export default function VideoConference({ sessionId, onError, onConnected, onDisconnected }: Props) {
  const [token, setToken] = useState<string | null>(null);
  const [roomName, setRoomName] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(true);

  const livekitUrl = import.meta.env.VITE_LIVEKIT_URL || 'wss://dev-api.mindbreeze.looxidlabs.com/livekit';

  useEffect(() => {
    let cancelled = false;
    setConnecting(true);

    joinSession(sessionId)
      .then((data: JoinSessionResponse) => {
        if (cancelled) return;
        setToken(data.livekit_token);
        setRoomName(data.webrtc_room_id);
      })
      .catch((err) => {
        if (!cancelled) {
          setConnecting(false);
          onError?.(err instanceof Error ? err : new Error(String(err)));
        }
      });

    return () => { cancelled = true; };
  }, [sessionId]);

  if (!token || !roomName) {
    return (
      <div className="flex items-center justify-center h-64 bg-neutral-900 rounded-xl">
        <div className="text-center space-y-3">
          <div className="animate-spin h-8 w-8 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto" />
          <p className="text-sm text-neutral-400">
            {connecting ? '화상 연결 중...' : '연결 실패'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl overflow-hidden bg-neutral-950" style={{ minHeight: '480px' }}>
      <LiveKitRoom
        token={token}
        serverUrl={livekitUrl}
        video={true}
        audio={true}
        onConnected={() => {
          setConnecting(false);
          onConnected?.();
        }}
        onDisconnected={() => {
          setConnecting(false);
          onDisconnected?.();
        }}
        onError={(err) => {
          setConnecting(false);
          onError?.(err instanceof Error ? err : new Error('LiveKit 연결 오류'));
        }}
        connectOptions={{
          autoSubscribe: true,
        }}
        style={{ height: '100%' }}
      >
        <div className="flex flex-col h-full">
          {/* 비디오 그리드 */}
          <div className="flex-1 p-2">
            <GridLayout tracks={[]}>
              <ParticipantTile />
            </GridLayout>
          </div>

          {/* 컨트롤 바 */}
          <ControlBar
            variation="minimal"
            className="border-t border-neutral-800 bg-neutral-950/90 backdrop-blur"
          >
            <TrackToggle source={Track.Source.Microphone} />
            <TrackToggle source={Track.Source.Camera} />
            <DisconnectButton>나가기</DisconnectButton>
          </ControlBar>
        </div>

        <RoomAudioRenderer />
      </LiveKitRoom>
    </div>
  );
}
