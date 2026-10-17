// SDD-209 M5 — FM06d 컨테이너. 이 단계에 있는 동안만 마이크·카메라를 쥔다(떠나면 훅이 스트림을 정리한다).
import { useState } from 'react';
import { useMediaCheck } from '../../../../hooks/useMediaCheck';
import { deviceOutcomeOf, type MicOutcome } from '../../../../lib/class/flow/member-prep';
import type { MemberFlowSteps } from './MemberFlowFrame';
import { DeviceStepView } from './DeviceStepView';

interface DeviceStepContainerProps {
  solo: boolean;
  steps: MemberFlowSteps;
  startedRemaining: readonly string[] | null;
  onDone: (result: { mic: MicOutcome; camOn: boolean }) => void;
  onStartedEnterNow: () => void;
  onStartedContinue: () => void;
  onBack: () => void;
  onExit: () => void;
}

export function DeviceStepContainer({ onDone, ...rest }: DeviceStepContainerProps) {
  const media = useMediaCheck();
  const [helpDevice, setHelpDevice] = useState<'마이크' | '카메라' | null>(null);
  const copyLink = (): void => {
    void navigator.clipboard?.writeText(window.location.href).catch(() => undefined);
  };
  return (
    <DeviceStepView
      {...rest}
      mic={media.mic} cam={media.cam} level={media.level} ringSteps={media.steps} quiet={media.quiet} speakerPlaying={media.speakerPlaying}
      videoRef={media.videoRef}
      helpDevice={helpDevice}
      onToggleMic={() => void media.toggleMic()}
      onToggleCamera={() => void media.toggleCamera()}
      onRecheck={() => {
        setHelpDevice(null);
        void media.recheck();
      }}
      onPlayTone={() => void media.playTestTone()}
      onOpenHelp={setHelpDevice}
      onCloseHelp={() => setHelpDevice(null)}
      onCopyLink={copyLink}
      onNext={() => onDone(deviceOutcomeOf(media.mic, media.cam))}
    />
  );
}
