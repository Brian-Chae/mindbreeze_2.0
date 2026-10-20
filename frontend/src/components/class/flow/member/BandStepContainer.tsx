// SDD-209 M4 — FM06c 연결 컨테이너. 이 단계에 있는 동안만 관찰용 useBand 를 쓰고, 떠나면 훅이 정리된다(BLE 연결은 전역이라 유지).
import { useEffect, useState } from 'react';
import { useBandStep } from '../../../../hooks/useBandStep';
import { bandOutcomeOf, type BandOutcome } from '../../../../lib/class/flow/member-prep';
import type { BandSnapshot } from '../../../../lib/class/flow/member-presence';
import type { MemberFlowSteps } from './MemberFlowFrame';
import { BandStepView } from './BandStepView';
import { EegConsentChoiceView } from './EegConsentChoiceView';

interface BandStepContainerProps {
  bandMode: 'opt' | 'req';
  place: 'online' | 'offline';
  steps: MemberFlowSteps;
  startedRemaining: readonly string[] | null;
  onDone: (outcome: BandOutcome) => void;
  /** 밴드 상태가 바뀔 때마다 알린다(상담사 로비의 접촉 표시용). 값은 서버에 저장되지 않는다 */
  onBandChange?: (snapshot: BandSnapshot) => void;
  /**
   * SDD-220 — 뇌파 수집 선택 저장. 넘기면 밴드 연결 전에 선택 화면을 먼저 보여 준다(거부하면 밴드 없이 계속).
   * 저장에 실패하면 던져야 하며, 그때는 동의한 것으로 보지 않고 다시 고르게 한다.
   */
  onEegChoice?: (agree: boolean) => Promise<void>;
  onStartedEnterNow: () => void;
  onStartedContinue: () => void;
  onBack: () => void;
  onExit: () => void;
}

export function BandStepContainer({ onDone, onBandChange, onEegChoice, ...rest }: BandStepContainerProps) {
  // 선택 저장 전(unset)에는 밴드 연결 UI 를 열지 않는다. onEegChoice 가 없으면 기존 동작(바로 연결 단계).
  const [eegChoice, setEegChoice] = useState<'unset' | 'agreed'>(onEegChoice ? 'unset' : 'agreed');
  const [eegSaving, setEegSaving] = useState(false);
  const [eegError, setEegError] = useState<string | null>(null);
  const band = useBandStep(eegChoice === 'agreed');
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
  const choose = async (agree: boolean): Promise<void> => {
    if (!onEegChoice || eegSaving) return;
    setEegSaving(true);
    setEegError(null);
    try {
      await onEegChoice(agree);
      if (agree) setEegChoice('agreed');
      else onDone('skipped');
    } catch {
      setEegError('선택을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setEegSaving(false);
    }
  };
  if (eegChoice === 'unset') {
    return (
      <EegConsentChoiceView
        steps={rest.steps} place={rest.place} saving={eegSaving} error={eegError}
        onAgree={() => void choose(true)} onDecline={() => void choose(false)} onBack={rest.onBack} onExit={rest.onExit}
      />
    );
  }
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
