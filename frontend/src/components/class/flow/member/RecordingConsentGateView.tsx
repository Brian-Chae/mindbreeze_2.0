// SDD-220 F1 — 초대받은 회원이 링크로 들어왔을 때(서버가 녹음·녹화 동의 없음으로 거부) 동의 후 입장하는 화면.
import { FlowButton, FlowCard, FlowH1, FlowSub } from '../shared/flow-primitives';
import { MemberFlowFrame } from './MemberFlowFrame';
import { RecordingConsentCheck } from './RecordingConsentCheck';

interface RecordingConsentGateViewProps {
  title: string;
  checked: boolean;
  submitting: boolean;
  error: string | null;
  onChange: (checked: boolean) => void;
  onConfirm: () => void;
  onBack: () => void;
}

export function RecordingConsentGateView({ title, checked, submitting, error, onChange, onConfirm, onBack }: RecordingConsentGateViewProps) {
  return (
    <MemberFlowFrame
      title="입장 전 확인"
      onBack={onBack}
      colClassName="fm-narrow"
      foot={<FlowButton kind="primary" disabled={!checked || submitting} onClick={onConfirm}>{submitting ? '입장 중…' : '동의하고 입장하기'}</FlowButton>}
    >
      <FlowCard size="sm">
        <FlowH1>{title}</FlowH1>
        <FlowSub>입장하려면 녹음·녹화 안내를 확인하고 동의해 주세요.</FlowSub>
        <RecordingConsentCheck checked={checked} error={error} onChange={onChange} />
      </FlowCard>
    </MemberFlowFrame>
  );
}
