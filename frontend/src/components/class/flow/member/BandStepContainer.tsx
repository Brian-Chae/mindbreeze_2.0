// SDD-209 M4 — FM06c 연결 컨테이너. 이 단계에 있는 동안만 관찰용 useBand 를 쓰고, 떠나면 훅이 정리된다(BLE 연결은 전역이라 유지).
import { useEffect } from 'react';
import { useBandStep } from '../../../../hooks/useBandStep';
import { bandOutcomeOf, type BandOutcome } from '../../../../lib/class/flow/member-prep';
import type { BandSnapshot } from '../../../../lib/class/flow/member-presence';
import type { MemberFlowSteps } from './MemberFlowFrame';
import { BandStepView } from './BandStepView';

interface BandStepContainerProps {
  bandMode: 'opt' | 'req';
  place: 'online' | 'offline';
  steps: MemberFlowSteps;
  startedRemaining: readonly string[] | null;
  onDone: (outcome: BandOutcome) => void;
  /** 밴드 상태가 바뀔 때마다 알린다(상담사 로비의 접촉 표시용). 값은 서버에 저장되지 않는다 */
  onBandChange?: (snapshot: BandSnapshot) => void;
  onStartedEnterNow: () => void;
  onStartedContinue: () => void;
  onBack: () => void;
  onExit: () => void;
}

export function BandStepContainer({ onDone, onBandChange, ...rest }: BandStepContainerProps) {
  const band = useBandStep(true);
  const leadCh1 = band.leadOff?.ch1;
  const leadCh2 = band.leadOff?.ch2;
  useEffect(() => {
    onBandChange?.({
      state: band.state,
      leadOff: leadCh1 === undefined || leadCh2 === undefined ? null : { ch1: leadCh1, ch2: leadCh2 },
      battery: band.battery,
    });
    // onBandChange 는 부모가 매 렌더 새로 만들 수 있어 값이 바뀔 때만 보낸다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [band.state, leadCh1, leadCh2, band.battery]);
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
