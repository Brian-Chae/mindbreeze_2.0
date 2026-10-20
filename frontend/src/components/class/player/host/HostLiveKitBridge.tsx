// SDD-208 H4 — 상담사 화상 연결(VideoConference 대체). 화면에는 아무것도 그리지 않는 헤드리스 브리지다.
// - 회원 음성은 RoomAudioRenderer 로 들려 주고, 회원 카메라 트랙이 있을 때만 그 스트림을 위로 올린다(확정 결정 #1: 회원 영상은 기본 비공개).
// - 내 마이크·카메라는 로컬 참가자를 직접 제어한다. LiveKitRoom 의 audio/video props 는 연결 직후 한 번만 발행에 쓰이고 이후 변경은 반영되지 않는다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LiveKitRoom, RoomAudioRenderer, useConnectionState, useLocalParticipant, useRoomContext, useTracks } from '@livekit/components-react';
import { ConnectionState, MediaDeviceFailure, Track, type LocalVideoTrack } from 'livekit-client';
import { useAppResume } from '../../../../hooks/useAppResume';
import { RESUME_ORDER } from '../../../../lib/native/app-lifecycle';
import { recoverHostLiveKit } from '../../../../lib/native/host-resume-recovery';
import type { MediaFailureKind, MediaFailureReason } from './host-media-control';

interface HostLiveKitBridgeProps {
  token: string;
  serverUrl: string;
  /** 지금 원하는 마이크·카메라 상태 — 연결되면 로컬 참가자에 반영한다 */
  micOn: boolean;
  camOn: boolean;
  /** 권한을 다시 허용한 뒤 로컬 마이크·카메라 발행을 다시 시도하게 하는 증가 값 */
  retryKey?: number;
  onDisconnected?: () => void;
  onMediaFailure?: (kind: MediaFailureKind, reason: MediaFailureReason) => void;
  /** 내 카메라 트랙의 스트림(셀프뷰). 없으면 null */
  onSelfStream?: (stream: MediaStream | null) => void;
  /** SDK가 원본 교체를 셀프뷰에 반영하도록 트랙 자체를 전달한다. */
  onSelfTrack?: (track: LocalVideoTrack | null) => void;
  /** 회원이 켠 카메라 트랙의 스트림. 없거나 꺼졌으면 null */
  onMemberStream?: (stream: MediaStream | null) => void;
}

function reasonOf(failure: MediaDeviceFailure | undefined): MediaFailureReason {
  if (failure === MediaDeviceFailure.PermissionDenied) return 'denied';
  if (failure === MediaDeviceFailure.NotFound) return 'notfound';
  return 'other';
}

interface ProbeProps {
  micOn: boolean;
  camOn: boolean;
  retryKey: number;
  /** 앱 복귀 시 연결이 끊겨 있으면 LiveKit 연결을 새로 맺도록 요청한다 */
  onReconnectNeeded: () => void;
  onSelfStream?: (stream: MediaStream | null) => void;
  /** SDK가 원본 교체를 셀프뷰에 반영하도록 트랙 자체를 전달한다. */
  onSelfTrack?: (track: LocalVideoTrack | null) => void;
  onMemberStream?: (stream: MediaStream | null) => void;
}

function BridgeProbe({ micOn, camOn, retryKey, onReconnectNeeded, onSelfStream, onSelfTrack, onMemberStream }: ProbeProps) {
  const { localParticipant } = useLocalParticipant();
  const connected = useConnectionState() === ConnectionState.Connected;
  const tracks = useTracks([Track.Source.Camera]);
  const room = useRoomContext();

  // 앱 복귀(SDD-222 T-J10): 소켓 재연결(RESUME_ORDER.socket) 뒤에 연결 확인 → 카메라 복구 순으로 실행한다.
  useAppResume(() => recoverHostLiveKit({ room, camOn, reconnect: onReconnectNeeded }), RESUME_ORDER.liveKit);

  useEffect(() => {
    if (!connected || !localParticipant) return;
    void localParticipant.setMicrophoneEnabled(micOn).catch(() => undefined);
  }, [connected, localParticipant, micOn, retryKey]);

  useEffect(() => {
    if (!connected || !localParticipant) return;
    void localParticipant.setCameraEnabled(camOn).catch(() => undefined);
  }, [connected, localParticipant, camOn, retryKey]);

  const selfTrack = tracks.find((t) => t.participant.isLocal)?.publication?.track as LocalVideoTrack | undefined;

  useEffect(() => {
    onSelfTrack?.(selfTrack ?? null);
    return () => onSelfTrack?.(null);
  }, [selfTrack, onSelfTrack]);

  const selfStream = useMemo(
    () => tracks.find((t) => t.participant.isLocal && t.publication?.track?.mediaStream)?.publication?.track?.mediaStream ?? null,
    [tracks],
  );
  const memberStream = useMemo(
    () => tracks.find((t) => !t.participant.isLocal && !t.publication?.isMuted && t.publication?.track?.mediaStream)?.publication?.track?.mediaStream ?? null,
    [tracks],
  );

  useEffect(() => {
    onSelfStream?.(selfStream);
  }, [selfStream, onSelfStream]);
  useEffect(() => {
    onMemberStream?.(memberStream);
  }, [memberStream, onMemberStream]);

  return <RoomAudioRenderer />;
}

export function HostLiveKitBridge({ token, serverUrl, micOn, camOn, retryKey = 0, onDisconnected, onMediaFailure, onSelfStream, onSelfTrack, onMemberStream }: HostLiveKitBridgeProps) {
  // 연결 시점의 발행 상태만 LiveKitRoom 에 준다(이후 변경은 BridgeProbe 가 로컬 참가자로 직접 반영)
  const [initial] = useState({ audio: micOn, video: camOn });
  // key 를 올리면 LiveKitRoom 이 새로 마운트되어 연결을 다시 맺는다 — 백그라운드에서 완전히 끊긴 경우 복구용
  const [connectKey, setConnectKey] = useState(0);
  const handleReconnectNeeded = useCallback((): void => setConnectKey((k) => k + 1), []);
  const handleFailure = (failure: MediaDeviceFailure | undefined, kind?: MediaDeviceKind): void => {
    if (kind === 'audioinput') onMediaFailure?.('mic', reasonOf(failure));
    else if (kind === 'videoinput') onMediaFailure?.('camera', reasonOf(failure));
  };
  return (
    <LiveKitRoom
      key={connectKey}
      token={token}
      serverUrl={serverUrl}
      connect
      audio={initial.audio}
      video={initial.video}
      onDisconnected={onDisconnected}
      onMediaDeviceFailure={handleFailure}
      style={{ display: 'none' }}
    >
      <BridgeProbe micOn={micOn} camOn={camOn} retryKey={retryKey} onReconnectNeeded={handleReconnectNeeded} onSelfStream={onSelfStream} onSelfTrack={onSelfTrack} onMemberStream={onMemberStream} />
    </LiveKitRoom>
  );
}
