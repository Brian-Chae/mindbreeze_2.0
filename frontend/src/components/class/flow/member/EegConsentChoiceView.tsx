// SDD-220 — LINK BAND 연결 전 뇌파 수집 선택 동의. 리포트 반영·연구 활용 선택과 별개이며, 거부해도 클래스에 참여할 수 있다.
import { Activity } from 'lucide-react';
import { FlowButton, FlowCard, FlowH1, FlowSub } from '../shared/flow-primitives';
import { MemberFlowFrame, type MemberFlowSteps } from './MemberFlowFrame';
import { PrivacyPolicyLink } from '../../../legal/PrivacyPolicyLink';

interface EegConsentChoiceViewProps {
  steps: MemberFlowSteps;
  place?: 'online' | 'offline';
  saving: boolean;
  /** 저장하지 못했을 때의 안내 — 동의한 것으로 보지 않는다 */
  error: string | null;
  onAgree: () => void;
  onDecline: () => void;
  onBack: () => void;
  onExit: () => void;
}

export function EegConsentChoiceView({ steps, place = 'online', saving, error, onAgree, onDecline, onBack, onExit }: EegConsentChoiceViewProps) {
  return (
    <MemberFlowFrame
      wizard
      place={place}
      steps={steps}
      onBack={onBack}
      onExit={onExit}
      foot={
        <>
          <FlowButton kind="primary" disabled={saving} onClick={onAgree}>동의하고 LINK BAND 연결하기</FlowButton>
          <FlowButton kind="ghost" disabled={saving} onClick={onDecline}>동의하지 않고 계속하기</FlowButton>
          {error ? <p className="fm-err" role="alert">{error}</p> : null}
        </>
      }
    >
      <div className="fm-head fm-wiz-dense">
        <FlowH1>뇌파 측정에 동의하시나요? (선택)</FlowH1>
        <FlowSub>LINK BAND를 쓰려면 먼저 뇌파 수집에 동의해야 해요.</FlowSub>
      </div>
      <FlowCard size="sm">
        <section className="fm-blk" aria-label="뇌파 수집 안내">
          <div className="fm-nrow"><Activity size={20} aria-hidden="true" /><span className="tx"><span>LINK BAND로 측정한 뇌파를 수집해요</span></span></div>
          <div className="fm-rlist">
            <p className="fm-ft">동의하지 않아도 클래스에는 그대로 참여할 수 있어요</p>
            <p className="fm-ft">리포트 반영, 연구 활용 선택과는 별개예요</p>
            <p className="fm-ft">설정 &gt; 개인정보에서 언제든 바꿀 수 있어요</p>
            <p className="fm-ft"><PrivacyPolicyLink>개인정보 처리방침 보기</PrivacyPolicyLink></p>
          </div>
        </section>
      </FlowCard>
    </MemberFlowFrame>
  );
}
