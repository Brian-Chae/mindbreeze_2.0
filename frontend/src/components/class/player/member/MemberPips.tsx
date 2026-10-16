// SDD-208 — 회원 미디어 표시부(순수 뷰): 상담사 PiP · 내 PiP · 미디어 줄(마이크·카메라·손들기).
// LiveKit 연결·권한은 MemberMediaControls 가 맡고, 여기서는 상태를 그리기만 한다.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Hand, Maximize2, Mic, MicOff, Pause, User, Video, VideoOff } from 'lucide-react';
import type { Track } from 'livekit-client';
import type { MediaButton, MemberCase } from '../../../../lib/class/member-player-case';
import type { CamUi } from '../../../../lib/class/player-case';
import type { MemberViewActions } from './member-view-types';
import './member-player.css';

/** LiveKit 트랙을 <video> 에 붙인다. 컨텍스트 없이 동작하도록 컴포넌트 대신 attach() 를 쓴다 */
export function MemberTrackVideo({ track, className }: { track: Track; className: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return <video ref={ref} className={className} autoPlay playsInline muted aria-hidden="true" />;
}

interface MemberHostPipProps {
  name: string | null;
  /** 네트워크가 정상이 아니면 영상이 멈춘 것으로 표시 */
  frozen: boolean;
  video: ReactNode;
}

export function MemberHostPip({ name, frozen, video }: MemberHostPipProps) {
  const [expanded, setExpanded] = useState(false);
  const who = name ? `${name} 상담사` : '상담사';
  return (
    <button
      type="button"
      className="mp-pip"
      data-pz="pip"
      data-expanded={expanded ? 'true' : 'false'}
      aria-expanded={expanded}
      aria-label={`${who} 영상 — 누르면 ${expanded ? '작게' : '크게'} 보기`}
      onClick={() => setExpanded((v) => !v)}
    >
      {video ?? <User className="mp-pip__avatar" size={48} strokeWidth={1.6} aria-hidden="true" />}
      <Maximize2 className="mp-pip__expand" size={16} strokeWidth={2} aria-hidden="true" />
      <span className="mp-pip__chip">
        <i className="mp-pip__dot" />
        {name ?? '상담사'}
        {name ? <span className="mp-pip__long">&nbsp;상담사</span> : null}
      </span>
      {frozen ? (
        <span className="mp-pip__freeze">
          <Pause size={22} strokeWidth={2} aria-hidden="true" />
          영상 멈춤
        </span>
      ) : null}
    </button>
  );
}

interface MemberMyPipProps {
  cam: CamUi;
  initial: string;
  video: ReactNode;
}

/** 내 PiP 는 카메라 상태가 바뀌어도 같은 자리·같은 크기를 지킨다(켜짐 · 꺼짐=이니셜 · 사용 불가=안내) */
export function MemberMyPip({ cam, initial, video }: MemberMyPipProps) {
  const blocked = cam === 'denied' || cam === 'nodevice';
  return (
    <div className="mp-mypip" data-pz="mypip" data-cam={cam} aria-label="내 화면">
      {cam === 'on' ? (
        <>
          {video ?? <span className="mp-mypip__body"><User className="mp-mypip__avatar" size={48} strokeWidth={1.6} aria-hidden="true" /></span>}
        </>
      ) : null}
      {cam === 'off' ? <span className="mp-mypip__body"><span className="mp-mypip__init" aria-hidden="true">{initial}</span></span> : null}
      {blocked ? (
        <span className="mp-mypip__body mp-mypip__deny">
          <VideoOff size={22} strokeWidth={2} aria-hidden="true" />
          <span>카메라를 쓸 수 없어요</span>
        </span>
      ) : null}
      {blocked ? null : <span className="mp-mypip__chip">{cam === 'off' ? '카메라 꺼짐' : '나'}</span>}
    </div>
  );
}

type MediaActions = Pick<MemberViewActions, 'onToggleMic' | 'onToggleCam' | 'onRaiseHand' | 'onEndSpeaking'>;

interface MediaButtonViewProps {
  button: MediaButton;
  icon: ReactNode;
  onClick: () => void;
}

function MediaButtonView({ button, icon, onClick }: MediaButtonViewProps) {
  return (
    <button
      type="button"
      className="mp-mbtn"
      data-pz="mbtn"
      data-s={button.s}
      aria-disabled={button.disabled ? 'true' : 'false'}
      aria-pressed={button.pressed}
      onClick={button.disabled ? undefined : onClick}
    >
      {icon}
      <span>{button.label}</span>
    </button>
  );
}

const ICON = { size: 20, strokeWidth: 2, 'aria-hidden': true } as const;

interface MemberMediaRowProps {
  c: MemberCase;
  /** 모바일 바텀 시트가 열려 있으면 줄을 접는다(CSS) */
  sheetOpen: boolean;
  actions: MediaActions;
}

export function MemberMediaRow({ c, sheetOpen, actions }: MemberMediaRowProps) {
  if (!c.showMediaRow) return null;
  return (
    <div className="mp-media-row" data-pz="media-row" data-sheet-open={sheetOpen ? 'true' : 'false'} role="group" aria-label="마이크·카메라">
      {c.mic ? (
        <MediaButtonView
          button={c.mic}
          icon={c.mic.s === 'on' || c.mic.s === 'speaking' ? <Mic {...ICON} /> : <MicOff {...ICON} />}
          onClick={actions.onToggleMic}
        />
      ) : null}
      {c.cam ? (
        <MediaButtonView button={c.cam} icon={c.cam.s === 'on' ? <Video {...ICON} /> : <VideoOff {...ICON} />} onClick={actions.onToggleCam} />
      ) : null}
      {c.hand ? (
        <MediaButtonView
          button={c.hand}
          icon={<Hand {...ICON} />}
          onClick={c.hand.s === 'speaking' ? actions.onEndSpeaking : actions.onRaiseHand}
        />
      ) : null}
    </div>
  );
}
