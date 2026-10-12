// 상담사 라이브 영상 타일 — 회원/게스트 LiveKitRoom
// canPublish(온라인 양방향)면 회원 카메라/마이크를 송출하고, 아니면 수신 전용.
// 자연 배경 위에 올라가는 반투명 카드. 토큰이 없거나 원격 트랙이 없으면 준비 중 표시.
// speakerOn=false면 상담사 오디오 볼륨 0 (하울링 방지 뮤트) — 오프라인 수업 기본 뮤트용.
// SDD-094: 온라인 그룹(≤20)은 기본 뮤트 — [손 들기]로 발언권을 요청하고,
// speaking_changed 수신 시 토큰이 재발급되면(canPublish=true) 카메라·마이크가 켜진다.
import { useEffect } from 'react';
import { LiveKitRoom, RoomAudioRenderer, useTracks, VideoTrack } from '@livekit/components-react';
import '@livekit/components-styles';
import { Track } from 'livekit-client';
import { useMemberLiveKit } from '../../hooks/useMemberLiveKit';

interface CounselorLiveTileProps {
  code: string | null;
  participantId: string | null;
  participantToken?: string | null;
  /** SDD-094: 손들기 API 경로용 세션 id */
  sessionId?: string | null;
  /** SDD-094: 온라인 그룹(≤20)에서만 true — 손들기 UI 노출 대상 */
  speakingManaged?: boolean;
  /** 스피커 on/off — false면 상담사 음성 음소거 (하울링 방지) */
  speakerOn?: boolean;
  className?: string;
}

/** 대기·실패 상태도 영상 영역 안에서 같은 높이를 유지한다. */
function CounselorPlaceholder({ message }: { message: string }) {
  return <div className="player-video-placeholder flex h-full w-full flex-col items-center justify-center text-white/60">
    <span className="player-video-avatar" aria-hidden="true">♙</span>
    <p>{message}</p>
  </div>;
}

/** 구독한 원격(상담사) 카메라 트랙만 렌더 */
function HostCamera() {
  const tracks = useTracks([Track.Source.Camera]);
  const remoteCameras = tracks.filter((t) => !t.participant.isLocal);
  if (remoteCameras.length === 0) {
    return (
      <CounselorPlaceholder message="상담사 영상 연결 중…" />
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

/** 발언권 부여 시 본인 카메라 확인용 셀프뷰 (송출 중일 때만 표시) */
function MemberSelfView() {
  const tracks = useTracks([Track.Source.Camera]);
  const localCamera = tracks.find((t) => t.participant.isLocal);
  if (!localCamera) return null;
  return (
    <VideoTrack
      trackRef={localCamera}
      className="absolute right-3 top-3 z-10 h-20 w-28 rounded-lg object-cover ring-1 ring-white/40"
    />
  );
}

export function CounselorLiveTile({
  code,
  participantId,
  participantToken,
  sessionId = null,
  speakingManaged = false,
  speakerOn = true,
  className = '',
}: CounselorLiveTileProps) {
  const {
    token,
    canPublish,
    error,
    notReady,
    attemptCount,
    connect,
    serverUrl,
    raisedHand,
    raising,
    raiseHandError,
    raiseHand,
  } = useMemberLiveKit({
    code,
    participantId,
    participantToken,
    sessionId,
    listenSpeakingChanges: speakingManaged,
  });

  // 진입 시 연결 + 상담사 화상 미시작이면 5초 간격 재시도
  useEffect(() => {
    void connect();
  }, [connect]);

  // SDD-131(②-17): 상담사 화상 미시작 시 지수 백오프 재시도(5s→10s→20s→40s, 최대 5회)
  useEffect(() => {
    if (!notReady || attemptCount >= 5) return;
    const delay = Math.min(5000 * 2 ** attemptCount, 30000);
    const id = window.setTimeout(() => void connect(), delay);
    return () => window.clearTimeout(id);
  }, [notReady, connect, attemptCount]);

  if (error && !token) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <CounselorPlaceholder message="상담사 영상을 불러오지 못했습니다" />
      </div>
    );
  }

  if (!token) {
    return (
      <div className={`flex flex-col items-center justify-center gap-3 ${className}`}>
        <CounselorPlaceholder message="상담사 영상을 기다리고 있어요" />
        {notReady && attemptCount >= 5 && (
          <button
            type="button"
            onClick={() => void connect()}
            className="rounded-full bg-white/20 px-5 py-2 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-white/30"
          >
            영상 다시 시도
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden rounded-2xl bg-black/40 ${className}`}>
      <LiveKitRoom
        // 발언권(송출 가능 여부)이 바뀌면 Room을 새로 만든다 — livekit-client의 Room.connect 는
        // 이미 연결된 상태면 즉시 반환하므로, 토큰만 갈아끼우면 카메라·마이크 권한이 반영되지 않는다.
        key={canPublish ? 'publish' : 'subscribe'}
        token={token}
        serverUrl={serverUrl}
        connect={true}
        // 온라인 양방향(canPublish)일 때만 로컬 카메라/마이크 캡처·발행
        video={canPublish}
        audio={canPublish}
        className="h-full w-full"
      >
        <HostCamera />
        {canPublish && <MemberSelfView />}
        {/* speakerOn=false → 볼륨 0 (클라이언트측 즉시 뮤트, 재구독 지연 없음) */}
        <RoomAudioRenderer volume={speakerOn ? 1 : 0} />
      </LiveKitRoom>

      {/* SDD-094: 발언권 UI — 온라인 그룹(≤20)에서만. 부여되면 버튼 대신 상태 표시 */}
      {speakingManaged && (
        <div className="player-speaking pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent p-3">
          {canPublish ? (
            <span className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-[#59CE90]/25 px-3 py-1.5 text-[12px] font-semibold text-[#B8F5D6]">
              🎤 발언권 부여됨 · 카메라·마이크 켜짐
            </span>
          ) : raisedHand ? (
            <span className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-amber-100/20 px-3 py-1.5 text-[12px] font-semibold text-amber-200">
              🙋 손들기 완료 · 상담사 승인 대기
            </span>
          ) : (
            <button
              type="button"
              onClick={() => void raiseHand()}
              disabled={raising || !sessionId || !participantId}
              className="pointer-events-auto rounded-full bg-white/20 px-5 py-2 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-white/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {raising ? '요청 중…' : '🙋 손 들기'}
            </button>
          )}
          {raiseHandError && (
            <p
              role="alert"
              className="pointer-events-auto max-w-sm text-center text-[12px] font-medium text-red-200"
            >
              {raiseHandError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
