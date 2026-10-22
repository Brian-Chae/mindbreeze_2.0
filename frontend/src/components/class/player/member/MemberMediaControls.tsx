// SDD-208 M2 — 회원 미디어 컨트롤(LiveKit 연동). 방(LiveKitRoom)은 화면 밖에 두고, 화면(children)은 방이 다시 만들어져도 유지한다.
//  - 회원 영상은 기본 비공개(spec 결정 #1): LiveKitRoom video={false}. 카메라는 회원이 켠 경우에만 setCameraEnabled(true).
//  - 켜 두려는 마음(micWanted·camWanted)은 이 컴포넌트가 보관한다 — 발언권 변경 등으로 방이 재마운트돼도(key 변경) 다시 적용된다.
//  - B2(말하기 종료) 서버 API 미적용(손들기 취소는 lower-hand API 사용): "말하기 종료" = 로컬 마이크 끄기.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { LiveKitRoom, RoomAudioRenderer, useConnectionState, useLocalParticipant, useTracks } from '@livekit/components-react';
import { ConnectionState, MediaDeviceFailure, Track } from 'livekit-client';
import { deriveMemberMedia, type MemberCaseInput } from '../../../../lib/class/member-player-case';
import { MemberTrackVideo } from './MemberPips';
import type { MemberViewActions } from './member-view-types';

type CamFailure = 'denied' | 'nodevice' | null;

interface LiveSnapshot {
  hostTrack: Track | null;
  localTrack: Track | null;
  connection: ConnectionState | null;
}

const EMPTY_SNAPSHOT: LiveSnapshot = { hostTrack: null, localTrack: null, connection: null };

export interface MemberMediaBinding {
  /** 케이스 입력 중 미디어가 정하는 부분 */
  input: Pick<MemberCaseInput, 'mic' | 'cam' | 'hand' | 'hostCamera'>;
  hostVideo: ReactNode;
  myVideo: ReactNode;
  actions: Pick<MemberViewActions, 'onToggleMic' | 'onToggleCam' | 'onRaiseHand' | 'onEndSpeaking'>;
  /** LiveKit 연결 상태 — 컨테이너가 네트워크 표시에 쓴다. 방이 없으면 null */
  roomConnection: ConnectionState | null;
}

interface MemberMediaControlsProps {
  place: 'online' | 'offline';
  mode: '1on1' | 'group';
  token: string | null;
  serverUrl: string;
  canPublish: boolean;
  speaking: boolean;
  raisedHand: boolean;
  raiseHand: () => Promise<void>;
  /** 손 내리기(손들기 취소) — 대기 중 같은 버튼을 다시 누르면 호출 */
  lowerHand?: () => Promise<void>;
  /** 손들기·손 내리기 실패 안내(짧은 문구) */
  raiseHandError?: string | null;
  /** 상담사 음성 듣기 */
  speakerOn: boolean;
  children: (binding: MemberMediaBinding) => ReactNode;
}

interface RoomBridgeProps {
  canPublish: boolean;
  micWanted: boolean;
  camWanted: boolean;
  onSnapshot: (snapshot: LiveSnapshot) => void;
  onCameraError: () => void;
}

function pickVideoTrack(tracks: ReturnType<typeof useTracks>, local: boolean): Track | null {
  for (const ref of tracks) {
    if (ref.participant.isLocal !== local) continue;
    const track = ref.publication?.track;
    if (track && track.kind === Track.Kind.Video) return track;
  }
  return null;
}

/** LiveKitRoom 안쪽에서 로컬 참가자·트랙을 읽고, 켜 두려는 상태(wanted)를 실제 발행 상태에 맞춘다 */
function RoomBridge({ canPublish, micWanted, camWanted, onSnapshot, onCameraError }: RoomBridgeProps) {
  const { localParticipant, isCameraEnabled, isMicrophoneEnabled } = useLocalParticipant();
  const tracks = useTracks([Track.Source.Camera]);
  const connection = useConnectionState();
  const hostTrack = pickVideoTrack(tracks, false);
  const localTrack = pickVideoTrack(tracks, true);
  const connected = connection === ConnectionState.Connected;

  useEffect(() => {
    if (!connected || !canPublish) return;
    if (camWanted === isCameraEnabled) return;
    localParticipant.setCameraEnabled(camWanted).catch(() => {
      if (camWanted) onCameraError();
    });
  }, [connected, canPublish, camWanted, isCameraEnabled, localParticipant, onCameraError]);

  useEffect(() => {
    if (!connected || !canPublish) return;
    if (micWanted === isMicrophoneEnabled) return;
    localParticipant.setMicrophoneEnabled(micWanted).catch(() => undefined);
  }, [connected, canPublish, micWanted, isMicrophoneEnabled, localParticipant]);

  useEffect(() => {
    onSnapshot({ hostTrack, localTrack, connection });
  }, [hostTrack, localTrack, connection, onSnapshot]);

  return null;
}

