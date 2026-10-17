// SDD-209 M5 — FM06d 기기 점검(온라인만). 내 영상·소리 합친 컴포넌트(MyAvCheck) + 스피커 + 허용 방법 시트.
// 마이크 권한은 사용자가 토글을 누를 때만 요청한다(진입 즉시 요청 없음). 어떤 결과여도 `다음`은 항상 활성이다.
import type { RefObject } from 'react';
import type { MediaDeviceUi } from '../../../../lib/class/class-media';
import { FlowButton, FlowH1, FlowSub } from '../shared/flow-primitives';
import { MyAvCheck } from '../shared/MyAvCheck';
import { PermissionHelpSheet } from '../shared/PermissionHelpSheet';
import { MemberFlowFrame, type MemberFlowSteps } from './MemberFlowFrame';
import { StartedSheet } from './StartedSheet';

export interface DeviceStepViewProps {
  mic: MediaDeviceUi;
  cam: MediaDeviceUi;
  level: number;
  ringSteps: number;
  quiet: boolean;
  solo: boolean;
  speakerPlaying: boolean;
  steps: MemberFlowSteps;
  videoRef?: RefObject<HTMLVideoElement | null>;
  /** 허용 방법 시트가 열려 있는 장치. 닫혀 있으면 null */
  helpDevice: '마이크' | '카메라' | null;
  /** 시작 후 시트 — 남은 준비 이름들 */
  startedRemaining: readonly string[] | null;
  backdropSrc?: string;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onRecheck: () => void;
  onPlayTone: () => void;
  onOpenHelp: (device: '마이크' | '카메라') => void;
  onCloseHelp: () => void;
  onCopyLink: () => void;
  onStartedEnterNow?: () => void;
  onStartedContinue?: () => void;
  onNext: () => void;
  onBack: () => void;
  onExit: () => void;
}

export function DeviceStepView(props: DeviceStepViewProps) {
  const { helpDevice, startedRemaining, backdropSrc, steps, onNext, onBack, onExit } = props;
  const sheet = helpDevice ? (
    <PermissionHelpSheet open device={helpDevice} onClose={props.onCloseHelp} onRecheck={props.onRecheck} />
  ) : startedRemaining ? (
    <StartedSheet open remaining={startedRemaining} onEnterNow={props.onStartedEnterNow ?? onNext} onContinue={props.onStartedContinue ?? onNext} />
  ) : null;
  return (
    <MemberFlowFrame
      wizard
      place="online"
      backdropSrc={backdropSrc}
      steps={steps}
      onBack={onBack}
      onExit={onExit}
      sheet={sheet}
      sheetOpen={sheet !== null}
      foot={
        <>
          <FlowButton kind="primary" onClick={onNext}>다음</FlowButton>
          <p className="fl-note fm-slot">마이크는 입장한 뒤에도 다시 켤 수 있어요.</p>
        </>
      }
    >
      <div className="fm-head">
        <FlowH1>내 영상과 소리를 확인해요</FlowH1>
        <FlowSub>마이크는 꼭 필요하고, 카메라와 스피커는 선택이에요.</FlowSub>
      </div>
      <MyAvCheck
        mic={props.mic} cam={props.cam} level={props.level} steps={props.ringSteps} quiet={props.quiet} solo={props.solo}
        speakerPlaying={props.speakerPlaying} videoRef={props.videoRef}
        onToggleMic={props.onToggleMic} onToggleCamera={props.onToggleCamera} onRecheck={props.onRecheck}
        onPlayTone={props.onPlayTone} onOpenHelp={props.onOpenHelp} onCopyLink={props.onCopyLink}
      />
    </MemberFlowFrame>
  );
}
