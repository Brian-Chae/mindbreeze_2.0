// SDD-209 H4 — FH05 세팅(클래스 열기 전 장비 점검): "내 영상·소리" 합친 컴포넌트 + 하단 `클래스 열기`.
// 오프라인은 장비 점검 대신 장소·안내를 보인다(getUserMedia 호출 0회는 컨테이너가 보장).
import type { ReactNode, RefObject } from 'react';
import { AlertTriangle, Bell, ChevronLeft, DoorOpen, Mic, MapPin, Pencil, VideoOff, Waves } from 'lucide-react';
import { setupFootNote } from '../../../../lib/class/flow/host-open';
import type { MediaDeviceUi } from '../../../../lib/class/class-media';
import type { FlowPlace } from '../../../../lib/class/flow/types';
import { MyAvCheck } from '../shared/MyAvCheck';
import { PermissionHelpSheet } from '../shared/PermissionHelpSheet';
import { FlowButton, FlowSheet } from '../shared/flow-primitives';
import { HostFlowFrame } from './HostFlowFrame';

export interface SetupMedia {
  mic: MediaDeviceUi;
  cam: MediaDeviceUi;
  level: number;
  steps: number;
  quiet: boolean;
  speakerPlaying: boolean;
  videoRef?: RefObject<HTMLVideoElement | null>;
}

export interface SetupScreenProps {
  title: string;
  /** `오늘 오후 3:00` 같은 상대 표기 */
  startText: string;
  place: FlowPlace;
  solo: boolean;
  address: string | null;
  media: SetupMedia;
  opening?: boolean;
  /** 마이크 꺼짐 확인 시트 */
  micOffSheetOpen: boolean;
  helpDevice: '마이크' | '카메라' | null;
  backdropSrc?: string;
  onBack: () => void;
  onOpen: () => void;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onRecheck: () => void;
  onPlayTone: () => void;
  onOpenHelp: (device: '마이크' | '카메라') => void;
  onCloseHelp: () => void;
  onCopyLink?: () => void;
  /** 시트: 마이크 켜고 열기 / 꺼진 채로 열기(수동 기록) / 돌아가기 */
  onOpenWithMic: () => void;
  onOpenManual: () => void;
  onDismissMicOff: () => void;
}

function Row({ icon, title, sub, strong, warn }: { icon: ReactNode; title?: string; sub: string; strong?: boolean; warn?: boolean }) {
  return (
    <div className={strong ? 'fhb-row strong' : 'fhb-row'}>
      <span className={warn ? 'fhb-ico warn' : 'fhb-ico'}>{icon}</span>
      <div className="fhb-rt">
        {title ? <b>{title}</b> : null}
        <span className={warn ? 'warn' : undefined}>{sub}</span>
      </div>
    </div>
  );
}

function failureHint(media: SetupMedia): string | null {
  if (media.mic === 'nodevice' && media.cam === 'nodevice') return '연결된 카메라와 마이크가 없어요. 없이 열면 수동 기록이에요';
  if (media.mic === 'denied') return '주소창 왼쪽 설정에서 마이크를 허용해 주세요';
  if (media.cam === 'denied') return '주소창 왼쪽 설정에서 카메라를 허용해 주세요';
  if (media.mic === 'off') return '꺼져 있어요. 켜지 않으면 녹음과 AI 기록지를 만들 수 없어요';
  return null;
}

export function SetupScreen(props: SetupScreenProps) {
  const { title, startText, place, solo, address, media, opening = false, micOffSheetOpen, helpDevice, backdropSrc } = props;
  const offline = place === 'offline';
  const hint = offline ? null : failureHint(media);
  const sheetOpen = micOffSheetOpen || helpDevice !== null;
  return (
    <HostFlowFrame
      className="fh-setup"
      place={place}
      backdropSrc={backdropSrc}
      left={{ label: '나가기', icon: <ChevronLeft size={24} />, onClick: props.onBack }}
      title={title}
      sub={offline ? `준비 · 오프라인 · ${startText}` : `장비 점검 · ${startText} 시작`}
      sheetOpen={sheetOpen}
      sheet={
        <>
          <FlowSheet
            open={micOffSheetOpen}
            title="마이크가 꺼져 있어요"
            onClose={props.onDismissMicOff}
            footer={
              <div className="fhb-act">
                <FlowButton kind="primary" onClick={props.onOpenWithMic}><Mic size={20} aria-hidden="true" />마이크 켜고 열기</FlowButton>
                <FlowButton kind="soft" onClick={props.onOpenManual}><Pencil size={20} aria-hidden="true" />꺼진 채로 열기 (수동 기록)</FlowButton>
                <FlowButton kind="ghost" onClick={props.onDismissMicOff}>돌아가기</FlowButton>
              </div>
            }
          >
            <div className="fhb-ctr">
              <span className="fhb-ico lg warn"><Mic size={24} aria-hidden="true" /></span>
              <p>이대로 열면 음성 녹음과 AI 기록지를 만들 수 없어요. 마이크를 켜고 열거나, 수동 기록 모드로 열 수 있어요.</p>
            </div>
          </FlowSheet>
          <PermissionHelpSheet open={helpDevice !== null} device={helpDevice ?? '마이크'} onClose={props.onCloseHelp} onRecheck={props.onRecheck} />
        </>
      }
      foot={
        <>
          <FlowButton kind="primary" disabled={opening} onClick={props.onOpen}>
            <DoorOpen size={20} aria-hidden="true" />{opening ? '여는 중이에요' : '클래스 열기'}
          </FlowButton>
          <p className="fhb-fnote">{setupFootNote(place, media.mic, media.cam, media.quiet)}</p>
        </>
      }
    >
      {offline ? (
        <>
          <Row strong icon={<MapPin size={20} aria-hidden="true" />} title={address?.trim() || '장소는 클래스 상세에서 확인해요'} sub={`${startText} 시작 예정`} />
          <Row icon={<VideoOff size={20} aria-hidden="true" />} title="카메라와 마이크는 쓰지 않아요" sub="대면 클래스라 장비 점검 없이 바로 열 수 있어요." />
          <Row icon={<Bell size={20} aria-hidden="true" />} title="초대한 회원에게 알려요" sub="열면 초대한 회원에게 알림을 요청해요. 도착하면 입장해요." />
          <Row icon={<Waves size={20} aria-hidden="true" />} title="LINK BAND는 선택이에요" sub="원하는 회원만 이마에 착용하고, 없어도 진행할 수 있어요." />
        </>
      ) : (
        <>
          <MyAvCheck
            mic={media.mic}
            cam={media.cam}
            level={media.level}
            steps={media.steps}
            quiet={media.quiet}
            solo={solo}
            speakerPlaying={media.speakerPlaying}
            videoRef={media.videoRef}
            onToggleMic={props.onToggleMic}
            onToggleCamera={props.onToggleCamera}
            onRecheck={props.onRecheck}
            onPlayTone={props.onPlayTone}
            onOpenHelp={props.onOpenHelp}
            onCopyLink={props.onCopyLink}
          />
          {hint ? (
            <div className="fhb-row" role="status">
              <span className="fhb-ico warn"><AlertTriangle size={20} aria-hidden="true" /></span>
              <div className="fhb-rt"><span className="warn">{hint}</span></div>
            </div>
          ) : null}
        </>
      )}
    </HostFlowFrame>
  );
}