export function MemberMediaControls({
  place, mode, token, serverUrl, canPublish, speaking, raisedHand, raiseHand, lowerHand, raiseHandError, speakerOn, children,
}: MemberMediaControlsProps) {
  const [micWanted, setMicWanted] = useState(true);
  const [camWanted, setCamWanted] = useState(false);
  const [micFailure, setMicFailure] = useState<'denied' | null>(null);
  const [camFailure, setCamFailure] = useState<CamFailure>(null);
  const [live, setLive] = useState<LiveSnapshot>(EMPTY_SNAPSHOT);

  const granted = canPublish || speaking;

  // 발언권이 회수되면 다음 발언을 위해 마이크 선택을 켜짐으로 되돌린다
  useEffect(() => {
    if (mode === 'group' && !granted) setMicWanted(true);
  }, [mode, granted]);

  // 방이 사라지면(오프라인·토큰 없음) 이전 트랙 정보를 버린다
  const hasRoom = place === 'online' && Boolean(token);
  useEffect(() => {
    if (!hasRoom) setLive(EMPTY_SNAPSHOT);
  }, [hasRoom]);

  const handleFailure = useCallback((failure?: MediaDeviceFailure, kind?: MediaDeviceKind): void => {
    if (kind === 'audioinput') setMicFailure('denied');
    if (kind === 'videoinput') {
      setCamFailure(failure === MediaDeviceFailure.PermissionDenied ? 'denied' : 'nodevice');
      setCamWanted(false);
    }
  }, []);
  const handleCameraError = useCallback((): void => {
    setCamFailure((prev) => prev ?? 'denied');
    setCamWanted(false);
  }, []);

  const onToggleMic = useCallback((): void => setMicWanted((v) => !v), []);
  const onToggleCam = useCallback((): void => setCamWanted((v) => !v), []);
  const onEndSpeaking = useCallback((): void => setMicWanted(false), []);
  // 발언권을 가진 채 말하기를 끝낸 상태에서는 서버 호출 없이 마이크만 다시 켠다
  const raiseHandRef = useRef(raiseHand);
  useEffect(() => {
    raiseHandRef.current = raiseHand;
  });
  const lowerHandRef = useRef(lowerHand);
  useEffect(() => {
    lowerHandRef.current = lowerHand;
  });
  // 손든 대기 중(발언권 전)에 다시 누르면 손을 내린다 — 서버에 취소를 알린 뒤 idle 로 돌아간다
  const waiting = raisedHand && !granted;
  const onRaiseHand = useCallback((): void => {
    if (granted) setMicWanted(true);
    else if (waiting) void lowerHandRef.current?.();
    else void raiseHandRef.current();
  }, [granted, waiting]);

  const media = deriveMemberMedia({ place, mode, canPublish, speaking, raisedHand, micWanted, camWanted, micFailure, camFailure });
  const hostVideo = live.hostTrack ? <MemberTrackVideo track={live.hostTrack} className="mp-pip__video" /> : null;
  const myVideo = live.localTrack ? <MemberTrackVideo track={live.localTrack} className="mp-mypip__video" /> : null;

  const binding: MemberMediaBinding = {
    input: { ...media, hostCamera: live.hostTrack !== null },
    hostVideo,
    myVideo,
    actions: { onToggleMic, onToggleCam, onRaiseHand, onEndSpeaking },
    roomConnection: hasRoom ? live.connection : null,
  };

  return (
    <>
      {hasRoom ? (
        <LiveKitRoom
          // 발언권(발행 가능 여부)이 바뀌면 Room 을 새로 만든다 — 이미 연결된 방은 토큰만 바꿔도 권한이 반영되지 않는다
          key={canPublish ? 'publish' : 'subscribe'}
          token={token ?? undefined}
          serverUrl={serverUrl}
          connect
          video={false}
          audio={canPublish && micWanted}
          onMediaDeviceFailure={handleFailure}
          className="mp-lk-room"
          aria-hidden="true"
        >
          <RoomBridge canPublish={canPublish} micWanted={micWanted} camWanted={camWanted} onSnapshot={setLive} onCameraError={handleCameraError} />
          <RoomAudioRenderer volume={speakerOn ? 1 : 0} />
        </LiveKitRoom>
      ) : null}
      {children(binding)}
      {raiseHandError ? <p className="mp-hand-error" role="alert" data-pz="hand-error">{raiseHandError}</p> : null}
    </>
  );
}
