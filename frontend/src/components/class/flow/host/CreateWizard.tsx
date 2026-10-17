// SDD-209 H1~H2 — 클래스 만들기 마법사 뷰(FH02a~e). 상태·API 는 컨테이너/하니스가 props 로 넘긴다.
import type { Dispatch, ReactNode } from 'react';
import { AlertTriangle, Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { WizardAction, WizardMember, WizardState } from '../../../../lib/class/class-wizard';
import { FlowButton, FlowSheet, FlowSteps } from '../shared/flow-primitives';
import { FhInfo } from './host-flow-atoms';
import { HostFlowFrame } from './HostFlowFrame';
import { StepConfirm, StepInvite, StepRecord, StepSchedule, StepType } from './wizard-steps';

export interface WizardViewProps {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  /** 마지막 단계 `클래스 만들기` — 제출 중이면 비활성 */
  onSubmit?: () => void;
  submitting?: boolean;
  /** 나가기 확정 */
  onExit?: () => void;
  backdropSrc?: string;
  /** 일정 표기 기준일(기본: 지금) */
  base?: Date;
  /** 같은 시간대 기존 클래스 제목(충돌 안내) */
  conflictTitle?: string | null;
  /** 초대할 수 있는 회원 목록 */
  members?: readonly WizardMember[];
  membersState?: 'ok' | 'loading' | 'error';
  onCsvText?: (text: string) => void;
  /** 제출 실패 안내(서버 원문이 아닌 정해진 문구) */
  error?: string | null;
}

function StepBody({ state, dispatch, base, conflictTitle = null, members = [], membersState, onCsvText }: WizardViewProps & { base: Date }): ReactNode {
  const props = { draft: state.draft, ui: state.ui, dispatch };
  switch (state.step) {
    case 1:
      return <StepType {...props} />;
    case 2:
      return <StepRecord {...props} />;
    case 3:
      return <StepSchedule {...props} base={base} conflictTitle={conflictTitle} />;
    case 4:
      return <StepInvite {...props} members={members} membersState={membersState} onCsvText={onCsvText} />;
    case 5:
      return <StepConfirm {...props} base={base} />;
    default:
      return null;
  }
}

export function WizardView(props: WizardViewProps) {
  const { state, dispatch, onSubmit, submitting = false, onExit, backdropSrc, base = new Date() } = props;
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
      <StepBody {...props} base={base} />
      {props.error ? <FhInfo warn role="alert">{props.error}</FhInfo> : null}
    </HostFlowFrame>
  );
}
