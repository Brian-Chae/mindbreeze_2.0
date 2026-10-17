// SDD-209 M4 — FM06c 연결 컨테이너. 이 단계에 있는 동안만 관찰용 useBand 를 쓰고, 떠나면 훅이 정리된다(BLE 연결은 전역이라 유지).
import { useBandStep } from '../../../../hooks/useBandStep';
import { bandOutcomeOf, type BandOutcome } from '../../../../lib/class/flow/member-prep';
import type { MemberFlowSteps } from './MemberFlowFrame';
import { BandStepView } from './BandStepView';

interface BandStepContainerProps {
  bandMode: 'opt' | 'req';
  place: 'online' | 'offline';
  steps: MemberFlowSteps;
  startedRemaining: readonly string[] | null;
  onDone: (outcome: BandOutcome) => void;
  onStartedEnterNow: () => void;
  onStartedContinue: () => void;
  onBack: () => void;
  onExit: () => void;
}

export function BandStepContainer({ onDone, ...rest }: BandStepContainerProps) {
  const band = useBandStep(true);
  return (
    <BandStepView
      {...rest}
      state={band.state}
      leadOff={band.leadOff}
      battery={band.battery}
      onConnect={() => void band.connect()}
      onDisconnect={() => void band.disconnect()}
      onNext={() => onDone(bandOutcomeOf(band.state, 'next'))}
      onSkip={() => onDone(bandOutcomeOf(band.state, 'skip'))}
    />
  );
}
