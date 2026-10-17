// SDD-209 H1~H2 — 클래스 만들기 마법사 뷰(FH02a~e). 상태·API 는 컨테이너/하니스가 props 로 넘긴다.
import type { Dispatch, ReactNode } from 'react';
import { AlertTriangle, Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { WizardAction, WizardState } from '../../../../lib/class/class-wizard';
import { FlowButton, FlowSheet, FlowSteps } from '../shared/flow-primitives';
import { HostFlowFrame } from './HostFlowFrame';
import { StepRecord, StepType } from './wizard-steps';

export interface WizardViewProps {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  /** 마지막 단계 `클래스 만들기` — 제출 중이면 비활성 */
  onSubmit?: () => void;
  submitting?: boolean;
  /** 나가기 확정 */
  onExit?: () => void;
  backdropSrc?: string;
}

function StepBody({ state, dispatch }: Pick<WizardViewProps, 'state' | 'dispatch'>): ReactNode {
  const props = { draft: state.draft, ui: state.ui, dispatch };
  switch (state.step) {
    case 1:
      return <StepType {...props} />;
    case 2:
      return <StepRecord {...props} />;
    default:
      return null;
  }
}

export function WizardView({ state, dispatch, onSubmit, submitting = false, onExit, backdropSrc }: WizardViewProps) {
  const { step, ui } = state;
  const last = step === 5;
  const next = (): void => {
    if (last) onSubmit?.();
    else dispatch({ type: 'next' });
  };
  return (
    <HostFlowFrame
      className="fh-wiz"
      place={state.draft.place}
      backdropSrc={backdropSrc}
      fill={step === 4}
      left={{ label: '나가기', icon: <X size={24} />, onClick: () => dispatch({ type: 'openLeave' }) }}
      title="클래스 만들기"
      sheetOpen={ui.leaveOpen}
      sheet={
        <FlowSheet
          open={ui.leaveOpen}
          title="만들기를 그만둘까요?"
          onClose={() => dispatch({ type: 'closeLeave' })}
          footer={
            <div className="fh-sfoot">
              <FlowButton kind="soft" onClick={() => dispatch({ type: 'closeLeave' })}>계속 만들기</FlowButton>
              <FlowButton kind="danger" onClick={onExit}>나가기</FlowButton>
            </div>
          }
        >
          <div className="fh-sbody">
            <span className="fh-sico"><AlertTriangle size={24} aria-hidden="true" /></span>
            <p>입력한 내용은 저장되지 않아요.</p>
          </div>
        </FlowSheet>
      }
      foot={
        <div className="fh-nav2">
          {step === 1 ? (
            <span className="fh-spacer" aria-hidden="true" />
          ) : (
            <FlowButton kind="soft" onClick={() => dispatch({ type: 'prev' })}>
              <ChevronLeft size={20} aria-hidden="true" />이전
            </FlowButton>
          )}
          <FlowButton kind="primary" disabled={submitting} onClick={next}>
            {last ? (<><Check size={20} aria-hidden="true" />클래스 만들기</>) : (<>다음<ChevronRight size={20} aria-hidden="true" /></>)}
          </FlowButton>
        </div>
      }
    >
      <FlowSteps total={5} current={step - 1} />
      <StepBody state={state} dispatch={dispatch} />
    </HostFlowFrame>
  );
}
